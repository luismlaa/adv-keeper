import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * The Cardnet session we opened for a deposit. The `session-key` is needed later to query the result,
 * so it must survive between the hand-off request and the browser's return.
 */
export interface CardnetSessionRecord {
  businessId: string;
  depositId: string;
  linkId: string;
  session: string;
  sessionKey: string;
  transactionId: string;
  amountMinor: number;
}

export interface CardnetSessionStore {
  save(record: CardnetSessionRecord): Promise<void>;
  findBySession(businessId: string, session: string): Promise<CardnetSessionRecord | null>;
  latestForLink(businessId: string, linkId: string): Promise<CardnetSessionRecord | null>;
}

export class MemoryCardnetSessionStore implements CardnetSessionStore {
  readonly records: CardnetSessionRecord[] = [];

  async save(record: CardnetSessionRecord): Promise<void> {
    this.records.push(record);
  }

  async findBySession(businessId: string, session: string): Promise<CardnetSessionRecord | null> {
    return this.records.find((r) => r.businessId === businessId && r.session === session) ?? null;
  }

  async latestForLink(businessId: string, linkId: string): Promise<CardnetSessionRecord | null> {
    return this.records.filter((r) => r.businessId === businessId && r.linkId === linkId).at(-1) ?? null;
  }
}

export const CARDNET_SESSION_ACTION = "cardnet_session_created";

const metaSchema = z.object({
  linkId: z.string().min(1),
  session: z.string().min(1),
  transactionId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  sessionKeyEncrypted: z.string().min(1),
});

const aad = (businessId: string, session: string) => `${businessId}:cardnet_session:${session}`;

/**
 * Persists sessions as `activity_log` rows (actor `payments`, action `cardnet_session_created`), so the
 * hand-off is audited and the session can be found on return without a schema change. The session
 * key is encrypted with ENCRYPTION_KEY, bound to business + session, so it never sits in the log in clear.
 *
 * ⚠️ Proposed core follow-up: a `payment_sessions` table (or `deposits.provider_session`) indexed by
 * session would be cleaner than JSON filters on `activity_log`.
 */
export class ActivityLogCardnetSessionStore implements CardnetSessionStore {
  constructor(
    private readonly db: SupabaseClient,
    private readonly hexKey: string,
  ) {}

  async save(record: CardnetSessionRecord): Promise<void> {
    const { error } = await this.db.from("activity_log").insert({
      business_id: record.businessId,
      actor: "payments",
      entity: "deposit",
      entity_id: record.depositId,
      action: CARDNET_SESSION_ACTION,
      reason: "Client sent to the Cardnet hosted checkout to pay the deposit",
      meta: {
        linkId: record.linkId,
        session: record.session,
        transactionId: record.transactionId,
        amountMinor: record.amountMinor,
        sessionKeyEncrypted: encryptSecret(record.sessionKey, this.hexKey, aad(record.businessId, record.session)),
      },
    });
    if (error) throw new Error(`Saving Cardnet session failed: ${error.message}`);
  }

  private async findOne(businessId: string, key: "session" | "linkId", value: string): Promise<CardnetSessionRecord | null> {
    const { data, error } = await this.db
      .from("activity_log")
      .select("entity_id, meta")
      .eq("business_id", businessId)
      .eq("action", CARDNET_SESSION_ACTION)
      .eq(`meta->>${key}`, value)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Loading Cardnet session failed: ${error.message}`);
    if (data === null) return null;
    const meta = metaSchema.parse(data.meta);
    return {
      businessId,
      depositId: String(data.entity_id),
      linkId: meta.linkId,
      session: meta.session,
      transactionId: meta.transactionId,
      amountMinor: meta.amountMinor,
      sessionKey: decryptSecret(meta.sessionKeyEncrypted, this.hexKey, aad(businessId, meta.session)),
    };
  }

  findBySession(businessId: string, session: string): Promise<CardnetSessionRecord | null> {
    return this.findOne(businessId, "session", session);
  }

  latestForLink(businessId: string, linkId: string): Promise<CardnetSessionRecord | null> {
    return this.findOne(businessId, "linkId", linkId);
  }
}
