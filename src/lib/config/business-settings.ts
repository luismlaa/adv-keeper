import { z } from "zod";
import defaults from "../../../config/business-defaults.json";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM");

export const openingWindowSchema = z
  .object({ open: hhmm, close: hhmm })
  .refine((w) => w.open < w.close, { message: "open must be before close" });

export const weeklyHoursSchema = z.object({
  "0": z.array(openingWindowSchema),
  "1": z.array(openingWindowSchema),
  "2": z.array(openingWindowSchema),
  "3": z.array(openingWindowSchema),
  "4": z.array(openingWindowSchema),
  "5": z.array(openingWindowSchema),
  "6": z.array(openingWindowSchema),
});

export const depositPolicySchema = z.object({
  percent: z.number().min(0).max(100),
  minimumMinor: z.number().int().min(0),
  roundToMinor: z.number().int().positive(),
});

export const businessSettingsSchema = z.object({
  currency: z.string().length(3),
  timezone: z.string().min(1),
  locale: z.string().min(2),
  deposit: depositPolicySchema,
  holdMinutes: z.number().int().min(5).max(24 * 60),
  reminderHoursBefore: z.number().int().min(1).max(72),
  reactivationWeeks: z.number().int().min(1).max(52),
  reengagementCooldownDays: z.number().int().min(1).max(90),
  slotStepMinutes: z.number().int().min(5).max(120),
  bufferMinutes: z.number().int().min(0).max(120),
  minLeadMinutes: z.number().int().min(0),
  bookingHorizonDays: z.number().int().min(1).max(180),
  weeklyHours: weeklyHoursSchema,
  tone: z.string().min(1),
  ownerDisplayName: z.string().min(1),
});

export type BusinessSettings = z.infer<typeof businessSettingsSchema>;
export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;
export type DepositPolicy = z.infer<typeof depositPolicySchema>;

export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = businessSettingsSchema.parse(defaults);

/**
 * Per-business overrides are stored as partial JSON in `businesses.settings`.
 * Merge them over the defaults (one level deep for `deposit`) and validate the result.
 */
export function resolveBusinessSettings(overrides: unknown): BusinessSettings {
  const partial = z.record(z.string(), z.unknown()).catch({}).parse(overrides ?? {});
  const depositOverride = z.record(z.string(), z.unknown()).catch({}).parse(partial.deposit ?? {});
  return businessSettingsSchema.parse({
    ...DEFAULT_BUSINESS_SETTINGS,
    ...partial,
    deposit: { ...DEFAULT_BUSINESS_SETTINGS.deposit, ...depositOverride },
  });
}
