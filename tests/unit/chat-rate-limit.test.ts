import { describe, expect, it } from "vitest";
import { sessionLimitMessage, sessionLimitStatus } from "@/lib/chat/limits";

describe("sessionLimitStatus (demo cost guard)", () => {
  it("allows demo messages below the cap and reports what is left", () => {
    expect(sessionLimitStatus({ integrationMode: "demo", clientMessagesSoFar: 0, maxPerSession: 3 })).toEqual({ limited: false, remaining: 2 });
    expect(sessionLimitStatus({ integrationMode: "demo", clientMessagesSoFar: 2, maxPerSession: 3 })).toEqual({ limited: false, remaining: 0 });
  });

  it("blocks the message that would exceed the cap", () => {
    expect(sessionLimitStatus({ integrationMode: "demo", clientMessagesSoFar: 3, maxPerSession: 3 })).toEqual({ limited: true, remaining: 0 });
    expect(sessionLimitStatus({ integrationMode: "demo", clientMessagesSoFar: 10, maxPerSession: 3 }).limited).toBe(true);
  });

  it("never caps live businesses", () => {
    expect(sessionLimitStatus({ integrationMode: "live", clientMessagesSoFar: 10_000, maxPerSession: 3 })).toEqual({ limited: false, remaining: null });
  });

  it("has a friendly Spanish message with the cap", () => {
    expect(sessionLimitMessage(30)).toContain("30 mensajes");
  });
});
