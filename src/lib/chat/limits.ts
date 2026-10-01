import type { Business } from "@/lib/schemas/entities";

export type ChatErrorCode = "invalid_input" | "business_not_found" | "session_limit" | "llm_unavailable";

/** Expected failures of a chat turn. Callers map `code` to a status / friendly message. */
export class ChatError extends Error {
  constructor(
    readonly code: ChatErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

export interface SessionLimitInput {
  integrationMode: Business["integrationMode"];
  /** Client messages already stored in this conversation (not counting the incoming one). */
  clientMessagesSoFar: number;
  maxPerSession: number;
}

export interface SessionLimitStatus {
  limited: boolean;
  /** Messages left after the incoming one; null when the business has no per-session cap. */
  remaining: number | null;
}

/**
 * Claude cost guard for demo tenants: a conversation ("session") may hold at most `maxPerSession`
 * client messages. Live businesses are never capped here.
 */
export function sessionLimitStatus({ integrationMode, clientMessagesSoFar, maxPerSession }: SessionLimitInput): SessionLimitStatus {
  if (integrationMode !== "demo") return { limited: false, remaining: null };
  if (clientMessagesSoFar >= maxPerSession) return { limited: true, remaining: 0 };
  return { limited: false, remaining: maxPerSession - clientMessagesSoFar - 1 };
}

export function sessionLimitMessage(maxPerSession: number): string {
  return `Esta demo permite hasta ${maxPerSession} mensajes por conversación y ya llegaste al límite. ¡Gracias por probar Keeper! Si quieres verlo con tu propio negocio, escríbenos.`;
}

export const LLM_UNAVAILABLE_MESSAGE = "Uy, tuve un problema para responder. Intenta de nuevo en un momento, por favor.";

export const FALLBACK_REPLY = "Déjame confirmarlo y te escribo en un momento.";
