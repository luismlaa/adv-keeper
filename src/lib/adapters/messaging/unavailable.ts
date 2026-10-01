import type { MessagingChannel } from "./types";

export type MessagingUnavailableCode = "whatsapp_phone_number_missing" | "whatsapp_token_missing";

const REASONS: Record<MessagingUnavailableCode, string> = {
  whatsapp_phone_number_missing: "El negocio no tiene número de WhatsApp configurado (whatsapp_phone_number_id)",
  whatsapp_token_missing: "WhatsApp no está configurado en Keeper (falta WHATSAPP_TOKEN)",
};

/** A live business cannot message clients yet. Crons log it and skip the business; nothing is sent. */
export class MessagingUnavailableError extends Error {
  constructor(
    readonly code: MessagingUnavailableCode,
    readonly businessId: string,
  ) {
    super(REASONS[code]);
    this.name = "MessagingUnavailableError";
  }
}

/**
 * Stand-in channel for a live business whose WhatsApp is not set up: resolving adapters never crashes,
 * but every send rejects with the typed error.
 */
export class UnavailableChannel implements MessagingChannel {
  readonly kind = "whatsapp" as const;

  constructor(readonly error: MessagingUnavailableError) {}

  async sendText(): Promise<{ messageId: string }> {
    throw this.error;
  }

  async sendTemplate(): Promise<{ messageId: string }> {
    throw this.error;
  }
}

/** The reason a channel cannot send, or null when it can. Lets callers skip before claiming a dedupe key. */
export function messagingUnavailable(channel: MessagingChannel): MessagingUnavailableError | null {
  return channel instanceof UnavailableChannel ? channel.error : null;
}
