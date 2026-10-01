import { handleCron } from "@/lib/crons/http";
import { runHoldsExpiry } from "@/lib/crons/holds-expiry";

export const maxDuration = 60;

/** Every 10 min from Supabase pg_cron + pg_net (see supabase/migrations/20261001000000_pg_cron.sql). Authorization: `Bearer $CRON_SECRET`. Demo tenants included (expiry never messages anyone). */
export function GET(request: Request): Promise<Response> {
  return handleCron(request, "holds-expiry", runHoldsExpiry);
}
