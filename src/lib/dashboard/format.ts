import { localDayOf, zonedWallTime, type LocalDay } from "@/lib/domain/time";

/** Presentation helpers for the owner dashboard. Pure — every instant is rendered in the business timezone. */

const LOCALE = "es-DO";

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-09-30" for a local calendar day. */
export function isoDayOf(day: LocalDay): string {
  return `${day.year}-${pad(day.monthIndex + 1)}-${pad(day.day)}`;
}

/** Local calendar day of an instant, as "YYYY-MM-DD". */
export function localIsoDay(instant: Date, timezone: string): string {
  return isoDayOf(localDayOf(instant, timezone));
}

/** Parses "YYYY-MM-DD" into a local day (weekday computed at local noon). Returns null when malformed. */
export function parseIsoDay(value: string | undefined | null, timezone: string): LocalDay | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Round-trip through local noon: rejects impossible dates (e.g. 2026-02-31) and yields the weekday.
  const local = localDayOf(zonedWallTime(year, month - 1, day, "12:00", timezone), timezone);
  if (local.year !== year || local.monthIndex !== month - 1 || local.day !== day) return null;
  return local;
}

/** "3:45 p. m." */
export function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "jue, 3:50 p. m." — short enough for a badge, unambiguous across days. */
export function formatWeekdayTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: timezone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "miércoles 30 de septiembre" */
export function formatDayHeading(day: LocalDay): string {
  const noonUtc = new Date(Date.UTC(day.year, day.monthIndex, day.day, 12));
  return new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(noonUtc);
}

/** "30 sep 2026" */
export function formatDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: timezone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/** "30 sep, 3:45 p. m." */
export function formatDateTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
