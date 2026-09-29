import type { Interval } from "@/lib/domain/time";

export interface CalendarEventInput {
  calendarRef: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
}

/** Availability source. Live implementation: Google Calendar (freebusy + events). */
export interface CalendarProvider {
  readonly kind: "fake" | "google";
  getBusy(calendarRef: string, range: Interval): Promise<Interval[]>;
  createEvent(input: CalendarEventInput): Promise<{ eventId: string }>;
  deleteEvent(calendarRef: string, eventId: string): Promise<void>;
}
