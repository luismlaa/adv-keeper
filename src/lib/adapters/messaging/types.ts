export type TemplateName = "day_before_reminder" | "deposit_link" | "package_nudge" | "reactivation";

export interface OutboundText {
  to: string;
  text: string;
}

export interface OutboundTemplate {
  to: string;
  template: TemplateName;
  /** Positional body variables, in the order declared in the approved WhatsApp template. */
  variables: readonly string[];
  /** Rendered fallback text — what the web channel shows and what we persist in `messages`. */
  previewText: string;
}

/** Outbound channel to the client. Live: WhatsApp Cloud API. Demo: web chat (persisted messages only). */
export interface MessagingChannel {
  readonly kind: "web" | "whatsapp" | "recording";
  sendText(message: OutboundText): Promise<{ messageId: string }>;
  sendTemplate(message: OutboundTemplate): Promise<{ messageId: string }>;
}
