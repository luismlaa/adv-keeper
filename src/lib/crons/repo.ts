import type { ReactivationInput } from "@/lib/domain/reactivation";
import type { Appointment, Business, ClientPackage } from "@/lib/schemas/entities";

/** A confirmed appointment plus what the `day_before_reminder` template needs. */
export interface ReminderCandidate {
  appointment: Appointment;
  clientName: string | null;
  clientPhone: string;
  serviceName: string;
}

/** An active package plus what `isPackageNudgeDue` and the `package_nudge` template need. */
export interface NudgeCandidate {
  clientPackage: ClientPackage;
  packageName: string;
  intervalDays: number;
  clientName: string | null;
  clientPhone: string;
  /** Start of the latest completed appointment that consumed a session of this package. */
  lastSessionAt: Date | null;
  hasUpcomingAppointment: boolean;
}

/**
 * Read-only queries the scheduled jobs need beyond `KeeperStore` (which stays the write path:
 * `recordNotification`, `logActivity`, `BookingService`). Every per-business method filters by `businessId`.
 */
export interface CronRepo {
  /** Businesses with `integration_mode = 'live'`. Demo tenants are never returned. */
  listLiveBusinesses(): Promise<Business[]>;
  /** Confirmed appointments with `from < starts_at <= to`. */
  listReminderCandidates(businessId: string, from: Date, to: Date): Promise<ReminderCandidate[]>;
  /** Which of `keys` are already in `notifications_sent` (so a run doesn't even try to re-send them). */
  listSentDedupeKeys(businessId: string, keys: readonly string[]): Promise<Set<string>>;
  listNudgeCandidates(businessId: string, now: Date): Promise<NudgeCandidate[]>;
  listReactivationInputs(businessId: string, now: Date): Promise<ReactivationInput[]>;
  /** True when `activity_log` already has a row with this action + entity id (dedupe for log-only jobs). */
  hasActivity(businessId: string, action: string, entityId: string): Promise<boolean>;
}
