import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * Conversation persistence ↔ Anthropic history.
 *
 * Storage model: one `messages` row per client message (role `client`, plain text) and ONE row per
 * concierge turn (role `assistant`). The assistant row's `content` is the final reply shown to the
 * client; its `payload.exchange` holds every Anthropic message of that turn after the client's text
 * (assistant tool_use → user tool_result → … → final assistant text). Keeping a whole turn in a
 * single row means a history window can never split a tool_use from its tool_result.
 */

export type StoredRole = "client" | "assistant" | "owner" | "system";

export interface StoredMessage {
  id: string;
  role: StoredRole;
  content: string;
  payload: unknown;
  createdAt: string;
}

export const EXCHANGE_PAYLOAD_VERSION = 1;

export interface AssistantPayload {
  v: typeof EXCHANGE_PAYLOAD_VERSION;
  exchange: Anthropic.Messages.MessageParam[];
  toolCalls: string[];
  stopReason: string;
  promptVersion: string;
}

const textBlock = z.object({ type: z.literal("text"), text: z.string().min(1) });
const toolUseBlock = z.object({ type: z.literal("tool_use"), id: z.string().min(1), name: z.string().min(1), input: z.unknown() });
const toolResultBlock = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string().min(1),
  content: z.string(),
  is_error: z.boolean().optional(),
});
const storedMessageParam = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string().min(1), z.array(z.discriminatedUnion("type", [textBlock, toolUseBlock, toolResultBlock])).min(1)]),
});
const assistantPayloadSchema = z.object({ v: z.literal(EXCHANGE_PAYLOAD_VERSION), exchange: z.array(storedMessageParam).min(1) });

type Block = Anthropic.Messages.ContentBlockParam | Anthropic.Messages.ContentBlock;

/** Keeps only replayable blocks in their minimal param shape (drops citations, empty text, etc.). */
function normalizeBlocks(content: Anthropic.Messages.MessageParam["content"]): Anthropic.Messages.ContentBlockParam[] {
  if (typeof content === "string") return content.trim() === "" ? [] : [{ type: "text", text: content }];
  const out: Anthropic.Messages.ContentBlockParam[] = [];
  for (const block of content as readonly Block[]) {
    if (block.type === "text" && block.text.trim() !== "") out.push({ type: "text", text: block.text });
    else if (block.type === "tool_use") out.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
    else if (block.type === "tool_result") {
      out.push({
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? ""),
        ...(block.is_error === undefined ? {} : { is_error: block.is_error }),
      });
    }
  }
  return out;
}

/**
 * The part of a finished turn to persist: everything after the client's text message. Guarantees the
 * exchange ends with an assistant message (a tool-budget-exhausted turn ends on tool results, so the
 * fallback reply is appended) and that no message has empty content.
 */
export function exchangeFromTurn(
  turnMessages: readonly Anthropic.Messages.MessageParam[],
  historyLength: number,
  reply: string,
): Anthropic.Messages.MessageParam[] {
  const tail = turnMessages.slice(historyLength + 1);
  const normalized = tail.map((m): Anthropic.Messages.MessageParam => ({ role: m.role, content: normalizeBlocks(m.content) }));
  const nonEmpty = normalized.filter((m) => (m.content as unknown[]).length > 0);
  const last = nonEmpty.at(-1);
  if (last === undefined || last.role !== "assistant") {
    return [...nonEmpty, { role: "assistant", content: [{ type: "text", text: reply }] }];
  }
  return nonEmpty;
}

function toolUseIds(message: Anthropic.Messages.MessageParam): string[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []));
}

function toolResultIds(message: Anthropic.Messages.MessageParam): string[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []));
}

/** An exchange replays safely when roles alternate (assistant first and last) and every tool_use is answered next. */
export function isReplayableExchange(exchange: readonly Anthropic.Messages.MessageParam[]): boolean {
  if (exchange.length === 0 || exchange[0]!.role !== "assistant" || exchange.at(-1)!.role !== "assistant") return false;
  for (let i = 0; i < exchange.length; i++) {
    const message = exchange[i]!;
    if (i > 0 && exchange[i - 1]!.role === message.role) return false;
    if (message.role !== "assistant") continue;
    const uses = toolUseIds(message);
    const next = exchange[i + 1];
    if (uses.length === 0) continue;
    if (next === undefined) return false;
    const answered = new Set(toolResultIds(next));
    if (!uses.every((id) => answered.has(id))) return false;
  }
  return true;
}

function exchangeFor(row: StoredMessage): Anthropic.Messages.MessageParam[] {
  const parsed = assistantPayloadSchema.safeParse(row.payload);
  const exchange = parsed.success ? (parsed.data.exchange as Anthropic.Messages.MessageParam[]) : null;
  if (exchange !== null && isReplayableExchange(exchange)) return exchange;
  // Unknown/corrupt payload: fall back to the visible reply so the model still sees what it said.
  return row.content.trim() === "" ? [] : [{ role: "assistant", content: row.content }];
}

export interface RebuiltHistory {
  history: Anthropic.Messages.MessageParam[];
  /** Client text with no reply yet (a previous turn failed). Prepend it to the new message. */
  pendingClientText: string | null;
}

/**
 * Rebuilds the Anthropic history from stored rows (oldest first). Assistant rows without a preceding
 * client message in the window are dropped (the window cut them off), consecutive client messages
 * are merged, and owner/system rows are ignored. The result always starts with `user` and ends with
 * `assistant` (or is empty).
 */
export function rebuildHistory(rows: readonly StoredMessage[]): RebuiltHistory {
  let history: Anthropic.Messages.MessageParam[] = [];
  let pending: string | null = null;
  for (const row of rows) {
    if (row.role === "client") {
      const text = row.content.trim();
      if (text !== "") pending = pending === null ? text : `${pending}\n${text}`;
      continue;
    }
    if (row.role !== "assistant" || pending === null) continue;
    const exchange = exchangeFor(row);
    if (exchange.length === 0) continue;
    history = [...history, { role: "user", content: pending }, ...exchange];
    pending = null;
  }
  return { history, pendingClientText: pending };
}

export interface DisplayMessage {
  id: string;
  role: "client" | "assistant";
  text: string;
  createdAt: string;
}

/** What the chat UI shows: client and assistant bubbles only, never tool traffic. */
export function toDisplayMessages(rows: readonly StoredMessage[]): DisplayMessage[] {
  return rows.flatMap((row) =>
    row.role === "client" || row.role === "assistant" ? [{ id: row.id, role: row.role, text: row.content, createdAt: row.createdAt }] : [],
  );
}
