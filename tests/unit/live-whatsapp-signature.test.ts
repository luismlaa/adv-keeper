import { describe, expect, it } from "vitest";
import { signWhatsAppPayload, verifyWebhookHandshake, verifyWhatsAppSignature } from "@/lib/adapters/whatsapp/signature";
import { handleWebhookGet } from "@/lib/adapters/whatsapp/webhook";

const SECRET = "meta-app-secret-for-tests";
const BODY = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

describe("X-Hub-Signature-256 verification", () => {
  it("accepts a valid signature over the raw body", () => {
    expect(verifyWhatsAppSignature(BODY, signWhatsAppPayload(BODY, SECRET), SECRET)).toBe(true);
  });

  it("accepts an uppercase hex digest", () => {
    const sig = signWhatsAppPayload(BODY, SECRET);
    expect(verifyWhatsAppSignature(BODY, `sha256=${sig.slice(7).toUpperCase()}`, SECRET)).toBe(true);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifyWhatsAppSignature(BODY, signWhatsAppPayload(BODY, "attacker-secret"), SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const sig = signWhatsAppPayload(BODY, SECRET);
    expect(verifyWhatsAppSignature(BODY.replace("[]", "[{}]"), sig, SECRET)).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyWhatsAppSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(BODY, "", SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(BODY, "sha1=abc", SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(BODY, signWhatsAppPayload(BODY, SECRET).slice(7), SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(BODY, "sha256=zz", SECRET)).toBe(false);
  });

  it("rejects everything when the app secret is not configured", () => {
    expect(verifyWhatsAppSignature(BODY, signWhatsAppPayload(BODY, ""), undefined)).toBe(false);
    expect(verifyWhatsAppSignature(BODY, signWhatsAppPayload(BODY, ""), "")).toBe(false);
  });
});

describe("verify handshake (GET)", () => {
  const params = (overrides: Record<string, string> = {}) =>
    new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "my-verify-token", "hub.challenge": "1158201444", ...overrides });

  it("echoes the challenge when the token matches", async () => {
    expect(verifyWebhookHandshake(params(), "my-verify-token")).toBe("1158201444");
    const res = handleWebhookGet(params(), "my-verify-token");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("1158201444");
  });

  it("answers 403 for a wrong token, wrong mode, missing challenge or unconfigured token", () => {
    expect(handleWebhookGet(params({ "hub.verify_token": "nope" }), "my-verify-token").status).toBe(403);
    expect(handleWebhookGet(params({ "hub.mode": "unsubscribe" }), "my-verify-token").status).toBe(403);
    expect(handleWebhookGet(params({ "hub.challenge": "" }), "my-verify-token").status).toBe(403);
    expect(handleWebhookGet(new URLSearchParams(), "my-verify-token").status).toBe(403);
    expect(handleWebhookGet(params(), undefined).status).toBe(403);
  });
});
