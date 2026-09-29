import { overlaps, type Interval } from "@/lib/domain/time";
import type { CalendarEventInput, CalendarProvider } from "./types";

interface StoredEvent {
  id: string;
  calendarRef: string;
  interval: Interval;
}

/**
 * In-memory calendar for the demo tenant and tests. Seed it with "personal" blocks to show that
 * availability respects the owner's own calendar. Returns copies; never exposes internal state.
 */
export class FakeCalendar implements CalendarProvider {
  readonly kind = "fake" as const;
  private events: readonly StoredEvent[];

  constructor(personalBlocks: readonly Interval[] = [], calendarRef = "demo") {
    this.events = personalBlocks.map((interval, i) => ({ id: `personal-${i}`, calendarRef, interval }));
  }

  async getBusy(calendarRef: string, range: Interval): Promise<Interval[]> {
    return this.events
      .filter((e) => e.calendarRef === calendarRef && overlaps(e.interval, range))
      .map((e) => ({ ...e.interval }));
  }

  async createEvent(input: CalendarEventInput): Promise<{ eventId: string }> {
    const id = `fake-evt-${crypto.randomUUID()}`;
    this.events = [...this.events, { id, calendarRef: input.calendarRef, interval: { start: input.start, end: input.end } }];
    return { eventId: id };
  }

  async deleteEvent(calendarRef: string, eventId: string): Promise<void> {
    this.events = this.events.filter((e) => !(e.calendarRef === calendarRef && e.id === eventId));
  }
}
