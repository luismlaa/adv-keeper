import { adminLiveServices } from "@/lib/adapters/live";
import { createPaymentGateway, gatewayDepsFromEnv } from "@/lib/adapters/payments/gateway";
import { resolveAdapters } from "@/lib/adapters/registry";
import { getServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { SupabaseStore } from "@/lib/store/supabase";
import type { ReturnDeps } from "./pay-flow";

/** Production dependencies for the pay routes (admin client: the client paying has no session). */
export function payFlowDeps(): ReturnDeps {
  const env = getServerEnv();
  const db = createAdminClient(env);
  const gatewayDeps = gatewayDepsFromEnv(env, adminLiveServices(env, db));
  return {
    store: new SupabaseStore(db),
    clock: () => new Date(),
    appUrl: env.APP_URL,
    // The hand-off (signed form / Cardnet session) is gateway-specific, so it is built here; verifying the
    // return goes through the registered live adapters (`resolveAdapters`), like the payments webhook.
    gatewayFor: (business) => createPaymentGateway(business, gatewayDeps),
    resolveAdapters: (business) => resolveAdapters(business, env),
    log: (event, meta) => console.info(`[pay] ${event}`, JSON.stringify(meta)),
  };
}
