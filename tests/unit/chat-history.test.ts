import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  exchangeFromTurn,
  isReplayableExchange,
  rebuildHistory,
  toDisplayMessages,
  type StoredMessage,
} from "@/lib/chat/history";

type Param = Anthropic.Messages.MessageParam;

let seq = 0;
const row = (role: StoredMessage["role"], content: string, payload: unknown = {}): StoredMessage => ({
  id: `m${++seq}`,
  role,
  content,
  payload,
  createdAt: new Date(Date.UTC(2026, 8, 28, 12, 0, seq)).toISOString(),
});

const toolExchange: Param[] = [
  { role: "assistant", content: [{ type: "text", text: "Déjame ver." }, { type: "tool_use", id: "tu_1", name: "list_services", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: '{"ok":true,"data":[]}' }] },
  { role: "assistant", content: [{ type: "text", text: "La limpieza facial cuesta RD$3,500." }] },
];
const payload = (exchange: Param[]) => ({ v: 1, exchange, toolCalls: [], stopReason: "end_turn", promptVersion: "v1" });

describe("exchangeFromTurn", () => {
  it("keeps everything after the client's text and strips SDK-only fields", () => {
    const history: Param[] = [
      { role: "user", content: "hola" },
      { role: "assistant", content: "¡Hola!" },
    ];
    const turnMessages: Param[] = [
      ...history,
      { role: "user", content: "¿cuánto cuesta?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Déjame ver.", citations: null },
          { type: "tool_use", id: "tu_1", name: "list_services", input: {} },
        ] as unknown as Anthropic.Messages.ContentBlockParam[],
      },
      toolExchange[1]!,
      toolExchange[2]!,
    ];
    const exchange = exchangeFromTurn(turnMessages, history.length, "La limpieza facial cuesta RD$3,500.");
    expect(exchange).toEqual(toolExchange);
    expect(isReplayableExchange(exchange)).toBe(true);
  });

  it("appends the fallback reply when the turn ended on tool results (tool budget exhausted)", () => {
    const turnMessages: Param[] = [{ role: "user", content: "hola" }, toolExchange[0]!, toolExchange[1]!];
    const exchange = exchangeFromTurn(turnMessages, 0, "Déjame confirmarlo.");
    expect(exchange.at(-1)).toEqual({ role: "assistant", content: [{ type: "text", text: "Déjame confirmarlo." }] });
    expect(isReplayableExchange(exchange)).toBe(true);
  });

  it("never stores an assistant message with empty content", () => {
    const turnMessages: Param[] = [{ role: "user", content: "hola" }, { role: "assistant", content: [{ type: "text", text: "  " }] }];
    const exchange = exchangeFromTurn(turnMessages, 0, "Fallback");
    expect(exchange).toEqual([{ role: "assistant", content: [{ type: "text", text: "Fallback" }] }]);
  });
});

describe("isReplayableExchange", () => {
  it("rejects a tool_use without its tool_result", () => {
    expect(isReplayableExchange([toolExchange[0]!])).toBe(false);
    expect(isReplayableExchange([toolExchange[0]!, { role: "user", content: [{ type: "tool_result", tool_use_id: "other", content: "{}" }] }, toolExchange[2]!])).toBe(false);
  });

  it("rejects exchanges that start with user or repeat a role", () => {
    expect(isReplayableExchange([toolExchange[1]!, toolExchange[2]!])).toBe(false);
    expect(isReplayableExchange([toolExchange[2]!, toolExchange[2]!])).toBe(false);
    expect(isReplayableExchange([])).toBe(false);
  });
});

describe("rebuildHistory", () => {
  it("replays tool_use/tool_result pairs from the stored payload", () => {
    const { history, pendingClientText } = rebuildHistory([
      row("client", "¿cuánto cuesta la limpieza?"),
      row("assistant", "La limpieza facial cuesta RD$3,500.", payload(toolExchange)),
      row("client", "gracias"),
      row("assistant", "¡A la orden!", payload([{ role: "assistant", content: [{ type: "text", text: "¡A la orden!" }] }])),
    ]);
    expect(pendingClientText).toBeNull();
    expect(history).toEqual([
      { role: "user", content: "¿cuánto cuesta la limpieza?" },
      ...toolExchange,
      { role: "user", content: "gracias" },
      { role: "assistant", content: [{ type: "text", text: "¡A la orden!" }] },
    ]);
  });

  it("drops assistant rows whose client message fell outside the window", () => {
    const { history } = rebuildHistory([row("assistant", "respuesta vieja", payload(toolExchange)), row("client", "hola"), row("assistant", "¡Hola!")]);
    expect(history).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "¡Hola!" },
    ]);
  });

  it("falls back to the visible reply when the payload is missing or corrupt", () => {
    const broken = { v: 1, exchange: [toolExchange[0]] }; // tool_use without result
    const { history } = rebuildHistory([row("client", "hola"), row("assistant", "¡Hola!", broken)]);
    expect(history.at(-1)).toEqual({ role: "assistant", content: "¡Hola!" });
  });

  it("merges unanswered client messages and returns a trailing one as pending", () => {
    const { history, pendingClientText } = rebuildHistory([
      row("client", "hola"),
      row("client", "¿estás?"),
      row("assistant", "¡Sí, aquí estoy!"),
      row("client", "quiero un facial"),
    ]);
    expect(history[0]).toEqual({ role: "user", content: "hola\n¿estás?" });
    expect(history).toHaveLength(2);
    expect(pendingClientText).toBe("quiero un facial");
  });

  it("ignores owner and system rows", () => {
    const { history } = rebuildHistory([row("system", "nota"), row("client", "hola"), row("owner", "interno"), row("assistant", "¡Hola!")]);
    expect(history.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("toDisplayMessages", () => {
  it("shows client and assistant bubbles only", () => {
    const shown = toDisplayMessages([row("client", "hola"), row("system", "x"), row("assistant", "¡Hola!", payload(toolExchange))]);
    expect(shown.map((m) => [m.role, m.text])).toEqual([
      ["client", "hola"],
      ["assistant", "¡Hola!"],
    ]);
  });
});
