import { handleCron } from "@/lib/crons/http";
import { runReactivationScan } from "@/lib/crons/reactivation-scan";

export const maxDuration = 60;

/** Weekly from Vercel Cron (vercel.json). Authorization: `Bearer $CRON_SECRET`. Only live businesses; demo tenants are skipped. */
export function GET(request: Request): Promise<Response> {
  return handleCron(request, "reactivation-scan", runReactivationScan);
}
