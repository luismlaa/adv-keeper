import { resolveAdapters } from "@/lib/adapters/registry";
import { getServerEnv } from "@/lib/config/env";
import { transition, type AppointmentEvent } from "@/lib/domain/appointment-state";
import { consumeSession } from "@/lib/domain/packages";
import type { Appointment, ClientPackage } from "@/lib/schemas/entities";
import { toAppointment, toClientPackage } from "@/lib/store/rows";
import { expirePendingDeposit, logOwnerActivity } from "./audit";
import type { OwnerContext } from "./context";

export type OwnerAppointmentAction = "complete" | "no_show" | "cancel";

const EVENTS: Readonly<Record<OwnerAppointmentAction, AppointmentEvent>> = {
  complete: "completed",
  no_show: "no_show",
  cancel: "cancelled",
};

const DEFAULT_REASONS: Readonly<Record<OwnerAppointmentAction, string>> = {
  complete: "La dueña marcó la cita como completada desde la agenda",
  no_show: "La dueña marcó que la clienta no asistió",
  cancel: "La dueña canceló la cita desde la agenda",
};

/** Cancelling a hold must also kill its pending deposit link. */
export function cancelsPendingDeposit(from: Appointment["status"], action: OwnerAppointmentAction): boolean {
  return action === "cancel" && from === "hold_pending_deposit";
}

export class StaleAppointmentError extends Error {
  constructor() {
    super("La cita cambió mientras tanto. Recarga la agenda e inténtalo de nuevo.");
    this.name = "StaleAppointmentError";
  }
}

/**
 * Owner transitions an appointment. The domain state machine decides legality; the update is
 * conditional on the status we read, so a double click (or a concurrent cron) can't apply it twice —
 * which also guarantees a package session is consumed at most once.
 */
export async function applyOwnerAppointmentAction(
  ctx: OwnerContext,
  appointmentId: string,
  action: OwnerAppointmentAction,
  reasonInput: string | null,
): Promise<Appointment> {
  const reason = reasonInput?.trim() ? reasonInput.trim() : DEFAULT_REASONS[action];
  const { data: row, error } = await ctx.db
    .from("appointments")
    .select("*")
    .eq("business_id", ctx.business.id)
    .eq("id", appointmentId)
    .maybeSingle();
  if (error) throw new Error(`load appointment failed: ${error.message}`);
  if (!row) throw new Error("Cita no encontrada");

  const current = toAppointment(row);
  const next = transition(current, EVENTS[action]);
  // Validate the package BEFORE touching the appointment, so an exhausted package blocks completion.
  const pkgPlan = action === "complete" && current.clientPackageId !== null ? await planPackageSession(ctx, current.clientPackageId) : null;

  const { data: updated, error: updateError } = await ctx.db
    .from("appointments")
    .update({ status: next.status, hold_expires_at: next.holdExpiresAt })
    .eq("business_id", ctx.business.id)
    .eq("id", current.id)
    .eq("status", current.status)
    .select("id");
  if (updateError) throw new Error(`update appointment failed: ${updateError.message}`);
  if (!updated || updated.length === 0) throw new StaleAppointmentError();

  const meta: Record<string, unknown> = { from: current.status, to: next.status };

  if (pkgPlan !== null) meta.package = await applyPackageSession(ctx, pkgPlan);

  if (cancelsPendingDeposit(current.status, action)) meta.depositsExpired = await expirePendingDeposit(ctx, current.id);

  if (action === "cancel" && current.calendarEventId !== null && ctx.business.googleCalendarId !== null) {
    try {
      await resolveAdapters(ctx.business, getServerEnv()).calendar.deleteEvent(ctx.business.googleCalendarId, current.calendarEventId);
      meta.calendarEventDeleted = true;
    } catch (e) {
      meta.calendarEventDeleted = false;
      meta.calendarError = e instanceof Error ? e.message : String(e);
    }
  }

  await logOwnerActivity(ctx, { entity: "appointment", entityId: current.id, action: `owner_${action}`, reason, meta });
  return next;
}

interface PackagePlan {
  before: ClientPackage;
  after: ClientPackage;
}

async function planPackageSession(ctx: OwnerContext, clientPackageId: string): Promise<PackagePlan | null> {
  const { data: row, error } = await ctx.db
    .from("client_packages")
    .select("*")
    .eq("business_id", ctx.business.id)
    .eq("id", clientPackageId)
    .maybeSingle();
  if (error) throw new Error(`load package failed: ${error.message}`);
  if (!row) return null;
  const before = toClientPackage(row);
  return { before, after: consumeSession(before) };
}

/** Conditional on the sessions count we read, so the same session is never consumed twice. */
async function applyPackageSession(ctx: OwnerContext, plan: PackagePlan): Promise<Record<string, unknown>> {
  const { before, after } = plan;
  const { data: updated, error } = await ctx.db
    .from("client_packages")
    .update({ sessions_used: after.sessionsUsed, status: after.status })
    .eq("business_id", ctx.business.id)
    .eq("id", before.id)
    .eq("sessions_used", before.sessionsUsed)
    .select("id");
  if (error) throw new Error(`update package failed: ${error.message}`);
  return {
    id: before.id,
    consumed: (updated?.length ?? 0) > 0,
    sessionsUsed: after.sessionsUsed,
    sessionsTotal: after.sessionsTotal,
    status: after.status,
  };
}
