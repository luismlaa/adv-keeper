import { TEMPLATE_LANGUAGE, WHATSAPP_TEMPLATES } from "@/lib/notifications/templates";
import type { MessagingChannel, OutboundTemplate, OutboundText } from "../messaging/types";
import { GRAPH_BASE_URL, graphPost, WhatsAppApiError, type FetchLike } from "./graph";
import { toWhatsAppRecipient } from "./phone";

export interface WhatsAppChannelOptions {
  /** Keeper's Meta system-user token (global env, never per business). */
  token: string;
  graphVersion: string;
  /** The business's WhatsApp Cloud API phone number id (`businesses.whatsapp_phone_number_id`). */
  phoneNumberId: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

function messageIdFrom(payload: unknown): string {
  const id = (payload as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id;
  if (typeof id !== "string" || id === "") {
    throw new WhatsAppApiError(200, null, "WhatsApp Graph API response did not include a message id");
  }
  return id;
}

/**
 * WhatsApp Cloud API channel: `POST /{phone-number-id}/messages`. Free-form text is only allowed
 * inside the 24h customer-service window; everything business-initiated goes through `sendTemplate`.
 */
export function createWhatsAppChannel(options: WhatsAppChannelOptions): MessagingChannel {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const url = `${GRAPH_BASE_URL}/${options.graphVersion}/${encodeURIComponent(options.phoneNumberId)}/messages`;

  const post = async (body: Record<string, unknown>) =>
    messageIdFrom(
      await graphPost({
        fetch: fetchImpl,
        token: options.token,
        url,
        body: { messaging_product: "whatsapp", recipient_type: "individual", ...body },
        timeoutMs: options.timeoutMs,
        maxAttempts: options.maxAttempts,
        sleep: options.sleep,
      }),
    );

  return {
    kind: "whatsapp",

    async sendText(message: OutboundText) {
      const messageId = await post({
        to: toWhatsAppRecipient(message.to),
        type: "text",
        text: { preview_url: true, body: message.text },
      });
      return { messageId };
    },

    async sendTemplate(message: OutboundTemplate) {
      const template = WHATSAPP_TEMPLATES[message.template];
      if (message.variables.length !== template.paramCount) {
        throw new Error(`Template ${message.template} expects ${template.paramCount} variables, got ${message.variables.length}`);
      }
      const messageId = await post({
        to: toWhatsAppRecipient(message.to),
        type: "template",
        template: {
          name: template.name,
          language: { code: TEMPLATE_LANGUAGE },
          components: [{ type: "body", parameters: message.variables.map((text) => ({ type: "text", text })) }],
        },
      });
      return { messageId };
    },
  };
}
