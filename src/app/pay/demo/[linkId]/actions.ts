"use server";

import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { buildDemoPaymentRequest, isDemoCheckoutExpired, loadDemoCheckout } from "@/lib/demo/checkout";
import { SupabaseStore } from "@/lib/store/supabase";

export interface PayState {
  error: string | null;
}

/**
 * "Pagar anticipo" on the simulated checkout. The amount is re-read from the deposit (never from the
 * form) and the confirmation travels through the real payments webhook with an HMAC signature.
 */
export async function payDemoDeposit(_prev: PayState, formData: FormData): Promise<PayState> {
  const linkId = formData.get("linkId");
  if (typeof linkId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(linkId)) return { error: "Link de pago inválido." };

  const env = getServerEnv();
  const view = await loadDemoCheckout(new SupabaseStore(createAdminClient(env)), linkId);
  if (!view) return { error: "Este link de pago no existe o ya no está disponible." };
  if (isDemoCheckoutExpired(view, new Date())) {
    return { error: "Este link venció. Pídele a Keeper un horario nuevo en el chat." };
  }

  if (view.depositStatus === "pending") {
    const { body, headers } = buildDemoPaymentRequest(view, env.DEMO_PAYMENT_WEBHOOK_SECRET, `demo_txn_${view.linkId}`);
    let response: Response;
    try {
      response = await fetch(`${env.APP_URL.replace(/\/$/, "")}/api/webhooks/payments/fake`, {
        method: "POST",
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      console.error("[demo-checkout] webhook call failed", { linkId, error: error instanceof Error ? error.message : String(error) });
      return { error: "No pudimos procesar el pago simulado. Intenta de nuevo." };
    }
    if (!response.ok) {
      console.error("[demo-checkout] webhook rejected", { linkId, status: response.status });
      return { error: "No pudimos procesar el pago simulado. Intenta de nuevo." };
    }
  }

  redirect(`/pay/demo/${encodeURIComponent(linkId)}`);
}
