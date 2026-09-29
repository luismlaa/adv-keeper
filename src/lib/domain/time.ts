import { TZDate } from "@date-fns/tz";

export interface Interval {
  start: Date;
  end: Date;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** The instant for a wall-clock time (HH:MM) on a local calendar day in `timezone`. */
export function zonedWallTime(year: number, monthIndex: number, day: number, hhmm: string, timezone: string): Date {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return new Date(new TZDate(year, monthIndex, day, h, m, 0, 0, timezone).getTime());
}

export interface LocalDay {
  year: number;
  monthIndex: number;
  day: number;
  weekday: number;
}

export function localDayOf(instant: Date, timezone: string): LocalDay {
  const z = new TZDate(instant.getTime(), timezone);
  return { year: z.getFullYear(), monthIndex: z.getMonth(), day: z.getDate(), weekday: z.getDay() };
}

/** Local calendar day `offset` days after `base` (DST-safe: constructs by calendar fields, not ms). */
export function shiftLocalDay(base: LocalDay, offset: number, timezone: string): LocalDay {
  const noon = new TZDate(base.year, base.monthIndex, base.day + offset, 12, 0, 0, 0, timezone);
  return localDayOf(new Date(noon.getTime()), timezone);
}

export function formatLocal(instant: Date, timezone: string, locale = "es-DO"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}
