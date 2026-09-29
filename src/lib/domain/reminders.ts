import type { Appointment } from "@/lib/schemas/entities";
import { HOUR_MS } from "./time";

export type NotificationKind = "day_before_reminder" | "package_nudge" | "reactivation" | "deposit_link";

/** Stable dedupe keys — the `notifications_sent.dedupe_key` unique index makes every send idempotent. */
export const dedupeKey = {
  dayBeforeReminder: (appointmentId: string) => `day_before_reminder:${appointmentId}`,
  packageNudge: (clientPackageId: string, nextSession: number) => `package_nudge:${clientPackageId}:${nextSession}`,
  reactivation: (clientId: string, isoDay: string) => `reactivation:${clientId}:${isoDay}`,
  depositLink: (depositId: string) => `deposit_link:${depositId}`,
} as const;

export interface ReminderWindow {
  hoursBefore: number;
  /** Skip appointments starting sooner than this — the booking confirmation already covered them. */
  minHoursBefore: number;
}

export function dueDayBeforeReminders(
  appointments: readonly Appointment[],
  now: Date,
  window: ReminderWindow,
  alreadySent: ReadonlySet<string>,
): Appointment[] {
  const upper = now.getTime() + window.hoursBefore * HOUR_MS;
  const lower = now.getTime() + window.minHoursBefore * HOUR_MS;
  return appointments.filter((a) => {
    const start = new Date(a.startsAt).getTime();
    return a.status === "confirmed" && start > lower && start <= upper && !alreadySent.has(dedupeKey.dayBeforeReminder(a.id));
  });
}
