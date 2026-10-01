import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationProvider } from "@/lib/integrations/repo";
import type { Business } from "@/lib/schemas/entities";

export interface NewBusiness {
  slug: string;
  name: string;
}

export interface BusinessPatch {
  integrationMode?: Business["integrationMode"];
  paymentProvider?: Business["paymentProvider"];
  whatsappPhoneNumberId?: string | null;
}

/** Operator-side persistence for onboarding (service role). Every write targets one business. */
export interface OnboardingRepo {
  findBusinessBySlug(slug: string): Promise<Business | null>;
  /** Business that already uses this WhatsApp phone number id, if any. */
  findBusinessByWhatsappId(phoneNumberId: string): Promise<Business | null>;
  insertBusiness(input: NewBusiness): Promise<Business>;
  updateBusiness(businessId: string, patch: BusinessPatch): Promise<Business>;
  /** Existing auth user id for this email, or null. */
  findUserIdByEmail(email: string): Promise<string | null>;
  createUser(email: string, password: string): Promise<string>;
  addOwnerMembership(userId: string, businessId: string): Promise<void>;
  ownerEmails(businessId: string): Promise<string[]>;
  countActiveServices(businessId: string): Promise<number>;
  hasIntegration(businessId: string, provider: IntegrationProvider): Promise<boolean>;
}

const BUSINESS_COLUMNS = "id, slug, name, integration_mode, payment_provider, google_calendar_id, whatsapp_phone_number_id, settings";

function toBusiness(row: Record<string, unknown>): Business {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    integrationMode: row.integration_mode as Business["integrationMode"],
    paymentProvider: row.payment_provider as Business["paymentProvider"],
    googleCalendarId: (row.google_calendar_id as string | null) ?? null,
    whatsappPhoneNumberId: (row.whatsapp_phone_number_id as string | null) ?? null,
    settings: row.settings,
  };
}

function fail(operation: string, error: { message: string }): never {
  throw new Error(`${operation} failed: ${error.message}`);
}

export class SupabaseOnboardingRepo implements OnboardingRepo {
  constructor(private readonly db: SupabaseClient) {}

  async findBusinessBySlug(slug: string): Promise<Business | null> {
    const { data, error } = await this.db.from("businesses").select(BUSINESS_COLUMNS).eq("slug", slug).maybeSingle();
    if (error) fail("findBusinessBySlug", error);
    return data ? toBusiness(data) : null;
  }

  async findBusinessByWhatsappId(phoneNumberId: string): Promise<Business | null> {
    const { data, error } = await this.db.from("businesses").select(BUSINESS_COLUMNS).eq("whatsapp_phone_number_id", phoneNumberId).maybeSingle();
    if (error) fail("findBusinessByWhatsappId", error);
    return data ? toBusiness(data) : null;
  }

  async insertBusiness(input: NewBusiness): Promise<Business> {
    // New tenants always start in demo mode with fake payments: nothing reaches a client until go-live.
    const { data, error } = await this.db
      .from("businesses")
      .insert({ slug: input.slug, name: input.name, integration_mode: "demo", payment_provider: "fake" })
      .select(BUSINESS_COLUMNS)
      .single();
    if (error) fail("insertBusiness", error);
    return toBusiness(data);
  }

  async updateBusiness(businessId: string, patch: BusinessPatch): Promise<Business> {
    const row: Record<string, unknown> = {};
    if (patch.integrationMode !== undefined) row.integration_mode = patch.integrationMode;
    if (patch.paymentProvider !== undefined) row.payment_provider = patch.paymentProvider;
    if (patch.whatsappPhoneNumberId !== undefined) row.whatsapp_phone_number_id = patch.whatsappPhoneNumberId;
    const { data, error } = await this.db.from("businesses").update(row).eq("id", businessId).select(BUSINESS_COLUMNS).single();
    if (error) fail("updateBusiness", error);
    return toBusiness(data);
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await this.db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) fail("listUsers", error);
      const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (match) return match.id;
      if (data.users.length < 200) return null;
    }
    return null;
  }

  async createUser(email: string, password: string): Promise<string> {
    const { data, error } = await this.db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) fail("createUser", error ?? { message: "no user returned" });
    return data.user.id;
  }

  async addOwnerMembership(userId: string, businessId: string): Promise<void> {
    const { error } = await this.db
      .from("memberships")
      .upsert({ user_id: userId, business_id: businessId, role: "owner" }, { onConflict: "user_id,business_id" });
    if (error) fail("addOwnerMembership", error);
  }

  async ownerEmails(businessId: string): Promise<string[]> {
    const { data, error } = await this.db.from("memberships").select("user_id").eq("business_id", businessId).eq("role", "owner");
    if (error) fail("ownerEmails", error);
    const emails: string[] = [];
    for (const row of data ?? []) {
      const user = await this.db.auth.admin.getUserById(row.user_id as string);
      if (user.data.user?.email) emails.push(user.data.user.email);
    }
    return emails;
  }

  async countActiveServices(businessId: string): Promise<number> {
    const { count, error } = await this.db
      .from("services")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("active", true);
    if (error) fail("countActiveServices", error);
    return count ?? 0;
  }

  async hasIntegration(businessId: string, provider: IntegrationProvider): Promise<boolean> {
    const { count, error } = await this.db
      .from("integrations")
      .select("business_id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("provider", provider);
    if (error) fail("hasIntegration", error);
    return (count ?? 0) > 0;
  }
}
