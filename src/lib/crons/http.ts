import { resolveAdapters } from "@/lib/adapters/registry";
import { getServerEnv } from "@/lib/config/env";
import { isAuthorizedCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/db/admin";
import { SupabaseStore } from "@/lib/store/supabase";
import type { CronDeps, CronJobName, CronSummary } from "./runner";
import { SupabaseCronRepo } from "./supabase-repo";

export type CronJob = (deps: CronDeps) => Promise<CronSummary>;

/** Authorizes, runs and reports one job. Pure enough to unit test: deps and secret are injected. */
export async function runCronRequest(
  request: Request,
  input: { job: CronJobName; run: CronJob; cronSecret: string; deps: () => CronDeps },
): Promise<Response> {
  if (!isAuthorizedCron(request, input.cronSecret)) {
    console.warn(`[cron:${input.job}] unauthorized call rejected`);
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await input.run(input.deps());
    const { results, ...totals } = summary;
    console.info(`[cron:${input.job}] done`, JSON.stringify(totals));
    return Response.json({ ok: true, ...totals, results });
  } catch (error) {
    // Every side effect is idempotent, so the next scheduled run simply retries.
    console.error(`[cron:${input.job}] failed`, error instanceof Error ? error.message : String(error));
    return Response.json({ error: `${input.job}_failed` }, { status: 500 });
  }
}

/** Production wiring: service-role client, registered adapters (live for live businesses). */
export function handleCron(request: Request, job: CronJobName, run: CronJob): Promise<Response> {
  const env = getServerEnv();
  return runCronRequest(request, {
    job,
    run,
    cronSecret: env.CRON_SECRET,
    deps: () => {
      const db = createAdminClient(env);
      return {
        store: new SupabaseStore(db),
        repo: new SupabaseCronRepo(db),
        resolveAdapters: (business) => resolveAdapters(business, env),
        clock: () => new Date(),
        log: (event, meta) => console.info(`[cron:${job}] ${event}`, JSON.stringify(meta)),
      };
    },
  });
}
