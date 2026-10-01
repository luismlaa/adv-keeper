import { describe, expect, it } from "vitest";
import {
  agendaNeighbours,
  agendaRange,
  availableOwnerActions,
  depositBadge,
  groupByLocalDay,
  parseAgendaParams,
  pickDeposit,
} from "@/lib/dashboard/agenda";
import { formatTime, isoDayOf, localIsoDay, parseIsoDay } from "@/lib/dashboard/format";
import { canTransition } from "@/lib/domain/appointment-state";
import type { AppointmentStatus } from "@/lib/schemas/entities";

const TZ = "America/Santo_Domingo";
/** Wednesday 2026-09-30 10:00 local (14:00Z). */
const NOW = new Date("2026-09-30T14:00:00.000Z");

describe("local days", () => {
  it("parses ISO days and rejects impossible ones", () => {
    expect(parseIsoDay("2026-09-30", TZ)).toEqual({ year: 2026, monthIndex: 8, day: 30, weekday: 3 });
    expect(parseIsoDay("2026-02-31", TZ)).toBeNull();
    expect(parseIsoDay("30/09/2026", TZ)).toBeNull();
    expect(parseIsoDay(undefined, TZ)).toBeNull();
  });

  it("uses the business timezone, not UTC, for the local day", () => {
    // 2026-10-01T02:00Z is still Sept 30 at 22:00 in Santo Domingo.
    expect(localIsoDay(new Date("2026-10-01T02:00:00.000Z"), TZ)).toBe("2026-09-30");
  });

  it("formats times in local wall-clock", () => {
    expect(formatTime("2026-09-30T13:00:00.000Z", TZ)).toMatch(/^9:00\s?a/);
  });
});

describe("agenda range", () => {
  it("defaults to the current week anchored on today", () => {
    const p = parseAgendaParams({}, NOW, TZ);
    expect(p.view).toBe("week");
    expect(isoDayOf(p.anchor)).toBe("2026-09-30");
  });

  it("week view spans Monday 00:00 to next Monday 00:00 local", () => {
    const anchor = parseIsoDay("2026-09-30", TZ)!;
    const r = agendaRange("week", anchor, TZ);
    expect(r.days.map(isoDayOf)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(r.from.toISOString()).toBe("2026-09-28T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-05T04:00:00.000Z");
  });

  it("a Sunday belongs to the week that started the previous Monday", () => {
    const r = agendaRange("week", parseIsoDay("2026-10-04", TZ)!, TZ);
    expect(isoDayOf(r.days[0]!)).toBe("2026-09-28");
  });

  it("day view spans one local day and navigates by one day", () => {
    const anchor = parseIsoDay("2026-09-30", TZ)!;
    const r = agendaRange("day", anchor, TZ);
    expect(r.from.toISOString()).toBe("2026-09-30T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-01T04:00:00.000Z");
    expect(agendaNeighbours("day", anchor, TZ)).toEqual({ prev: "2026-09-29", next: "2026-10-01" });
    expect(agendaNeighbours("week", anchor, TZ)).toEqual({ prev: "2026-09-23", next: "2026-10-07" });
  });

  it("groups appointments by local day, keeping empty days", () => {
    const anchor = parseIsoDay("2026-09-30", TZ)!;
    const { days } = agendaRange("week", anchor, TZ);
    const groups = groupByLocalDay(
      [
        { id: "late", startsAt: "2026-10-01T01:30:00.000Z" }, // Sept 30, 21:30 local
        { id: "early", startsAt: "2026-09-30T13:00:00.000Z" },
      ],
      days,
      TZ,
    );
    expect(groups).toHaveLength(7);
    expect(groups.find((g) => g.iso === "2026-09-30")!.items.map((i) => i.id)).toEqual(["early", "late"]);
    expect(groups.find((g) => g.iso === "2026-10-01")!.items).toEqual([]);
  });
});

describe("deposit badge", () => {
  const base = { status: "confirmed" as AppointmentStatus, clientPackageId: null, depositMinor: 105000, holdExpiresAt: null, deposit: null };

  it("📦 for package sessions, even without a deposit", () => {
    expect(depositBadge({ ...base, clientPackageId: "pkg", depositMinor: 0 }, TZ).kind).toBe("package");
  });

  it("💰 when the deposit is paid", () => {
    const b = depositBadge({ ...base, deposit: { status: "paid", expiresAt: "2026-09-30T14:00:00.000Z" } }, TZ);
    expect(b).toEqual({ kind: "paid", label: "💰 Pagado", expiresAt: null });
  });

  it("⏳ with the local expiry time while the hold waits for payment", () => {
    const b = depositBadge(
      {
        ...base,
        status: "hold_pending_deposit",
        holdExpiresAt: "2026-09-30T19:45:00.000Z",
        deposit: { status: "pending", expiresAt: "2026-09-30T19:45:00.000Z" },
      },
      TZ,
    );
    expect(b.kind).toBe("pending");
    expect(b.expiresAt).toBe("2026-09-30T19:45:00.000Z");
    expect(b.label).toMatch(/^⏳ Pendiente · vence mi[ée]\.?,? 3:45\s?p/);
  });

  it("no deposit needed", () => {
    expect(depositBadge({ ...base, depositMinor: 0 }, TZ).kind).toBe("none");
  });

  it("prefers a paid deposit over newer pending ones", () => {
    const picked = pickDeposit([
      { status: "pending" as const, expiresAt: "2026-09-30T20:00:00.000Z", createdAt: "2026-09-30T19:00:00.000Z" },
      { status: "paid" as const, expiresAt: "2026-09-29T20:00:00.000Z", createdAt: "2026-09-29T19:00:00.000Z" },
    ]);
    expect(picked?.status).toBe("paid");
    expect(pickDeposit([])).toBeNull();
  });
});

describe("owner actions", () => {
  it("only offers actions the state machine allows", () => {
    const statuses: AppointmentStatus[] = ["hold_pending_deposit", "confirmed", "completed", "no_show", "cancelled", "expired"];
    const events = { complete: "completed", no_show: "no_show", cancel: "cancelled" } as const;
    for (const status of statuses) {
      for (const action of availableOwnerActions(status)) {
        expect(canTransition(status, events[action])).toBe(true);
      }
    }
    expect(availableOwnerActions("confirmed")).toEqual(["complete", "no_show", "cancel"]);
    expect(availableOwnerActions("completed")).toEqual([]);
  });
});
