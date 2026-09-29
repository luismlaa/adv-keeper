import type { SupabaseClient } from "@supabase/supabase-js";
import { fromAppointment, fromDeposit } from "@/lib/store/rows";
import { buildDemoDataset, DEMO_BUSINESS_ID, type DemoDataset } from "./dataset";

export interface SeedDemoOptions {
  now: Date;
  slug: string;
  appUrl: string;
  ownerEmail: string;
  ownerPassword: string;
}

export interface SeedDemoResult {
  businessId: string;
  ownerUserId: string;
  counts: Record<string, number>;
}

async function insert(db: SupabaseClient, table: string, rows: readonly Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from(table).insert(rows);
  if (error) throw new Error(`Seeding ${table} failed: ${error.message}`);
}

async function ensureDemoOwner(db: SupabaseClient, email: string, password: string): Promise<string> {
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { demo: true } });
  if (created.data.user) return created.data.user.id;

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Listing auth users failed: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) {
      // Reset the password on every seed so a prospect can't lock the demo by changing it.
      const updated = await db.auth.admin.updateUserById(match.id, { password });
      if (updated.error) throw new Error(`Resetting demo password failed: ${updated.error.message}`);
      return match.id;
    }
    if (data.users.length < 200) break;
  }
  throw new Error(`Could not create or find demo owner ${email}: ${created.error?.message ?? "unknown error"}`);
}

/**
 * Wipes and recreates the demo tenant (cascade delete by business id) with fresh data relative to
 * `now`. Used by `npm run seed:demo` and the nightly demo-reset cron. Requires the service-role client.
 */
export async function seedDemo(db: SupabaseClient, opts: SeedDemoOptions): Promise<SeedDemoResult> {
  const data: DemoDataset = buildDemoDataset(opts.now, { slug: opts.slug, appUrl: opts.appUrl });

  const removed = await db.from("businesses").delete().or(`id.eq.${DEMO_BUSINESS_ID},slug.eq.${opts.slug}`);
  if (removed.error) throw new Error(`Removing previous demo tenant failed: ${removed.error.message}`);

  const b = data.business;
  await insert(db, "businesses", [
    {
      id: b.id,
      slug: b.slug,
      name: b.name,
      integration_mode: b.integrationMode,
      payment_provider: b.paymentProvider,
      google_calendar_id: b.googleCalendarId,
      whatsapp_phone_number_id: b.whatsappPhoneNumberId,
      settings: b.settings,
    },
  ]);
  await insert(
    db,
    "services",
    data.services.map((s, i) => ({
      id: s.id,
      business_id: s.businessId,
      name: s.name,
      description: s.description,
      category: s.category,
      duration_min: s.durationMin,
      price_minor: s.priceMinor,
      deposit_override_minor: s.depositOverrideMinor,
      active: s.active,
      sort: i,
    })),
  );
  await insert(
    db,
    "package_templates",
    data.packageTemplates.map((p) => ({
      id: p.id,
      business_id: p.businessId,
      service_id: p.serviceId,
      name: p.name,
      sessions_total: p.sessionsTotal,
      price_minor: p.priceMinor,
      interval_days: p.intervalDays,
      active: p.active,
    })),
  );
  await insert(
    db,
    "clients",
    data.clients.map((c) => ({
      id: c.id,
      business_id: c.businessId,
      name: c.name,
      phone: c.phone,
      email: c.email,
      notes: c.notes,
      last_visit_at: c.lastVisitAt,
      last_reengaged_at: c.lastReengagedAt,
    })),
  );
  await insert(
    db,
    "client_packages",
    data.clientPackages.map((p) => ({
      id: p.id,
      business_id: p.businessId,
      client_id: p.clientId,
      package_template_id: p.packageTemplateId,
      sessions_total: p.sessionsTotal,
      sessions_used: p.sessionsUsed,
      status: p.status,
      purchased_at: p.purchasedAt,
      expires_at: p.expiresAt,
    })),
  );
  await insert(db, "appointments", data.appointments.map(fromAppointment));
  await insert(db, "deposits", data.deposits.map(fromDeposit));

  const ownerUserId = await ensureDemoOwner(db, opts.ownerEmail, opts.ownerPassword);
  await insert(db, "memberships", [{ user_id: ownerUserId, business_id: b.id, role: "owner" }]);

  return {
    businessId: b.id,
    ownerUserId,
    counts: {
      services: data.services.length,
      packageTemplates: data.packageTemplates.length,
      clients: data.clients.length,
      clientPackages: data.clientPackages.length,
      appointments: data.appointments.length,
      deposits: data.deposits.length,
    },
  };
}
