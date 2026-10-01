import { resolveAdapters } from "@/lib/adapters/registry";
import { getServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { SupabaseStore } from "@/lib/store/supabase";
import { createPaymentGateway, gatewayDepsFromEnv } from "./gateways";
import type { ReturnDeps } from "./pay-flow";

/** Production dependencies for the pay routes (admin client: the client paying has no session). */
export function payFlowDeps(): ReturnDeps {
  const env = getServerEnv();
  const db = createAdminClient(env);
  const store = new SupabaseStore(db);
  const gatewayDeps = gatewayDepsFromEnv(env, db, (entry) => store.logActivity(entry));
  return {
    store,
    clock: () => new Date(),
    appUrl: env.APP_URL,
    gatewayFor: (business) => createPaymentGateway(business, gatewayDeps),
    resolveAdapters: (business) => resolveAdapters(business, env),
    log: (event, meta) => console.info(`[pay] ${event}`, JSON.stringify(meta)),
  };
}
