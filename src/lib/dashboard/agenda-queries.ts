import { BLOCKING_STATUSES } from "@/lib/domain/appointment-state";
import type { AppointmentStatus } from "@/lib/schemas/entities";
import { availableOwnerActions, depositBadge, pickDeposit, type DepositBadge, type DepositInfo } from "./agenda";
import type { OwnerContext } from "./context";

export interface AgendaItem {
  id: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  clientId: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  priceMinor: number;
  depositMinor: number;
  badge: DepositBadge;
  actions: Array<"complete" | "no_show" | "cancel">;
  notes: string | null;
}

type Row = Record<string, unknown>;

/** Appointments starting in [from, to), excluding expired holds (they never happened). RLS-scoped. */
export async function listAgenda(ctx: OwnerContext, from: Date, to: Date): Promise<AgendaItem[]> {
  const { data, error } = await ctx.db
    .from("appointments")
    .select(
      "id, client_id, client_package_id, starts_at, ends_at, status, price_minor, deposit_minor, hold_expires_at, notes, clients(name, phone), services(name), deposits(status, expires_at, created_at)",
    )
    .eq("business_id", ctx.business.id)
    .neq("status", "expired")
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listAgenda failed: ${error.message}`);
  return (data as Row[]).map((r) => toAgendaItem(r, ctx.settings.timezone));
}

function toAgendaItem(r: Row, timezone: string): AgendaItem {
  const client = (r.clients ?? {}) as { name?: string | null; phone?: string };
  const service = (r.services ?? {}) as { name?: string };
  const deposits = ((r.deposits ?? []) as Array<{ status: DepositInfo["status"]; expires_at: string; created_at: string | null }>).map(
    (d) => ({ status: d.status, expiresAt: new Date(d.expires_at).toISOString(), createdAt: d.created_at }),
  );
  const status = r.status as AppointmentStatus;
  const holdExpiresAt = r.hold_expires_at ? new Date(String(r.hold_expires_at)).toISOString() : null;
  return {
    id: String(r.id),
    startsAt: new Date(String(r.starts_at)).toISOString(),
    endsAt: new Date(String(r.ends_at)).toISOString(),
    status,
    clientId: String(r.client_id),
    clientName: client.name ?? "Clienta sin nombre",
    clientPhone: client.phone ?? "",
    serviceName: service.name ?? "Servicio",
    priceMinor: Number(r.price_minor),
    depositMinor: Number(r.deposit_minor),
    badge: depositBadge(
      {
        status,
        clientPackageId: (r.client_package_id as string | null) ?? null,
        depositMinor: Number(r.deposit_minor),
        holdExpiresAt,
        deposit: pickDeposit(deposits),
      },
      timezone,
    ),
    actions: availableOwnerActions(status),
    notes: (r.notes as string | null) ?? null,
  };
}

/** Client ids with a hold or confirmed appointment from `now` on. */
export async function clientsWithUpcomingAppointments(ctx: OwnerContext, now: Date): Promise<Set<string>> {
  const { data, error } = await ctx.db
    .from("appointments")
    .select("client_id")
    .eq("business_id", ctx.business.id)
    .in("status", [...BLOCKING_STATUSES])
    .gte("starts_at", now.toISOString());
  if (error) throw new Error(`clientsWithUpcomingAppointments failed: ${error.message}`);
  return new Set((data as Array<{ client_id: string }>).map((r) => r.client_id));
}
