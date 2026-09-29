import { readFile } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { BusinessSettings } from "@/lib/config/business-settings";
import { computeDeposit, formatMoney } from "@/lib/domain/money";
import { formatLocal } from "@/lib/domain/time";
import type { Business, PackageTemplate, Service } from "@/lib/schemas/entities";

export const CONCIERGE_PROMPT_VERSION = "v1";

const templateCache = new Map<string, string>();

export async function loadPromptTemplate(version = CONCIERGE_PROMPT_VERSION, root = process.cwd()): Promise<string> {
  const cached = templateCache.get(version);
  if (cached !== undefined) return cached;
  const template = await readFile(path.join(root, "prompts", "concierge", version, "system.md"), "utf8");
  templateCache.set(version, template);
  return template;
}

export function renderTemplate(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`Prompt variable "${key}" was not provided`);
    return value;
  });
}

export interface PromptInput {
  business: Business;
  settings: BusinessSettings;
  services: readonly Service[];
  packages: readonly PackageTemplate[];
}

export function promptVariables({ business, settings, services, packages }: PromptInput): Record<string, string> {
  const money = (minor: number) => formatMoney(minor, settings.currency, settings.locale);
  const catalog = services
    .map(
      (s) =>
        `- [${s.id}] **${s.name}** (${s.category}) — ${money(s.priceMinor)} · ${s.durationMin} min · anticipo ${money(
          computeDeposit(s.priceMinor, settings.deposit, s.depositOverrideMinor),
        )}${s.description ? ` — ${s.description}` : ""}`,
    )
    .join("\n");
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const packageList =
    packages.length === 0
      ? "(ninguno)"
      : packages
          .map((p) => `- **${p.name}**: ${p.sessionsTotal} sesiones de ${serviceName.get(p.serviceId) ?? "servicio"} por ${money(p.priceMinor)}, cada ${p.intervalDays} días`)
          .join("\n");
  return {
    business_name: business.name,
    tone: settings.tone,
    owner_name: settings.ownerDisplayName,
    timezone: settings.timezone,
    currency: settings.currency,
    hold_minutes: String(settings.holdMinutes),
    deposit_policy: `El anticipo es el ${settings.deposit.percent}% del servicio (mínimo ${money(settings.deposit.minimumMinor)}), salvo los servicios con anticipo fijo indicado en el catálogo. Se descuenta del total el día de la cita. Las sesiones de un paquete ya pagado no llevan anticipo.`,
    catalog,
    packages: packageList,
  };
}

/**
 * System prompt as two blocks: the stable business block (cached — it only changes when the
 * catalog does) and a small per-turn block with the current time and client.
 */
export async function buildSystemBlocks(
  input: PromptInput & { now: Date; clientName: string | null },
): Promise<Anthropic.Messages.TextBlockParam[]> {
  const template = await loadPromptTemplate();
  const stable = renderTemplate(template, promptVariables(input));
  const turn = `Ahora: ${formatLocal(input.now, input.settings.timezone, input.settings.locale)} (${input.settings.timezone}). Clienta: ${
    input.clientName ?? "nombre desconocido — pregúntaselo de forma natural antes de reservar"
  }.`;
  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: turn },
  ];
}
