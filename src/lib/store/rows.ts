import {
  appointmentSchema,
  approvalRequestSchema,
  businessSchema,
  clientPackageSchema,
  clientSchema,
  depositSchema,
  packageTemplateSchema,
  serviceSchema,
  type Appointment,
  type Deposit,
} from "@/lib/schemas/entities";

/** DB row (snake_case) ⇄ entity (camelCase) mapping. Rows are validated on the way in. */

type Row = Record<string, unknown>;

/** Postgres returns timestamptz as "+00:00" strings; normalize to ISO-8601 Z for stable comparisons. */
function ts(value: unknown): string | null {
  return value === null || value === undefined ? null : new Date(String(value)).toISOString();
}

export const toBusiness = (r: Row) =>
  businessSchema.parse({
    id: r.id,
    slug: r.slug,
    name: r.name,
    integrationMode: r.integration_mode,
    paymentProvider: r.payment_provider,
    googleCalendarId: r.google_calendar_id ?? null,
    whatsappPhoneNumberId: r.whatsapp_phone_number_id ?? null,
    settings: r.settings ?? {},
  });

export const toService = (r: Row) =>
  serviceSchema.parse({
    id: r.id,
    businessId: r.business_id,
    name: r.name,
    description: r.description ?? "",
    category: r.category ?? "general",
    durationMin: r.duration_min,
    priceMinor: r.price_minor,
    depositOverrideMinor: r.deposit_override_minor ?? null,
    active: r.active,
  });

export const toPackageTemplate = (r: Row) =>
  packageTemplateSchema.parse({
    id: r.id,
    businessId: r.business_id,
    serviceId: r.service_id,
    name: r.name,
    sessionsTotal: r.sessions_total,
    priceMinor: r.price_minor,
    intervalDays: r.interval_days,
    active: r.active,
  });

export const toClient = (r: Row) =>
  clientSchema.parse({
    id: r.id,
    businessId: r.business_id,
    name: r.name ?? null,
    phone: r.phone,
    email: r.email ?? null,
    notes: r.notes ?? null,
    lastVisitAt: ts(r.last_visit_at),
    lastReengagedAt: ts(r.last_reengaged_at),
  });

export const toClientPackage = (r: Row) =>
  clientPackageSchema.parse({
    id: r.id,
    businessId: r.business_id,
    clientId: r.client_id,
    packageTemplateId: r.package_template_id,
    sessionsTotal: r.sessions_total,
    sessionsUsed: r.sessions_used,
    status: r.status,
    purchasedAt: ts(r.purchased_at),
    expiresAt: ts(r.expires_at),
  });

export const toAppointment = (r: Row) =>
  appointmentSchema.parse({
    id: r.id,
    businessId: r.business_id,
    clientId: r.client_id,
    serviceId: r.service_id,
    clientPackageId: r.client_package_id ?? null,
    startsAt: ts(r.starts_at),
    endsAt: ts(r.ends_at),
    status: r.status,
    priceMinor: r.price_minor,
    depositMinor: r.deposit_minor,
    holdExpiresAt: ts(r.hold_expires_at),
    calendarEventId: r.calendar_event_id ?? null,
    source: r.source,
    notes: r.notes ?? null,
  });

export const fromAppointment = (a: Appointment): Row => ({
  id: a.id,
  business_id: a.businessId,
  client_id: a.clientId,
  service_id: a.serviceId,
  client_package_id: a.clientPackageId,
  starts_at: a.startsAt,
  ends_at: a.endsAt,
  status: a.status,
  price_minor: a.priceMinor,
  deposit_minor: a.depositMinor,
  hold_expires_at: a.holdExpiresAt,
  calendar_event_id: a.calendarEventId,
  source: a.source,
  notes: a.notes,
});

export const toDeposit = (r: Row) =>
  depositSchema.parse({
    id: r.id,
    businessId: r.business_id,
    appointmentId: r.appointment_id,
    provider: r.provider,
    linkId: r.link_id,
    url: r.url,
    amountMinor: r.amount_minor,
    currency: String(r.currency).trim(),
    status: r.status,
    providerTxnId: r.provider_txn_id ?? null,
    expiresAt: ts(r.expires_at),
    paidAt: ts(r.paid_at),
  });

export const fromDeposit = (d: Deposit): Row => ({
  id: d.id,
  business_id: d.businessId,
  appointment_id: d.appointmentId,
  provider: d.provider,
  link_id: d.linkId,
  url: d.url,
  amount_minor: d.amountMinor,
  currency: d.currency,
  status: d.status,
  provider_txn_id: d.providerTxnId,
  expires_at: d.expiresAt,
  paid_at: d.paidAt,
});

export const toApprovalRequest = (r: Row) =>
  approvalRequestSchema.parse({
    id: r.id,
    businessId: r.business_id,
    clientId: r.client_id,
    appointmentId: r.appointment_id ?? null,
    kind: r.kind,
    details: r.details,
    status: r.status,
    createdAt: ts(r.created_at),
  });
