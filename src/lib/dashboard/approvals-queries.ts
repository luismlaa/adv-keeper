import type { ApprovalKind } from "@/lib/schemas/entities";
import { logOwnerActivity } from "./audit";
import type { OwnerContext } from "./context";

type Row = Record<string, unknown>;

export const APPROVAL_KIND_LABELS: Readonly<Record<ApprovalKind, string>> = {
  discount: "Descuento",
  off_menu_price: "Precio fuera de menú",
  cancellation: "Cancelación",
  refund: "Reembolso",
  other: "Otro",
};

export interface PendingApproval {
  id: string;
  kind: ApprovalKind;
  details: string;
  createdAt: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  appointmentStartsAt: string | null;
  appointmentService: string | null;
}

export async function listPendingApprovals(ctx: OwnerContext): Promise<PendingApproval[]> {
  const { data, error } = await ctx.db
    .from("approval_requests")
    .select("id, kind, details, created_at, client_id, clients(name, phone), appointments(starts_at, services(name))")
    .eq("business_id", ctx.business.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listPendingApprovals failed: ${error.message}`);
  return (data as Row[]).map((r) => {
    const client = (r.clients ?? {}) as { name?: string | null; phone?: string };
    const appt = (r.appointments ?? null) as { starts_at?: string; services?: { name?: string } | null } | null;
    return {
      id: String(r.id),
      kind: r.kind as ApprovalKind,
      details: String(r.details),
      createdAt: new Date(String(r.created_at)).toISOString(),
      clientId: String(r.client_id),
      clientName: client.name ?? "Clienta sin nombre",
      clientPhone: client.phone ?? "",
      appointmentStartsAt: appt?.starts_at ? new Date(appt.starts_at).toISOString() : null,
      appointmentService: appt?.services?.name ?? null,
    };
  });
}

/** Approve/reject only records the decision — no money moves and nothing is sent from here. */
export async function resolveApproval(
  ctx: OwnerContext,
  approvalId: string,
  decision: "approved" | "rejected",
  note: string | null,
  now: Date,
): Promise<void> {
  const { data, error } = await ctx.db
    .from("approval_requests")
    .update({ status: decision, resolved_at: now.toISOString(), resolved_by: ctx.userId })
    .eq("business_id", ctx.business.id)
    .eq("id", approvalId)
    .eq("status", "pending")
    .select("id, kind");
  if (error) throw new Error(`resolveApproval failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("La solicitud ya fue resuelta o no existe");
  await logOwnerActivity(ctx, {
    entity: "approval_request",
    entityId: approvalId,
    action: decision === "approved" ? "owner_approved" : "owner_rejected",
    reason: note?.trim() ? note.trim() : decision === "approved" ? "La dueña aprobó la solicitud" : "La dueña rechazó la solicitud",
    meta: { kind: (data[0] as Row).kind },
  });
}
