import { describe, expect, it } from "vitest";
import { DEFAULT_BUSINESS_SETTINGS } from "@/lib/config/business-settings";
import { computeAvailableSlots, isSlotAvailable } from "@/lib/domain/slots";
import { NOW } from "../helpers/fixtures";

const s = DEFAULT_BUSINESS_SETTINGS;
const base = {
  now: NOW, // Monday 08:00 local
  timezone: s.timezone,
  weeklyHours: s.weeklyHours,
  durationMin: 60,
  bufferMin: 10,
  stepMin: 30,
  minLeadMinutes: 120,
  horizonDays: 30,
  busy: [],
};

const localHHMM = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: s.timezone, hour: "2-digit", minute: "2-digit" }).format(d);

describe("computeAvailableSlots", () => {
  it("respects the minimum lead time on the current day", () => {
    const slots = computeAvailableSlots({ ...base, from: NOW, days: 1 });
    expect(localHHMM(slots[0]!)).toBe("10:00");
  });

  it("only offers slots that finish before closing", () => {
    const slots = computeAvailableSlots({ ...base, from: NOW, days: 1 });
    expect(localHHMM(slots.at(-1)!)).toBe("17:00"); // Monday closes 18:00, 60-min service
  });

  it("skips busy blocks including the post-appointment buffer", () => {
    const busy = [{ start: new Date("2026-09-28T15:00:00Z"), end: new Date("2026-09-28T16:00:00Z") }]; // 11:00–12:00 local
    const slots = computeAvailableSlots({ ...base, busy, from: NOW, days: 1 }).map(localHHMM);
    expect(slots).not.toContain("10:00"); // 10:00–11:10 (with buffer) overlaps the 11:00 block
    expect(slots).not.toContain("10:30");
    expect(slots).not.toContain("11:00");
    expect(slots).not.toContain("11:30");
    expect(slots).toContain("12:00");
  });

  it("returns nothing on Sunday (closed)", () => {
    const sunday = new Date("2026-10-04T14:00:00Z");
    expect(computeAvailableSlots({ ...base, from: sunday, days: 1 })).toEqual([]);
  });

  it("confirms a specific start is still free", () => {
    expect(isSlotAvailable(base, new Date("2026-09-29T14:00:00Z"))).toBe(true);
    expect(isSlotAvailable(base, new Date("2026-09-29T14:10:00Z"))).toBe(false); // not on the 30-min grid
  });
});
