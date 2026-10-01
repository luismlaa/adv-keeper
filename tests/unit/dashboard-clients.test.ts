import { describe, expect, it } from "vitest";
import { lastVisit, packageOutlook, sanitizeSearch } from "@/lib/dashboard/clients";
import { firstName, reactivationMessage, toReactivationInputs } from "@/lib/dashboard/reactivation";
import { buildDemoDataset } from "@/lib/demo/dataset";
import { DEFAULT_BUSINESS_SETTINGS } from "@/lib/config/business-settings";
import { BLOCKING_STATUSES } from "@/lib/domain/appointment-state";
import { findReactivationCandidates } from "@/lib/domain/reactivation";
import { buildTemplateMessage, renderPreview } from "@/lib/notifications/templates";
import { DAY_MS } from "@/lib/domain/time";
import type { ClientPackage } from "@/lib/schemas/entities";

const NOW = new Date("2026-09-30T14:00:00.000Z");

const pkg = (over: Partial<ClientPackage> = {}): ClientPackage => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  businessId: "00000000-0000-4000-8000-0000000000bb",
  clientId: "00000000-0000-4000-8000-0000000000cc",
  packageTemplateId: "00000000-0000-4000-8000-0000000000dd",
  sessionsTotal: 10,
  sessionsUsed: 3,
  status: "active",
  purchasedAt: "2026-06-01T12:00:00.000Z",
  expiresAt: null,
  ...over,
});

describe("client search", () => {
  it("strips PostgREST filter syntax from the query", () => {
    expect(sanitizeSearch("Ana, (Pérez)*")).toBe("Ana Pérez");
    expect(sanitizeSearch("name.eq.x),id.neq.(y")).toBe("name.eq.x id.neq. y");
    expect(sanitizeSearch(["a", "b"])).toBe("");
    expect(sanitizeSearch(undefined)).toBe("");
    expect(sanitizeSearch("x".repeat(100))).toHaveLength(60);
  });
});

describe("package outlook", () => {
  const lastSession = new Date(NOW.getTime() - 40 * DAY_MS).toISOString();

  it("recommends the next session interval_days after the last one and flags overdue", () => {
    const o = packageOutlook(pkg(), 30, [{ startsAt: lastSession, status: "completed", clientPackageId: pkg().id }], NOW);
    expect(o).toMatchObject({ used: 3, remaining: 7, total: 10, nextLabel: "sesión 4 de 10", nextBookedAt: null, overdue: true });
    expect(o.recommendedAt).toBe(new Date(new Date(lastSession).getTime() + 30 * DAY_MS).toISOString());
  });

  it("shows the booked session instead of a recommendation", () => {
    const booked = new Date(NOW.getTime() + 2 * DAY_MS).toISOString();
    const o = packageOutlook(
      pkg(),
      30,
      [
        { startsAt: lastSession, status: "completed", clientPackageId: pkg().id },
        { startsAt: booked, status: "confirmed", clientPackageId: pkg().id },
        { startsAt: booked, status: "confirmed", clientPackageId: "other" },
      ],
      NOW,
    );
    expect(o.nextBookedAt).toBe(booked);
    expect(o.recommendedAt).toBeNull();
    expect(o.overdue).toBe(false);
  });

  it("a finished package has nothing next", () => {
    const o = packageOutlook(pkg({ sessionsUsed: 10, status: "completed" }), 30, [], NOW);
    expect(o.nextLabel).toBeNull();
    expect(o.remaining).toBe(0);
  });

  it("last visit takes the latest of history and the stored value", () => {
    expect(lastVisit([{ startsAt: "2026-09-01T12:00:00.000Z", status: "completed", clientPackageId: null }], "2026-08-01T12:00:00.000Z")).toBe(
      "2026-09-01T12:00:00.000Z",
    );
    expect(lastVisit([{ startsAt: "2026-09-01T12:00:00.000Z", status: "no_show", clientPackageId: null }], null)).toBeNull();
  });
});

describe("reactivation", () => {
  it("builds the template variables and a friendly preview", () => {
    const m = reactivationMessage("Patricia Cabrera", "Spa Demo");
    expect(m.variables).toEqual(["Patricia", "Spa Demo"]);
    expect(m.previewText).toMatch(/^¡Hola, Patricia! Te extrañamos en Spa Demo/);
    expect(reactivationMessage(null, "Spa").previewText).toMatch(/^¡Hola, clienta! Te extrañamos en Spa/);
    expect(firstName("  ")).toBe("");
  });

  it("previews exactly the approved WhatsApp template", () => {
    for (const name of ["Patricia Cabrera", null, "  "]) {
      const m = reactivationMessage(name, "Spa Demo");
      const approved = buildTemplateMessage("reactivation", { clientName: name, businessName: "Spa Demo" });
      expect(m.variables).toEqual(approved.variables);
      expect(m.previewText).toBe(approved.previewText);
      expect(m.previewText).toBe(renderPreview("reactivation", m.variables));
    }
  });

  it("finds exactly the 8 seeded demo candidates", () => {
    const demo = buildDemoDataset(NOW, { slug: "spa-demo", appUrl: "http://localhost:3000" });
    const upcoming = new Set(
      demo.appointments.filter((a) => BLOCKING_STATUSES.includes(a.status) && new Date(a.startsAt) >= NOW).map((a) => a.clientId),
    );
    const inputs = toReactivationInputs(
      demo.clients.map((c) => ({ id: c.id, name: c.name, lastVisitAt: c.lastVisitAt, lastReengagedAt: c.lastReengagedAt })),
      upcoming,
    );
    const candidates = findReactivationCandidates(inputs, NOW, {
      weeks: DEFAULT_BUSINESS_SETTINGS.reactivationWeeks,
      cooldownDays: DEFAULT_BUSINESS_SETTINGS.reengagementCooldownDays,
    });
    expect(candidates).toHaveLength(8);

    // Re-engaging one (last_reengaged_at = now) removes her from the list.
    const first = candidates[0]!.clientId;
    const after = findReactivationCandidates(
      inputs.map((i) => (i.clientId === first ? { ...i, lastReengagedAt: NOW.toISOString() } : i)),
      NOW,
      { weeks: DEFAULT_BUSINESS_SETTINGS.reactivationWeeks, cooldownDays: DEFAULT_BUSINESS_SETTINGS.reengagementCooldownDays },
    );
    expect(after).toHaveLength(7);
    expect(after.some((c) => c.clientId === first)).toBe(false);
  });
});
