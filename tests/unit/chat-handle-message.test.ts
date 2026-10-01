import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { LlmClient } from "@/lib/agent/concierge";
import { handleClientMessage, type ChatDeps } from "@/lib/chat/handle-message";
import { ChatError } from "@/lib/chat/limits";
import { MemoryConversationRepo } from "@/lib/chat/memory-conversation-repo";
import { business, harness, NOW } from "../helpers/fixtures";

type Reply = Anthropic.Messages.ContentBlock[] | Error;

/** Scripted Claude that records every request it receives. */
function scriptedLlm(replies: Reply[]): LlmClient & { requests: Anthropic.Messages.MessageCreateParamsNonStreaming[] } {
  const requests: Anthropic.Messages.MessageCreateParamsNonStreaming[] = [];
  return {
    requests,
    async create(params) {
      requests.push(structuredClone(params));
      const next = replies.shift();
      if (next === undefined) throw new Error("script exhausted");
      if (next instanceof Error) throw next;
      return {
        id: `msg_${requests.length}`,
        type: "message",
        role: "assistant",
        model: params.model,
        content: next,
        stop_reason: next.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 } as Anthropic.Messages.Usage,
      } as Anthropic.Messages.Message;
    },
  };
}

const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.Messages.ContentBlock;
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as Anthropic.Messages.ContentBlock;

const PHONE = "+18090001234";

function setup(replies: Reply[], maxPerSession = 30) {
  const h = harness();
  const llm = scriptedLlm(replies);
  const conversations = new MemoryConversationRepo(
    (businessId, phone) => h.store.clients.find((c) => c.businessId === businessId && c.phone === phone)?.id ?? null,
    () => NOW,
  );
  const deps: ChatDeps = {
    store: h.store,
    conversations,
    llm,
    adapters: () => h.adapters,
    clock: () => NOW,
    model: "claude-test",
    maxTokens: 512,
    demoMaxMessagesPerSession: maxPerSession,
  };
  const say = (t: string) => handleClientMessage({ businessId: business.id, phone: PHONE, text: t, channel: "web" }, deps);
  return { h, llm, conversations, deps, say };
}

describe("handleClientMessage", () => {
  it("persists the turn and replays tool_use/tool_result pairs on the next message", async () => {
    const { h, llm, conversations, say } = setup([
      [toolUse("tu_1", "list_services", {})],
      [text("La limpieza facial cuesta RD$3,500.")],
      [text("¡A la orden!")],
    ]);

    const first = await say("¿Cuánto cuesta la limpieza facial?");
    expect(first.reply).toBe("La limpieza facial cuesta RD$3,500.");
    expect(conversations.messages.map((m) => m.role)).toEqual(["client", "assistant"]);

    const second = await say("gracias");
    expect(second.conversationId).toBe(first.conversationId);
    const replayed = llm.requests.at(-1)!.messages;
    expect(replayed.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(JSON.stringify(replayed[1]!.content)).toContain('"tool_use"');
    expect(JSON.stringify(replayed[2]!.content)).toContain('"tool_result"');
    expect(replayed.at(-1)).toEqual({ role: "user", content: "gracias" });

    const client = h.store.clients.find((c) => c.phone === PHONE)!;
    expect(client.businessId).toBe(business.id);
    expect(h.store.activity.filter((a) => a.action === "replied")).toHaveLength(2);
  });

  it("queues a discount request for the owner", async () => {
    const { h, say } = setup([
      [toolUse("tu_1", "request_owner_approval", { kind: "discount", details: "Pide 20% de descuento en el facial" })],
      [text("Ana revisa tu solicitud y te confirma pronto.")],
    ]);
    const { reply } = await say("¿Me haces un 20% de descuento?");
    expect(reply).toContain("te confirma");
    expect(h.store.approvals).toHaveLength(1);
    expect(h.store.approvals[0]).toMatchObject({ kind: "discount", status: "pending" });
  });

  it("enforces the per-session demo cap without calling Claude", async () => {
    const { llm, conversations, say } = setup([[text("uno")], [text("dos")]], 2);
    await say("hola");
    await say("¿sigues?");
    const calls = llm.requests.length;
    await expect(say("otra más")).rejects.toMatchObject({ code: "session_limit" });
    expect(llm.requests.length).toBe(calls);
    expect(conversations.messages.filter((m) => m.role === "client")).toHaveLength(2);
  });

  it("keeps the client's message when Claude fails and folds it into the next turn", async () => {
    const { llm, conversations, say } = setup([new Error("overloaded"), [text("¡Hola! ¿En qué te ayudo?")]]);
    const failure = await say("hola").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ChatError);
    expect((failure as ChatError).code).toBe("llm_unavailable");
    expect(conversations.messages.map((m) => m.role)).toEqual(["client"]);

    await say("¿hay alguien?");
    expect(llm.requests.at(-1)!.messages).toEqual([{ role: "user", content: "hola\n¿hay alguien?" }]);
  });

  it("rejects unknown businesses and empty text", async () => {
    const { say, deps } = setup([]);
    await expect(say("   ")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      handleClientMessage({ businessId: "99999999-9999-4999-8999-999999999999", phone: PHONE, text: "hola", channel: "web" }, deps),
    ).rejects.toMatchObject({ code: "business_not_found" });
  });
});
