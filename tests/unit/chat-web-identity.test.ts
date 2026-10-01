import { describe, expect, it } from "vitest";
import { toRichSegments } from "@/lib/chat/rich-text";
import { allocateWebPhone, randomWebPhone, signWebIdentity, verifyWebIdentity } from "@/lib/chat/web-identity";

const SECRET = "a".repeat(64);

describe("web chat identity cookie", () => {
  it("generates +1809000xxxx phones", () => {
    expect(randomWebPhone(() => 42)).toBe("+18090000042");
    expect(randomWebPhone()).toMatch(/^\+1809000\d{4}$/);
  });

  it("round-trips a signed phone and rejects tampering", () => {
    const value = signWebIdentity("+18090001234", SECRET);
    expect(verifyWebIdentity(value, SECRET)).toBe("+18090001234");
    expect(verifyWebIdentity(value.replace("1234", "1235"), SECRET)).toBeNull();
    expect(verifyWebIdentity(value, "b".repeat(64))).toBeNull();
    expect(verifyWebIdentity(undefined, SECRET)).toBeNull();
    expect(verifyWebIdentity("+18090001234", SECRET)).toBeNull();
  });

  it("cannot be used to impersonate a non-web phone, even when signed", () => {
    expect(verifyWebIdentity(signWebIdentity("+18095551001", SECRET), SECRET)).toBeNull();
  });

  it("skips phones already taken by another client", async () => {
    const candidates = ["+18090000001", "+18090000002", "+18090000003"];
    const phone = await allocateWebPhone(async (p) => p !== "+18090000003", 8, () => candidates.shift()!);
    expect(phone).toBe("+18090000003");
    await expect(allocateWebPhone(async () => true, 3)).rejects.toThrow(/allocate/);
  });
});

describe("toRichSegments", () => {
  it("turns deposit links into a 'Pagar anticipo' button and trims trailing punctuation", () => {
    const segments = toRichSegments("Paga aquí: http://localhost:3000/pay/demo/abc123.");
    expect(segments).toEqual([
      { type: "text", text: "Paga aquí: ", bold: false },
      { type: "link", url: "http://localhost:3000/pay/demo/abc123", label: "Pagar anticipo" },
      { type: "text", text: ".", bold: false },
    ]);
  });

  it("supports markdown links and bold, and ignores non-http schemes", () => {
    const segments = toRichSegments("**Total** [ver](https://example.com/x) javascript:alert(1)");
    expect(segments).toEqual([
      { type: "text", text: "Total", bold: true },
      { type: "text", text: " ", bold: false },
      { type: "link", url: "https://example.com/x", label: "ver" },
      { type: "text", text: " javascript:alert(1)", bold: false },
    ]);
  });
});
