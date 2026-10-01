import type { ClientMessageInput } from "@/lib/chat/handle-message";
import type { Business } from "@/lib/schemas/entities";
import type { KeeperStore } from "@/lib/store/types";
import type { MessagingChannel } from "../messaging/types";
import { WhatsAppApiError } from "./graph";
import { parseInboundMessages, WhatsAppPayloadError, type InboundWhatsAppMessage } from "./payload";
import { NUDGE_MESSAGE_TYPES, replyForError, UNSUPPORTED_MESSAGE_REPLY } from "./replies";
import type { WhatsAppRepo } from "./repo";
import { verifyWebhookHandshake, verifyWhatsAppSignature } from "./signature";

export interface InboundDeps {
  repo: WhatsAppRepo;
  store: Pick<KeeperStore, "logActivity">;
  /** `handleClientMessage` in production (import-only contract from the chat module). */
  handleMessage: (input: ClientMessageInput) => Promise<{ reply: string }>;
  /** WhatsApp channel bound to the number that received the message. */
  channelFor: (business: Business, phoneNumberId: string) => MessagingChannel;
  /** Operational log (stdout). Never receives message text or secrets. */
  log?: (event: string, meta: Record<string, unknown>) => void;
}

/** GET: Meta's subscription handshake. */
export function handleWebhookGet(params: URLSearchParams, verifyToken: string | undefined): Response {
  const challenge = verifyWebhookHandshake(params, verifyToken);
  if (challenge === null) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export interface WebhookPostInput {
  rawBody: string;
  signature: string | null;
  appSecret: string | undefined;
}

export interface WebhookPostResult {
  response: Response;
  /** Deferred processing — the route hands it to `after()` so Meta gets its 200 immediately. */
  work: (() => Promise<void>) | null;
}

/**
 * POST: verify the signature on the raw body, parse, and answer fast. Replying (Claude + Graph API)
 * happens in `work`, after the response is sent.
 */
export function handleWebhookPost(deps: InboundDeps, input: WebhookPostInput): WebhookPostResult {
  if (!verifyWhatsAppSignature(input.rawBody, input.signature, input.appSecret)) {
    deps.log?.("invalid_signature", { hasSignature: input.signature !== null, configured: Boolean(input.appSecret) });
    return { response: Response.json({ status: "invalid_signature" }, { status: 401 }), work: null };
  }
  let messages: InboundWhatsAppMessage[];
  try {
    messages = parseInboundMessages(input.rawBody);
  } catch (error) {
    if (!(error instanceof WhatsAppPayloadError)) throw error;
    deps.log?.("invalid_payload", { reason: error.message });
    return { response: Response.json({ status: "invalid_payload" }, { status: 400 }), work: null };
  }
  const response = Response.json({ status: "received", messages: messages.length }, { status: 200 });
  return { response, work: messages.length === 0 ? null : () => processInboundMessages(deps, messages) };
}

/** Sequential on purpose: messages of one delivery keep their order in the conversation. */
export async function processInboundMessages(deps: InboundDeps, messages: readonly InboundWhatsAppMessage[]): Promise<void> {
  for (const message of messages) {
    try {
      await processOne(deps, message);
    } catch (error) {
      deps.log?.("inbound_failed", { wamid: message.wamid, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

async function processOne(deps: InboundDeps, message: InboundWhatsAppMessage): Promise<void> {
  const business = await deps.repo.findBusinessByPhoneNumberId(message.phoneNumberId);
  if (business === null) {
    deps.log?.("unknown_phone_number_id", { phoneNumberId: message.phoneNumberId, wamid: message.wamid });
    return;
  }

  const fresh = await deps.repo.claimInbound({
    businessId: business.id,
    wamid: message.wamid,
    reason: `Inbound WhatsApp ${message.type} message from a client`,
    meta: { type: message.type, phoneNumberId: message.phoneNumberId },
  });
  if (!fresh) {
    deps.log?.("duplicate", { businessId: business.id, wamid: message.wamid });
    return;
  }

  const reply = await replyFor(deps, business, message);
  if (reply === null) return;

  const channel = deps.channelFor(business, message.phoneNumberId);
  try {
    const { messageId } = await channel.sendText({ to: message.waId, text: reply });
    await deps.store.logActivity({
      businessId: business.id,
      actor: "whatsapp",
      entity: "whatsapp_message",
      entityId: messageId,
      action: "whatsapp_reply_sent",
      reason: "Replied to a client on WhatsApp",
      meta: { inReplyTo: message.wamid },
    });
  } catch (error) {
    await deps.store.logActivity({
      businessId: business.id,
      actor: "whatsapp",
      entity: "whatsapp_message",
      entityId: message.wamid,
      action: "whatsapp_reply_failed",
      reason: "Could not deliver the WhatsApp reply to the client",
      meta: {
        status: error instanceof WhatsAppApiError ? error.status : null,
        code: error instanceof WhatsAppApiError ? error.code : null,
      },
    });
    throw error;
  }
}

async function replyFor(deps: InboundDeps, business: Business, message: InboundWhatsAppMessage): Promise<string | null> {
  if (message.type !== "text" || message.text === null) {
    return NUDGE_MESSAGE_TYPES.has(message.type) ? UNSUPPORTED_MESSAGE_REPLY : null;
  }
  try {
    const { reply } = await deps.handleMessage({ businessId: business.id, phone: message.phone, text: message.text, channel: "whatsapp" });
    return reply;
  } catch (error) {
    deps.log?.("chat_failed", {
      businessId: business.id,
      wamid: message.wamid,
      code: (error as { code?: unknown } | null)?.code ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    return replyForError(error);
  }
}
