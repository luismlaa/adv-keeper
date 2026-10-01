import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export type IntegrationProvider = "google_calendar" | "azul" | "cardnet";

export interface StoredIntegration {
  businessId: string;
  provider: IntegrationProvider;
  encryptedCredentials: string;
  accountEmail: string | null;
}

/** Raw persistence of encrypted integration rows. Every method is scoped by `businessId`. */
export interface IntegrationRepo {
  get(businessId: string, provider: IntegrationProvider): Promise<StoredIntegration | null>;
  upsert(row: StoredIntegration): Promise<void>;
  remove(businessId: string, provider: IntegrationProvider): Promise<void>;
}

const aad = (businessId: string, provider: IntegrationProvider) => `${businessId}:${provider}`;

/**
 * Typed, encrypted credentials per business + provider. Callers pass a zod schema for the provider's
 * JSON shape, so a malformed or stale row fails loudly instead of reaching a gateway call.
 */
export class IntegrationCredentials {
  constructor(
    private readonly repo: IntegrationRepo,
    private readonly hexKey: string,
  ) {}

  async read<T>(businessId: string, provider: IntegrationProvider, schema: z.ZodType<T>): Promise<T | null> {
    const row = await this.repo.get(businessId, provider);
    if (row === null) return null;
    return schema.parse(JSON.parse(decryptSecret(row.encryptedCredentials, this.hexKey, aad(businessId, provider))));
  }

  async save(businessId: string, provider: IntegrationProvider, credentials: unknown, accountEmail: string | null = null): Promise<void> {
    const encryptedCredentials = encryptSecret(JSON.stringify(credentials), this.hexKey, aad(businessId, provider));
    await this.repo.upsert({ businessId, provider, encryptedCredentials, accountEmail });
  }

  remove(businessId: string, provider: IntegrationProvider): Promise<void> {
    return this.repo.remove(businessId, provider);
  }
}

/** Service-role repo (the table has no RLS policies: only the server can touch tokens). */
export class SupabaseIntegrationRepo implements IntegrationRepo {
  constructor(private readonly db: SupabaseClient) {}

  async get(businessId: string, provider: IntegrationProvider): Promise<StoredIntegration | null> {
    const { data, error } = await this.db
      .from("integrations")
      .select("encrypted_credentials, account_email")
      .eq("business_id", businessId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw new Error(`Loading ${provider} integration failed: ${error.message}`);
    if (data === null) return null;
    return { businessId, provider, encryptedCredentials: data.encrypted_credentials as string, accountEmail: (data.account_email as string | null) ?? null };
  }

  async upsert(row: StoredIntegration): Promise<void> {
    const { error } = await this.db.from("integrations").upsert(
      {
        business_id: row.businessId,
        provider: row.provider,
        encrypted_credentials: row.encryptedCredentials,
        account_email: row.accountEmail,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id,provider" },
    );
    if (error) throw new Error(`Saving ${row.provider} integration failed: ${error.message}`);
  }

  async remove(businessId: string, provider: IntegrationProvider): Promise<void> {
    const { error } = await this.db.from("integrations").delete().eq("business_id", businessId).eq("provider", provider);
    if (error) throw new Error(`Removing ${provider} integration failed: ${error.message}`);
  }
}

/** In-memory repo for tests. */
export class MemoryIntegrationRepo implements IntegrationRepo {
  readonly rows: StoredIntegration[] = [];

  async get(businessId: string, provider: IntegrationProvider): Promise<StoredIntegration | null> {
    return this.rows.find((r) => r.businessId === businessId && r.provider === provider) ?? null;
  }

  async upsert(row: StoredIntegration): Promise<void> {
    const i = this.rows.findIndex((r) => r.businessId === row.businessId && r.provider === row.provider);
    if (i === -1) this.rows.push(row);
    else this.rows[i] = row;
  }

  async remove(businessId: string, provider: IntegrationProvider): Promise<void> {
    const i = this.rows.findIndex((r) => r.businessId === businessId && r.provider === provider);
    if (i !== -1) this.rows.splice(i, 1);
  }
}
