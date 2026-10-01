import { isPackageNudgeDue, packageProgress } from "@/lib/domain/packages";
import { dedupeKey } from "@/lib/domain/reminders";
import { buildTemplateMessage } from "@/lib/notifications/templates";
import { deliverTemplate, forEachLiveBusiness, requireMessaging, tally, zeroCounts, type CronDeps, type CronSummary } from "./runner";

/**
 * Daily (Vercel cron): "te toca la sesión N de M, ¿agendamos?" via the approved `package_nudge` template.
 * One nudge per package session (`dedupe_key = package_nudge:<clientPackageId>:<nextSession>`).
 */
export async function runPackageNudges(deps: CronDeps): Promise<CronSummary> {
  return forEachLiveBusiness(deps, "package-nudges", async (business) => {
    const now = deps.clock();
    const candidates = (await deps.repo.listNudgeCandidates(business.id, now)).map((c) => {
      const progress = packageProgress(c.clientPackage);
      return { ...c, progress, key: dedupeKey.packageNudge(c.clientPackage.id, progress.nextSession) };
    });
    const due = candidates.filter((c) =>
      isPackageNudgeDue({
        pkg: c.clientPackage,
        intervalDays: c.intervalDays,
        lastSessionAt: c.lastSessionAt,
        hasUpcomingAppointment: c.hasUpcomingAppointment,
        // The dedupe key is per session, so "already nudged since it came due" is the sent-keys check below.
        lastNudgeAt: null,
        now,
      }),
    );
    const sent = await deps.repo.listSentDedupeKeys(business.id, due.map((c) => c.key));
    const pending = due.filter((c) => !sent.has(c.key));
    if (pending.length === 0) return { ...zeroCounts(), duplicates: due.length };

    const messaging = requireMessaging(deps, business);
    let counts = { ...zeroCounts(), duplicates: due.length - pending.length };
    for (const c of pending) {
      const message = buildTemplateMessage("package_nudge", {
        clientName: c.clientName,
        nextSession: c.progress.nextSession,
        sessionsTotal: c.progress.total,
        packageName: c.packageName,
        businessName: business.name,
      });
      const outcome = await deliverTemplate(deps, messaging, {
        business,
        clientId: c.clientPackage.clientId,
        kind: "package_nudge",
        dedupeKey: c.key,
        message: { to: c.clientPhone, ...message },
        entity: "client_package",
        entityId: c.clientPackage.id,
        reason: `Recordatorio de paquete: le toca la sesión ${c.progress.nextSession} de ${c.progress.total}`,
      });
      counts = tally(counts, outcome);
    }
    return counts;
  });
}
