import { getServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import type { NotificationKind } from "@/lib/domain/reminders";
import { SupabaseStore } from "@/lib/store/supabase";
import type { OwnerContext } from "./context";

/**
 * `activity_log` and `notifications_sent` are read-only for owners under RLS (only the server writes
 * them). Dashboard actions therefore write them through the service-role store — but only with the
 * business id taken from the RLS-verified owner context, never from user input.
 */
function serverStore(): SupabaseStore {
  return new SupabaseStore(createAdminClient(getServerEnv()));
}

export interface OwnerActivity {
  entity: string;
  entityId: string | null;
  action: string;
  reason: string;
  meta?: Record<string, unknown>;
}

export async function logOwnerActivity(ctx: OwnerContext, activity: OwnerActivity): Promise<void> {
  await serverStore().logActivity({
    businessId: ctx.business.id,
    actor: `owner:${ctx.userId}`,
    entity: activity.entity,
    entityId: activity.entityId,
    action: activity.action,
    reason: activity.reason,
    meta: activity.meta ?? {},
  });
}

/** Returns false when `dedupeKey` was already recorded (the message must not be sent again). */
export async function recordOwnerNotification(
  ctx: OwnerContext,
  input: { clientId: string; kind: NotificationKind; dedupeKey: string; channel: "web" | "whatsapp" | "recording" },
): Promise<boolean> {
  return serverStore().recordNotification({ businessId: ctx.business.id, ...input });
}
