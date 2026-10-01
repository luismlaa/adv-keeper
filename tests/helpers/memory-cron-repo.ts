import type { CronRepo, NudgeCandidate, ReminderCandidate } from "@/lib/crons/repo";
import { toReactivationInputs } from "@/lib/dashboard/reactivation";
import { BLOCKING_STATUSES } from "@/lib/domain/appointment-state";
import type { ReactivationInput } from "@/lib/domain/reactivation";
import type { Business } from "@/lib/schemas/entities";
import type { MemoryStore } from "@/lib/store/memory";

/** `CronRepo` over a `MemoryStore`, mirroring `SupabaseCronRepo`'s filters. */
export class MemoryCronRepo implements CronRepo {
  constructor(private readonly store: MemoryStore) {}

  async listLiveBusinesses(): Promise<Business[]> {
    return this.store.businesses.filter((b) => b.integrationMode === "live").map((b) => ({ ...b }));
  }

  async listReminderCandidates(businessId: string, from: Date, to: Date): Promise<ReminderCandidate[]> {
    return this.store.appointments
      .filter((a) => a.businessId === businessId && a.status === "confirmed")
      .filter((a) => new Date(a.startsAt) > from && new Date(a.startsAt) <= to)
      .flatMap((a) => {
        const client = this.store.clients.find((c) => c.id === a.clientId);
        const service = this.store.services.find((s) => s.id === a.serviceId);
        return client ? [{ appointment: { ...a }, clientName: client.name, clientPhone: client.phone, serviceName: service?.name ?? "tu cita" }] : [];
      });
  }

  async listSentDedupeKeys(businessId: string, keys: readonly string[]): Promise<Set<string>> {
    return new Set(this.store.notifications.filter((n) => n.businessId === businessId && keys.includes(n.dedupeKey)).map((n) => n.dedupeKey));
  }

  private upcoming(businessId: string, now: Date): Set<string> {
    return new Set(
      this.store.appointments
        .filter((a) => a.businessId === businessId && BLOCKING_STATUSES.includes(a.status) && new Date(a.startsAt) >= now)
        .map((a) => a.clientId),
    );
  }

  async listNudgeCandidates(businessId: string, now: Date): Promise<NudgeCandidate[]> {
    const upcoming = this.upcoming(businessId, now);
    return this.store.clientPackages
      .filter((p) => p.businessId === businessId && p.status === "active")
      .flatMap((p) => {
        const template = this.store.packageTemplates.find((t) => t.id === p.packageTemplateId);
        const client = this.store.clients.find((c) => c.id === p.clientId);
        if (!template || !client) return [];
        const sessions = this.store.appointments
          .filter((a) => a.businessId === businessId && a.clientPackageId === p.id && a.status === "completed")
          .map((a) => new Date(a.startsAt).getTime());
        return [
          {
            clientPackage: { ...p },
            packageName: template.name,
            intervalDays: template.intervalDays,
            clientName: client.name,
            clientPhone: client.phone,
            lastSessionAt: sessions.length === 0 ? null : new Date(Math.max(...sessions)),
            hasUpcomingAppointment: upcoming.has(p.clientId),
          },
        ];
      });
  }

  async listReactivationInputs(businessId: string, now: Date): Promise<ReactivationInput[]> {
    const clients = this.store.clients.filter((c) => c.businessId === businessId && c.lastVisitAt !== null);
    return toReactivationInputs(clients, this.upcoming(businessId, now));
  }

  async hasActivity(businessId: string, action: string, entityId: string): Promise<boolean> {
    return this.store.activity.some((a) => a.businessId === businessId && a.action === action && a.entityId === entityId);
  }
}
