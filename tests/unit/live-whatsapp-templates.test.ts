import { describe, expect, it } from "vitest";
import {
  buildTemplateMessage,
  greetingName,
  renderPreview,
  sanitizeParam,
  TEMPLATE_NAMES,
  WHATSAPP_TEMPLATES,
} from "@/lib/notifications/templates";

const TZ = "America/Santo_Domingo";
/** 10:00 local on Tuesday 2026-09-29. */
const TUESDAY_10 = new Date("2026-09-29T14:00:00.000Z");

describe("WhatsApp templates", () => {
  it("defines exactly the four business-initiated templates, in Spanish", () => {
    expect([...TEMPLATE_NAMES].sort()).toEqual(["day_before_reminder", "deposit_link", "package_nudge", "reactivation"]);
    for (const name of TEMPLATE_NAMES) expect(WHATSAPP_TEMPLATES[name].language).toBe("es");
  });

  it("bodies follow Meta's placeholder rules", () => {
    for (const name of TEMPLATE_NAMES) {
      const t = WHATSAPP_TEMPLATES[name];
      const placeholders = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      // Sequential {{1}}..{{n}}, each used once, matching paramCount and the sample values.
      expect(placeholders).toEqual(Array.from({ length: t.paramCount }, (_, i) => i + 1));
      expect(t.sample).toHaveLength(t.paramCount);
      // No placeholder at the very start or end, and no two placeholders side by side.
      expect(t.body).not.toMatch(/^\s*\{\{/);
      expect(t.body).not.toMatch(/\}\}\s*[.!?]?\s*$/);
      expect(t.body).not.toMatch(/\}\}\s*\{\{/);
      expect(t.body.length).toBeLessThanOrEqual(1024);
      expect(t.body).not.toContain("\n");
    }
  });

  it("renders the sample values into a readable preview", () => {
    expect(renderPreview("package_nudge", WHATSAPP_TEMPLATES.package_nudge.sample)).toBe(
      "Hola María 😊 Te toca la sesión 4 de 10 de tu paquete Láser piernas en Spa Bella. ¿Agendamos? Responde a este mensaje y te buscamos el horario que mejor te quede.",
    );
  });

  it("refuses a variable count that doesn't match the template", () => {
    expect(() => renderPreview("reactivation", ["María"])).toThrow(/expects 2/);
  });

  it("day_before_reminder: first name, service, business and local time", () => {
    const msg = buildTemplateMessage("day_before_reminder", {
      clientName: "María Pérez",
      serviceName: "Limpieza facial",
      businessName: "Spa Bella",
      startsAt: TUESDAY_10,
      timezone: TZ,
    });
    expect(msg.variables[0]).toBe("María");
    expect(msg.variables.slice(1, 3)).toEqual(["Limpieza facial", "Spa Bella"]);
    expect(msg.variables[3]).toMatch(/martes.*29.*septiembre.*10:00/);
    expect(msg.previewText).toContain("Te recordamos tu cita de Limpieza facial en Spa Bella");
  });

  it("deposit_link: formats money in RD$ and includes the link and hold minutes", () => {
    const msg = buildTemplateMessage("deposit_link", {
      clientName: null,
      serviceName: "Limpieza facial",
      startsAt: TUESDAY_10,
      timezone: TZ,
      amountMinor: 75000,
      currency: "DOP",
      url: "https://adv-keeper.vercel.app/api/pay/azul/abc123",
      holdMinutes: 30,
    });
    expect(msg.variables[0]).toBe("clienta");
    expect(msg.variables[3]).toBe("RD$750");
    expect(msg.variables[4]).toBe("https://adv-keeper.vercel.app/api/pay/azul/abc123");
    expect(msg.variables[5]).toBe("30");
    expect(msg.previewText).toContain("paga el anticipo de RD$750 en este enlace seguro: https://adv-keeper.vercel.app/api/pay/azul/abc123 El espacio");
  });

  it("package_nudge reads 'te toca la sesión N de M, ¿agendamos?'", () => {
    const msg = buildTemplateMessage("package_nudge", {
      clientName: "Laura",
      nextSession: 4,
      sessionsTotal: 10,
      packageName: "Láser piernas",
      businessName: "Spa Test",
    });
    expect(msg.variables).toEqual(["Laura", "4", "10", "Láser piernas", "Spa Test"]);
    expect(msg.previewText).toMatch(/Te toca la sesión 4 de 10 .*¿Agendamos\?/);
  });

  it("reactivation keeps the dashboard's variable order ({{1}} name, {{2}} business)", () => {
    const msg = buildTemplateMessage("reactivation", { clientName: "Ana", businessName: "Spa Test" });
    expect(msg.template).toBe("reactivation");
    expect(msg.variables).toEqual(["Ana", "Spa Test"]);
    expect(msg.previewText).toBe(
      "¡Hola, Ana! Te extrañamos en Spa Test 💆‍♀️ ¿Te reservamos un espacio esta semana? Responde a este mensaje y te buscamos el horario que mejor te quede.",
    );
  });

  it("sanitizes parameters Meta would reject", () => {
    expect(sanitizeParam("  Spa\n\tBella    Centro ")).toBe("Spa Bella Centro");
    expect(sanitizeParam("   ")).toBe("-");
    expect(greetingName("   ")).toBe("clienta");
    const msg = buildTemplateMessage("reactivation", { clientName: "Ana", businessName: "Spa\nBella" });
    expect(msg.variables[1]).toBe("Spa Bella");
  });
});
