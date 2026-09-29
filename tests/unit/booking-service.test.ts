import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain/errors";
import { business, client, facial, harness, laser, laserPackage, otherClient, TUESDAY_10 } from "../helpers/fixtures";

const holdInput = { businessId: business.id, clientId: client.id, serviceId: facial.id, startsAt: TUESDAY_10, clientPackageId: null, source: "chat" as const };

describe("BookingService", () => {
  it("creates a hold priced from the catalog with a computed deposit", async () => {
    const h = harness();
    const hold = await h.booking.createHold(holdInput);
    expect(hold.status).toBe("hold_pending_deposit");
    expect(hold.priceMinor).toBe(350000);
    expect(hold.depositMinor).toBe(105000);
    expect(hold.holdExpiresAt).toBe("2026-09-28T12:30:00.000Z");
  });

  it("is idempotent for the same client and start", async () => {
    const h = harness();
    const a = await h.booking.createHold(holdInput);
    const b = await h.booking.createHold(holdInput);
    expect(b.id).toBe(a.id);
    expect(h.store.appointments).toHaveLength(1);
  });

  it("refuses a slot another client already holds", async () => {
    const h = harness();
    await h.booking.createHold(holdInput);
    await expect(h.booking.createHold({ ...holdInput, clientId: otherClient.id })).rejects.toThrow(DomainError);
  });

  it("returns the same deposit link on repeated calls", async () => {
    const h = harness();
    const hold = await h.booking.createHold(holdInput);
    const first = await h.booking.createDepositLink(business.id, hold.id);
    const second = await h.booking.createDepositLink(business.id, hold.id);
    expect(second.linkId).toBe(first.linkId);
    expect(first.url).toMatch(/^https:\/\/keeper\.test\/pay\/demo\//);
  });

  it("confirms on payment, and a duplicate webhook changes nothing", async () => {
    const h = harness();
    const hold = await h.booking.createHold(holdInput);
    const deposit = await h.booking.createDepositLink(business.id, hold.id);
    const event = { linkId: deposit.linkId, providerTxnId: "txn-1", amountMinor: deposit.amountMinor, status: "paid" as const };

    const first = await h.booking.handlePaymentEvent(event);
    expect(first.status).toBe("confirmed");
    const appointment = await h.store.getAppointment(business.id, hold.id);
    expect(appointment?.status).toBe("confirmed");
    expect(appointment?.calendarEventId).toMatch(/^fake-evt-/);

    const again = await h.booking.handlePaymentEvent(event);
    expect(again.status).toBe("already_processed");
    expect(h.store.activity.filter((a) => a.action === "confirmed")).toHaveLength(1);
  });

  it("ignores a payment whose amount does not match and logs it for the owner", async () => {
    const h = harness();
    const hold = await h.booking.createHold(holdInput);
    const deposit = await h.booking.createDepositLink(business.id, hold.id);
    const outcome = await h.booking.handlePaymentEvent({ linkId: deposit.linkId, providerTxnId: "t", amountMinor: 1, status: "paid" });
    expect(outcome).toEqual({ status: "ignored", reason: "amount_mismatch" });
    expect(h.store.activity.some((a) => a.action === "amount_mismatch")).toBe(true);
  });

  it("expires unpaid holds and frees the slot", async () => {
    const h = harness();
    const hold = await h.booking.createHold(holdInput);
    await h.booking.createDepositLink(business.id, hold.id);
    h.setNow(new Date("2026-09-28T13:00:00.000Z"));
    const expired = await h.booking.expireHolds();
    expect(expired.map((a) => a.status)).toEqual(["expired"]);
    expect(h.store.deposits[0]!.status).toBe("expired");
    await expect(h.booking.createHold({ ...holdInput, clientId: otherClient.id })).resolves.toMatchObject({ status: "hold_pending_deposit" });
  });

  it("confirms package sessions immediately with no deposit", async () => {
    const h = harness();
    const appt = await h.booking.createHold({ ...holdInput, serviceId: laser.id, clientPackageId: laserPackage.id });
    expect(appt.status).toBe("confirmed");
    expect(appt.depositMinor).toBe(0);
  });

  it("rejects a package that does not match the service", async () => {
    const h = harness();
    await expect(h.booking.createHold({ ...holdInput, clientPackageId: laserPackage.id })).rejects.toMatchObject({ code: "package_invalid" });
  });
});
