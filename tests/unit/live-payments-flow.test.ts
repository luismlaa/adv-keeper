import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { azulHashInput, AZUL_RESPONSE_HASH_FIELDS } from "@/lib/adapters/azul/hash";
import { FakeCalendar } from "@/lib/adapters/calendar/fake";
import { MemoryCardnetSessionStore } from "@/lib/adapters/cardnet/session-store";
import { RecordingChannel } from "@/lib/adapters/messaging/recording";
import { BookingService } from "@/lib/booking/booking-service";
import { IntegrationCredentials, MemoryIntegrationRepo } from "@/lib/integrations/repo";
import type { Business } from "@/lib/schemas/entities";
import { MemoryStore } from "@/lib/store/memory";
import { createPaymentGateway, type GatewayDeps } from "@/lib/adapters/payments/gateway";
import { escapeHtml, renderGatewayForm, renderPayPage } from "@/app/api/pay/_lib/html";
import { handleGatewayReturn, prepareHandoff, type ReturnDeps } from "@/app/api/pay/_lib/pay-flow";
import { business as baseBusiness, client, facial, NOW, otherClient, TUESDAY_10 } from "../helpers/fixtures";

const KEY = "e".repeat(64);
const AUTH_KEY = "azul-auth-key-for-tests";

type Provider = "azul" | "cardnet";

async function world(provider: Provider, fetchResponses: Response[] = []) {
  let now = NOW;
  const business: Business = { ...baseBusiness, integrationMode: "live", paymentProvider: provider, googleCalendarId: "primary" };
  const store = new MemoryStore({ businesses: [business], services: [facial], clients: [client, otherClient] });
  const credentials = new IntegrationCredentials(new MemoryIntegrationRepo(), KEY);
  await credentials.save(business.id, "azul", { merchantId: "39038540035", merchantName: "Spa Test", authKey: AUTH_KEY });
  await credentials.save(business.id, "cardnet", { merchantNumber: "349000000", merchantTerminal: "58585858", merchantName: "Spa Test", merchantType: "7997" });
  const fetchCalls: string[] = [];
  const gatewayDeps: GatewayDeps = {
    appUrl: "https://keeper.test",
    credentials,
    cardnetSessions: new MemoryCardnetSessionStore(),
    cardnetApiUrl: "https://lab.cardnet.com.do",
    sleep: async () => undefined,
    fetch: async (url) => {
      fetchCalls.push(url);
      const next = fetchResponses.shift();
      if (!next) throw new Error(`unexpected fetch ${url}`);
      return next;
    },
    logActivity: (e) => store.logActivity(e),
  };
  const gateway = createPaymentGateway(business, gatewayDeps)!;
  const calendar = new FakeCalendar();
  const adapters = { calendar, payments: gateway.payments, messaging: new RecordingChannel() };
  const booking = new BookingService({ store, adapters, clock: () => now });
  const hold = await booking.createHold({ businessId: business.id, clientId: client.id, serviceId: facial.id, startsAt: TUESDAY_10, clientPackageId: null, source: "whatsapp" });
  const deposit = await booking.createDepositLink(business.id, hold.id);
  const deps: ReturnDeps = {
    store,
    clock: () => now,
    appUrl: "https://keeper.test",
    gatewayFor: (b) => createPaymentGateway(b, gatewayDeps),
    // What the live factory resolves for this business: its own gateway's PaymentProvider.
    resolveAdapters: () => adapters,
  };
  return { business, store, deposit, hold, deps, fetchCalls, setNow: (d: Date) => (now = d) };
}

function azulReturn(fields: Record<string, string>, authKey = AUTH_KEY): URLSearchParams {
  const AuthHash = createHmac("sha512", authKey).update(azulHashInput(AZUL_RESPONSE_HASH_FIELDS, fields, authKey), "utf8").digest("hex");
  return new URLSearchParams({ ...fields, AuthHash });
}

const approved = (linkId: string, amount: number) => ({
  OrderNumber: linkId,
  Amount: String(amount),
  AuthorizationCode: "OK1234",
  DateTime: "20260928081500",
  ResponseCode: "ISO8583",
  IsoCode: "00",
  ResponseMessage: "APROBADA",
  ErrorDescription: "",
  RRN: "202609280001",
  AzulOrderId: "44556677",
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("pay hand-off route (Azul)", () => {
  it("links to our own domain and hands off a signed form carrying the stored deposit amount", async () => {
    const w = await world("azul");
    expect(w.deposit.url).toBe(`https://keeper.test/api/pay/azul/${w.deposit.linkId}`);
    const outcome = await prepareHandoff(w.deps, "azul", w.deposit.linkId);

    expect(outcome.kind).toBe("form");
    if (outcome.kind !== "form") return;
    expect(outcome.form.fields.Amount).toBe(String(w.deposit.amountMinor));
    expect(outcome.form.fields.OrderNumber).toBe(w.deposit.linkId);
    expect(w.store.activity.at(-1)).toMatchObject({ action: "payment_handoff", entityId: w.deposit.id });
    const html = renderGatewayForm(outcome.form.action, outcome.form.fields, outcome.gatewayName);
    expect(html).toContain(`name="AuthHash" value="${outcome.form.fields.AuthHash}"`);
    expect(html).toContain('method="post"');
  });

  it("refuses an expired link with a friendly page and never reaches the gateway", async () => {
    const w = await world("azul");
    w.setNow(new Date(new Date(w.deposit.expiresAt).getTime() + 1000));
    const outcome = await prepareHandoff(w.deps, "azul", w.deposit.linkId);
    expect(outcome).toMatchObject({ kind: "page", status: 410, page: { kind: "expired" } });
    if (outcome.kind === "page") expect(renderPayPage(outcome.page)).toContain("Este link venció");
  });

  it("refuses a link whose deposit was already expired by the cron", async () => {
    const w = await world("azul");
    await w.store.updateDeposit({ ...w.deposit, status: "expired" });
    expect(await prepareHandoff(w.deps, "azul", w.deposit.linkId)).toMatchObject({ kind: "page", page: { kind: "expired" } });
  });

  it("404s unknown links, malformed ids and the wrong provider segment", async () => {
    const w = await world("azul");
    expect(await prepareHandoff(w.deps, "azul", "az-does-not-exist")).toMatchObject({ status: 404 });
    expect(await prepareHandoff(w.deps, "azul", "../../etc")).toMatchObject({ status: 404 });
    expect(await prepareHandoff(w.deps, "cardnet", w.deposit.linkId)).toMatchObject({ status: 404 });
    expect(await prepareHandoff(w.deps, "fake", w.deposit.linkId)).toMatchObject({ status: 404 });
  });
});

describe("gateway return (Azul)", () => {
  it("confirms the appointment on a correctly signed approval", async () => {
    const w = await world("azul");
    const result = await handleGatewayReturn(w.deps, {
      provider: "azul",
      linkId: w.deposit.linkId,
      outcome: "approved",
      fields: azulReturn(approved(w.deposit.linkId, w.deposit.amountMinor)),
    });

    expect(result).toMatchObject({ status: 200, page: { kind: "paid", confirmed: true }, result: { status: "confirmed" } });
    expect(w.store.deposits[0]).toMatchObject({ status: "paid", providerTxnId: "202609280001" });
    expect(w.store.appointments[0]!.status).toBe("confirmed");
  });

  it("is harmless when the same approval comes back twice", async () => {
    const w = await world("azul");
    const input = { provider: "azul", linkId: w.deposit.linkId, outcome: "approved", fields: azulReturn(approved(w.deposit.linkId, w.deposit.amountMinor)) };
    await handleGatewayReturn(w.deps, input);
    const snapshot = { deposits: w.store.deposits, appointments: w.store.appointments, activity: w.store.activity.length };
    const second = await handleGatewayReturn(w.deps, input);

    expect(second.page).toMatchObject({ kind: "paid", confirmed: true });
    expect(w.store.deposits).toEqual(snapshot.deposits);
    expect(w.store.appointments).toEqual(snapshot.appointments);
    expect(w.store.activity).toHaveLength(snapshot.activity);
  });

  it("rejects a forged hash and an unsigned approval, changing nothing", async () => {
    const w = await world("azul");
    const forged = await handleGatewayReturn(w.deps, {
      provider: "azul",
      linkId: w.deposit.linkId,
      outcome: "approved",
      fields: azulReturn(approved(w.deposit.linkId, w.deposit.amountMinor), "attacker-key"),
    });
    const unsigned = await handleGatewayReturn(w.deps, {
      provider: "azul",
      linkId: w.deposit.linkId,
      outcome: "approved",
      fields: new URLSearchParams(approved(w.deposit.linkId, w.deposit.amountMinor)),
    });

    expect(forged).toMatchObject({ status: 401, page: { kind: "unverified" } });
    expect(unsigned).toMatchObject({ status: 401, page: { kind: "unverified" } });
    expect(w.store.deposits[0]!.status).toBe("pending");
    expect(w.store.appointments[0]!.status).toBe("hold_pending_deposit");
    expect(w.store.activity.filter((a) => a.action === "webhook_signature_invalid")).toHaveLength(2);
  });

  it("rejects a tampered amount (hash breaks) and a signed amount that differs from the deposit", async () => {
    const w = await world("azul");
    const good = azulReturn(approved(w.deposit.linkId, w.deposit.amountMinor));
    good.set("Amount", "100");
    const tampered = await handleGatewayReturn(w.deps, { provider: "azul", linkId: w.deposit.linkId, outcome: "approved", fields: good });
    const mismatched = await handleGatewayReturn(w.deps, {
      provider: "azul",
      linkId: w.deposit.linkId,
      outcome: "approved",
      fields: azulReturn(approved(w.deposit.linkId, 100)),
    });

    expect(tampered).toMatchObject({ status: 401, page: { kind: "unverified" } });
    expect(mismatched).toMatchObject({ page: { kind: "unverified" }, result: { reason: "amount_mismatch" } });
    expect(w.store.deposits[0]!.status).toBe("pending");
    expect(w.store.activity.at(-1)).toMatchObject({ action: "amount_mismatch", meta: { expected: w.deposit.amountMinor, received: 100 } });
  });

  it("rejects a signed approval for another order replayed on this link", async () => {
    const w = await world("azul");
    const result = await handleGatewayReturn(w.deps, {
      provider: "azul",
      linkId: w.deposit.linkId,
      outcome: "approved",
      fields: azulReturn(approved("az-other-order1", w.deposit.amountMinor)),
    });
    expect(result).toMatchObject({ status: 400, page: { kind: "unverified" } });
    expect(w.store.deposits[0]!.status).toBe("pending");
    expect(w.store.activity.at(-1)).toMatchObject({ action: "payment_return_mismatch" });
  });

  it("shows 'not completed' with a retry link for a signed decline or a cancel", async () => {
    const w = await world("azul");
    const declined = await handleGatewayReturn(w.deps, {
      provider: "azul",
      linkId: w.deposit.linkId,
      outcome: "declined",
      fields: azulReturn({ ...approved(w.deposit.linkId, w.deposit.amountMinor), IsoCode: "51", ResponseMessage: "DECLINADA", RRN: "" }),
    });
    const cancelled = await handleGatewayReturn(w.deps, { provider: "azul", linkId: w.deposit.linkId, outcome: "cancel", fields: new URLSearchParams() });

    expect(declined.page).toMatchObject({ kind: "not_completed" });
    expect(cancelled.page).toMatchObject({ kind: "not_completed" });
    expect(renderPayPage(declined.page)).toContain(`href="https://keeper.test/api/pay/azul/${w.deposit.linkId}"`);
    expect(w.store.deposits[0]!.status).toBe("pending");
  });

  it("404s an unknown outcome segment", async () => {
    const w = await world("azul");
    expect(await handleGatewayReturn(w.deps, { provider: "azul", linkId: w.deposit.linkId, outcome: "paid", fields: new URLSearchParams() })).toMatchObject({ status: 404 });
  });
});

describe("Cardnet hand-off and return", () => {
  it("opens a session, then confirms only after Cardnet's status query says approved", async () => {
    const w = await world("cardnet", [json({ SESSION: "S1", "session-key": "SK1" }), json({ ResponseCode: "00", RetrivalReferenceNumber: "RRN9" })]);
    const handoff = await prepareHandoff(w.deps, "cardnet", w.deposit.linkId);
    expect(handoff).toMatchObject({ kind: "form", form: { action: "https://lab.cardnet.com.do/authorize", fields: { SESSION: "S1" } } });

    const result = await handleGatewayReturn(w.deps, { provider: "cardnet", linkId: w.deposit.linkId, outcome: "approved", fields: new URLSearchParams({ SESSION: "S1" }) });

    expect(result).toMatchObject({ page: { kind: "paid", confirmed: true }, result: { status: "confirmed" } });
    expect(w.fetchCalls).toEqual(["https://lab.cardnet.com.do/sessions", "https://lab.cardnet.com.do/sessions/S1?sk=SK1"]);
    expect(w.store.deposits[0]).toMatchObject({ status: "paid", providerTxnId: "RRN9" });
  });

  it("is harmless on a duplicate return (no second gateway query, nothing changes)", async () => {
    const w = await world("cardnet", [json({ SESSION: "S1", "session-key": "SK1" }), json({ ResponseCode: "00", RetrivalReferenceNumber: "RRN9" })]);
    await prepareHandoff(w.deps, "cardnet", w.deposit.linkId);
    const input = { provider: "cardnet", linkId: w.deposit.linkId, outcome: "approved", fields: new URLSearchParams({ SESSION: "S1" }) };
    await handleGatewayReturn(w.deps, input);
    const deposits = w.store.deposits;
    const second = await handleGatewayReturn(w.deps, input);

    expect(second.page).toMatchObject({ kind: "paid" });
    expect(w.fetchCalls).toHaveLength(2);
    expect(w.store.deposits).toEqual(deposits);
  });

  it("rejects a forged SESSION without asking Cardnet and an amount Cardnet reports differently", async () => {
    const w = await world("cardnet", [json({ SESSION: "S1", "session-key": "SK1" }), json({ ResponseCode: "00", Amount: "000000000100", TxToken: "T1" })]);
    await prepareHandoff(w.deps, "cardnet", w.deposit.linkId);
    const forged = await handleGatewayReturn(w.deps, { provider: "cardnet", linkId: w.deposit.linkId, outcome: "approved", fields: new URLSearchParams({ SESSION: "FORGED" }) });
    expect(forged).toMatchObject({ status: 401, page: { kind: "unverified" } });
    expect(w.fetchCalls).toHaveLength(1);

    const mismatched = await handleGatewayReturn(w.deps, { provider: "cardnet", linkId: w.deposit.linkId, outcome: "approved", fields: new URLSearchParams({ SESSION: "S1" }) });
    expect(mismatched).toMatchObject({ page: { kind: "unverified" }, result: { reason: "amount_mismatch" } });
    expect(w.store.deposits[0]!.status).toBe("pending");
  });

  it("shows a retry page (503) when Cardnet cannot be reached, marking nothing paid", async () => {
    const w = await world("cardnet", [json({ SESSION: "S1", "session-key": "SK1" }), new Response("", { status: 500 }), new Response("", { status: 500 }), new Response("", { status: 500 })]);
    await prepareHandoff(w.deps, "cardnet", w.deposit.linkId);
    const result = await handleGatewayReturn(w.deps, { provider: "cardnet", linkId: w.deposit.linkId, outcome: "approved", fields: new URLSearchParams({ SESSION: "S1" }) });
    expect(result).toMatchObject({ status: 503, page: { kind: "unavailable" } });
    expect(w.store.deposits[0]!.status).toBe("pending");
  });

  it("shows the unavailable page when the session cannot be opened", async () => {
    const w = await world("cardnet", [json({ nope: true }, 400)]);
    expect(await prepareHandoff(w.deps, "cardnet", w.deposit.linkId)).toMatchObject({ kind: "page", status: 503, page: { kind: "unavailable" } });
  });
});

describe("pay pages", () => {
  it("escapes everything interpolated into HTML", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
    const html = renderPayPage({ kind: "paid", confirmed: true, context: { businessName: "<img src=x onerror=alert(1)>", amountLabel: "RD$700" } });
    expect(html).not.toContain("<img");
    const form = renderGatewayForm("https://gw.test/\"><script>", { 'a"b': '"><script>' }, "Azul");
    expect(form).not.toContain('"><script>');
  });
});
