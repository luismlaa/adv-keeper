import type { ServerEnv } from "@/lib/config/env";
import { isAuthorizedCron } from "@/lib/cron";
import type { SeedDemoOptions, SeedDemoResult } from "./seed";

export type DemoResetEnv = Pick<
  ServerEnv,
  "CRON_SECRET" | "DEMO_BUSINESS_SLUG" | "APP_URL" | "DEMO_OWNER_EMAIL" | "DEMO_OWNER_PASSWORD"
>;

export interface DemoResetDeps {
  env: DemoResetEnv;
  /** `seedDemo` bound to the service-role client; injected so tests never touch the real database. */
  seed: (opts: SeedDemoOptions) => Promise<SeedDemoResult>;
  clock: () => Date;
}

export type DemoResetResult =
  | { httpStatus: 401; body: { error: "unauthorized" } }
  | { httpStatus: 200; body: { ok: true; slug: string; counts: Record<string, number> } };

/** Nightly demo reset: wipes and re-seeds the demo tenant. Authorized with the Vercel cron secret. */
export async function runDemoReset(request: Request, deps: DemoResetDeps): Promise<DemoResetResult> {
  if (!isAuthorizedCron(request, deps.env.CRON_SECRET)) {
    return { httpStatus: 401, body: { error: "unauthorized" } };
  }
  const result = await deps.seed({
    now: deps.clock(),
    slug: deps.env.DEMO_BUSINESS_SLUG,
    appUrl: deps.env.APP_URL,
    ownerEmail: deps.env.DEMO_OWNER_EMAIL,
    ownerPassword: deps.env.DEMO_OWNER_PASSWORD,
  });
  return { httpStatus: 200, body: { ok: true, slug: deps.env.DEMO_BUSINESS_SLUG, counts: result.counts } };
}
