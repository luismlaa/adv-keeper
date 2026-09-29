import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { approvalKindSchema } from "@/lib/schemas/entities";

/**
 * Tool input contracts. `z.strictObject` rejects unknown keys, so the model cannot smuggle a
 * `price`, `amount` or `discount` into a booking — the server computes money from the catalog.
 */
export const toolInputSchemas = {
  list_services: z.strictObject({}),
  check_availability: z.strictObject({
    service_id: z.uuid().describe("id del servicio, tomado de list_services o del catálogo"),
    date_from: z.iso.date().describe("primer día a consultar, YYYY-MM-DD en hora local del negocio"),
    days: z.number().int().min(1).max(7).default(3).describe("cuántos días consultar (1–7)"),
  }),
  create_booking_hold: z.strictObject({
    service_id: z.uuid(),
    starts_at: z.iso.datetime({ offset: true }).describe("inicio exacto, copiado de check_availability (campo starts_at)"),
    client_package_id: z.uuid().nullable().default(null).describe("paquete activo de la clienta a usar, o null"),
    client_name: z.string().min(1).max(80).nullable().default(null).describe("nombre de la clienta si lo dijo"),
  }),
  create_deposit_link: z.strictObject({
    appointment_id: z.uuid().describe("id devuelto por create_booking_hold"),
  }),
  get_client_packages: z.strictObject({}),
  request_owner_approval: z.strictObject({
    kind: approvalKindSchema,
    details: z.string().min(5).max(600).describe("qué pide la clienta, con sus palabras y contexto"),
    appointment_id: z.uuid().nullable().default(null),
  }),
} as const;

export type ToolName = keyof typeof toolInputSchemas;
export type ToolInput<N extends ToolName> = z.infer<(typeof toolInputSchemas)[N]>;

export const TOOL_NAMES = Object.keys(toolInputSchemas) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return name in toolInputSchemas;
}

const descriptions: Record<ToolName, string> = {
  list_services: "Lista servicios activos con precio, duración y anticipo. Úsala si la clienta pregunta por servicios o precios.",
  check_availability: "Horarios libres reales para un servicio. Devuelve starts_at (ISO) y una etiqueta en hora local.",
  create_booking_hold:
    "Aparta un horario para la clienta. Crea una reserva pendiente de anticipo (o confirmada si usa un paquete). Confirma servicio, día y hora con ella antes de usarla.",
  create_deposit_link: "Genera (o recupera) el link de pago del anticipo para una reserva pendiente. Envía el link tal cual.",
  get_client_packages: "Paquetes multi-sesión de la clienta actual con sesiones usadas/restantes y la próxima sesión.",
  request_owner_approval:
    "Escala a la dueña lo que no puedes decidir: descuentos, precios fuera de catálogo, cancelaciones o reembolsos. No ejecuta la acción; crea una solicitud.",
};

/** Regex patterns are validated by zod server-side; dropping them keeps the tool schema small for the model. */
function withoutPatterns(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPatterns);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "pattern" && key !== "$schema")
      .map(([key, v]) => [key, withoutPatterns(v)]),
  );
}

export function anthropicTools(): Anthropic.Messages.Tool[] {
  return TOOL_NAMES.map((name) => {
    const inputSchema = withoutPatterns(z.toJSONSchema(toolInputSchemas[name], { io: "input" })) as Record<string, unknown>;
    return {
      name,
      description: descriptions[name],
      input_schema: { ...inputSchema, type: "object" } as Anthropic.Messages.Tool.InputSchema,
    };
  });
}
