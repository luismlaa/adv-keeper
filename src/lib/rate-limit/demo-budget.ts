import type { Business } from "@/lib/schemas/entities";
import { localDayOf, zonedWallTime } from "@/lib/domain/time";

export const DEMO_BUDGET_TIMEZONE = "America/Santo_Domingo";

/** Start of the local calendar day (00:00 America/Santo_Domingo) containing `now`, as a UTC instant. */
export function startOfLocalDay(now: Date, timezone: string = DEMO_BUDGET_TIMEZONE): Date {
  const d = localDayOf(now, timezone);
  return zonedWallTime(d.year, d.monthIndex, d.day, "00:00", timezone);
}

export interface DemoBudgetDeps {
  getBusiness: (businessId: string) => Promise<Pick<Business, "id" | "integrationMode"> | null>;
  /** Number of `messages` rows with role `client` for the business created at or after `since`. */
  countClientMessagesSince: (businessId: string, since: Date) => Promise<number>;
  /** DEMO_DAILY_MESSAGE_BUDGET. */
  dailyBudget: number;
  clock: () => Date;
}

/**
 * Claude cost guard for demo tenants: true once today's client messages (local day) reach the budget.
 * Live tenants are never capped here. Errors propagate — the caller decides how to answer.
 */
export async function checkDemoBudgetExhausted(deps: DemoBudgetDeps, businessId: string): Promise<boolean> {
  const business = await deps.getBusiness(businessId);
  if (!business || business.integrationMode !== "demo") return false;
  const used = await deps.countClientMessagesSince(businessId, startOfLocalDay(deps.clock()));
  return used >= deps.dailyBudget;
}
