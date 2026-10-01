import { z } from "zod";
import { fromWhatsAppId } from "./phone";

/**
 * Inbound webhook payload (Cloud API `whatsapp_business_account` object). Parsed leniently: unknown
 * fields pass through and entries we can't read are skipped, so a new Meta field never breaks intake.
 * Only runs after the signature has been verified.
 */

const messageSchema = z.looseObject({
  id: z.string().min(1),
  from: z.string().min(1),
  timestamp: z.string().optional(),
  type: z.string().min(1),
  text: z.looseObject({ body: z.string() }).optional(),
});

const valueSchema = z.looseObject({
  messaging_product: z.string().optional(),
  metadata: z.looseObject({ phone_number_id: z.string().min(1) }),
  contacts: z.array(z.looseObject({ wa_id: z.string().optional(), profile: z.looseObject({ name: z.string().optional() }).optional() })).optional(),
  messages: z.array(z.unknown()).optional(),
});

const payloadSchema = z.looseObject({
  object: z.string(),
  entry: z.array(
    z.looseObject({
      changes: z.array(z.looseObject({ field: z.string().optional(), value: z.unknown() })).default([]),
    }),
  ),
});

export interface InboundWhatsAppMessage {
  /** Business phone number id that received the message (`metadata.phone_number_id`). */
  phoneNumberId: string;
  /** Meta message id (`wamid.…`) — the dedupe key. */
  wamid: string;
  /** Sender in Keeper's stored format (`+1809…`). */
  phone: string;
  /** Sender exactly as Meta sent it (bare digits), used to reply. */
  waId: string;
  type: string;
  /** Present only for `type: "text"`. */
  text: string | null;
  profileName: string | null;
}

export class WhatsAppPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppPayloadError";
  }
}

/** Extracts inbound client messages; status callbacks (sent/delivered/read) are ignored. */
export function parseInboundMessages(rawBody: string): InboundWhatsAppMessage[] {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new WhatsAppPayloadError("Body is not JSON");
  }
  const payload = payloadSchema.safeParse(json);
  if (!payload.success || payload.data.object !== "whatsapp_business_account") {
    throw new WhatsAppPayloadError("Not a WhatsApp Business Account webhook");
  }

  const out: InboundWhatsAppMessage[] = [];
  for (const entry of payload.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== undefined && change.field !== "messages") continue;
      const value = valueSchema.safeParse(change.value);
      if (!value.success) continue;
      const { metadata, contacts, messages } = value.data;
      for (const candidate of messages ?? []) {
        const message = messageSchema.safeParse(candidate);
        if (!message.success) continue;
        const m = message.data;
        const contact = contacts?.find((c) => c.wa_id === m.from) ?? contacts?.[0];
        out.push({
          phoneNumberId: metadata.phone_number_id,
          wamid: m.id,
          phone: fromWhatsAppId(m.from),
          waId: m.from,
          type: m.type,
          text: m.type === "text" && m.text ? m.text.body : null,
          profileName: contact?.profile?.name?.trim() || null,
        });
      }
    }
  }
  return out;
}
