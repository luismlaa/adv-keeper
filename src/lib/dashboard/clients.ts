import { nextSessionLabel, packageProgress } from "@/lib/domain/packages";
import { DAY_MS } from "@/lib/domain/time";
import type { AppointmentStatus, ClientPackage } from "@/lib/schemas/entities";

/** Pure helpers for /clientas. No I/O. */

/**
 * Makes free text safe to embed in a PostgREST `or=(...ilike...)` filter: drops the characters that
 * carry meaning in that syntax (commas, parentheses, wildcards, quotes, backslashes) and caps length.
 */
export function sanitizeSearch(raw: string | string[] | undefined): string {
  const value = typeof raw === "string" ? raw : "";
  return value.replace(/[,()*%\\"':]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export interface PackageHistoryItem {
  startsAt: string;
  status: AppointmentStatus;
  clientPackageId: string | null;
}

export interface PackageOutlook {
  used: number;
  remaining: number;
  total: number;
  /** "sesión 4 de 10", or null once the package is finished. */
  nextLabel: string | null;
  /** Upcoming booked session for this package, if any. */
  nextBookedAt: string | null;
  /** When the next session is recommended (last session + interval_days), if nothing is booked. */
  recommendedAt: string | null;
  /** True when the recommended date has passed and nothing is booked. */
  overdue: boolean;
}

/** Progress plus "what comes next" for one client package, from its appointment history. */
export function packageOutlook(
  pkg: ClientPackage,
  intervalDays: number,
  history: readonly PackageHistoryItem[],
  now: Date,
): PackageOutlook {
  const progress = packageProgress(pkg);
  const own = history.filter((h) => h.clientPackageId === pkg.id);
  const finished = pkg.status !== "active" || progress.remaining === 0;
  const nextBookedAt =
    own
      .filter((h) => (h.status === "confirmed" || h.status === "hold_pending_deposit") && new Date(h.startsAt) >= now)
      .map((h) => h.startsAt)
      .sort()[0] ?? null;
  const lastSessionAt =
    own
      .filter((h) => h.status === "completed")
      .map((h) => h.startsAt)
      .sort()
      .at(-1) ?? null;
  const recommendedAt =
    finished || nextBookedAt !== null || lastSessionAt === null
      ? null
      : new Date(new Date(lastSessionAt).getTime() + intervalDays * DAY_MS).toISOString();
  return {
    used: progress.used,
    remaining: progress.remaining,
    total: progress.total,
    nextLabel: finished ? null : nextSessionLabel(pkg),
    nextBookedAt,
    recommendedAt,
    overdue: recommendedAt !== null && new Date(recommendedAt) <= now,
  };
}

/** Most recent completed visit from the history, falling back to the stored `last_visit_at`. */
export function lastVisit(history: readonly PackageHistoryItem[], stored: string | null): string | null {
  const fromHistory = history
    .filter((h) => h.status === "completed")
    .map((h) => h.startsAt)
    .sort()
    .at(-1);
  if (fromHistory === undefined) return stored;
  if (stored === null) return fromHistory;
  return new Date(fromHistory) > new Date(stored) ? fromHistory : stored;
}
