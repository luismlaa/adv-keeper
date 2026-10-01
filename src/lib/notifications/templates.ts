import type { TemplateName } from "@/lib/adapters/messaging/types";
import { formatMoney } from "@/lib/domain/money";
import { formatLocal } from "@/lib/domain/time";

/**
 * Single source of truth for the business-initiated WhatsApp templates. The `body` strings are the
 * exact text submitted to Meta for approval (see docs/whatsapp-templates.md); positional `{{n}}`
 * placeholders are filled by each template's `variables(...)` builder, in order.
 *
 * Changing a body here means re-submitting the template to Meta: approved text and code must match.
 */

export type TemplateCategory = "UTILITY" | "MARKETING";

export const TEMPLATE_LANGUAGE = "es";

export interface DayBeforeReminderInput {
  clientName: string | null;
  serviceName: string;
  businessName: string;
  startsAt: Date;
  timezone: string;
}

export interface DepositLinkInput {
  clientName: string | null;
  serviceName: string;
  startsAt: Date;
  timezone: string;
  amountMinor: number;
  currency: string;
  url: string;
  holdMinutes: number;
}

export interface PackageNudgeInput {
  clientName: string | null;
  /** 1-based number of the session that is due next. */
  nextSession: number;
  sessionsTotal: number;
  packageName: string;
  businessName: string;
}

export interface ReactivationInput {
  clientName: string | null;
  businessName: string;
}

interface TemplateInputs {
  day_before_reminder: DayBeforeReminderInput;
  deposit_link: DepositLinkInput;
  package_nudge: PackageNudgeInput;
  reactivation: ReactivationInput;
}

export interface WhatsAppTemplate<N extends TemplateName> {
  name: N;
  category: TemplateCategory;
  language: typeof TEMPLATE_LANGUAGE;
  /** Approved body text with `{{1}}`-style placeholders. */
  body: string;
  /** Number of positional body variables (`{{1}}` … `{{paramCount}}`). */
  paramCount: number;
  /** Example values Meta asks for when the template is submitted. */
  sample: readonly string[];
  variables(input: TemplateInputs[N]): string[];
}

/** Meta rejects empty parameters and parameters containing newlines, tabs or 4+ consecutive spaces. */
export function sanitizeParam(value: string, fallback = "-"): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean === "" ? fallback : clean;
}

/** First name for a greeting; templates always need a non-empty value. */
export function greetingName(clientName: string | null): string {
  const first = clientName?.trim().split(/\s+/)[0] ?? "";
  return first === "" ? "clienta" : first;
}

const dayBeforeReminder: WhatsAppTemplate<"day_before_reminder"> = {
  name: "day_before_reminder",
  category: "UTILITY",
  language: TEMPLATE_LANGUAGE,
  body: "Hola {{1}} 👋 Te recordamos tu cita de {{2}} en {{3}}: {{4}}. Si necesitas cambiarla, responde a este mensaje y te ayudamos.",
  paramCount: 4,
  sample: ["María", "Limpieza facial", "Spa Bella", "martes, 7 de octubre, 10:00 a. m."],
  variables: (i) => [greetingName(i.clientName), i.serviceName, i.businessName, formatLocal(i.startsAt, i.timezone)].map((v) => sanitizeParam(v)),
};

const depositLink: WhatsAppTemplate<"deposit_link"> = {
  name: "deposit_link",
  category: "UTILITY",
  language: TEMPLATE_LANGUAGE,
  body: "Hola {{1}}, te separamos {{2}} para el {{3}}. Para confirmar tu cita, paga el anticipo de {{4}} en este enlace seguro: {{5}} El espacio queda reservado por {{6}} minutos.",
  paramCount: 6,
  sample: ["María", "Limpieza facial", "martes, 7 de octubre, 10:00 a. m.", "RD$750", "https://adv-keeper.vercel.app/api/pay/azul/abc123", "30"],
  variables: (i) =>
    [
      greetingName(i.clientName),
      i.serviceName,
      formatLocal(i.startsAt, i.timezone),
      formatMoney(i.amountMinor, i.currency),
      i.url,
      String(i.holdMinutes),
    ].map((v) => sanitizeParam(v)),
};

const packageNudge: WhatsAppTemplate<"package_nudge"> = {
  name: "package_nudge",
  category: "UTILITY",
  language: TEMPLATE_LANGUAGE,
  body: "Hola {{1}} 😊 Te toca la sesión {{2}} de {{3}} de tu paquete {{4}} en {{5}}. ¿Agendamos? Responde a este mensaje y te buscamos el horario que mejor te quede.",
  paramCount: 5,
  sample: ["María", "4", "10", "Láser piernas", "Spa Bella"],
  variables: (i) =>
    [greetingName(i.clientName), String(i.nextSession), String(i.sessionsTotal), i.packageName, i.businessName].map((v) => sanitizeParam(v)),
};

const reactivation: WhatsAppTemplate<"reactivation"> = {
  name: "reactivation",
  category: "MARKETING",
  language: TEMPLATE_LANGUAGE,
  body: "¡Hola, {{1}}! Te extrañamos en {{2}} 💆‍♀️ ¿Te reservamos un espacio esta semana? Responde a este mensaje y te buscamos el horario que mejor te quede.",
  paramCount: 2,
  sample: ["María", "Spa Bella"],
  variables: (i) => [greetingName(i.clientName), i.businessName].map((v) => sanitizeParam(v)),
};

export const WHATSAPP_TEMPLATES: { readonly [N in TemplateName]: WhatsAppTemplate<N> } = {
  day_before_reminder: dayBeforeReminder,
  deposit_link: depositLink,
  package_nudge: packageNudge,
  reactivation,
};

export const TEMPLATE_NAMES = Object.keys(WHATSAPP_TEMPLATES) as TemplateName[];

/** Fills `{{n}}` placeholders with positional variables — the text the client will actually read. */
export function renderPreview(name: TemplateName, variables: readonly string[]): string {
  const template = WHATSAPP_TEMPLATES[name];
  if (variables.length !== template.paramCount) {
    throw new Error(`Template ${name} expects ${template.paramCount} variables, got ${variables.length}`);
  }
  return template.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => variables[Number(n) - 1] ?? "");
}

/** Variables + rendered preview, ready for `MessagingChannel.sendTemplate`. */
export function buildTemplateMessage<N extends TemplateName>(
  name: N,
  input: TemplateInputs[N],
): { template: N; variables: string[]; previewText: string } {
  const variables = (WHATSAPP_TEMPLATES[name] as WhatsAppTemplate<N>).variables(input);
  return { template: name, variables, previewText: renderPreview(name, variables) };
}
