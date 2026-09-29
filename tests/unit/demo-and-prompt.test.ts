import { describe, expect, it } from "vitest";
import { buildSystemBlocks, loadPromptTemplate, promptVariables, renderTemplate } from "@/lib/agent/prompt";
import { DEFAULT_BUSINESS_SETTINGS } from "@/lib/config/business-settings";
import { BLOCKING_STATUSES } from "@/lib/domain/appointment-state";
import { findReactivationCandidates } from "@/lib/domain/reactivation";
import { overlaps } from "@/lib/domain/time";
import { buildDemoDataset } from "@/lib/demo/dataset";
import { appointmentSchema, clientSchema, depositSchema } from "@/lib/schemas/entities";
import { NOW } from "../helpers/fixtures";

const data = buildDemoDataset(NOW, { slug: "spa-demo", appUrl: "https://keeper.test" });

describe("demo dataset", () => {
  it("produces schema-valid entities", () => {
    data.appointments.forEach((a) => appointmentSchema.parse(a));
    data.deposits.forEach((d) => depositSchema.parse(d));
    data.clients.forEach((c) => clientSchema.parse(c));
  });

  it("never double-books (mirrors the DB exclusion constraint)", () => {
    const live = data.appointments.filter((a) => BLOCKING_STATUSES.includes(a.status));
    for (const a of live) {
      for (const b of live) {
        if (a.id === b.id) continue;
        expect(overlaps({ start: new Date(a.startsAt), end: new Date(a.endsAt) }, { start: new Date(b.startsAt), end: new Date(b.endsAt) })).toBe(false);
      }
    }
  });

  it("shows both paid and pending deposits and a reactivation list", () => {
    expect(data.deposits.some((d) => d.status === "paid")).toBe(true);
    expect(data.deposits.some((d) => d.status === "pending")).toBe(true);
    const candidates = findReactivationCandidates(
      data.clients.map((c) => ({ clientId: c.id, name: c.name, lastVisitAt: c.lastVisitAt, lastReengagedAt: c.lastReengagedAt, hasUpcomingAppointment: data.appointments.some((a) => a.clientId === c.id && new Date(a.startsAt) > NOW) })),
      NOW,
      { weeks: 6, cooldownDays: 14 },
    );
    expect(candidates).toHaveLength(8);
  });
});

describe("concierge prompt v1", () => {
  it("renders every placeholder and keeps the CAN / CANNOT sections", async () => {
    const template = await loadPromptTemplate();
    const rendered = renderTemplate(
      template,
      promptVariables({ business: data.business, settings: DEFAULT_BUSINESS_SETTINGS, services: data.services, packages: data.packageTemplates }),
    );
    expect(rendered).not.toMatch(/\{\{\w+\}\}/);
    expect(rendered).toContain("Lo que SÍ puedes hacer");
    expect(rendered).toContain("Lo que NO puedes hacer");
    expect(rendered).toContain("Limpieza facial profunda");
  });

  it("marks the stable block for prompt caching", async () => {
    const blocks = await buildSystemBlocks({ business: data.business, settings: DEFAULT_BUSINESS_SETTINGS, services: data.services, packages: data.packageTemplates, now: NOW, clientName: null });
    expect(blocks[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]?.cache_control).toBeUndefined();
  });

  it("fails loudly on a missing variable", () => {
    expect(() => renderTemplate("Hola {{nombre}}", {})).toThrow(/nombre/);
  });
});
