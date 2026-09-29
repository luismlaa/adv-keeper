import { describe, expect, it } from "vitest";
import { canTransition, isHoldExpired, transition } from "@/lib/domain/appointment-state";
import { DomainError } from "@/lib/domain/errors";
import { consumeSession, isPackageNudgeDue, nextSessionLabel } from "@/lib/domain/packages";
import { findReactivationCandidates } from "@/lib/domain/reactivation";
import { dedupeKey, dueDayBeforeReminders } from "@/lib/domain/reminders";
import { DAY_MS, HOUR_MS } from "@/lib/domain/time";
import type { Appointment } from "@/lib/schemas/entities";
import { business, client, facial, laserPackage, NOW } from "../helpers/fixtures";

const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: "66666666-6666-4666-8666-666666666666",
  businessId: business.id,
  clientId: client.id,
  serviceId: facial.id,
  clientPackageId: null,
  startsAt: new Date(NOW.getTime() + 20 * HOUR_MS).toISOString(),
  endsAt: new Date(NOW.getTime() + 21 * HOUR_MS).toISOString(),
  status: "confirmed",
  priceMinor: 350000,
  depositMinor: 105000,
  holdExpiresAt: null,
  calendarEventId: null,
  source: "chat",
  notes: null,
  ...over,
});

describe("appointment state machine", () => {
  it("confirms a hold when the deposit is paid and clears the hold expiry", () => {
    const hold = appt({ status: "hold_pending_deposit", holdExpiresAt: NOW.toISOString() });
    const confirmed = transition(hold, "deposit_paid");
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.holdExpiresAt).toBeNull();
    expect(hold.status).toBe("hold_pending_deposit"); // original untouched
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("completed", "deposit_paid")).toBe(false);
    expect(() => transition(appt({ status: "expired" }), "deposit_paid")).toThrow(DomainError);
  });

  it("detects expired holds", () => {
    const hold = appt({ status: "hold_pending_deposit", holdExpiresAt: new Date(NOW.getTime() - 1).toISOString() });
    expect(isHoldExpired(hold, NOW)).toBe(true);
    expect(isHoldExpired(appt(), NOW)).toBe(false);
  });
});

describe("packages", () => {
  it("labels the next session", () => {
    expect(nextSessionLabel(laserPackage)).toBe("sesión 4 de 10");
  });

  it("consumes sessions and completes the package on the last one", () => {
    const almost = { ...laserPackage, sessionsUsed: 9 };
    const done = consumeSession(almost);
    expect(done.sessionsUsed).toBe(10);
    expect(done.status).toBe("completed");
    expect(() => consumeSession(done)).toThrow(DomainError);
  });

  it("nudges only when the interval elapsed, nothing is booked and not nudged since", () => {
    const lastSessionAt = new Date(NOW.getTime() - 31 * DAY_MS);
    const input = { pkg: laserPackage, intervalDays: 30, lastSessionAt, hasUpcomingAppointment: false, lastNudgeAt: null, now: NOW };
    expect(isPackageNudgeDue(input)).toBe(true);
    expect(isPackageNudgeDue({ ...input, hasUpcomingAppointment: true })).toBe(false);
    expect(isPackageNudgeDue({ ...input, lastSessionAt: new Date(NOW.getTime() - 10 * DAY_MS) })).toBe(false);
    expect(isPackageNudgeDue({ ...input, lastNudgeAt: new Date(NOW.getTime() - DAY_MS) })).toBe(false);
  });
});

describe("reactivation", () => {
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS).toISOString();
  const base = { name: "X", lastReengagedAt: null, hasUpcomingAppointment: false };

  it("lists clients absent 6+ weeks with nothing booked, longest absent first", () => {
    const result = findReactivationCandidates(
      [
        { ...base, clientId: "a", lastVisitAt: daysAgo(50) },
        { ...base, clientId: "b", lastVisitAt: daysAgo(90) },
        { ...base, clientId: "c", lastVisitAt: daysAgo(20) },
        { ...base, clientId: "d", lastVisitAt: daysAgo(60), hasUpcomingAppointment: true },
        { ...base, clientId: "e", lastVisitAt: daysAgo(70), lastReengagedAt: daysAgo(3) },
        { ...base, clientId: "f", lastVisitAt: null },
      ],
      NOW,
      { weeks: 6, cooldownDays: 14 },
    );
    expect(result.map((r) => r.clientId)).toEqual(["b", "a"]);
    expect(result[0]!.daysSinceVisit).toBe(90);
  });
});

describe("day-before reminders", () => {
  it("selects confirmed appointments inside the window that were not reminded yet", () => {
    const soon = appt({ id: "77777777-7777-4777-8777-777777777777", startsAt: new Date(NOW.getTime() + HOUR_MS).toISOString() });
    const pending = appt({ id: "88888888-8888-4888-8888-888888888888", status: "hold_pending_deposit" });
    const target = appt();
    const window = { hoursBefore: 24, minHoursBefore: 2 };
    expect(dueDayBeforeReminders([soon, pending, target], NOW, window, new Set()).map((a) => a.id)).toEqual([target.id]);
    expect(dueDayBeforeReminders([target], NOW, window, new Set([dedupeKey.dayBeforeReminder(target.id)]))).toEqual([]);
  });
});
