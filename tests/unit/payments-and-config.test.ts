import { describe, expect, it } from "vitest";
import { DEMO_SIGNATURE_HEADER, FakePaymentProvider, signDemoPayload } from "@/lib/adapters/payments/fake";
import { resolveBusinessSettings } from "@/lib/config/business-settings";
import { EnvError, parseServerEnv } from "@/lib/config/env";
import { isAuthorizedCron } from "@/lib/cron";
import { WEBHOOK_SECRET } from "../helpers/fixtures";

describe("fake payment webhook verification", () => {
  const provider = new FakePaymentProvider("https://keeper.test", WEBHOOK_SECRET);
  const body = JSON.stringify({ linkId: "demo_1", providerTxnId: "t1", amountMinor: 105000, status: "paid" });

  it("accepts a correctly signed payload", async () => {
    const headers = new Headers({ [DEMO_SIGNATURE_HEADER]: signDemoPayload(body, WEBHOOK_SECRET) });
    await expect(provider.verifyWebhook(body, headers)).resolves.toMatchObject({ linkId: "demo_1", status: "paid" });
  });

  it("rejects missing, forged or tampered signatures", async () => {
    await expect(provider.verifyWebhook(body, new Headers())).resolves.toBeNull();
    const forged = new Headers({ [DEMO_SIGNATURE_HEADER]: signDemoPayload(body, "wrong-secret-000000") });
    await expect(provider.verifyWebhook(body, forged)).resolves.toBeNull();
    const signed = new Headers({ [DEMO_SIGNATURE_HEADER]: signDemoPayload(body, WEBHOOK_SECRET) });
    await expect(provider.verifyWebhook(body.replace("105000", "1"), signed)).resolves.toBeNull();
  });
});

describe("business settings", () => {
  it("merges overrides over defaults and validates", () => {
    const s = resolveBusinessSettings({ holdMinutes: 45, deposit: { percent: 50 } });
    expect(s.holdMinutes).toBe(45);
    expect(s.deposit).toEqual({ percent: 50, minimumMinor: 50000, roundToMinor: 5000 });
    expect(s.timezone).toBe("America/Santo_Domingo");
  });

  it("rejects invalid overrides", () => {
    expect(() => resolveBusinessSettings({ deposit: { percent: 150 } })).toThrow();
  });
});

describe("server env", () => {
  it("reports every missing variable at once", () => {
    expect(() => parseServerEnv({})).toThrow(EnvError);
    try {
      parseServerEnv({});
    } catch (e) {
      expect((e as Error).message).toMatch(/ANTHROPIC_API_KEY/);
      expect((e as Error).message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    }
  });
});

describe("cron auth", () => {
  it("requires the exact bearer secret", () => {
    const secret = "cron-secret-1234567890";
    expect(isAuthorizedCron(new Request("https://x", { headers: { authorization: `Bearer ${secret}` } }), secret)).toBe(true);
    expect(isAuthorizedCron(new Request("https://x", { headers: { authorization: "Bearer nope" } }), secret)).toBe(false);
    expect(isAuthorizedCron(new Request("https://x"), secret)).toBe(false);
  });
});
