import type Anthropic from "@anthropic-ai/sdk";
import { TURN_LIMITS } from "./approvals";
import type { ToolExecutor, ToolResult } from "./tool-executor";
import { anthropicTools } from "./tools";

/** The one LLM call the loop needs — lets tests script responses without the network. */
export interface LlmClient {
  create(params: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message>;
}

export function anthropicLlm(client: Anthropic): LlmClient {
  return { create: (params) => client.messages.create(params) };
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  result: ToolResult;
}

export interface ConciergeTurnInput {
  llm: LlmClient;
  model: string;
  maxTokens: number;
  system: Anthropic.Messages.TextBlockParam[];
  /** Prior conversation, oldest first. Not mutated. */
  history: readonly Anthropic.Messages.MessageParam[];
  userText: string;
  execute: ToolExecutor;
  fallbackReply: string;
}

export interface ConciergeTurnResult {
  reply: string;
  /** history + this turn (user message, assistant/tool exchanges, final assistant message). */
  messages: Anthropic.Messages.MessageParam[];
  toolCalls: ToolCallRecord[];
  stopReason: Anthropic.Messages.StopReason | "tool_budget_exhausted";
}

const MAX_MODEL_ROUNDS = TURN_LIMITS.maxToolCalls + 1;

/** Runs one client message through the tool-use loop until Claude answers in plain text. */
export async function runConciergeTurn(input: ConciergeTurnInput): Promise<ConciergeTurnResult> {
  const tools = anthropicTools();
  let messages: Anthropic.Messages.MessageParam[] = [...input.history, { role: "user", content: input.userText }];
  let toolCalls: ToolCallRecord[] = [];

  for (let round = 0; round < MAX_MODEL_ROUNDS; round++) {
    const response = await input.llm.create({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      tools,
      messages,
    });
    messages = [...messages, { role: "assistant", content: response.content }];

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply: text === "" ? input.fallbackReply : text, messages, toolCalls, stopReason: response.stop_reason ?? "end_turn" };
    }

    const toolUses = response.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const result = await input.execute(use.name, use.input);
      toolCalls = [...toolCalls, { name: use.name, input: use.input, result }];
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result), is_error: !result.ok });
    }
    messages = [...messages, { role: "user", content: results }];
  }

  return { reply: input.fallbackReply, messages, toolCalls, stopReason: "tool_budget_exhausted" };
}
