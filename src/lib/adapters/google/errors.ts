/** The stored refresh token was revoked or expired: the owner must reconnect in /ajustes. */
export class GoogleDisconnectedError extends Error {
  readonly code = "google_disconnected" as const;

  constructor(readonly businessId: string) {
    super("Google desconectado, reconectar en Ajustes");
    this.name = "GoogleDisconnectedError";
  }
}

/** The business has no Google Calendar integration row. */
export class GoogleNotConnectedError extends Error {
  readonly code = "google_not_connected" as const;

  constructor(readonly businessId: string) {
    super("Google Calendar no está conectado para este negocio");
    this.name = "GoogleNotConnectedError";
  }
}

/** Any other non-success answer from Google. Never carries tokens; `detail` is Google's short reason. */
export class GoogleApiError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
    readonly detail: string | null = null,
  ) {
    super(`Google ${operation} failed with HTTP ${status}${detail ? ` (${detail})` : ""}`);
    this.name = "GoogleApiError";
  }
}

/** Extracts Google's short error reason from an OAuth (`{error}`) or API (`{error:{status,message}}`) body. */
export function googleErrorReason(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    const { status, message } = error as { status?: unknown; message?: unknown };
    if (typeof status === "string") return status;
    if (typeof message === "string") return message.slice(0, 120);
  }
  return null;
}
