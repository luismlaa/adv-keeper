import { describe, expect, it } from "vitest";
import { FakeCalendar } from "@/lib/adapters/calendar/fake";
import { RecordingChannel } from "@/lib/adapters/messaging/recording";
import type { PaymentEvent, PaymentProvider } from "@/lib/adapters/payments/types";
import type { Adapters } from "@/lib/adapters/registry";
import { runHoldsExpiry } from "@/lib/crons/holds-expiry";
import { RECONCILE_GIVE_UP_MS } from "@/lib/crons/reconcile";
import type { CronDeps } from "@/lib/crons/runner";
import { HOUR_MS } from "@/lib/domain/time";
import type { Appointment, Business, Deposit } from "@/lib/schemas/entities";
import { MemoryStore } from "@/lib/store/memory";
import { business as base, client, facial, NOW } from "../helpers/fixtures";
import { MemoryCronRepo } from "../helpers/memory-cron-repo";

const cardnet: Business = { ...base, integrationMode: "live", paymentProvider: "cardnet", whatsappPhoneNumberId: "1098765432" };
const azul: Business = { ...cardnet, paymentProvider: "azul" };
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

const hold: Appointment = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000901",
  businessId: base.id,
  clientId: client.id,
  serviceId: facial.id,
  clientPackageId: null,
  startsAt: at(48 * HOUR_MS),
  endsAt: at(49 * HOUR_MS),
  status: "hold_pending_deposit",
  priceMinor: 350000,
  depositMinor: 105000,
  holdExpiresAt: at(-60_000),
  calendarEventId: null,
  source: "chat",
  notes: null,
};

const deposit: Deposit = {
  id: "dddddddd-dddd-4ddd-8ddd-000000000901",
  businessId: base.id,
  appointmentId: hold.id,
  provider: "cardnet",
  linkId: "cn_link_901",
  url: "https://keeper.test/api/pay/cardnet/cn_link_901",
  amountMinor: 105000,
  currency: "DOP",
  status: "pending",
  providerTxnId: null,
  expiresAt: at(-60_000),
  paidAt: null,
};

/** Gateway stub: answers the server-side status query the way the Cardnet adapter does. */
function gateway(answer: "paid" | "unpaid" | "down"): PaymentProvider & { queries: string[] } {
  const queries: string[] = [];
  return {
    kind: "cardnet",
    queries,
    async createDepositLink() {
      throw new Error("not used");
    },
    async verifyWebhook(rawBody: string): Promise<PaymentEvent | null> {
      queries.push(rawBody);
      if (answer === "down") throw new Error("Cardnet unreachable");
      if (answer === "unpaid") return null;
      return { linkId: deposit.linkId, providerTxnId: "rrn-123", amountMinor: deposit.amountMinor, status: "paid" };
    },
  };
}

function world(business: Business, answer: "paid" | "unpaid" | "down", now = NOW, holdOverride: Partial<Appointment> = {}) {
  const store = new MemoryStore({
    businesses: [business],
    services: [facial],
    clients: [client],
    appointments: [{ ...hold, ...holdOverride }],
    deposits: [{ ...deposit, provider: business.paymentProvider }],
  });
  const payments = gateway(answer);
  const adapters: Adapters = { calendar: new FakeCalendar(), payments, messaging: new RecordingChannel() };
  const deps: CronDeps = { store, repo: new MemoryCronRepo(store), resolveAdapters: () => adapters, clock: () => now };
  return { store, deps, payments };
}

const statusOf = (store: MemoryStore) => ({
  appointment: store.appointments.find((a) => a.id === hold.id)?.status,
  deposit: store.deposits.find((d) => d.id === deposit.id)?.status,
});

describe("holds-expiry reconciliation", () => {
  it("confirms a Cardnet hold that was paid but never came back, instead of expiring it", async () => {
    const w = world(cardnet, "paid");
    expect(await runHoldsExpiry(w.deps)).toMatchObject({ done: 1, failed: 0 });
    expect(w.payments.queries).toEqual(["linkId=cn_link_901"]);
    expect(statusOf(w.store)).toEqual({ appointment: "confirmed", deposit: "paid" });
    expect(w.store.activity.some((a) => a.action === "payment_reconciled")).toBe(true);
    expect(w.store.activity.some((a) => a.action === "hold_expired")).toBe(false);
  });

  it("expires the hold when the gateway reports it unpaid", async () => {
    const w = world(cardnet, "unpaid");
    await runHoldsExpiry(w.deps);
    expect(statusOf(w.store)).toEqual({ appointment: "expired", deposit: "expired" });
  });

  it("keeps the hold while the gateway is unreachable, then gives up after an hour and tells the owner", async () => {
    const early = world(cardnet, "down");
    await runHoldsExpiry(early.deps);
    expect(statusOf(early.store)).toEqual({ appointment: "hold_pending_deposit", deposit: "pending" });

    const late = world(cardnet, "down", NOW, { holdExpiresAt: at(-RECONCILE_GIVE_UP_MS - 60_000) });
    await runHoldsExpiry(late.deps);
    expect(statusOf(late.store)).toEqual({ appointment: "expired", deposit: "expired" });
    expect(late.store.activity.some((a) => a.action === "payment_unverified_on_expiry")).toBe(true);
  });

  it("never queries Azul (no status API) and simply expires", async () => {
    const w = world(azul, "paid");
    await runHoldsExpiry(w.deps);
    expect(w.payments.queries).toHaveLength(0);
    expect(statusOf(w.store).appointment).toBe("expired");
  });
});
