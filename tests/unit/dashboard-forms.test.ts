import { describe, expect, it } from "vitest";
import { errorToState, safeNextPath } from "@/lib/dashboard/action-state";
import { formToRecord, parsePackageTemplateForm, parseServiceForm } from "@/lib/dashboard/catalog-form";
import { minorToPesosInput, parsePesosToMinor } from "@/lib/dashboard/money-input";
import { formatDayHours, parseDayHours, parseSettingsForm } from "@/lib/dashboard/settings-form";
import { DEFAULT_BUSINESS_SETTINGS, resolveBusinessSettings } from "@/lib/config/business-settings";
import { DomainError } from "@/lib/domain/errors";

describe("RD$ ⇄ centavos", () => {
  it("parses pesos into integer centavos without float math", () => {
    expect(parsePesosToMinor("3500")).toBe(350000);
    expect(parsePesosToMinor("RD$ 1,500.50")).toBe(150050);
    expect(parsePesosToMinor("0.1")).toBe(10);
    expect(parsePesosToMinor("19.99")).toBe(1999);
    expect(parsePesosToMinor("-5")).toBeNull();
    expect(parsePesosToMinor("1.234")).toBeNull();
    expect(parsePesosToMinor("abc")).toBeNull();
    expect(parsePesosToMinor("")).toBeNull();
  });

  it("round-trips for form defaults", () => {
    expect(minorToPesosInput(350000)).toBe("3500");
    expect(minorToPesosInput(150050)).toBe("1500.50");
    expect(parsePesosToMinor(minorToPesosInput(1999))).toBe(1999);
  });
});

describe("service and package forms", () => {
  it("stores prices in centavos and a blank deposit override as null", () => {
    const r = parseServiceForm({ name: " Facial ", price: "3,500", durationMin: "60", depositOverride: "", active: "on", category: "", description: "" });
    expect(r).toEqual({
      ok: true,
      value: { name: "Facial", description: "", category: "general", duration_min: 60, price_minor: 350000, deposit_override_minor: null, active: true },
    });
  });

  it("rejects bad prices and deposits larger than the price", () => {
    const r = parseServiceForm({ name: "X", price: "100", durationMin: "30", depositOverride: "200" });
    expect(r.ok).toBe(false);
    const bad = parseServiceForm({ name: "", price: "abc", durationMin: "0" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("package templates need a service and positive sessions/interval", () => {
    const ok = parsePackageTemplateForm({
      name: "Láser · 10",
      serviceId: "00000000-0000-4000-8000-000000001000",
      sessionsTotal: "10",
      price: "36000",
      intervalDays: "30",
    });
    expect(ok).toEqual({
      ok: true,
      value: { name: "Láser · 10", service_id: "00000000-0000-4000-8000-000000001000", sessions_total: 10, price_minor: 3600000, interval_days: 30, active: false },
    });
    expect(parsePackageTemplateForm({ name: "x", serviceId: "nope", sessionsTotal: "0", price: "1", intervalDays: "0" }).ok).toBe(false);
  });

  it("FormData → record skips React's internal action fields", () => {
    const fd = new FormData();
    fd.set("name", "Ana");
    fd.set("$ACTION_ID_abc", "");
    expect(formToRecord(fd)).toEqual({ name: "Ana" });
  });
});

describe("settings form", () => {
  const baseForm = (): Record<string, string> => ({
    ownerDisplayName: "Ana",
    tone: "cálido",
    holdMinutes: "30",
    reminderHoursBefore: "24",
    reactivationWeeks: "8",
    reengagementCooldownDays: "14",
    slotStepMinutes: "30",
    bufferMinutes: "10",
    minLeadMinutes: "120",
    bookingHorizonDays: "30",
    depositPercent: "30",
    depositMinimum: "500",
    depositRoundTo: "50",
    hours_0: "",
    hours_1: "09:00-18:00",
    hours_2: "09:00-18:00",
    hours_3: "09:00-13:00, 14:00-18:00",
    hours_4: "9:00 a 18:00",
    hours_5: "09:00-19:00",
    hours_6: "09:00-14:00",
  });

  it("parses opening hours text, including split shifts and closed days", () => {
    expect(parseDayHours("")).toEqual([]);
    expect(parseDayHours("Cerrado")).toEqual([]);
    expect(parseDayHours("14:00-18:00, 9:00-13:00")).toEqual([
      { open: "09:00", close: "13:00" },
      { open: "14:00", close: "18:00" },
    ]);
    expect(parseDayHours("09:00-13:00, 12:00-18:00")).toBeNull(); // overlap
    expect(parseDayHours("nueve a seis")).toBeNull();
    expect(formatDayHours([{ open: "09:00", close: "13:00" }, { open: "14:00", close: "18:00" }])).toBe("09:00-13:00, 14:00-18:00");
  });

  it("produces overrides that resolve to valid settings and keeps untouched overrides", () => {
    const r = parseSettingsForm(baseForm(), DEFAULT_BUSINESS_SETTINGS, { currency: "DOP", ownerDisplayName: "vieja" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.settings.reactivationWeeks).toBe(8);
    expect(r.settings.deposit).toEqual({ percent: 30, minimumMinor: 50000, roundToMinor: 5000 });
    expect(r.settings.weeklyHours["3"]).toHaveLength(2);
    expect(r.overrides.currency).toBe("DOP");
    expect(r.overrides.ownerDisplayName).toBe("Ana");
    expect(resolveBusinessSettings(r.overrides)).toEqual(r.settings);
  });

  it("rejects values outside businessSettingsSchema bounds", () => {
    const r = parseSettingsForm({ ...baseForm(), holdMinutes: "1", hours_2: "18:00-09:00" }, DEFAULT_BUSINESS_SETTINGS, {});
    expect(r.ok).toBe(false);
    const bad = parseSettingsForm({ ...baseForm(), depositMinimum: "x", hours_1: "mañana" }, DEFAULT_BUSINESS_SETTINGS, {});
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.some((e) => e.startsWith("Lunes"))).toBe(true);
  });
});

describe("action helpers", () => {
  it("only allows same-site post-login redirects", () => {
    expect(safeNextPath("/clientas?q=ana")).toBe("/clientas?q=ana");
    expect(safeNextPath("https://evil.example")).toBe("/agenda");
    expect(safeNextPath("//evil.example")).toBe("/agenda");
    expect(safeNextPath("/\\evil.example")).toBe("/agenda");
    expect(safeNextPath("/login")).toBe("/agenda");
    expect(safeNextPath(null)).toBe("/agenda");
  });

  it("maps domain errors to Spanish messages and hides technical ones", () => {
    expect(errorToState(new DomainError("package_exhausted", "x")).message).toMatch(/sesiones disponibles/);
    expect(errorToState(new Error("Cita no encontrada")).message).toBe("Cita no encontrada");
    const original = console.error;
    console.error = () => {};
    try {
      expect(errorToState(new Error("listAgenda failed: boom")).message).toMatch(/No se pudo/);
    } finally {
      console.error = original;
    }
  });
});
