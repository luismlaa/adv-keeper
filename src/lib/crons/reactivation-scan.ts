import { resolveBusinessSettings } from "@/lib/config/business-settings";
import { findReactivationCandidates } from "@/lib/domain/reactivation";
import { localDayOf } from "@/lib/domain/time";
import { CRON_ACTOR, forEachLiveBusiness, type CronDeps, type CronSummary } from "./runner";

export const REACTIVATION_DIGEST_ACTION = "reactivation_digest";
const DIGEST_SAMPLE = 20;

/** ISO-8601 week of the local calendar day, e.g. "2026-W40" (weeks start on Monday). */
export function isoWeekKey(instant: Date, timezone: string): string {
  const { year, monthIndex, day } = localDayOf(instant, timezone);
  const date = new Date(Date.UTC(year, monthIndex, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday); // Thursday of this week decides the ISO year.
  const isoYear = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(isoYear, 0, 1)) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Weekly (Vercel cron): a digest for the owner of clients who stopped coming, written to `activity_log`
 * only. No client is messaged: re-engaging stays a deliberate owner action in /reactivar.
 * One digest per business per ISO week (deduped on the `activity_log` row, since nothing is "sent").
 */
export async function runReactivationScan(deps: CronDeps): Promise<CronSummary> {
  return forEachLiveBusiness(deps, "reactivation-scan", async (business) => {
    const settings = resolveBusinessSettings(business.settings);
    const now = deps.clock();
    const week = isoWeekKey(now, settings.timezone);
    if (await deps.repo.hasActivity(business.id, REACTIVATION_DIGEST_ACTION, week)) return { done: 0, duplicates: 1, failed: 0 };

    const inputs = await deps.repo.listReactivationInputs(business.id, now);
    const candidates = findReactivationCandidates(inputs, now, {
      weeks: settings.reactivationWeeks,
      cooldownDays: settings.reengagementCooldownDays,
    });
    if (candidates.length === 0) return { done: 0, duplicates: 0, failed: 0 };

    await deps.store.logActivity({
      businessId: business.id,
      actor: CRON_ACTOR,
      entity: "business",
      entityId: week,
      action: REACTIVATION_DIGEST_ACTION,
      reason: `${candidates.length} ${candidates.length === 1 ? "clienta lleva" : "clientas llevan"} más de ${settings.reactivationWeeks} semanas sin venir: revisa /reactivar`,
      meta: {
        week,
        count: candidates.length,
        clients: candidates.slice(0, DIGEST_SAMPLE).map((c) => ({ clientId: c.clientId, name: c.name, daysSinceVisit: c.daysSinceVisit })),
      },
    });
    return { done: 1, duplicates: 0, failed: 0 };
  });
}
