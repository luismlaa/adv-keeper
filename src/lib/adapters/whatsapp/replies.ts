import { ChatError, type ChatErrorCode, LLM_UNAVAILABLE_MESSAGE } from "@/lib/chat/limits";

/** Short Spanish replies for expected chat failures. Never include error details. */
export const CHAT_ERROR_REPLIES: Readonly<Record<ChatErrorCode, string>> = {
  invalid_input: "No pude leer bien tu mensaje 🙏 ¿Me lo escribes de nuevo, un poco más corto?",
  business_not_found: LLM_UNAVAILABLE_MESSAGE,
  session_limit: "Esta conversación de prueba llegó a su límite de mensajes. ¡Gracias por probar Keeper!",
  daily_budget: "La demo llegó a su límite de mensajes por hoy. ¡Escríbenos mañana!",
  llm_unavailable: LLM_UNAVAILABLE_MESSAGE,
};

export const UNSUPPORTED_MESSAGE_REPLY = "Por ahora solo puedo leer mensajes de texto 🙏 ¿Me escribes lo que necesitas?";

/** Message types that get the "text only" nudge; anything else (reactions, system events…) is ignored silently. */
export const NUDGE_MESSAGE_TYPES: ReadonlySet<string> = new Set(["image", "audio", "video", "document", "sticker", "location", "contacts"]);

export function replyForError(error: unknown): string {
  return error instanceof ChatError ? CHAT_ERROR_REPLIES[error.code] : LLM_UNAVAILABLE_MESSAGE;
}
