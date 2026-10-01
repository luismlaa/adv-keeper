import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { IntegrationCredentials, MemoryIntegrationRepo } from "@/lib/integrations/repo";

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);

describe("encryptSecret / decryptSecret", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("refresh-token-123", KEY, "biz:google_calendar");
    const b = encryptSecret("refresh-token-123", KEY, "biz:google_calendar");
    expect(a).not.toBe(b);
    expect(a).not.toContain("refresh-token-123");
    expect(decryptSecret(a, KEY, "biz:google_calendar")).toBe("refresh-token-123");
  });

  it("rejects a wrong key, a different context or a tampered payload", () => {
    const payload = encryptSecret("secret", KEY, "biz-1:azul");
    expect(() => decryptSecret(payload, OTHER_KEY, "biz-1:azul")).toThrow();
    expect(() => decryptSecret(payload, KEY, "biz-2:azul")).toThrow();
    const parts = payload.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), KEY, "biz-1:azul")).toThrow();
    expect(() => decryptSecret("garbage", KEY, "biz-1:azul")).toThrow();
  });

  it("refuses keys that are not 32 bytes", () => {
    expect(() => encryptSecret("x", "abcd", "ctx")).toThrow();
  });
});

describe("IntegrationCredentials", () => {
  const schema = z.object({ merchantId: z.string(), authKey: z.string() });

  it("stores only ciphertext and reads typed credentials back", async () => {
    const repo = new MemoryIntegrationRepo();
    const creds = new IntegrationCredentials(repo, KEY);
    await creds.save("biz-1", "azul", { merchantId: "39038540035", authKey: "s3cr3t" });
    expect(repo.rows[0]!.encryptedCredentials).not.toContain("s3cr3t");
    await expect(creds.read("biz-1", "azul", schema)).resolves.toEqual({ merchantId: "39038540035", authKey: "s3cr3t" });
    await expect(creds.read("biz-1", "cardnet", schema)).resolves.toBeNull();
  });

  it("cannot decrypt a row copied to another business", async () => {
    const repo = new MemoryIntegrationRepo();
    const creds = new IntegrationCredentials(repo, KEY);
    await creds.save("biz-1", "azul", { merchantId: "m", authKey: "k" });
    await repo.upsert({ ...repo.rows[0]!, businessId: "biz-2" });
    await expect(creds.read("biz-2", "azul", schema)).rejects.toThrow();
  });

  it("fails loudly on a row that no longer matches the schema", async () => {
    const creds = new IntegrationCredentials(new MemoryIntegrationRepo(), KEY);
    await creds.save("biz-1", "azul", { merchantId: "m" });
    await expect(creds.read("biz-1", "azul", schema)).rejects.toThrow();
  });
});
