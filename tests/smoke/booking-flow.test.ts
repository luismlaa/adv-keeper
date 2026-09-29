import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { DEMO_SIGNATURE_HEADER, signDemoPayload } from "@/lib/adapters/payments/fake";
import { runConciergeTurn, type LlmClient } from "@/lib/agent/concierge";
import { buildSystemBlocks } from "@/lib/agent/prompt";
import { createToolExecutor } from "@/lib/agent/tool-executor";
import { resolveBusinessSettings } from "@/lib/config/business-settings";
import { dueDayBeforeReminders } from "@/lib/domain/reminders";
import { business, client, facial, harness, NOW, WEBHOOK_SECRET } from "../helpers/fixtures";

type Step = (lastToolResult: unknown) => Anthropic.Messages.ContentBlock[];

/** Scripted stand-in for Claude: each call returns the next step, fed the previous tool result. */
function scriptedLlm(steps: Step[]): LlmClient & { calls: number } {
  const llm = {
    calls: 0,
    async create(params: Anthropic.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Messages.Message> {
      const last = params.messages.at(-1);
      const toolResult =
        last && Array.isArray(last.content) && last.content[0]?.type === "tool_result"
          ? JSON.parse(String(last.content[0].content))
          : null;
      const content = steps[llm.calls++]!(toolResult);
      return {
        id: `msg_${llm.calls}`,
        type: "message",
        role: "assistant",
        model: params.model,
        content,
        stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 } as Anthropic.Messages.Usage,
      } as Anthropic.Messages.Message;
    },
  };
  return llm;
}

const toolUse = (id: string, name: string, input: unknown): Anthropic.Messages.ContentBlock =>
  ({ type: "tool_use", id, name, input }) as Anthropic.Messages.ContentBlock;
const text = (t: string): Anthropic.Messages.ContentBlock => ({ type: "text", text: t, citations: null }) as Anthropic.Messages.ContentBlock;

describe("smoke: client books via chat, pays the deposit, gets reminded", () => {
  it("runs hold → deposit link → signed payment → confirmed → reminder due", async () => {
    const h = harness();
    const settings = resolveBusinessSettings(business.settings);
    let depositUrl = "";

    const llm = scriptedLlm([
      () => [toolUse("t1", "check_availability", { service_id: facial.id, date_from: "2026-09-29", days: 1 })],
      (availability) => {
        const first = (availability as { data: { slots: { starts_at: string }[] } }).data.slots[0]!;
        return [toolUse("t2", "create_booking_hold", { service_id: facial.id, starts_at: first.starts_at })];
      },
      (hold) => [toolUse("t3", "create_deposit_link", { appointment_id: (hold as { data: { appointment_id: string } }).data.appointment_id })],
      (link) => {
        depositUrl = (link as { data: { url: string } }).data.url;
        return [text(`¡Listo! Te aparté la cita. Paga el anticipo aquí para asegurarla: ${depositUrl}`)];
      },
    ]);

    const turn = await runConciergeTurn({
      llm,
      model: "claude-sonnet-5",
      maxTokens: 512,
      system: await buildSystemBlocks({ business, settings, services: [facial], packages: [], now: NOW, clientName: client.name }),
      history: [],
      userText: "Hola! quiero una limpieza facial mañana temprano",
      execute: createToolExecutor({ business, client, settings, store: h.store, booking: h.booking }),
      fallbackReply: "Déjame confirmarlo y te escribo.",
    });

    expect(turn.stopReason).toBe("end_turn");
    expect(turn.toolCalls.every((c) => c.result.ok)).toBe(true);
    expect(turn.reply).toContain("/pay/demo/");
    expect(h.store.appointments[0]!.status).toBe("hold_pending_deposit");

    // The demo checkout posts a signed confirmation to the payments webhook.
    const deposit = h.store.deposits[0]!;
    const body = JSON.stringify({ linkId: deposit.linkId, providerTxnId: "demo-txn-1", amountMinor: deposit.amountMinor, status: "paid" });
    const event = await h.payments.verifyWebhook(body, new Headers({ [DEMO_SIGNATURE_HEADER]: signDemoPayload(body, WEBHOOK_SECRET) }));
    expect(event).not.toBeNull();
    const outcome = await h.booking.handlePaymentEvent(event!);
    expect(outcome.status).toBe("confirmed");

    const confirmed = h.store.appointments[0]!;
    expect(confirmed.status).toBe("confirmed");
    const reminderCheck = new Date(new Date(confirmed.startsAt).getTime() - 23 * 3_600_000);
    expect(dueDayBeforeReminders(h.store.appointments, reminderCheck, { hoursBefore: 24, minHoursBefore: 2 }, new Set())).toHaveLength(1);
  });
});
