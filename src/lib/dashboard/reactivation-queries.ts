import { resolveAdapters } from "@/lib/adapters/registry";
import { getServerEnv } from "@/lib/config/env";
import { findReactivationCandidates, type ReactivationCandidate } from "@/lib/domain/reactivation";
import { dedupeKey } from "@/lib/domain/reminders";
import { clientsWithUpcomingAppointments } from "./agenda-queries";
import { logOwnerActivity, recordOwnerNotification } from "./audit";
import type { OwnerContext } from "./context";
import { localIsoDay } from "./format";
import { reactivationMessage, toReactivationInputs } from "./reactivation";

type Row = Record<string, unknown>;

export interface ReactivationRow extends ReactivationCandidate {
  phone: string;
  preview: string;
}

export async function listReactivationCandidates(ctx: OwnerContext, now: Date): Promise<ReactivationRow[]> {
  const [clientsRes, upcoming] = await Promise.all([
    ctx.db
      .from("clients")
      .select("id, name, phone, last_visit_at, last_reengaged_at")
      .eq("business_id", ctx.business.id)
      .not("last_visit_at", "is", null),
    clientsWithUpcomingAppointments(ctx, now),
  ]);
  if (clientsRes.error) throw new Error(`listReactivationCandidates failed: ${clientsRes.error.message}`);
  const rows = (clientsRes.data ?? []) as Row[];
  const clients = rows.map((r) => ({
    id: String(r.id),
    name: (r.name as string | null) ?? null,
    phone: String(r.phone),
    lastVisitAt: r.last_visit_at ? new Date(String(r.last_visit_at)).toISOString() : null,
    lastReengagedAt: r.last_reengaged_at ? new Date(String(r.last_reengaged_at)).toISOString() : null,
  }));
  const phoneById = new Map(clients.map((c) => [c.id, c.phone]));
  const candidates = findReactivationCandidates(toReactivationInputs(clients, upcoming), now, {
    weeks: ctx.settings.reactivationWeeks,
    cooldownDays: ctx.settings.reengagementCooldownDays,
  });
  return candidates.map((c) => ({
    ...c,
    phone: phoneById.get(c.clientId) ?? "",
    preview: reactivationMessage(c.name, ctx.business.name).previewText,
  }));
}

export interface ReengageOutcome {
  clientName: string | null;
  preview: string;
  /** False when today's reactivation for this client was already recorded (nothing re-sent). */
  sent: boolean;
  channel: string;
}

/**
 * "Reenganchar": record the notification (idempotent per client and local day), send the approved
 * `reactivation` template through the business's messaging channel, stamp `last_reengaged_at`, log it.
 */
export async function reengageClient(ctx: OwnerContext, clientId: string, now: Date): Promise<ReengageOutcome> {
  const { data: row, error } = await ctx.db
    .from("clients")
    .select("id, name, phone")
    .eq("business_id", ctx.business.id)
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(`load client failed: ${error.message}`);
  if (!row) throw new Error("Clienta no encontrada");
  const client = { id: String(row.id), name: (row.name as string | null) ?? null, phone: String(row.phone) };

  const message = reactivationMessage(client.name, ctx.business.name);
  const messaging = resolveAdapters(ctx.business, getServerEnv()).messaging;
  const key = dedupeKey.reactivation(client.id, localIsoDay(now, ctx.settings.timezone));

  const fresh = await recordOwnerNotification(ctx, { clientId: client.id, kind: "reactivation", dedupeKey: key, channel: messaging.kind });
  let messageId: string | null = null;
  if (fresh) {
    const result = await messaging.sendTemplate({ to: client.phone, template: "reactivation", variables: message.variables, previewText: message.previewText });
    messageId = result.messageId;
  }

  const { error: stampError } = await ctx.db
    .from("clients")
    .update({ last_reengaged_at: now.toISOString() })
    .eq("business_id", ctx.business.id)
    .eq("id", client.id);
  if (stampError) throw new Error(`stamp last_reengaged_at failed: ${stampError.message}`);

  await logOwnerActivity(ctx, {
    entity: "client",
    entityId: client.id,
    action: "owner_reengaged",
    reason: fresh ? "La dueña reenganchó a una clienta inactiva desde /reactivar" : "Reenganche repetido el mismo día; no se reenvió el mensaje",
    meta: { dedupeKey: key, channel: messaging.kind, messageId, template: "reactivation" },
  });

  return { clientName: client.name, preview: message.previewText, sent: fresh, channel: messaging.kind };
}
