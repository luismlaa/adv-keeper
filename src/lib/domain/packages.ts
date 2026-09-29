import type { ClientPackage } from "@/lib/schemas/entities";
import { DAY_MS } from "./time";
import { DomainError } from "./errors";

export interface PackageProgress {
  nextSession: number;
  total: number;
  used: number;
  remaining: number;
}

export function packageProgress(pkg: ClientPackage): PackageProgress {
  const remaining = Math.max(pkg.sessionsTotal - pkg.sessionsUsed, 0);
  return { nextSession: Math.min(pkg.sessionsUsed + 1, pkg.sessionsTotal), total: pkg.sessionsTotal, used: pkg.sessionsUsed, remaining };
}

/** "sesión 4 de 10" — the next session the client is due for. */
export function nextSessionLabel(pkg: ClientPackage): string {
  const p = packageProgress(pkg);
  return `sesión ${p.nextSession} de ${p.total}`;
}

/** Consume one session when an appointment tied to the package is completed. */
export function consumeSession(pkg: ClientPackage): ClientPackage {
  if (pkg.status !== "active") {
    throw new DomainError("package_not_active", `Package ${pkg.id} is ${pkg.status}`);
  }
  if (pkg.sessionsUsed >= pkg.sessionsTotal) {
    throw new DomainError("package_exhausted", `Package ${pkg.id} has no sessions left`);
  }
  const sessionsUsed = pkg.sessionsUsed + 1;
  return { ...pkg, sessionsUsed, status: sessionsUsed === pkg.sessionsTotal ? "completed" : "active" };
}

export interface PackageNudgeInput {
  pkg: ClientPackage;
  intervalDays: number;
  lastSessionAt: Date | null;
  hasUpcomingAppointment: boolean;
  lastNudgeAt: Date | null;
  now: Date;
}

/**
 * A client is nudged ("te toca sesión N de M, ¿agendamos?") when her package is active, she has no
 * upcoming appointment, the recommended interval since her last session has passed, and she hasn't
 * been nudged since it came due.
 */
export function isPackageNudgeDue(input: PackageNudgeInput): boolean {
  const { pkg, intervalDays, lastSessionAt, hasUpcomingAppointment, lastNudgeAt, now } = input;
  if (pkg.status !== "active" || pkg.sessionsUsed === 0 || pkg.sessionsUsed >= pkg.sessionsTotal) return false;
  if (hasUpcomingAppointment || lastSessionAt === null) return false;
  const dueAt = new Date(lastSessionAt.getTime() + intervalDays * DAY_MS);
  if (now < dueAt) return false;
  return lastNudgeAt === null || lastNudgeAt < dueAt;
}
