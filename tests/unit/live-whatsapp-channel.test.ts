import { describe, expect, it } from "vitest";
import { createWhatsAppChannel } from "@/lib/adapters/whatsapp/channel";
import { WhatsAppApiError, type FetchLike } from "@/lib/adapters/whatsapp/graph";
import { buildTemplateMessage } from "@/lib/notifications/templates";

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

/** Mocked fetch: replays scripted responses and records every request. */
function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const next = responses.shift();
    if (next === undefined) throw new Error("no scripted response left");
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "Content-Type": "application/json" } });
  };
  return { fetch, calls };
}

const ok = (id: string) => ({ status: 200, body: { messaging_product: "whatsapp", contacts: [{ input: "18095550001", wa_id: "18095550001" }], messages: [{ id }] } });

const sleeps: number[] = [];
const channel = (fetch: FetchLike) =>
  createWhatsAppChannel({ token: "test-token", graphVersion: "v23.0", phoneNumberId: "1234567890", fetch, sleep: async (ms) => void sleeps.push(ms) });

describe("WhatsApp channel", () => {
  it("sends text to /{phone-number-id}/messages and returns the wamid", async () => {
    const { fetch, calls } = mockFetch([ok("wamid.TEXT1")]);
    const result = await channel(fetch).sendText({ to: "+1 (809) 555-0001", text: "Hola 👋" });

    expect(result).toEqual({ messageId: "wamid.TEXT1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v23.0/1234567890/messages");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]!.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "18095550001",
      type: "text",
      text: { preview_url: true, body: "Hola 👋" },
    });
  });

  it("sends a template with language es and positional body parameters", async () => {
    const { fetch, calls } = mockFetch([ok("wamid.TPL1")]);
    const msg = buildTemplateMessage("reactivation", { clientName: "Ana", businessName: "Spa Test" });
    const result = await channel(fetch).sendTemplate({ to: "+18095550001", ...msg });

    expect(result).toEqual({ messageId: "wamid.TPL1" });
    expect(calls[0]!.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "18095550001",
      type: "template",
      template: {
        name: "reactivation",
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Ana" },
              { type: "text", text: "Spa Test" },
            ],
          },
        ],
      },
    });
  });

  it("refuses a template with the wrong number of variables without calling Meta", async () => {
    const { fetch, calls } = mockFetch([]);
    await expect(
      channel(fetch).sendTemplate({ to: "+18095550001", template: "package_nudge", variables: ["Ana"], previewText: "x" }),
    ).rejects.toThrow(/expects 5/);
    expect(calls).toHaveLength(0);
  });

  it("retries with backoff on 5xx and 429, then succeeds", async () => {
    sleeps.length = 0;
    const { fetch, calls } = mockFetch([
      { status: 503, body: { error: { message: "Service unavailable", code: 2 } } },
      { status: 429, body: { error: { message: "Rate limit", code: 130429 } } },
      ok("wamid.RETRY"),
    ]);
    const result = await channel(fetch).sendText({ to: "+18095550001", text: "hola" });
    expect(result.messageId).toBe("wamid.RETRY");
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([300, 600]);
  });

  it("gives up after the last attempt on persistent 5xx", async () => {
    const { fetch, calls } = mockFetch([
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
    ]);
    await expect(channel(fetch).sendText({ to: "+18095550001", text: "hola" })).rejects.toBeInstanceOf(WhatsAppApiError);
    expect(calls).toHaveLength(3);
  });

  it("does not retry 4xx errors and never leaks the token", async () => {
    const { fetch, calls } = mockFetch([
      { status: 400, body: { error: { message: "Re-engagement message", code: 131047, fbtrace_id: "x" } } },
    ]);
    const error = await channel(fetch)
      .sendText({ to: "+18095550001", text: "hola" })
      .catch((e: unknown) => e);
    expect(calls).toHaveLength(1);
    expect(error).toBeInstanceOf(WhatsAppApiError);
    expect((error as WhatsAppApiError).status).toBe(400);
    expect((error as WhatsAppApiError).code).toBe(131047);
    expect((error as Error).message).not.toContain("test-token");
  });

  it("fails loudly when Meta's response has no message id", async () => {
    const { fetch } = mockFetch([{ status: 200, body: { messaging_product: "whatsapp" } }]);
    await expect(channel(fetch).sendText({ to: "+18095550001", text: "hola" })).rejects.toThrow(/message id/);
  });

  it("rejects an invalid recipient", async () => {
    const { fetch, calls } = mockFetch([]);
    await expect(channel(fetch).sendText({ to: "123", text: "hola" })).rejects.toThrow(/recipient/);
    expect(calls).toHaveLength(0);
  });
});
