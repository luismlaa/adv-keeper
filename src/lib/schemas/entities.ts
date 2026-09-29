import { z } from "zod";

/** Domain entities (camelCase). The store layer maps DB rows (snake_case) to these. */

export const integrationModeSchema = z.enum(["demo", "live"]);
export const paymentProviderSchema = z.enum(["fake", "azul", "cardnet"]);

export const businessSchema = z.object({
  id: z.uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  integrationMode: integrationModeSchema,
  paymentProvider: paymentProviderSchema,
  googleCalendarId: z.string().nullable(),
  whatsappPhoneNumberId: z.string().nullable(),
  settings: z.unknown(),
});
export type Business = z.infer<typeof businessSchema>;

export const serviceSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  name: z.string().min(1),
  description: z.string(),
  category: z.string(),
  durationMin: z.number().int().positive(),
  priceMinor: z.number().int().nonnegative(),
  depositOverrideMinor: z.number().int().nonnegative().nullable(),
  active: z.boolean(),
});
export type Service = z.infer<typeof serviceSchema>;

export const clientSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  name: z.string().nullable(),
  phone: z.string().min(5),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  lastVisitAt: z.string().nullable(),
  lastReengagedAt: z.string().nullable(),
});
export type Client = z.infer<typeof clientSchema>;

export const appointmentStatusSchema = z.enum([
  "hold_pending_deposit",
  "confirmed",
  "completed",
  "no_show",
  "cancelled",
  "expired",
]);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const appointmentSourceSchema = z.enum(["chat", "whatsapp", "owner"]);

export const appointmentSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  clientId: z.uuid(),
  serviceId: z.uuid(),
  clientPackageId: z.uuid().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: appointmentStatusSchema,
  priceMinor: z.number().int().nonnegative(),
  depositMinor: z.number().int().nonnegative(),
  holdExpiresAt: z.string().nullable(),
  calendarEventId: z.string().nullable(),
  source: appointmentSourceSchema,
  notes: z.string().nullable(),
});
export type Appointment = z.infer<typeof appointmentSchema>;

export const depositStatusSchema = z.enum(["pending", "paid", "expired", "refunded"]);

export const depositSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  appointmentId: z.uuid(),
  provider: paymentProviderSchema,
  linkId: z.string().min(1),
  url: z.url(),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3),
  status: depositStatusSchema,
  providerTxnId: z.string().nullable(),
  expiresAt: z.string(),
  paidAt: z.string().nullable(),
});
export type Deposit = z.infer<typeof depositSchema>;

export const packageTemplateSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  serviceId: z.uuid(),
  name: z.string().min(1),
  sessionsTotal: z.number().int().positive(),
  priceMinor: z.number().int().nonnegative(),
  intervalDays: z.number().int().positive(),
  active: z.boolean(),
});
export type PackageTemplate = z.infer<typeof packageTemplateSchema>;

export const clientPackageStatusSchema = z.enum(["active", "completed", "expired"]);

export const clientPackageSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  clientId: z.uuid(),
  packageTemplateId: z.uuid(),
  sessionsTotal: z.number().int().positive(),
  sessionsUsed: z.number().int().nonnegative(),
  status: clientPackageStatusSchema,
  purchasedAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type ClientPackage = z.infer<typeof clientPackageSchema>;

export const approvalKindSchema = z.enum(["discount", "off_menu_price", "cancellation", "refund", "other"]);
export type ApprovalKind = z.infer<typeof approvalKindSchema>;

export const approvalRequestSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  clientId: z.uuid(),
  appointmentId: z.uuid().nullable(),
  kind: approvalKindSchema,
  details: z.string().min(1),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.string(),
});
export type ApprovalRequest = z.infer<typeof approvalRequestSchema>;

export const activityEntrySchema = z.object({
  businessId: z.uuid(),
  actor: z.string().min(1),
  entity: z.string().min(1),
  entityId: z.string().nullable(),
  action: z.string().min(1),
  reason: z.string().min(1),
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type ActivityEntry = z.input<typeof activityEntrySchema>;
