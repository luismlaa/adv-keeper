import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { LlmClient } from "@/lib/agent/concierge";
import { createWhatsAppChannel } from "@/lib/adapters/whatsapp/channel";
import type { FetchLike } from "@/lib/adapters/whatsapp/graph";
import { parseInboundMessages } from "@/lib/adapters/whatsapp/payload";
import { CHAT_ERROR_REPLIES, UNSUPPORTED_MESSAGE_REPLY } from "@/lib/adapters/whatsapp/replies";
import { MemoryWhatsAppRepo } from "@/lib/adapters/whatsapp/repo";
import { signWhatsAppPayload } from "@/lib/adapters/whatsapp/signature";
import { handleWebhookPost, type InboundDeps } from "@/lib/adapters/whatsapp/webhook";
import { handleClientMessage, type ChatDeps, type ClientMessageInput } from "@/lib/chat/handle-message";
import { ChatError } from "@/lib/chat/limits";
import { MemoryConversationRepo } from "@/lib/chat/memory-conversation-repo";
import { business, harness, NOW } from "../helpers/fixtures";

const APP_SECRET = "meta-app-secret-for-tests";
const PHONE_NUMBER_ID = "106540352242922";
const waBusiness = { ...business, whatsappPhoneNumberId: PHONE_NUMBER_ID };

type InboundMsg = Record<string, unknown>;

function webhookBody(messages: InboundMsg[], phoneNumberId = PHONE_NUMBER_ID): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "18095550000", phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "María Pérez" }, wa_id: "18095559876" }],
              messages,
            },
          },
        ],
      },
    ],
  });
}

const textMsg = (id: string, body: string): InboundMsg => ({ from: "18095559876", id, timestamp: "1759240000", type: "text", text: { body } });

function scriptedLlm(texts: string[]): LlmClient & { calls: number } {
  const llm = {
    calls: 0,
    async create(params: Anthropic.Messages.MessageCreateParamsNonStreaming) {
      llm.calls++;
      const next = texts.shift();
      if (next === undefined) throw new Error("script exhausted");
      return {
        id: `msg_${llm.calls}`,
        type: "message",
        role: "assistant",
        model: params.model,
        content: [{ type: "text", text: next, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      } as unknown as Anthropic.Messages.Message;
    },
  };
  return llm;
}

/** Wires the webhook to the real `handleClientMessage` (scripted Claude, MemoryStore) and a mocked Graph API. */
function setup(options: { replies?: string[]; handleMessage?: InboundDeps["handleMessage"]; graphStatus?: number } = {}) {
  const h = harness();
  const llm = scriptedLlm(options.replies ?? []);
  const conversations = new MemoryConversationRepo(
    (businessId, phone) => h.store.clients.find((c) => c.businessId === businessId && c.phone === phone)?.id ?? null,
    () => NOW,
  );
  const chatDeps: ChatDeps = {
    store: h.store,
    conversations,
    llm,
    adapters: () => h.adapters,
    clock: () => NOW,
    model: "claude-test",
    maxTokens: 512,
    demoMaxMessagesPerSession: 30,
    isDailyBudgetExhausted: async () => false,
  };
  const chatInputs: ClientMessageInput[] = [];
  const graphCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetch: FetchLike = async (url, init) => {
    graphCalls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const status = options.graphStatus ?? 200;
    const body = status === 200 ? { messages: [{ id: `wamid.OUT${graphCalls.length}` }] } : { error: { message: "bad", code: 131047 } };
    return new Response(JSON.stringify(body), { status });
  };
  const repo = new MemoryWhatsAppRepo([waBusiness]);
  const logs: string[] = [];
  const deps: InboundDeps = {
    repo,
    store: h.store,
    handleMessage: async (input) => {
      chatInputs.push(input);
      return options.handleMessage ? options.handleMessage(input) : handleClientMessage(input, chatDeps);
    },
    channelFor: (_b, phoneNumberId) => createWhatsAppChannel({ token: "test-token", graphVersion: "v23.0", phoneNumberId, fetch, maxAttempts: 1 }),
    log: (event) => void logs.push(event),
  };

  /** Simulates one Meta delivery: returns the HTTP status and runs the deferred `after()` work. */
  async function deliver(rawBody: string, signature: string | null = signWhatsAppPayload(rawBody, APP_SECRET)) {
    const { response, work } = handleWebhookPost(deps, { rawBody, signature, appSecret: APP_SECRET });
    if (work) await work();
    return response;
  }

  return { h, llm, conversations, repo, chatInputs, graphCalls, logs, deliver };
}

describe("WhatsApp webhook POST", () => {
  it("answers a text message through handleClientMessage and replies with sendText", async () => {
    const s = setup({ replies: ["¡Hola María! La limpieza facial cuesta RD$3,500."] });
    const res = await s.deliver(webhookBody([textMsg("wamid.IN1", "¿Cuánto cuesta la limpieza facial?")]));

    expect(res.status).toBe(200);
    expect(s.chatInputs).toEqual([{ businessId: business.id, phone: "+18095559876", text: "¿Cuánto cuesta la limpieza facial?", channel: "whatsapp" }]);
    expect(s.graphCalls).toHaveLength(1);
    expect(s.graphCalls[0]!.url).toBe(`https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`);
    expect(s.graphCalls[0]!.body).toMatchObject({ to: "18095559876", type: "text", text: { body: "¡Hola María! La limpieza facial cuesta RD$3,500." } });
    expect(s.repo.activity.map((a) => [a.action, a.entityId])).toEqual([["whatsapp_inbound", "wamid.IN1"]]);
    expect(s.h.store.activity.some((a) => a.action === "whatsapp_reply_sent" && a.entityId === "wamid.OUT1")).toBe(true);
    // The conversation is persisted on the whatsapp channel.
    expect(s.conversations.messages.map((m) => m.role)).toEqual(["client", "assistant"]);
  });

  it("dedupes by wamid: the same webhook delivered twice gets one reply", async () => {
    const s = setup({ replies: ["Respuesta única"] });
    const body = webhookBody([textMsg("wamid.DUP", "hola")]);

    expect((await s.deliver(body)).status).toBe(200);
    expect((await s.deliver(body)).status).toBe(200);

    expect(s.llm.calls).toBe(1);
    expect(s.graphCalls).toHaveLength(1);
    expect(s.logs).toContain("duplicate");
  });

  it("rejects forged and missing signatures with 401 and does nothing", async () => {
    const s = setup({ replies: ["no debería responder"] });
    const body = webhookBody([textMsg("wamid.FORGED", "hola")]);

    expect((await s.deliver(body, signWhatsAppPayload(body, "attacker-secret"))).status).toBe(401);
    expect((await s.deliver(body, null)).status).toBe(401);
    expect((await s.deliver(body.replace("hola", "adiós"), signWhatsAppPayload(body, APP_SECRET))).status).toBe(401);

    expect(s.chatInputs).toHaveLength(0);
    expect(s.graphCalls).toHaveLength(0);
    expect(s.repo.activity).toHaveLength(0);
  });

  it("answers 400 for a signed body that is not a WhatsApp webhook", async () => {
    const s = setup();
    expect((await s.deliver("not json")).status).toBe(400);
    expect((await s.deliver(JSON.stringify({ object: "page", entry: [] }))).status).toBe(400);
  });

  it("acknowledges status callbacks without replying", async () => {
    const s = setup();
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, statuses: [{ id: "wamid.X", status: "read" }] } }] }],
    });
    expect((await s.deliver(body)).status).toBe(200);
    expect(s.graphCalls).toHaveLength(0);
  });

  it("ignores messages for a phone number id no business owns", async () => {
    const s = setup({ replies: ["x"] });
    expect((await s.deliver(webhookBody([textMsg("wamid.OTHER", "hola")], "999"))).status).toBe(200);
    expect(s.chatInputs).toHaveLength(0);
    expect(s.graphCalls).toHaveLength(0);
    expect(s.logs).toContain("unknown_phone_number_id");
  });

  it("nudges non-text messages to write instead, and ignores reactions", async () => {
    const s = setup();
    await s.deliver(
      webhookBody([
        { from: "18095559876", id: "wamid.AUDIO", type: "audio", audio: { id: "media1" } },
        { from: "18095559876", id: "wamid.REACT", type: "reaction", reaction: { message_id: "wamid.OUT1", emoji: "👍" } },
      ]),
    );
    expect(s.chatInputs).toHaveLength(0);
    expect(s.graphCalls).toHaveLength(1);
    expect(s.graphCalls[0]!.body).toMatchObject({ text: { body: UNSUPPORTED_MESSAGE_REPLY } });
  });

  it.each([
    ["invalid_input", CHAT_ERROR_REPLIES.invalid_input],
    ["business_not_found", CHAT_ERROR_REPLIES.business_not_found],
    ["session_limit", CHAT_ERROR_REPLIES.session_limit],
    ["daily_budget", CHAT_ERROR_REPLIES.daily_budget],
    ["llm_unavailable", CHAT_ERROR_REPLIES.llm_unavailable],
  ] as const)("maps ChatError %s to a short Spanish reply without leaking details", async (code, expected) => {
    const s = setup({
      handleMessage: async () => {
        throw new ChatError(code, "internal detail: secret stack");
      },
    });
    await s.deliver(webhookBody([textMsg(`wamid.${code}`, "hola")]));
    expect(s.graphCalls).toHaveLength(1);
    const sent = (s.graphCalls[0]!.body.text as { body: string }).body;
    expect(sent).toBe(expected);
    expect(sent).not.toContain("internal detail");
  });

  it("answers unexpected errors with the generic apology", async () => {
    const s = setup({
      handleMessage: async () => {
        throw new Error("db exploded");
      },
    });
    await s.deliver(webhookBody([textMsg("wamid.BOOM", "hola")]));
    const sent = (s.graphCalls[0]!.body.text as { body: string }).body;
    expect(sent).toBe(CHAT_ERROR_REPLIES.llm_unavailable);
    expect(sent).not.toContain("db exploded");
  });

  it("logs a failed Graph API reply to activity_log and keeps processing the next message", async () => {
    const s = setup({ handleMessage: async () => ({ reply: "ok" }), graphStatus: 400 });
    await s.deliver(webhookBody([textMsg("wamid.F1", "uno"), textMsg("wamid.F2", "dos")]));
    const failures = s.h.store.activity.filter((a) => a.action === "whatsapp_reply_failed");
    expect(failures.map((f) => f.entityId)).toEqual(["wamid.F1", "wamid.F2"]);
    expect(failures[0]!.meta).toEqual({ status: 400, code: 131047 });
  });
});

describe("inbound payload parsing", () => {
  it("extracts sender, wamid, text and profile name", () => {
    const [m] = parseInboundMessages(webhookBody([textMsg("wamid.P1", "Hola")]));
    expect(m).toEqual({
      phoneNumberId: PHONE_NUMBER_ID,
      wamid: "wamid.P1",
      phone: "+18095559876",
      waId: "18095559876",
      type: "text",
      text: "Hola",
      profileName: "María Pérez",
    });
  });
});
