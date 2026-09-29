import type { WeeklyHours } from "@/lib/config/business-settings";
import { addMinutes, type Interval, localDayOf, overlaps, shiftLocalDay, zonedWallTime } from "./time";

export interface SlotQuery {
  now: Date;
  /** First local day to consider (any instant within it). */
  from: Date;
  days: number;
  timezone: string;
  weeklyHours: WeeklyHours;
  durationMin: number;
  bufferMin: number;
  stepMin: number;
  minLeadMinutes: number;
  horizonDays: number;
  busy: readonly Interval[];
}

/**
 * Free start times for a service. A slot occupies [start, end + buffer) and must fit fully inside an
 * opening window, start after `now + minLead`, stay within the booking horizon and not overlap any busy block.
 */
export function computeAvailableSlots(q: SlotQuery): Date[] {
  const earliest = addMinutes(q.now, q.minLeadMinutes);
  const horizonEnd = addMinutes(q.now, q.horizonDays * 24 * 60);
  const firstDay = localDayOf(q.from < q.now ? q.now : q.from, q.timezone);
  const slots: Date[] = [];

  for (let offset = 0; offset < q.days; offset++) {
    const day = shiftLocalDay(firstDay, offset, q.timezone);
    const windows = q.weeklyHours[String(day.weekday) as keyof WeeklyHours];
    for (const window of windows) {
      const open = zonedWallTime(day.year, day.monthIndex, day.day, window.open, q.timezone);
      const close = zonedWallTime(day.year, day.monthIndex, day.day, window.close, q.timezone);
      for (let start = open; addMinutes(start, q.durationMin) <= close; start = addMinutes(start, q.stepMin)) {
        if (start < earliest || start > horizonEnd) continue;
        const occupied: Interval = { start, end: addMinutes(start, q.durationMin + q.bufferMin) };
        if (q.busy.some((b) => overlaps(occupied, b))) continue;
        slots.push(start);
      }
    }
  }
  return slots;
}

/** True when the exact start is still bookable — used to re-check a slot right before creating a hold. */
export function isSlotAvailable(q: Omit<SlotQuery, "from" | "days">, start: Date): boolean {
  return computeAvailableSlots({ ...q, from: start, days: 1 }).some((s) => s.getTime() === start.getTime());
}
