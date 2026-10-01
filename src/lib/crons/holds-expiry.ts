import { BookingService } from "@/lib/booking/booking-service";
import type { Appointment } from "@/lib/schemas/entities";
import type { KeeperStore } from "@/lib/store/types";
import { forEachBusiness, type CronDeps, type CronSummary } from "./runner";

/** The store as seen by one business's expiry run: `listExpiredHolds` returns only that business's holds. */
function withHolds(store: KeeperStore, holds: readonly Appointment[]): KeeperStore {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "listExpiredHolds") return async () => holds.map((h) => ({ ...h }));
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * Every 10 minutes (pg_cron): releases unpaid holds through `BookingService.expireHolds`, demo tenants
 * included, so abandoned demo holds free their slot instead of blocking it until the nightly reset.
 * Safe for demo: expiring a hold only updates the appointment/deposit and logs; it never messages anyone.
 * Idempotent by state: an expired hold is no longer `hold_pending_deposit`, so a second run finds nothing.
 */
export async function runHoldsExpiry(deps: CronDeps): Promise<CronSummary> {
  const expired = await deps.store.listExpiredHolds(deps.clock());
  const ids = [...new Set(expired.map((a) => a.businessId))];
  const businesses = (await Promise.all(ids.map((id) => deps.store.getBusinessById(id)))).filter((b) => b !== null);

  return forEachBusiness(
    deps,
    "holds-expiry",
    async (business) => {
      const holds = expired.filter((a) => a.businessId === business.id);
      if (holds.length === 0) return { done: 0, duplicates: 0, failed: 0 };
      const booking = new BookingService({
        store: withHolds(deps.store, holds),
        adapters: deps.resolveAdapters(business),
        clock: deps.clock,
      });
      const released = await booking.expireHolds();
      return { done: released.length, duplicates: 0, failed: 0 };
    },
    businesses,
  );
}
