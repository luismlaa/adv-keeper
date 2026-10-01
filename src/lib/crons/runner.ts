import { messagingUnavailable } from "@/lib/adapters/messaging/unavailable";
import type { MessagingChannel, OutboundTemplate } from "@/lib/adapters/messaging/types";
import type { Adapters } from "@/lib/adapters/registry";
import type { NotificationKind } from "@/lib/domain/reminders";
import type { Business } from "@/lib/schemas/entities";
import type { KeeperStore } from "@/lib/store/types";
import type { CronRepo } from "./repo";

export type CronJobName = "holds-expiry" | "reminders" | "package-nudges" | "reactivation-scan";

export const CRON_ACTOR = "system:cron";

export interface CronDeps {
  store: KeeperStore;
  repo: CronRepo;
  resolveAdapters: (business: Business) => Adapters;
  clock: () => Date;
  log?: (event: string, meta: Record<string, unknown>) => void;
}

export interface BusinessCounts {
  /** Messages sent, holds expired or digests written: whatever the job's unit of work is. */
  done: number;
  /** Already handled by an earlier run (dedupe key / activity row present). */
  duplicates: number;
  failed: number;
}

export type BusinessResult =
  | ({ businessId: string; status: "ok" } & BusinessCounts)
  | { businessId: string; status: "skipped"; reason: string }
  | { businessId: string; status: "failed"; error: string };

export interface CronSummary {
  job: CronJobName;
  businesses: number;
  done: number;
  duplicates: number;
  failed: number;
  skipped: number;
  results: BusinessResult[];
}

/** A business-level skip (e.g. WhatsApp not configured): logged, nothing claimed, retried next run. */
export class SkipBusiness extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SkipBusiness";
  }
}

export const zeroCounts = (): BusinessCounts => ({ done: 0, duplicates: 0, failed: 0 });

const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown");

/**
 * Runs `work` for every live business. One business failing never stops the others; demo businesses
 * are excluded twice (by the query and here) because they must never get real messages.
 */
export async function forEachLiveBusiness(
  deps: CronDeps,
  job: CronJobName,
  work: (business: Business) => Promise<BusinessCounts>,
  businesses?: readonly Business[],
): Promise<CronSummary> {
  const live = (businesses ?? (await deps.repo.listLiveBusinesses())).filter((b) => b.integrationMode === "live");
  return forEachBusiness(deps, job, work, live);
}

/**
 * Runs `work` for exactly the given businesses, demo included. Only for jobs that never message clients
 * (e.g. holds-expiry); anything that sends must go through `forEachLiveBusiness`.
 */
export async function forEachBusiness(
  deps: CronDeps,
  job: CronJobName,
  work: (business: Business) => Promise<BusinessCounts>,
  businesses: readonly Business[],
): Promise<CronSummary> {
  const results: BusinessResult[] = [];
  for (const business of businesses) {
    try {
      results.push({ businessId: business.id, status: "ok", ...(await work(business)) });
    } catch (error) {
      if (error instanceof SkipBusiness) {
        deps.log?.(`${job}.business_skipped`, { businessId: business.id, reason: error.reason });
        results.push({ businessId: business.id, status: "skipped", reason: error.reason });
      } else {
        deps.log?.(`${job}.business_failed`, { businessId: business.id, error: errorName(error) });
        results.push({ businessId: business.id, status: "failed", error: errorName(error) });
      }
    }
  }
  const sum = (key: keyof BusinessCounts) => results.reduce((acc, r) => acc + (r.status === "ok" ? r[key] : 0), 0);
  return {
    job,
    businesses: businesses.length,
    done: sum("done"),
    duplicates: sum("duplicates"),
    failed: sum("failed") + results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    results,
  };
}

/** The channel to message clients with, or a business-level skip when WhatsApp is not set up. */
export function requireMessaging(deps: CronDeps, business: Business): MessagingChannel {
  const messaging = deps.resolveAdapters(business).messaging;
  const unavailable = messagingUnavailable(messaging);
  if (unavailable !== null) throw new SkipBusiness(unavailable.code);
  return messaging;
}

export interface TemplateDelivery {
  business: Business;
  clientId: string;
  kind: NotificationKind;
  dedupeKey: string;
  message: OutboundTemplate;
  entity: string;
  entityId: string;
  reason: string;
}

export type DeliveryOutcome = "sent" | "duplicate" | "failed";

/**
 * Claim-then-send: the `notifications_sent` row is written first, so two overlapping runs (or a retry)
 * can never message the client twice. The trade-off is at-most-once: if the send fails after the claim,
 * it is logged as `<kind>_failed` for the owner and not retried automatically.
 */
export async function deliverTemplate(deps: CronDeps, messaging: MessagingChannel, d: TemplateDelivery): Promise<DeliveryOutcome> {
  const fresh = await deps.store.recordNotification({
    businessId: d.business.id,
    clientId: d.clientId,
    kind: d.kind,
    dedupeKey: d.dedupeKey,
    channel: messaging.kind,
  });
  if (!fresh) return "duplicate";

  const base = { businessId: d.business.id, actor: CRON_ACTOR, entity: d.entity, entityId: d.entityId };
  try {
    const { messageId } = await messaging.sendTemplate(d.message);
    await deps.store.logActivity({
      ...base,
      action: `${d.kind}_sent`,
      reason: d.reason,
      meta: { dedupeKey: d.dedupeKey, template: d.message.template, channel: messaging.kind, messageId },
    });
    return "sent";
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    await deps.store.logActivity({
      ...base,
      action: `${d.kind}_failed`,
      reason: `No se pudo enviar la plantilla ${d.message.template}; no se reintenta automáticamente`,
      meta: { dedupeKey: d.dedupeKey, template: d.message.template, error: errorName(error), code: code ?? null },
    });
    deps.log?.("delivery_failed", { businessId: d.business.id, kind: d.kind, error: errorName(error) });
    return "failed";
  }
}

export function tally(counts: BusinessCounts, outcome: DeliveryOutcome): BusinessCounts {
  if (outcome === "sent") return { ...counts, done: counts.done + 1 };
  if (outcome === "duplicate") return { ...counts, duplicates: counts.duplicates + 1 };
  return { ...counts, failed: counts.failed + 1 };
}
