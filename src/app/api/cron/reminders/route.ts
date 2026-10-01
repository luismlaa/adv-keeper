import { handleCron } from "@/lib/crons/http";
import { runReminders } from "@/lib/crons/reminders";

export const maxDuration = 60;

/** Hourly from Supabase pg_cron + pg_net (see supabase/migrations/20261001000000_pg_cron.sql). Authorization: `Bearer $CRON_SECRET`. Only live businesses; demo tenants are skipped. */
export function GET(request: Request): Promise<Response> {
  return handleCron(request, "reminders", runReminders);
}
