import { describe, expect, it } from "vitest";
import { fetchWithRetry, GatewayHttpError } from "@/lib/adapters/cardnet/http";
import { CardnetNotConfiguredError, CardnetUnavailableError, createCardnetPayments } from "@/lib/adapters/cardnet/payments";
import {
  buildCardnetSessionRequest,
  cardnetMerchantName,
  cardnetStatusUrl,
  formatCardnetAmount,
  interpretCardnetStatus,
  parseCardnetSessionResponse,
} from "@/lib/adapters/cardnet/session";
import { MemoryCardnetSessionStore } from "@/lib/adapters/cardnet/session-store";
import { IntegrationCredentials, MemoryIntegrationRepo } from "@/lib/integrations/repo";
import type { ActivityEntry } from "@/lib/schemas/entities";

const KEY = "d".repeat(64);
const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const CREDS = {
  merchantNumber: "349000000",
  merchantTerminal: "58585858",
  merchantName: "Salón Bella Spa",
  merchantType: "7997",
  acquiringInstitutionCode: "349",
};

interface Call {
  url: string;
  init?: RequestInit;
}

function mockFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => undefined;

describe("Cardnet session builders (public lab example)", () => {
  it("builds the documented session request from our deposit", () => {
    const body = buildCardnetSessionRequest({
      credentials: CREDS,
      linkId: "cn0000000000001",
      transactionId: "123456",
      amountMinor: 20000,
      currency: "DOP",
      returnUrl: "https://keeper.test/r",
      cancelUrl: "https://keeper.test/c",
    });
    expect(body).toEqual({
      TransactionType: "0200",
      CurrencyCode: "214",
      AcquiringInstitutionCode: "349",
      MerchantType: "7997",
      MerchantNumber: "349000000",
      MerchantTerminal: "58585858",
      ReturnUrl: "https://keeper.test/r",
      CancelUrl: "https://keeper.test/c",
      PageLanguaje: "ESP",
      OrdenId: "cn0000000000001",
      TransactionId: "123456",
      Tax: "000000000000",
      MerchantName: "SALON BELLA SPA",
      Amount: "000000020000",
    });
  });

  it("formats amounts and names, and refuses bad input", () => {
    expect(formatCardnetAmount(20000)).toBe("000000020000");
    expect(() => formatCardnetAmount(1.5)).toThrow();
    expect(cardnetMerchantName("Peluquería <Ñ> & Co.")).toBe("PELUQUERIA N & CO.");
    expect(() => buildCardnetSessionRequest({ credentials: CREDS, linkId: "x", transactionId: "12", amountMinor: 1, currency: "DOP", returnUrl: "", cancelUrl: "" })).toThrow();
    expect(() => buildCardnetSessionRequest({ credentials: CREDS, linkId: "x", transactionId: "123456", amountMinor: 1, currency: "EUR", returnUrl: "", cancelUrl: "" })).toThrow();
  });

  it("parses the session response and builds the status query URL", () => {
    expect(parseCardnetSessionResponse({ SESSION: "abc123", "session-key": "sk-1" })).toEqual({ session: "abc123", sessionKey: "sk-1" });
    expect(parseCardnetSessionResponse({ SESSION: "abc" })).toBeNull();
    expect(parseCardnetSessionResponse({ SESSION: "../evil", "session-key": "x" })).toBeNull();
    expect(cardnetStatusUrl("https://lab.cardnet.com.do/", "abc123", "k&y")).toBe("https://lab.cardnet.com.do/sessions/abc123?sk=k%26y");
  });

  const expected = { linkId: "cn1", session: "S1", transactionId: "123456", amountMinor: 20000 };

  it("interprets an approved status, falling back to our own session amount", () => {
    expect(interpretCardnetStatus({ ResponseCode: "00", RetrivalReferenceNumber: "RRN1", TxToken: "T" }, expected)).toEqual({
      linkId: "cn1",
      providerTxnId: "RRN1",
      amountMinor: 20000,
      status: "paid",
    });
    expect(interpretCardnetStatus({ ResponseCode: "05" }, expected)?.status).toBe("failed");
  });

  it("reports the gateway's amount when present so a mismatch reaches the booking service", () => {
    expect(interpretCardnetStatus({ ResponseCode: "00", Amount: "000000000100", TxToken: "T" }, expected)?.amountMinor).toBe(100);
  });

  it("rejects responses that contradict the session we opened", () => {
    expect(interpretCardnetStatus({ ResponseCode: "00", OrdenId: "cn-other" }, expected)).toBeNull();
    expect(interpretCardnetStatus({ ResponseCode: "00", TransactionID: "999999" }, expected)).toBeNull();
    expect(interpretCardnetStatus({ AuthorizationCode: "x" }, expected)).toBeNull();
    expect(interpretCardnetStatus("nope", expected)).toBeNull();
  });
});

describe("fetchWithRetry", () => {
  it("retries 5xx and 429 with backoff, then returns", async () => {
    const { fetch, calls } = mockFetch([new Response("", { status: 503 }), new Response("", { status: 429 }), json({ ok: true })]);
    const slept: number[] = [];
    const res = await fetchWithRetry("https://x.test", { method: "GET" }, { fetch, sleep: async (ms) => void slept.push(ms) });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(slept).toEqual([250, 500]);
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not retry 4xx or network errors", async () => {
    const four = mockFetch([new Response("", { status: 400 })]);
    expect((await fetchWithRetry("https://x.test", {}, { fetch: four.fetch, sleep: noSleep })).status).toBe(400);
    expect(four.calls).toHaveLength(1);
    const net = mockFetch([new TypeError("fetch failed")]);
    await expect(fetchWithRetry("https://x.test", {}, { fetch: net.fetch, sleep: noSleep })).rejects.toBeInstanceOf(GatewayHttpError);
    expect(net.calls).toHaveLength(1);
  });
});

async function setup(responses: Array<Response | Error>, withCredentials = true) {
  const credentials = new IntegrationCredentials(new MemoryIntegrationRepo(), KEY);
  if (withCredentials) await credentials.save(BUSINESS_ID, "cardnet", CREDS);
  const sessions = new MemoryCardnetSessionStore();
  const activity: ActivityEntry[] = [];
  const { fetch, calls } = mockFetch(responses);
  const cardnet = createCardnetPayments({
    businessId: BUSINESS_ID,
    appUrl: "https://keeper.test",
    apiUrl: "https://lab.cardnet.com.do",
    credentials,
    sessions,
    fetch,
    sleep: noSleep,
    logActivity: async (e) => void activity.push(e),
  });
  return { cardnet, sessions, calls, activity };
}

const DEPOSIT = { id: "66666666-6666-4666-8666-666666666666", linkId: "cn0000000000001", amountMinor: 20000, currency: "DOP" };

describe("createCardnetPayments", () => {
  it("opens a session for the stored deposit and redirects with SESSION to /authorize", async () => {
    const { cardnet, sessions, calls } = await setup([json({ SESSION: "S1", "session-key": "SK1" })]);
    const form = await cardnet.startCheckout(DEPOSIT);

    expect(form).toEqual({ action: "https://lab.cardnet.com.do/authorize", fields: { SESSION: "S1" } });
    expect(calls[0]!.url).toBe("https://lab.cardnet.com.do/sessions");
    expect(calls[0]!.init?.method).toBe("POST");
    const sent = JSON.parse(String(calls[0]!.init?.body)) as Record<string, string>;
    expect(sent).toMatchObject({
      OrdenId: DEPOSIT.linkId,
      Amount: "000000020000",
      ReturnUrl: "https://keeper.test/api/pay/cardnet/cn0000000000001/return/approved",
      CancelUrl: "https://keeper.test/api/pay/cardnet/cn0000000000001/return/cancel",
    });
    expect(sent.TransactionId).toMatch(/^\d{6}$/);
    expect(sessions.records[0]).toMatchObject({ session: "S1", sessionKey: "SK1", linkId: DEPOSIT.linkId, amountMinor: 20000, transactionId: sent.TransactionId });
  });

  it("raises typed errors when credentials are missing or Cardnet refuses the session", async () => {
    const none = await setup([], false);
    await expect(none.cardnet.startCheckout(DEPOSIT)).rejects.toBeInstanceOf(CardnetNotConfiguredError);
    const refused = await setup([json({ error: "bad merchant" }, 400)]);
    await expect(refused.cardnet.startCheckout(DEPOSIT)).rejects.toBeInstanceOf(CardnetUnavailableError);
    expect(refused.activity.at(-1)).toMatchObject({ action: "cardnet_session_failed", entityId: DEPOSIT.id });
    expect(refused.sessions.records).toHaveLength(0);
  });

  it("verifies by querying Cardnet with the stored session key, never trusting the callback body", async () => {
    const { cardnet, calls } = await setup([
      json({ SESSION: "S1", "session-key": "SK1" }),
      json({ ResponseCode: "00", RetrivalReferenceNumber: "RRN1", AuthorizationCode: "A1" }),
    ]);
    await cardnet.startCheckout(DEPOSIT);
    const event = await cardnet.verifyWebhook(`linkId=${DEPOSIT.linkId}&SESSION=S1&ResponseCode=00&Amount=1`, new Headers());

    expect(event).toEqual({ linkId: DEPOSIT.linkId, providerTxnId: "RRN1", amountMinor: 20000, status: "paid" });
    expect(calls[1]!.url).toBe("https://lab.cardnet.com.do/sessions/S1?sk=SK1");
  });

  it("rejects callbacks for unknown sessions or sessions opened for another link, without calling Cardnet", async () => {
    const { cardnet, calls } = await setup([json({ SESSION: "S1", "session-key": "SK1" })]);
    await cardnet.startCheckout(DEPOSIT);
    expect(await cardnet.verifyWebhook(`linkId=${DEPOSIT.linkId}&SESSION=FORGED`, new Headers())).toBeNull();
    expect(await cardnet.verifyWebhook(`linkId=cn-other&SESSION=S1`, new Headers())).toBeNull();
    expect(await cardnet.verifyWebhook(`SESSION=S1`, new Headers())).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("surfaces an unreachable Cardnet as a retryable error and logs it without the session key", async () => {
    const { cardnet, activity } = await setup([json({ SESSION: "S1", "session-key": "SK1" }), new Response("", { status: 502 }), new Response("", { status: 502 }), new Response("", { status: 502 })]);
    await cardnet.startCheckout(DEPOSIT);
    await expect(cardnet.verifyWebhook(`linkId=${DEPOSIT.linkId}`, new Headers())).rejects.toBeInstanceOf(CardnetUnavailableError);
    expect(activity.at(-1)).toMatchObject({ action: "cardnet_status_failed" });
    expect(JSON.stringify(activity)).not.toContain("SK1");
  });
});
