import type { PaymentProvider } from "@/lib/adapters/payments/types";
import type { BookingService } from "@/lib/booking/booking-service";
import type { Appointment, Business } from "@/lib/schemas/entities";
import type { KeeperStore } from "@/lib/store/types";
import { CRON_ACTOR } from "./runner";

/**
 * Gateways whose payment status Keeper can ask for server-side. Cardnet: the adapter's `verifyWebhook`
 * accepts a bare `linkId` and queries the session it stored. Azul's Payment Page has no status query —
 * it only confirms through the signed browser redirect — so it is not reconcilable here.
 */
const QUERYABLE: ReadonlySet<Business["paymentProvider"]> = new Set(["cardnet"]);

/** Give up waiting for an unreachable gateway this long after the hold expired, and release the slot. */
export const RECONCILE_GIVE_UP_MS = 60 * 60 * 1000;

export interface ReconcileResult {
  /** Holds the gateway reported as paid: confirmed instead of expired. */
  confirmed: number;
  /** Holds that may still be paid (gateway unreachable): kept for the next run. */
  deferred: Appointment[];
  /** Holds to expire now. */
  expire: Appointment[];
}

interface ReconcileDeps {
  store: KeeperStore;
  payments: PaymentProvider;
  booking: BookingService;
  now: Date;
}

/**
 * Last check before expiring a live hold: a client may have paid and closed the browser before the
 * gateway redirected her back, so Keeper never saw the confirmation. For queryable gateways, ask; a
 * paid one is confirmed through `BookingService.handlePaymentEvent` (amount + idempotency checks).
 */
export async function reconcileExpiredHolds(deps: ReconcileDeps, business: Business, holds: readonly Appointment[]): Promise<ReconcileResult> {
  const result: ReconcileResult = { confirmed: 0, deferred: [], expire: [] };
  const queryable = business.integrationMode === "live" && QUERYABLE.has(business.paymentProvider);

  for (const hold of holds) {
    const deposit = queryable ? await deps.store.getOpenDepositForAppointment(business.id, hold.id) : null;
    if (deposit === null) {
      result.expire.push(hold);
      continue;
    }
    try {
      const event = await deps.payments.verifyWebhook(new URLSearchParams({ linkId: deposit.linkId }).toString(), new Headers());
      const outcome = event?.status === "paid" ? await deps.booking.handlePaymentEvent(event) : null;
      if (outcome?.status === "confirmed" || outcome?.status === "already_processed") {
        result.confirmed += 1;
        await deps.store.logActivity({
          businessId: business.id,
          actor: CRON_ACTOR,
          entity: "appointment",
          entityId: hold.id,
          action: "payment_reconciled",
          reason: `La clienta pagó en ${business.paymentProvider} pero no volvió a Keeper; se confirmó al consultar la pasarela`,
          meta: { linkId: deposit.linkId },
        });
      } else {
        result.expire.push(hold);
      }
    } catch (error) {
      const expiredFor = deps.now.getTime() - new Date(hold.holdExpiresAt ?? deps.now.toISOString()).getTime();
      if (expiredFor < RECONCILE_GIVE_UP_MS) {
        result.deferred.push(hold);
      } else {
        result.expire.push(hold);
        await deps.store.logActivity({
          businessId: business.id,
          actor: CRON_ACTOR,
          entity: "appointment",
          entityId: hold.id,
          action: "payment_unverified_on_expiry",
          reason: `No se pudo consultar ${business.paymentProvider} durante 1 h; se liberó el horario. Si la clienta dice que pagó, revisar el portal del banco`,
          meta: { linkId: deposit.linkId, error: error instanceof Error ? error.name : "unknown" },
        });
      }
    }
  }
  return result;
}
