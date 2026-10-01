import { shiftLocalDay, zonedWallTime, type LocalDay } from "@/lib/domain/time";
import type { AppointmentStatus } from "@/lib/schemas/entities";
import { formatWeekdayTime, isoDayOf, localIsoDay, parseIsoDay } from "./format";

/** Pure view-model logic for /agenda. No I/O. */

export type AgendaView = "day" | "week";

export interface AgendaParams {
  view: AgendaView;
  anchor: LocalDay;
}

export function parseAgendaParams(
  raw: { view?: string | string[]; date?: string | string[] },
  now: Date,
  timezone: string,
): AgendaParams {
  const view: AgendaView = raw.view === "day" ? "day" : "week";
  const date = typeof raw.date === "string" ? raw.date : undefined;
  const anchor = parseIsoDay(date, timezone) ?? parseIsoDay(localIsoDay(now, timezone), timezone)!;
  return { view, anchor };
}

export interface AgendaRange {
  days: LocalDay[];
  from: Date;
  to: Date;
}

/** Day view = the anchor day; week view = Monday..Sunday containing the anchor. [from, to) in UTC instants. */
export function agendaRange(view: AgendaView, anchor: LocalDay, timezone: string): AgendaRange {
  const mondayOffset = (anchor.weekday + 6) % 7;
  const first = view === "day" ? anchor : shiftLocalDay(anchor, -mondayOffset, timezone);
  const count = view === "day" ? 1 : 7;
  const days = Array.from({ length: count }, (_, i) => shiftLocalDay(first, i, timezone));
  const last = days[days.length - 1]!;
  const after = shiftLocalDay(last, 1, timezone);
  return {
    days,
    from: zonedWallTime(first.year, first.monthIndex, first.day, "00:00", timezone),
    to: zonedWallTime(after.year, after.monthIndex, after.day, "00:00", timezone),
  };
}

/** Navigation targets (previous/next period) as ISO days. */
export function agendaNeighbours(view: AgendaView, anchor: LocalDay, timezone: string): { prev: string; next: string } {
  const step = view === "day" ? 1 : 7;
  return {
    prev: isoDayOf(shiftLocalDay(anchor, -step, timezone)),
    next: isoDayOf(shiftLocalDay(anchor, step, timezone)),
  };
}

export interface DepositInfo {
  status: "pending" | "paid" | "expired" | "refunded";
  expiresAt: string;
  createdAt?: string | null;
}

/** The deposit that best describes an appointment: a paid one wins, otherwise the most recent. */
export function pickDeposit<T extends DepositInfo>(deposits: readonly T[]): T | null {
  const paid = deposits.find((d) => d.status === "paid");
  if (paid) return paid;
  return [...deposits].sort((a, b) => (b.createdAt ?? b.expiresAt).localeCompare(a.createdAt ?? a.expiresAt))[0] ?? null;
}

export type DepositBadgeKind = "package" | "paid" | "pending" | "expired" | "refunded" | "none";

export interface DepositBadge {
  kind: DepositBadgeKind;
  label: string;
  /** Only for "pending": when the hold / payment link expires. */
  expiresAt: string | null;
}

export interface BadgeInput {
  status: AppointmentStatus;
  clientPackageId: string | null;
  depositMinor: number;
  holdExpiresAt: string | null;
  deposit: DepositInfo | null;
}

export function depositBadge(input: BadgeInput, timezone: string): DepositBadge {
  if (input.clientPackageId !== null) return { kind: "package", label: "📦 Paquete", expiresAt: null };
  if (input.deposit?.status === "paid") return { kind: "paid", label: "💰 Pagado", expiresAt: null };
  if (input.deposit?.status === "refunded") return { kind: "refunded", label: "↩️ Reembolsado", expiresAt: null };
  if (input.status === "hold_pending_deposit" || input.deposit?.status === "pending") {
    const expiresAt = input.holdExpiresAt ?? input.deposit?.expiresAt ?? null;
    const label = expiresAt === null ? "⏳ Pendiente" : `⏳ Pendiente · vence ${formatWeekdayTime(expiresAt, timezone)}`;
    return { kind: "pending", label, expiresAt };
  }
  if (input.deposit?.status === "expired") return { kind: "expired", label: "⌛ Anticipo vencido", expiresAt: null };
  return { kind: "none", label: input.depositMinor === 0 ? "Sin anticipo" : "Anticipo no registrado", expiresAt: null };
}

export const STATUS_LABELS: Readonly<Record<AppointmentStatus, string>> = {
  hold_pending_deposit: "Reservada (esperando anticipo)",
  confirmed: "Confirmada",
  completed: "Completada",
  no_show: "No asistió",
  cancelled: "Cancelada",
  expired: "Vencida",
};

/** Owner actions offered per status (mirrors the domain state machine; `transition()` still enforces it). */
export function availableOwnerActions(status: AppointmentStatus): Array<"complete" | "no_show" | "cancel"> {
  if (status === "confirmed") return ["complete", "no_show", "cancel"];
  if (status === "hold_pending_deposit") return ["cancel"];
  return [];
}

/** Group items (already sorted by start) by local ISO day, keeping every day of the range (possibly empty). */
export function groupByLocalDay<T extends { startsAt: string }>(
  items: readonly T[],
  days: readonly LocalDay[],
  timezone: string,
): Array<{ day: LocalDay; iso: string; items: T[] }> {
  const buckets = new Map(days.map((d) => [isoDayOf(d), [] as T[]]));
  for (const item of [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    buckets.get(localIsoDay(new Date(item.startsAt), timezone))?.push(item);
  }
  return days.map((day) => ({ day, iso: isoDayOf(day), items: buckets.get(isoDayOf(day)) ?? [] }));
}
