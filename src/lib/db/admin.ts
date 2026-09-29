import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ServerEnv } from "@/lib/config/env";

/**
 * Service-role client — bypasses RLS. Server-only: webhooks, crons, the concierge agent and seeding.
 * Every query made with it MUST filter by business_id explicitly (the store layer does).
 */
export function createAdminClient(
  env: Pick<ServerEnv, "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">,
): SupabaseClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
