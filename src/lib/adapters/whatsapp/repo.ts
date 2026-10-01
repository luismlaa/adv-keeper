import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityEntry, Business } from "@/lib/schemas/entities";
import { toBusiness } from "@/lib/store/rows";

export const INBOUND_ACTION = "whatsapp_inbound";
const UNIQUE_VIOLATION = "23505";

export interface InboundClaim {
  businessId: string;
  wamid: string;
  reason: string;
  meta: Record<string, unknown>;
}

/** Data access for the WhatsApp webhook. Service-role; every activity query filters by business_id. */
export interface WhatsAppRepo {
  findBusinessByPhoneNumberId(phoneNumberId: string): Promise<Business | null>;
  /**
   * Records `activity_log(action='whatsapp_inbound', entity_id=wamid)` unless it already exists.
   * Returns false for a message we have already seen — the caller must not process it again.
   */
  claimInbound(claim: InboundClaim): Promise<boolean>;
}

export class SupabaseWhatsAppRepo implements WhatsAppRepo {
  constructor(private readonly db: SupabaseClient) {}

  async findBusinessByPhoneNumberId(phoneNumberId: string): Promise<Business | null> {
    const { data, error } = await this.db.from("businesses").select("*").eq("whatsapp_phone_number_id", phoneNumberId).maybeSingle();
    if (error) throw new Error(`Looking up business by WhatsApp phone number id failed: ${error.message}`);
    return data ? toBusiness(data) : null;
  }

  async claimInbound(claim: InboundClaim): Promise<boolean> {
    const existing = await this.db
      .from("activity_log")
      .select("id")
      .eq("business_id", claim.businessId)
      .eq("action", INBOUND_ACTION)
      .eq("entity_id", claim.wamid)
      .limit(1);
    if (existing.error) throw new Error(`Checking WhatsApp dedupe failed: ${existing.error.message}`);
    if (existing.data.length > 0) return false;

    const { error } = await this.db.from("activity_log").insert({
      business_id: claim.businessId,
      actor: "whatsapp",
      entity: "whatsapp_message",
      entity_id: claim.wamid,
      action: INBOUND_ACTION,
      reason: claim.reason,
      meta: claim.meta,
    });
    // With the suggested partial unique index, a concurrent duplicate lands here instead of slipping through.
    if (error?.code === UNIQUE_VIOLATION) return false;
    if (error) throw new Error(`Recording WhatsApp inbound message failed: ${error.message}`);
    return true;
  }
}

/** In-memory repo for tests. `activity` mirrors what would land in activity_log. */
export class MemoryWhatsAppRepo implements WhatsAppRepo {
  readonly activity: ActivityEntry[] = [];

  constructor(private readonly businesses: readonly Business[]) {}

  async findBusinessByPhoneNumberId(phoneNumberId: string): Promise<Business | null> {
    return this.businesses.find((b) => b.whatsappPhoneNumberId === phoneNumberId) ?? null;
  }

  async claimInbound(claim: InboundClaim): Promise<boolean> {
    const seen = this.activity.some((a) => a.businessId === claim.businessId && a.action === INBOUND_ACTION && a.entityId === claim.wamid);
    if (seen) return false;
    this.activity.push({
      businessId: claim.businessId,
      actor: "whatsapp",
      entity: "whatsapp_message",
      entityId: claim.wamid,
      action: INBOUND_ACTION,
      reason: claim.reason,
      meta: claim.meta,
    });
    return true;
  }
}
