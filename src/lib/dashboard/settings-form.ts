import { z } from "zod";
import { businessSettingsSchema, type BusinessSettings, type WeeklyHours } from "@/lib/config/business-settings";
import { parsePesosToMinor } from "./money-input";

/** Pure parsing for /ajustes. The result is always validated by `businessSettingsSchema`. */

export const WEEKDAY_LABELS: ReadonlyArray<readonly [keyof WeeklyHours, string]> = [
  ["1", "Lunes"],
  ["2", "Martes"],
  ["3", "Miércoles"],
  ["4", "Jueves"],
  ["5", "Viernes"],
  ["6", "Sábado"],
  ["0", "Domingo"],
];

/** "09:00-13:00, 14:00-18:00" ⇄ [{open,close}, ...]. Empty text or "cerrado" means closed. */
export function formatDayHours(windows: WeeklyHours[keyof WeeklyHours]): string {
  return windows.map((w) => `${w.open}-${w.close}`).join(", ");
}

export function parseDayHours(text: string): Array<{ open: string; close: string }> | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "" || trimmed === "cerrado") return [];
  const parts = trimmed.split(",").map((p) => p.trim()).filter((p) => p !== "");
  const windows: Array<{ open: string; close: string }> = [];
  for (const part of parts) {
    const match = /^(\d{1,2}):(\d{2})\s*[-–a]\s*(\d{1,2}):(\d{2})$/.exec(part);
    if (!match) return null;
    const open = `${match[1]!.padStart(2, "0")}:${match[2]}`;
    const close = `${match[3]!.padStart(2, "0")}:${match[4]}`;
    windows.push({ open, close });
  }
  const sorted = [...windows].sort((a, b) => a.open.localeCompare(b.open));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.open < sorted[i - 1]!.close) return null; // overlapping windows
  }
  return sorted;
}

export type SettingsFormResult =
  | { ok: true; settings: BusinessSettings; overrides: Record<string, unknown> }
  | { ok: false; errors: string[] };

const intField = (label: string) =>
  z.coerce.number({ error: `${label}: número inválido` }).int(`${label}: debe ser un número entero`);

const formSchema = z.object({
  ownerDisplayName: z.string().trim().min(1, "Nombre de la dueña: requerido"),
  tone: z.string().trim().min(1, "Tono: requerido"),
  holdMinutes: intField("Minutos de reserva"),
  reminderHoursBefore: intField("Horas de recordatorio"),
  reactivationWeeks: intField("Semanas para reactivar"),
  reengagementCooldownDays: intField("Días entre reenganches"),
  slotStepMinutes: intField("Intervalo de horarios"),
  bufferMinutes: intField("Minutos entre citas"),
  minLeadMinutes: intField("Anticipación mínima"),
  bookingHorizonDays: intField("Días hacia adelante"),
  depositPercent: z.coerce.number({ error: "Porcentaje de anticipo: número inválido" }),
  depositMinimum: z.string(),
  depositRoundTo: z.string(),
});

/**
 * Builds the new `businesses.settings` overrides from the form, keeping any existing overrides the form
 * does not edit (currency, timezone, locale). Returns the fully-resolved, validated settings too.
 */
export function parseSettingsForm(
  form: Record<string, string>,
  current: BusinessSettings,
  existingOverrides: Record<string, unknown>,
): SettingsFormResult {
  const parsed = formSchema.safeParse(form);
  const errors: string[] = parsed.success ? [] : parsed.error.issues.map((i) => i.message);

  const minimumMinor = parsePesosToMinor(form.depositMinimum ?? "");
  const roundToMinor = parsePesosToMinor(form.depositRoundTo ?? "");
  if (minimumMinor === null) errors.push("Anticipo mínimo: monto inválido");
  if (roundToMinor === null || roundToMinor === 0) errors.push("Redondeo del anticipo: monto inválido");

  const weeklyHours = { ...current.weeklyHours };
  for (const [key, label] of WEEKDAY_LABELS) {
    const windows = parseDayHours(form[`hours_${key}`] ?? "");
    if (windows === null) errors.push(`${label}: usa el formato 09:00-18:00 (separa tramos con coma)`);
    else weeklyHours[key] = windows;
  }

  if (!parsed.success || errors.length > 0) return { ok: false, errors };

  const d = parsed.data;
  const edited = {
    ownerDisplayName: d.ownerDisplayName,
    tone: d.tone,
    holdMinutes: d.holdMinutes,
    reminderHoursBefore: d.reminderHoursBefore,
    reactivationWeeks: d.reactivationWeeks,
    reengagementCooldownDays: d.reengagementCooldownDays,
    slotStepMinutes: d.slotStepMinutes,
    bufferMinutes: d.bufferMinutes,
    minLeadMinutes: d.minLeadMinutes,
    bookingHorizonDays: d.bookingHorizonDays,
    deposit: { percent: d.depositPercent, minimumMinor: minimumMinor!, roundToMinor: roundToMinor! },
    weeklyHours,
  };
  const candidate = { ...current, ...edited };
  const validated = businessSettingsSchema.safeParse(candidate);
  if (!validated.success) {
    return { ok: false, errors: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  return { ok: true, settings: validated.data, overrides: { ...existingOverrides, ...edited } };
}
