import { DomainError } from "@/lib/domain/errors";

/** Result shape every dashboard server action returns to `useActionState`. */
export interface ActionState {
  status: "idle" | "ok" | "error";
  message?: string;
  /** Extra text to show after success (e.g. the message preview sent to a client). */
  preview?: string;
  /** Validation errors, one per line. */
  errors?: string[];
}

export const IDLE: ActionState = { status: "idle" };

const DOMAIN_MESSAGES: Readonly<Record<string, string>> = {
  invalid_transition: "Esa acción ya no aplica al estado actual de la cita. Recarga la página.",
  package_not_active: "El paquete de la clienta no está activo.",
  package_exhausted: "El paquete de la clienta ya no tiene sesiones disponibles.",
};

/** Turns any thrown error into a Spanish, owner-friendly message (never a stack trace). */
export function errorToState(error: unknown): ActionState {
  if (error instanceof DomainError) {
    return { status: "error", message: DOMAIN_MESSAGES[error.code] ?? "Esa acción no está permitida." };
  }
  const message = error instanceof Error ? error.message : "";
  // Our own thrown messages are written in Spanish for the owner; technical ones end in "failed: ...".
  if (message !== "" && !/failed:/.test(message)) return { status: "error", message };
  console.error("[dashboard] action failed", error);
  return { status: "error", message: "No se pudo completar la acción. Inténtalo de nuevo." };
}

/** Only same-site absolute paths are allowed as post-login destinations. */
export function safeNextPath(raw: unknown, fallback = "/agenda"): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\") || raw.startsWith("/login")) return fallback;
  return raw;
}

/** Same-instant clock for request handlers (kept out of components so render stays pure). */
export function currentInstant(): Date {
  return new Date();
}
