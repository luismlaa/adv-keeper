import { DAY_MS } from "./time";

export interface ReactivationInput {
  clientId: string;
  name: string | null;
  lastVisitAt: string | null;
  lastReengagedAt: string | null;
  hasUpcomingAppointment: boolean;
}

export interface ReactivationCandidate {
  clientId: string;
  name: string | null;
  lastVisitAt: string;
  daysSinceVisit: number;
}

export interface ReactivationPolicy {
  weeks: number;
  cooldownDays: number;
}

/**
 * Clients who haven't come in for `weeks`, have nothing booked, and weren't re-engaged recently.
 * Longest-absent first (but capped to one year — beyond that they are unlikely to return).
 */
export function findReactivationCandidates(
  clients: readonly ReactivationInput[],
  now: Date,
  policy: ReactivationPolicy,
): ReactivationCandidate[] {
  const threshold = now.getTime() - policy.weeks * 7 * DAY_MS;
  const cooldown = now.getTime() - policy.cooldownDays * DAY_MS;
  const oneYear = now.getTime() - 365 * DAY_MS;

  return clients
    .filter((c): c is ReactivationInput & { lastVisitAt: string } => c.lastVisitAt !== null)
    .filter((c) => {
      const visit = new Date(c.lastVisitAt).getTime();
      const reengaged = c.lastReengagedAt === null ? null : new Date(c.lastReengagedAt).getTime();
      return visit <= threshold && visit >= oneYear && !c.hasUpcomingAppointment && (reengaged === null || reengaged < cooldown);
    })
    .map((c) => ({
      clientId: c.clientId,
      name: c.name,
      lastVisitAt: c.lastVisitAt,
      daysSinceVisit: Math.floor((now.getTime() - new Date(c.lastVisitAt).getTime()) / DAY_MS),
    }))
    .sort((a, b) => b.daysSinceVisit - a.daysSinceVisit);
}
