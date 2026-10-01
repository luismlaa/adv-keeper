import { z } from "zod";
import { parsePesosToMinor } from "./money-input";

/** Pure parsing of the /servicios forms into DB rows (snake_case). Prices arrive in RD$, leave in centavos. */

export type FormResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface ServiceRowInput {
  name: string;
  description: string;
  category: string;
  duration_min: number;
  price_minor: number;
  deposit_override_minor: number | null;
  active: boolean;
}

export interface PackageTemplateRowInput {
  name: string;
  service_id: string;
  sessions_total: number;
  price_minor: number;
  interval_days: number;
  active: boolean;
}

const serviceForm = z.object({
  name: z.string().trim().min(1, "Nombre: requerido").max(120),
  description: z.string().trim().max(500).default(""),
  category: z.string().trim().max(60).default(""),
  durationMin: z.coerce.number({ error: "Duración: número inválido" }).int("Duración: minutos enteros").min(5, "Duración: mínimo 5 minutos").max(600),
});

const packageForm = z.object({
  name: z.string().trim().min(1, "Nombre: requerido").max(120),
  serviceId: z.uuid("Servicio: elige uno"),
  sessionsTotal: z.coerce.number({ error: "Sesiones: número inválido" }).int().min(1, "Sesiones: mínimo 1").max(100),
  intervalDays: z.coerce.number({ error: "Intervalo: número inválido" }).int().min(1, "Intervalo: mínimo 1 día").max(365),
});

const issues = (e: z.ZodError) => e.issues.map((i) => i.message);

export function parseServiceForm(form: Record<string, string>): FormResult<ServiceRowInput> {
  const parsed = serviceForm.safeParse(form);
  const errors = parsed.success ? [] : issues(parsed.error);
  const price = parsePesosToMinor(form.price ?? "");
  if (price === null) errors.push("Precio: monto inválido (ej. 3500 o 3,500.00)");
  const depositRaw = (form.depositOverride ?? "").trim();
  const deposit = depositRaw === "" ? null : parsePesosToMinor(depositRaw);
  if (depositRaw !== "" && deposit === null) errors.push("Anticipo fijo: monto inválido");
  if (deposit !== null && price !== null && deposit > price) errors.push("Anticipo fijo: no puede ser mayor que el precio");
  if (!parsed.success || errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: parsed.data.name,
      description: parsed.data.description,
      category: parsed.data.category === "" ? "general" : parsed.data.category,
      duration_min: parsed.data.durationMin,
      price_minor: price!,
      deposit_override_minor: deposit,
      active: form.active === "on" || form.active === "true",
    },
  };
}

export function parsePackageTemplateForm(form: Record<string, string>): FormResult<PackageTemplateRowInput> {
  const parsed = packageForm.safeParse(form);
  const errors = parsed.success ? [] : issues(parsed.error);
  const price = parsePesosToMinor(form.price ?? "");
  if (price === null) errors.push("Precio: monto inválido (ej. 36000)");
  if (!parsed.success || errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: parsed.data.name,
      service_id: parsed.data.serviceId,
      sessions_total: parsed.data.sessionsTotal,
      price_minor: price!,
      interval_days: parsed.data.intervalDays,
      active: form.active === "on" || form.active === "true",
    },
  };
}

/** FormData → plain string record (files are ignored). */
export function formToRecord(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  });
  return out;
}
