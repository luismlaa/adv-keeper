import { resolveBusinessSettings } from "@/lib/config/business-settings";
import { dedupeKey, dueDayBeforeReminders, type ReminderWindow } from "@/lib/domain/reminders";
import { HOUR_MS } from "@/lib/domain/time";
import { buildTemplateMessage } from "@/lib/notifications/templates";
import { deliverTemplate, forEachLiveBusiness, requireMessaging, tally, zeroCounts, type CronDeps, type CronSummary } from "./runner";

/** Appointments starting sooner than this were just booked: the confirmation already covered them. */
export const REMINDER_MIN_HOURS_BEFORE = 2;

/**
 * Hourly (pg_cron): sends the approved `day_before_reminder` template for confirmed appointments that
 * start within the business's `reminderHoursBefore` window. One reminder per appointment, ever
 * (`notifications_sent.dedupe_key = day_before_reminder:<appointmentId>`).
 */
export async function runReminders(deps: CronDeps): Promise<CronSummary> {
  return forEachLiveBusiness(deps, "reminders", async (business) => {
    const settings = resolveBusinessSettings(business.settings);
    const now = deps.clock();
    const window: ReminderWindow = { hoursBefore: settings.reminderHoursBefore, minHoursBefore: REMINDER_MIN_HOURS_BEFORE };
    const candidates = await deps.repo.listReminderCandidates(
      business.id,
      new Date(now.getTime() + window.minHoursBefore * HOUR_MS),
      new Date(now.getTime() + window.hoursBefore * HOUR_MS),
    );
    const sent = await deps.repo.listSentDedupeKeys(
      business.id,
      candidates.map((c) => dedupeKey.dayBeforeReminder(c.appointment.id)),
    );
    const dueIds = new Set(dueDayBeforeReminders(candidates.map((c) => c.appointment), now, window, sent).map((a) => a.id));
    const due = candidates.filter((c) => dueIds.has(c.appointment.id));
    if (due.length === 0) return { ...zeroCounts(), duplicates: candidates.length };

    const messaging = requireMessaging(deps, business);
    let counts = { ...zeroCounts(), duplicates: candidates.length - due.length };
    for (const c of due) {
      const message = buildTemplateMessage("day_before_reminder", {
        clientName: c.clientName,
        serviceName: c.serviceName,
        businessName: business.name,
        startsAt: new Date(c.appointment.startsAt),
        timezone: settings.timezone,
      });
      const outcome = await deliverTemplate(deps, messaging, {
        business,
        clientId: c.appointment.clientId,
        kind: "day_before_reminder",
        dedupeKey: dedupeKey.dayBeforeReminder(c.appointment.id),
        message: { to: c.clientPhone, ...message },
        entity: "appointment",
        entityId: c.appointment.id,
        reason: "Recordatorio automático del día anterior a la cita",
      });
      counts = tally(counts, outcome);
    }
    return counts;
  });
}
