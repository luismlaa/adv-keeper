import { handleCron } from "@/lib/crons/http";
import { runPackageNudges } from "@/lib/crons/package-nudges";

export const maxDuration = 60;

/** Daily from Vercel Cron (vercel.json). Authorization: `Bearer $CRON_SECRET`. Only live businesses; demo tenants are skipped. */
export function GET(request: Request): Promise<Response> {
  return handleCron(request, "package-nudges", runPackageNudges);
}
