import { describe, expect, it } from "vitest";
import { createToolExecutor } from "@/lib/agent/tool-executor";
import { anthropicTools } from "@/lib/agent/tools";
import { resolveBusinessSettings } from "@/lib/config/business-settings";
import { business, client, facial, harness, otherClient, TUESDAY_10 } from "../helpers/fixtures";

function executorFor(h: ReturnType<typeof harness>, who = client) {
  return createToolExecutor({ business, client: who, settings: resolveBusinessSettings(business.settings), store: h.store, booking: h.booking });
}

describe("concierge tool guardrails", () => {
  it("rejects a booking that tries to set its own price", async () => {
    const h = harness();
    const exec = executorFor(h);
    const result = await exec("create_booking_hold", { service_id: facial.id, starts_at: TUESDAY_10.toISOString(), price: 100 });
    expect(result.ok).toBe(false);
    expect(h.store.appointments).toHaveLength(0);
    expect(h.store.activity.some((a) => a.action === "blocked_invalid_input")).toBe(true);
  });

  it("routes a discount request to the owner instead of acting", async () => {
    const h = harness();
    const result = await executorFor(h)("request_owner_approval", { kind: "discount", details: "Pide 20% por ser clienta frecuente" });
    expect(result).toMatchObject({ ok: true, data: { status: "pending_owner" } });
    expect(h.store.approvals).toHaveLength(1);
    expect(h.store.approvals[0]).toMatchObject({ kind: "discount", status: "pending", clientId: client.id });
  });

  it("will not create a deposit link for another client's booking", async () => {
    const h = harness();
    const hold = await h.booking.createHold({ businessId: business.id, clientId: otherClient.id, serviceId: facial.id, startsAt: TUESDAY_10, clientPackageId: null, source: "chat" });
    const result = await executorFor(h)("create_deposit_link", { appointment_id: hold.id });
    expect(result).toMatchObject({ ok: false, error: { code: "appointment_not_found" } });
    expect(h.store.deposits).toHaveLength(0);
  });

  it("allows only one booking per client message", async () => {
    const h = harness();
    const exec = executorFor(h);
    await exec("create_booking_hold", { service_id: facial.id, starts_at: TUESDAY_10.toISOString() });
    const second = await exec("create_booking_hold", { service_id: facial.id, starts_at: "2026-09-29T15:00:00.000Z" });
    expect(second).toMatchObject({ ok: false, error: { code: "turn_limit" } });
  });

  it("rejects unknown tools", async () => {
    const result = await executorFor(harness())("issue_refund", { amount: 5 });
    expect(result).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
  });

  it("exposes no tool that can move money or change prices", () => {
    const names = anthropicTools().map((t) => t.name);
    expect(names).not.toEqual(expect.arrayContaining(["refund", "cancel_appointment", "apply_discount"]));
    for (const tool of anthropicTools()) {
      expect(JSON.stringify(tool.input_schema)).not.toMatch(/"(price|amount|discount)[^"]*"\s*:/);
    }
  });
});
