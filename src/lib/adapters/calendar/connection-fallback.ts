import { GoogleDisconnectedError, GoogleNotConnectedError } from "@/lib/adapters/google/errors";
import type { Interval } from "@/lib/domain/time";
import type { CalendarEventInput, CalendarProvider } from "./types";

/** No Google connection (never connected, revoked, or Keeper's OAuth client not configured). */
export function isCalendarNotConnected(error: unknown): error is GoogleNotConnectedError | GoogleDisconnectedError {
  return error instanceof GoogleNotConnectedError || error instanceof GoogleDisconnectedError;
}

export type CalendarWarn = (event: string, meta: Record<string, unknown>) => void;

const defaultWarn: CalendarWarn = (event, meta) => console.warn(`[calendar] ${event}`, JSON.stringify(meta));

/**
 * Degrades a live calendar gracefully when the business has no working Google connection:
 * - `getBusy` → no external busy blocks (Keeper's own appointments still block slots);
 * - `createEvent` → rethrows the typed error; `BookingService` confirms anyway and logs the skip;
 * - `deleteEvent` → nothing we can reach, so it is a logged no-op.
 * Any other failure (timeouts, Google 5xx after retries) still throws: we never guess availability.
 */
export function withConnectionFallback(inner: CalendarProvider, businessId: string, warn: CalendarWarn = defaultWarn): CalendarProvider {
  return {
    kind: inner.kind,

    async getBusy(calendarRef: string, range: Interval): Promise<Interval[]> {
      try {
        return await inner.getBusy(calendarRef, range);
      } catch (error) {
        if (!isCalendarNotConnected(error)) throw error;
        warn("busy_skipped", { businessId, reason: error.code });
        return [];
      }
    },

    createEvent(input: CalendarEventInput): Promise<{ eventId: string }> {
      return inner.createEvent(input);
    },

    async deleteEvent(calendarRef: string, eventId: string): Promise<void> {
      try {
        await inner.deleteEvent(calendarRef, eventId);
      } catch (error) {
        if (!isCalendarNotConnected(error)) throw error;
        warn("delete_skipped", { businessId, reason: error.code });
      }
    },
  };
}

/** Calendar for a live business when Keeper's Google OAuth client is not configured at all. */
export function notConnectedCalendar(businessId: string): CalendarProvider {
  const fail = async (): Promise<never> => {
    throw new GoogleNotConnectedError(businessId);
  };
  return { kind: "google", getBusy: fail, createEvent: fail, deleteEvent: fail };
}
