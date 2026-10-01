import { describe, expect, it } from "vitest";
import { DEMO_SIGNATURE_HEADER, signDemoPayload } from "@/lib/adapters/payments/fake";
import { buildDemoPaymentRequest, isDemoCheckoutExpired, loadDemoCheckout } from "@/lib/demo/checkout";
import { extractLinkId, processPaymentWebhook, type PaymentWebhookDeps } from "@/lib/demo/payment-webhook";
import { client, facial, harness, NOW, TUESDAY_10, WEBHOOK_SECRET, type Harness } from "../helpers/fixtures";

async function heldDeposit(h: Harness) {
  const hold = await h.booking.createHold({
    businessId: client.businessId,
    clientId: client.id,
    serviceId: facial.id,
    startsAt: TUESDAY_10,
    clientPackageId: null,
    source: "chat",
  });
  const deposit = await h.booking.createDepositLink(client.businessId, hold.id);
  return { hold, deposit };
}

function deps(h: Harness): PaymentWebhookDeps {
  return { store: h.store, resolveAdapters: () => h.adapters, clock: () => NOW };
}

function signed(event: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  const rawBody = JSON.stringify(event);
  return { rawBody, headers: new Headers({ [DEMO_SIGNATURE_HEADER]: signDemoPayload(rawBody, secret) }) };
}

describe("payments webhook", () => {
  it("confirms the appointment and marks the deposit paid for a valid signed payment", async () => {
    const h = harness();
    const { hold, deposit } = await heldDeposit(h);
    const req = signed({ linkId: deposit.linkId, providerTxnId: "txn-1", amountMinor: deposit.amountMinor, status: "paid" });

    const result = await processPaymentWebhook(deps(h), { provider: "fake", ...req });

    expect(result).toEqual({ httpStatus: 200, status: "confirmed" });
    expect(h.store.appointments.find((a) => a.id === hold.id)?.status).toBe("confirmed");
    const paid = h.store.deposits.find((d) => d.id === deposit.id)!;
    expect(paid.status).toBe("paid");
    expect(paid.providerTxnId).toBe("txn-1");
  });

  it("is harmless when the same payment arrives twice", async () => {
    const h = harness();
    const { deposit } = await heldDeposit(h);
    const req = signed({ linkId: deposit.linkId, providerTxnId: "txn-1", amountMinor: deposit.amountMinor, status: "paid" });

    await processPaymentWebhook(deps(h), { provider: "fake", ...req });
    const snapshot = { appointments: h.store.appointments, deposits: h.store.deposits };
    const second = await processPaymentWebhook(deps(h), { provider: "fake", ...req });

    expect(second).toEqual({ httpStatus: 200, status: "already_processed" });
    expect(h.store.appointments).toEqual(snapshot.appointments);
    expect(h.store.deposits).toEqual(snapshot.deposits);
    expect(h.store.activity.filter((a) => a.action === "confirmed")).toHaveLength(1);
  });

  it("rejects a forged signature with 401 and changes nothing", async () => {
    const h = harness();
    const { hold, deposit } = await heldDeposit(h);
    const req = signed({ linkId: deposit.linkId, providerTxnId: "txn-x", amountMinor: deposit.amountMinor, status: "paid" }, "attacker-secret-0000000");

    const result = await processPaymentWebhook(deps(h), { provider: "fake", ...req });

    expect(result).toEqual({ httpStatus: 401, status: "invalid_signature" });
    expect(h.store.appointments.find((a) => a.id === hold.id)?.status).toBe("hold_pending_deposit");
    expect(h.store.deposits.find((d) => d.id === deposit.id)?.status).toBe("pending");
    expect(h.store.activity.at(-1)).toMatchObject({ action: "webhook_signature_invalid", entityId: deposit.id });
  });

  it("rejects a missing signature and a body tampered after signing", async () => {
    const h = harness();
    const { deposit } = await heldDeposit(h);
    const event = { linkId: deposit.linkId, providerTxnId: "txn-1", amountMinor: deposit.amountMinor, status: "paid" };
    const unsigned = await processPaymentWebhook(deps(h), { provider: "fake", rawBody: JSON.stringify(event), headers: new Headers() });
    const req = signed(event);
    const tampered = await processPaymentWebhook(deps(h), {
      provider: "fake",
      rawBody: req.rawBody.replace(String(deposit.amountMinor), "1"),
      headers: req.headers,
    });

    expect(unsigned.httpStatus).toBe(401);
    expect(tampered.httpStatus).toBe(401);
    expect(h.store.deposits[0]!.status).toBe("pending");
  });

  it("ignores a signed payment whose amount differs from the deposit and flags it for the owner", async () => {
    const h = harness();
    const { hold, deposit } = await heldDeposit(h);
    const req = signed({ linkId: deposit.linkId, providerTxnId: "txn-2", amountMinor: deposit.amountMinor - 100, status: "paid" });

    const result = await processPaymentWebhook(deps(h), { provider: "fake", ...req });

    expect(result).toEqual({ httpStatus: 200, status: "ignored", reason: "amount_mismatch" });
    expect(h.store.appointments.find((a) => a.id === hold.id)?.status).toBe("hold_pending_deposit");
    expect(h.store.deposits.find((d) => d.id === deposit.id)?.status).toBe("pending");
    expect(h.store.activity.some((a) => a.action === "amount_mismatch")).toBe(true);
  });

  it("rejects a webhook sent to another provider's route", async () => {
    const h = harness();
    const { deposit } = await heldDeposit(h);
    const req = signed({ linkId: deposit.linkId, providerTxnId: "txn-3", amountMinor: deposit.amountMinor, status: "paid" });

    const result = await processPaymentWebhook(deps(h), { provider: "azul", ...req });

    expect(result).toEqual({ httpStatus: 400, status: "provider_mismatch" });
    expect(h.store.deposits[0]!.status).toBe("pending");
  });

  it("answers unknown providers, missing and unknown link ids without side effects", async () => {
    const h = harness();
    await heldDeposit(h);
    const body = signed({ linkId: "demo_nope", providerTxnId: "t", amountMinor: 100, status: "paid" });

    expect(await processPaymentWebhook(deps(h), { provider: "paypal", ...body })).toMatchObject({ httpStatus: 404 });
    expect(await processPaymentWebhook(deps(h), { provider: "fake", rawBody: "{}", headers: new Headers() })).toMatchObject({
      httpStatus: 400,
      status: "missing_link_id",
    });
    expect(await processPaymentWebhook(deps(h), { provider: "fake", ...body })).toEqual({
      httpStatus: 200,
      status: "ignored",
      reason: "unknown_link",
    });
    expect(h.store.deposits[0]!.status).toBe("pending");
  });

  it("extracts link ids leniently from JSON, form bodies and the query string", () => {
    expect(extractLinkId("fake", JSON.stringify({ linkId: "demo_1" }))).toBe("demo_1");
    expect(extractLinkId("azul", "OrderNumber=ord_9&Amount=100")).toBe("ord_9");
    expect(extractLinkId("cardnet", "", new URLSearchParams("OrdenId=cn_7"))).toBe("cn_7");
    expect(extractLinkId("fake", "not json {")).toBeNull();
    expect(extractLinkId("fake", "[1,2]")).toBeNull();
  });
});

describe("demo checkout", () => {
  it("loads what the checkout shows from the store and signs a request the webhook accepts", async () => {
    const h = harness();
    const { deposit } = await heldDeposit(h);
    const view = await loadDemoCheckout(h.store, deposit.linkId);

    expect(view).toMatchObject({
      businessName: "Spa Test",
      serviceName: facial.name,
      amountMinor: deposit.amountMinor,
      depositStatus: "pending",
      appointmentStatus: "hold_pending_deposit",
    });
    expect(view!.amountLabel).toContain("RD$");
    expect(isDemoCheckoutExpired(view!, NOW)).toBe(false);

    const { body, headers } = buildDemoPaymentRequest(view!, WEBHOOK_SECRET, `demo_txn_${view!.linkId}`);
    const result = await processPaymentWebhook(deps(h), { provider: "fake", rawBody: body, headers: new Headers(headers) });
    expect(result.status).toBe("confirmed");
    expect((await loadDemoCheckout(h.store, deposit.linkId))!.depositStatus).toBe("paid");
  });

  it("returns null for unknown links and treats elapsed holds as expired", async () => {
    const h = harness();
    const { deposit } = await heldDeposit(h);
    expect(await loadDemoCheckout(h.store, "demo_missing")).toBeNull();
    const view = (await loadDemoCheckout(h.store, deposit.linkId))!;
    expect(isDemoCheckoutExpired(view, new Date(new Date(view.expiresAt).getTime() + 1))).toBe(true);
    expect(isDemoCheckoutExpired({ ...view, depositStatus: "expired" }, NOW)).toBe(true);
    expect(isDemoCheckoutExpired({ ...view, depositStatus: "paid" }, new Date("2100-01-01"))).toBe(false);
  });
});
