import { resolveAdapters } from "@/lib/adapters/registry";
import { getServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { processPaymentWebhook } from "@/lib/demo/payment-webhook";
import { SupabaseStore } from "@/lib/store/supabase";

/**
 * Payment gateway confirmations for every provider (fake demo checkout, Azul, Cardnet).
 * Live adapters plug in through `registerLiveAdapters`; this route never changes per gateway.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/payments/[provider]">): Promise<Response> {
  const { provider } = await ctx.params;
  const rawBody = await request.text();
  const env = getServerEnv();

  try {
    const result = await processPaymentWebhook(
      {
        store: new SupabaseStore(createAdminClient(env)),
        resolveAdapters: (business) => resolveAdapters(business, env),
        clock: () => new Date(),
        log: (event, meta) => console.info(`[payments-webhook] ${event}`, JSON.stringify(meta)),
      },
      { provider, rawBody, headers: request.headers, query: new URL(request.url).searchParams },
    );
    return Response.json({ status: result.status, reason: result.reason }, { status: result.httpStatus });
  } catch (error) {
    // 500 → the gateway retries later; every side effect is idempotent.
    console.error("[payments-webhook] failed", { provider, error: error instanceof Error ? error.message : String(error) });
    return Response.json({ status: "error" }, { status: 500 });
  }
}
