import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AzulNotConfiguredError,
  azulFieldsToEvent,
  azulReturnUrl,
  createAzulPayments,
  newAzulLinkId,
} from "@/lib/adapters/azul/payments";
import {
  azulHashInput,
  AZUL_REQUEST_HASH_FIELDS,
  AZUL_RESPONSE_HASH_FIELDS,
  formatAzulAmount,
  signAzulRequest,
  verifyAzulResponseHash,
} from "@/lib/adapters/azul/hash";
import { IntegrationCredentials, MemoryIntegrationRepo } from "@/lib/integrations/repo";

const KEY = "c".repeat(64);
const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const AUTH_KEY = "test-secret-key-12345";

/**
 * Example request from the public azul-go HPP tests (merchant 39038540035, "ORD-123", RD$1,500.00).
 * Azul publishes no official hash vector; the expected digests were computed independently with
 * Python's hmac module. ⚠️ Replace with a vector from the first client's sandbox.
 */
const DOC_REQUEST = {
  MerchantId: "39038540035",
  MerchantName: "Test Store",
  MerchantType: "ECommerce",
  CurrencyCode: "$",
  OrderNumber: "ORD-123",
  Amount: "150000",
  ITBIS: "000",
  ApprovedUrl: "https://myapp.com/approved",
  DeclinedUrl: "https://myapp.com/declined",
  CancelUrl: "https://myapp.com/cancel",
  UseCustomField1: "0",
  CustomField1Label: "",
  CustomField1Value: "",
  UseCustomField2: "0",
  CustomField2Label: "",
  CustomField2Value: "",
};
const DOC_REQUEST_HASH_UTF8 =
  "7d846166748158fb005355330520b43da7cf86beff56894f48813b82b4e9bff5466ff84d355a8b976bb40d23b4432e29f99f92d76bf3fc3561dd7b9f5ebd4a13";
const DOC_REQUEST_HASH_UTF16 =
  "70dd313c7300fa28fdf67272d160c941bd12a35de389f16f4e763835d345aa5a7af0b32080ab7ae7e4f8c0cbdbbf6fb1a13c65c4dab785aea19332e485847aea";

const DOC_RESPONSE = {
  OrderNumber: "ORD-123",
  Amount: "150000",
  AuthorizationCode: "OK0001",
  DateTime: "20260929101500",
  ResponseCode: "ISO8583",
  IsoCode: "00",
  ResponseMessage: "APROBADA",
  ErrorDescription: "",
  RRN: "000012345678",
};
const DOC_RESPONSE_HASH_UTF8 =
  "0749d17fb704d9bc13f546272b440d70a90dd426373ca6f8d3f8540c0acf097e89cb4cd3cd83e30d398db994a4e25878d36da407ca6e853c119797e58c7d56a2";
const DOC_RESPONSE_HASH_UTF16 =
  "a2a166beca3fb843a5d0efa6121595f18478dd22000c701ac15d1ba82c03e46ed045a2f224fa6074ec432d45558309617777b06c00ad22c24be4113c68c51de0";

describe("Azul AuthHash builders", () => {
  it("concatenates the 16 request fields in the documented order, then the AuthKey", () => {
    expect(azulHashInput(AZUL_REQUEST_HASH_FIELDS, DOC_REQUEST, AUTH_KEY)).toBe(
      "39038540035Test StoreECommerce$ORD-123150000000https://myapp.com/approvedhttps://myapp.com/declinedhttps://myapp.com/cancel00test-secret-key-12345",
    );
  });

  it("matches the example request hash (HMAC-SHA512 keyed with the AuthKey)", () => {
    expect(signAzulRequest(DOC_REQUEST, AUTH_KEY)).toBe(DOC_REQUEST_HASH_UTF8);
    expect(signAzulRequest(DOC_REQUEST, AUTH_KEY, "utf16le")).toBe(DOC_REQUEST_HASH_UTF16);
  });

  it("concatenates the response fields in the documented order", () => {
    expect(AZUL_RESPONSE_HASH_FIELDS.join(",")).toBe("OrderNumber,Amount,AuthorizationCode,DateTime,ResponseCode,IsoCode,ResponseMessage,ErrorDescription,RRN");
    expect(azulHashInput(AZUL_RESPONSE_HASH_FIELDS, DOC_RESPONSE, AUTH_KEY)).toBe(
      "ORD-123150000OK000120260929101500ISO858300APROBADA000012345678test-secret-key-12345",
    );
  });

  it("accepts the example response hash in either encoding and any hex case", () => {
    expect(verifyAzulResponseHash({ ...DOC_RESPONSE, AuthHash: DOC_RESPONSE_HASH_UTF8 }, AUTH_KEY)).toBe(true);
    expect(verifyAzulResponseHash({ ...DOC_RESPONSE, AuthHash: DOC_RESPONSE_HASH_UTF16.toUpperCase() }, AUTH_KEY)).toBe(true);
  });

  it("rejects a missing, forged or tampered response hash", () => {
    expect(verifyAzulResponseHash(DOC_RESPONSE, AUTH_KEY)).toBe(false);
    expect(verifyAzulResponseHash({ ...DOC_RESPONSE, AuthHash: "" }, AUTH_KEY)).toBe(false);
    expect(verifyAzulResponseHash({ ...DOC_RESPONSE, AuthHash: "zz-not-hex" }, AUTH_KEY)).toBe(false);
    expect(verifyAzulResponseHash({ ...DOC_RESPONSE, AuthHash: DOC_RESPONSE_HASH_UTF8 }, "attacker-key")).toBe(false);
    expect(verifyAzulResponseHash({ ...DOC_RESPONSE, Amount: "100", AuthHash: DOC_RESPONSE_HASH_UTF8 }, AUTH_KEY)).toBe(false);
    expect(verifyAzulResponseHash({ ...DOC_RESPONSE, IsoCode: "00", RRN: "999", AuthHash: DOC_RESPONSE_HASH_UTF8 }, AUTH_KEY)).toBe(false);
  });

  it("formats amounts as integer minor units with at least 3 digits", () => {
    expect(formatAzulAmount(0)).toBe("000");
    expect(formatAzulAmount(5)).toBe("005");
    expect(formatAzulAmount(150000)).toBe("150000");
    expect(() => formatAzulAmount(1.5)).toThrow();
    expect(() => formatAzulAmount(-1)).toThrow();
  });
});

function signedResponse(fields: Record<string, string>, authKey = AUTH_KEY): string {
  const input = azulHashInput(AZUL_RESPONSE_HASH_FIELDS, fields, authKey);
  const AuthHash = createHmac("sha512", authKey).update(input, "utf8").digest("hex");
  return new URLSearchParams({ ...fields, AuthHash }).toString();
}

async function adapter(withCredentials = true) {
  const credentials = new IntegrationCredentials(new MemoryIntegrationRepo(), KEY);
  if (withCredentials) {
    await credentials.save(BUSINESS_ID, "azul", { merchantId: "39038540035", merchantName: "Spa Test", authKey: AUTH_KEY });
  }
  return createAzulPayments({ businessId: BUSINESS_ID, appUrl: "https://keeper.test/", credentials, paymentPageUrl: "https://pruebas.azul.com.do/PaymentPage/" });
}

describe("createAzulPayments", () => {
  it("creates links on our own domain with an Azul-sized order number", async () => {
    const azul = await adapter();
    const link = await azul.createDepositLink({ reference: "appt", amountMinor: 70000, currency: "DOP", description: "x", expiresAt: new Date(), customerPhone: "+1809" });
    expect(link.url).toBe(`https://keeper.test/api/pay/azul/${link.linkId}`);
    expect(link.linkId).toMatch(/^az[0-9a-z]{13}$/);
    expect(newAzulLinkId()).not.toBe(newAzulLinkId());
  });

  it("refuses to create links for a business without Azul credentials", async () => {
    const azul = await adapter(false);
    await expect(azul.createDepositLink({ reference: "a", amountMinor: 1, currency: "DOP", description: "", expiresAt: new Date(), customerPhone: "" })).rejects.toBeInstanceOf(AzulNotConfiguredError);
  });

  it("builds a signed Payment Page form from the stored deposit only", async () => {
    const azul = await adapter();
    const form = await azul.buildPaymentForm({ linkId: "az0000000000001", amountMinor: 70000, currency: "DOP" });
    expect(form.action).toBe("https://pruebas.azul.com.do/PaymentPage/");
    expect(form.fields).toMatchObject({
      MerchantId: "39038540035",
      MerchantName: "Spa Test",
      MerchantType: "ECommerce",
      CurrencyCode: "$",
      OrderNumber: "az0000000000001",
      Amount: "70000",
      ITBIS: "000",
      ApprovedUrl: azulReturnUrl("https://keeper.test", "az0000000000001", "approved"),
      DeclinedUrl: "https://keeper.test/api/pay/azul/az0000000000001/return/declined",
      CancelUrl: "https://keeper.test/api/pay/azul/az0000000000001/return/cancel",
    });
    const { AuthHash, ...rest } = form.fields;
    expect(AuthHash).toBe(signAzulRequest(rest as typeof DOC_REQUEST, AUTH_KEY));
    expect(JSON.stringify(form)).not.toContain(AUTH_KEY);
  });

  it("verifies a signed approval and maps it to a paid event keyed by the hashed RRN", async () => {
    const azul = await adapter();
    const event = await azul.verifyWebhook(signedResponse({ ...DOC_RESPONSE, OrderNumber: "az0000000000001", Amount: "70000" }), new Headers());
    expect(event).toEqual({ linkId: "az0000000000001", providerTxnId: "000012345678", amountMinor: 70000, status: "paid" });
  });

  it("maps a signed decline to a failed event", async () => {
    const azul = await adapter();
    const event = await azul.verifyWebhook(signedResponse({ ...DOC_RESPONSE, IsoCode: "51", ResponseMessage: "DECLINADA", RRN: "" }), new Headers());
    expect(event?.status).toBe("failed");
  });

  it("rejects unsigned, forged, tampered and credential-less callbacks", async () => {
    const azul = await adapter();
    const good = signedResponse(DOC_RESPONSE);
    const unsigned = new URLSearchParams(DOC_RESPONSE).toString();
    expect(await azul.verifyWebhook(unsigned, new Headers())).toBeNull();
    expect(await azul.verifyWebhook(signedResponse(DOC_RESPONSE, "attacker-key"), new Headers())).toBeNull();
    expect(await azul.verifyWebhook(good.replace("Amount=150000", "Amount=100"), new Headers())).toBeNull();
    expect(await (await adapter(false)).verifyWebhook(good, new Headers())).toBeNull();
    expect(await azul.verifyWebhook("not a form at all {", new Headers())).toBeNull();
  });

  it("never builds an event without an order number or a positive amount", () => {
    expect(azulFieldsToEvent({ ...DOC_RESPONSE, OrderNumber: "" })).toBeNull();
    expect(azulFieldsToEvent({ ...DOC_RESPONSE, Amount: "000" })).toBeNull();
    expect(azulFieldsToEvent({ ...DOC_RESPONSE, Amount: "12.50" })).toBeNull();
  });
});
