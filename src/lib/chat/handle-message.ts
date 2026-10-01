import { z } from "zod";
import type { Adapters } from "@/lib/adapters/registry";
import { runConciergeTurn, type ConciergeTurnResult, type LlmClient } from "@/lib/agent/concierge";
import { buildSystemBlocks, CONCIERGE_PROMPT_VERSION } from "@/lib/agent/prompt";
import { createToolExecutor } from "@/lib/agent/tool-executor";
import { BookingService } from "@/lib/booking/booking-service";
import { resolveBusinessSettings } from "@/lib/config/business-settings";
import type { Business } from "@/lib/schemas/entities";
import type { KeeperStore } from "@/lib/store/types";
import type { ChatChannel, ConversationRepo } from "./conversation-repo";
import { defaultChatDeps } from "./deps";
import { exchangeFromTurn, rebuildHistory, type AssistantPayload, EXCHANGE_PAYLOAD_VERSION } from "./history";
import { ChatError, FALLBACK_REPLY, sessionLimitStatus } from "./limits";

/** Stored rows replayed to Claude each turn (client + assistant rows, one assistant row per turn). */
export const HISTORY_WINDOW = 20;
export const MAX_CLIENT_TEXT_LENGTH = 1000;

export interface ChatDeps {
  store: KeeperStore;
  conversations: ConversationRepo;
  llm: LlmClient;
  adapters: (business: Business) => Adapters;
  clock: () => Date;
  model: string;
  maxTokens: number;
  demoMaxMessagesPerSession: number;
  /** Demo daily Claude budget (`isDemoBudgetExhausted`); always false for live businesses. */
  isDailyBudgetExhausted: (businessId: string) => Promise<boolean>;
}

export const clientMessageInputSchema = z.object({
  businessId: z.uuid(),
  phone: z.string().trim().min(5).max(32),
  text: z.string().trim().min(1).max(MAX_CLIENT_TEXT_LENGTH),
  channel: z.enum(["web", "whatsapp"]),
});

export type ClientMessageInput = z.input<typeof clientMessageInputSchema>;

export interface ClientMessageResult {
  reply: string;
  conversationId: string;
}

async function loadOrCreateConversation(deps: ChatDeps, businessId: string, clientId: string, channel: ChatChannel): Promise<string> {
  const existing = await deps.conversations.findConversation(businessId, clientId, channel);
  return existing ?? deps.conversations.createConversation(businessId, clientId, channel);
}

/**
 * One inbound client message → one concierge reply. Shared by the web chat (`/api/chat`) and the
 * WhatsApp webhook. Throws `ChatError` for expected failures (unknown business, demo session limit,
 * LLM outage); the caller turns those into a friendly response.
 */
export async function handleClientMessage(input: ClientMessageInput, deps?: ChatDeps): Promise<ClientMessageResult> {
  const parsed = clientMessageInputSchema.safeParse(input);
  if (!parsed.success) throw new ChatError("invalid_input", parsed.error.issues.map((i) => i.message).join("; "));
  const { businessId, phone, text, channel } = parsed.data;
  const d = deps ?? defaultChatDeps();

  const business = await d.store.getBusinessById(businessId);
  if (!business) throw new ChatError("business_not_found", `Business ${businessId} not found`);
  const settings = resolveBusinessSettings(business.settings);
  const client = await d.store.findOrCreateClient(business.id, phone, null);
  const conversationId = await loadOrCreateConversation(d, business.id, client.id, channel);

  // Cost guards (demo only): the daily budget across all sessions, then the per-session cap.
  // Checked before the incoming message is stored, so it never counts toward either limit.
  if (await d.isDailyBudgetExhausted(business.id)) {
    await d.store.logActivity({
      businessId: business.id,
      actor: "system",
      entity: "conversation",
      entityId: conversationId,
      action: "rate_limited",
      reason: "Demo daily message budget exhausted",
      meta: { clientId: client.id, channel },
    });
    throw new ChatError("daily_budget", "Demo daily message budget exhausted");
  }
  const limit = sessionLimitStatus({
    integrationMode: business.integrationMode,
    clientMessagesSoFar: business.integrationMode === "demo" ? await d.conversations.countClientMessages(business.id, conversationId) : 0,
    maxPerSession: d.demoMaxMessagesPerSession,
  });
  if (limit.limited) {
    await d.store.logActivity({
      businessId: business.id,
      actor: "system",
      entity: "conversation",
      entityId: conversationId,
      action: "rate_limited",
      reason: `Demo session reached ${d.demoMaxMessagesPerSession} client messages`,
      meta: { clientId: client.id, channel },
    });
    throw new ChatError("session_limit", "Demo session message limit reached");
  }

  const rows = await d.conversations.listRecentMessages(business.id, conversationId, HISTORY_WINDOW);
  // Persist the client's message before calling Claude so it is never lost (and counts toward limits).
  await d.conversations.insertMessage({ businessId: business.id, conversationId, role: "client", content: text });

  const { history, pendingClientText } = rebuildHistory(rows);
  const userText = pendingClientText === null ? text : `${pendingClientText}\n${text}`;
  const now = d.clock();
  const [services, packages] = await Promise.all([
    d.store.listActiveServices(business.id),
    d.store.listActivePackageTemplates(business.id),
  ]);
  const booking = new BookingService({ store: d.store, adapters: d.adapters(business), clock: d.clock });

  let turn: ConciergeTurnResult;
  try {
    turn = await runConciergeTurn({
      llm: d.llm,
      model: d.model,
      maxTokens: d.maxTokens,
      system: await buildSystemBlocks({ business, settings, services, packages, now, clientName: client.name }),
      history,
      userText,
      execute: createToolExecutor({ business, client, settings, store: d.store, booking }),
      fallbackReply: FALLBACK_REPLY,
    });
  } catch (error) {
    await d.store.logActivity({
      businessId: business.id,
      actor: "concierge",
      entity: "conversation",
      entityId: conversationId,
      action: "turn_failed",
      reason: "The concierge could not answer the client (LLM or tool failure)",
      meta: { clientId: client.id, channel, error: error instanceof Error ? error.message : String(error) },
    });
    throw new ChatError("llm_unavailable", error instanceof Error ? error.message : "Concierge turn failed");
  }

  const payload: AssistantPayload = {
    v: EXCHANGE_PAYLOAD_VERSION,
    exchange: exchangeFromTurn(turn.messages, history.length, turn.reply),
    toolCalls: turn.toolCalls.map((c) => c.name),
    stopReason: turn.stopReason,
    promptVersion: CONCIERGE_PROMPT_VERSION,
  };
  await d.conversations.insertMessage({ businessId: business.id, conversationId, role: "assistant", content: turn.reply, payload });
  await d.conversations.touchConversation(business.id, conversationId, d.clock());
  await d.store.logActivity({
    businessId: business.id,
    actor: "concierge",
    entity: "conversation",
    entityId: conversationId,
    action: "replied",
    reason: `Answered a ${channel} client message`,
    meta: {
      clientId: client.id,
      toolCalls: turn.toolCalls.map((c) => ({ name: c.name, ok: c.result.ok })),
      stopReason: turn.stopReason,
      promptVersion: CONCIERGE_PROMPT_VERSION,
    },
  });

  return { reply: turn.reply, conversationId };
}
