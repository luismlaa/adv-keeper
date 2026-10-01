import type { ReactivationInput } from "@/lib/domain/reactivation";

/** Pure helpers for /reactivar. No I/O. */

export interface ClientRowLite {
  id: string;
  name: string | null;
  lastVisitAt: string | null;
  lastReengagedAt: string | null;
}

/** Joins clients with the set of clients that have something booked, into the domain's input shape. */
export function toReactivationInputs(
  clients: readonly ClientRowLite[],
  clientsWithUpcoming: ReadonlySet<string>,
): ReactivationInput[] {
  return clients.map((c) => ({
    clientId: c.id,
    name: c.name,
    lastVisitAt: c.lastVisitAt,
    lastReengagedAt: c.lastReengagedAt,
    hasUpcomingAppointment: clientsWithUpcoming.has(c.id),
  }));
}

export function firstName(name: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : "";
}

/**
 * Variables and rendered preview for the approved `reactivation` WhatsApp template.
 * Variable order: {{1}} client first name, {{2}} business name.
 */
export function reactivationMessage(clientName: string | null, businessName: string): { variables: string[]; previewText: string } {
  const name = firstName(clientName);
  const greeting = name === "" ? "¡Hola!" : `¡Hola, ${name}!`;
  return {
    variables: [name === "" ? "clienta" : name, businessName],
    previewText: `${greeting} Te extrañamos en ${businessName} 💆‍♀️ ¿Te reservamos un espacio esta semana? Responde a este mensaje y te buscamos el horario que mejor te quede.`,
  };
}

export function weeksLabel(days: number): string {
  const weeks = Math.floor(days / 7);
  return weeks <= 1 ? `${days} días` : `${weeks} semanas`;
}
