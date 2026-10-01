import { getServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { SupabaseStore } from "@/lib/store/supabase";
import { checkDemoBudgetExhausted } from "./demo-budget";

export { checkDemoBudgetExhausted, startOfLocalDay, type DemoBudgetDeps } from "./demo-budget";

/**
 * True when the demo tenant `businessId` has used up today's `DEMO_DAILY_MESSAGE_BUDGET`
 * (client-role `messages` rows since 00:00 America/Santo_Domingo). Always false for live businesses.
 * Call it BEFORE running a Claude turn and answer with a friendly "vuelve mañana" when true.
 */
export async function isDemoBudgetExhausted(businessId: string): Promise<boolean> {
  const env = getServerEnv();
  const db = createAdminClient(env);
  const store = new SupabaseStore(db);
  return checkDemoBudgetExhausted(
    {
      getBusiness: (id) => store.getBusinessById(id),
      countClientMessagesSince: async (id, since) => {
        const { count, error } = await db
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("business_id", id)
          .eq("role", "client")
          .gte("created_at", since.toISOString());
        if (error) throw new Error(`Counting demo messages failed: ${error.message}`);
        return count ?? 0;
      },
      dailyBudget: env.DEMO_DAILY_MESSAGE_BUDGET,
      clock: () => new Date(),
    },
    businessId,
  );
}
