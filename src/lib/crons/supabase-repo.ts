import type { SupabaseClient } from "@supabase/supabase-js";
import { toReactivationInputs } from "@/lib/dashboard/reactivation";
import { BLOCKING_STATUSES } from "@/lib/domain/appointment-state";
import type { ReactivationInput } from "@/lib/domain/reactivation";
import type { Business } from "@/lib/schemas/entities";
import { toAppointment, toBusiness, toClientPackage } from "@/lib/store/rows";
import type { CronRepo, NudgeCandidate, ReminderCandidate } from "./repo";

type Row = Record<string, unknown>;

function fail(operation: string, error: { message: string; code?: string }): never {
  throw new Error(`cron ${operation} failed: ${error.message}${error.code ? ` (${error.code})` : ""}`);
}

const iso = (value: unknown): string | null => (value === null || value === undefined ? null : new Date(String(value)).toISOString());

/** PostgREST returns a to-one embed as an object (or, depending on the FK, a one-element array). */
function one(value: unknown): Row | null {
  if (Array.isArray(value)) return (value[0] as Row | undefined) ?? null;
  return (value as Row | null) ?? null;
}

/** Service-role queries for the crons. Every per-business query filters by `business_id`. */
export class SupabaseCronRepo implements CronRepo {
  constructor(private readonly db: SupabaseClient) {}

  async listLiveBusinesses(): Promise<Business[]> {
    const { data, error } = await this.db.from("businesses").select("*").eq("integration_mode", "live").order("created_at");
    if (error) fail("listLiveBusinesses", error);
    return (data as Row[]).map(toBusiness);
  }

  async listReminderCandidates(businessId: string, from: Date, to: Date): Promise<ReminderCandidate[]> {
    const { data, error } = await this.db
      .from("appointments")
      .select("*, clients(name, phone), services(name)")
      .eq("business_id", businessId)
      .eq("status", "confirmed")
      .gt("starts_at", from.toISOString())
      .lte("starts_at", to.toISOString())
      .order("starts_at");
    if (error) fail("listReminderCandidates", error);
    return (data as Row[]).flatMap((row) => {
      const client = one(row.clients);
      const service = one(row.services);
      if (client === null || typeof client.phone !== "string") return [];
      return [
        {
          appointment: toAppointment(row),
          clientName: (client.name as string | null) ?? null,
          clientPhone: client.phone,
          serviceName: typeof service?.name === "string" ? service.name : "tu cita",
        },
      ];
    });
  }

  async listSentDedupeKeys(businessId: string, keys: readonly string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const { data, error } = await this.db
      .from("notifications_sent")
      .select("dedupe_key")
      .eq("business_id", businessId)
      .in("dedupe_key", [...keys]);
    if (error) fail("listSentDedupeKeys", error);
    return new Set((data as Row[]).map((r) => String(r.dedupe_key)));
  }

  private async clientsWithUpcoming(businessId: string, now: Date): Promise<Set<string>> {
    const { data, error } = await this.db
      .from("appointments")
      .select("client_id")
      .eq("business_id", businessId)
      .in("status", [...BLOCKING_STATUSES])
      .gte("starts_at", now.toISOString());
    if (error) fail("clientsWithUpcoming", error);
    return new Set((data as Row[]).map((r) => String(r.client_id)));
  }

  async listNudgeCandidates(businessId: string, now: Date): Promise<NudgeCandidate[]> {
    const { data, error } = await this.db
      .from("client_packages")
      .select("*, package_templates(name, interval_days), clients(name, phone)")
      .eq("business_id", businessId)
      .eq("status", "active");
    if (error) fail("listNudgeCandidates", error);
    const rows = data as Row[];
    if (rows.length === 0) return [];

    const packageIds = rows.map((r) => String(r.id));
    const [sessions, upcoming] = await Promise.all([
      this.db
        .from("appointments")
        .select("client_package_id, starts_at")
        .eq("business_id", businessId)
        .eq("status", "completed")
        .in("client_package_id", packageIds),
      this.clientsWithUpcoming(businessId, now),
    ]);
    if (sessions.error) fail("listNudgeCandidates(sessions)", sessions.error);
    const lastSession = new Map<string, number>();
    for (const s of sessions.data as Row[]) {
      const id = String(s.client_package_id);
      const at = new Date(String(s.starts_at)).getTime();
      lastSession.set(id, Math.max(lastSession.get(id) ?? at, at));
    }

    return rows.flatMap((row) => {
      const template = one(row.package_templates);
      const client = one(row.clients);
      if (template === null || client === null || typeof client.phone !== "string") return [];
      const pkg = toClientPackage(row);
      const last = lastSession.get(pkg.id);
      return [
        {
          clientPackage: pkg,
          packageName: String(template.name),
          intervalDays: Number(template.interval_days),
          clientName: (client.name as string | null) ?? null,
          clientPhone: client.phone,
          lastSessionAt: last === undefined ? null : new Date(last),
          hasUpcomingAppointment: upcoming.has(pkg.clientId),
        },
      ];
    });
  }

  async listReactivationInputs(businessId: string, now: Date): Promise<ReactivationInput[]> {
    const [clients, upcoming] = await Promise.all([
      this.db
        .from("clients")
        .select("id, name, last_visit_at, last_reengaged_at")
        .eq("business_id", businessId)
        .not("last_visit_at", "is", null),
      this.clientsWithUpcoming(businessId, now),
    ]);
    if (clients.error) fail("listReactivationInputs", clients.error);
    const rows = (clients.data as Row[]).map((r) => ({
      id: String(r.id),
      name: (r.name as string | null) ?? null,
      lastVisitAt: iso(r.last_visit_at),
      lastReengagedAt: iso(r.last_reengaged_at),
    }));
    return toReactivationInputs(rows, upcoming);
  }

  async hasActivity(businessId: string, action: string, entityId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("activity_log")
      .select("id")
      .eq("business_id", businessId)
      .eq("action", action)
      .eq("entity_id", entityId)
      .limit(1);
    if (error) fail("hasActivity", error);
    return (data as Row[]).length > 0;
  }
}
