import type { Appointment, AppointmentStatus } from "@/lib/schemas/entities";
import { DomainError } from "./errors";

export type AppointmentEvent =
  | "deposit_paid"
  | "owner_confirmed_without_deposit"
  | "hold_expired"
  | "completed"
  | "no_show"
  | "cancelled";

const TRANSITIONS: Readonly<Record<AppointmentStatus, Partial<Record<AppointmentEvent, AppointmentStatus>>>> = {
  hold_pending_deposit: {
    deposit_paid: "confirmed",
    owner_confirmed_without_deposit: "confirmed",
    hold_expired: "expired",
    cancelled: "cancelled",
  },
  confirmed: { completed: "completed", no_show: "no_show", cancelled: "cancelled" },
  completed: {},
  no_show: {},
  cancelled: {},
  expired: {},
};

/** Statuses that occupy the calendar slot. */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = ["hold_pending_deposit", "confirmed"];

export function canTransition(status: AppointmentStatus, event: AppointmentEvent): boolean {
  return TRANSITIONS[status][event] !== undefined;
}

export function transition(appointment: Appointment, event: AppointmentEvent): Appointment {
  const next = TRANSITIONS[appointment.status][event];
  if (next === undefined) {
    throw new DomainError(
      "invalid_transition",
      `Cannot apply "${event}" to an appointment in status "${appointment.status}"`,
    );
  }
  return { ...appointment, status: next, holdExpiresAt: next === "hold_pending_deposit" ? appointment.holdExpiresAt : null };
}

export function isHoldExpired(appointment: Appointment, now: Date): boolean {
  return (
    appointment.status === "hold_pending_deposit" &&
    appointment.holdExpiresAt !== null &&
    new Date(appointment.holdExpiresAt) <= now
  );
}
