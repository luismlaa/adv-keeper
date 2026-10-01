import type { SupabaseClient } from "@supabase/supabase-js";
import { createAzulPayments } from "@/lib/adapters/azul/payments";
import { createCardnetPayments } from "@/lib/adapters/cardnet/payments";
import { ActivityLogCardnetSessionStore, type CardnetSessionStore } from "@/lib/adapters/cardnet/session-store";
import type { FetchLike } from "@/lib/adapters/cardnet/http";
import type { PaymentProvider } from "@/lib/adapters/payments/types";
import type { ServerEnv } from "@/lib/config/env";
import { IntegrationCredentials, SupabaseIntegrationRepo } from "@/lib/integrations/repo";
import type { ActivityEntry, Business, Deposit } from "@/lib/schemas/entities";

export type LivePayProvider = "azul" | "cardnet";

export function isLivePayProvider(value: string): value is LivePayProvider {
  return value === "azul" || value === "cardnet";
}

export interface GatewayForm {
  action: string;
  fields: Record<string, string>;
}

/** One business's gateway: the `PaymentProvider` plus the hand-off the generic port doesn't cover. */
export interface PaymentGateway {
  provider: LivePayProvider;
  displayName: string;
  payments: PaymentProvider;
  buildHandoff(deposit: Deposit): Promise<GatewayForm>;
}

export interface GatewayDeps {
  appUrl: string;
  credentials: IntegrationCredentials;
  cardnetSessions: CardnetSessionStore;
  azulPaymentPageUrl?: string;
  cardnetApiUrl?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  logActivity?: (entry: ActivityEntry) => Promise<void>;
}

/** Builds the business's own gateway from its encrypted per-business credentials. */
export function createPaymentGateway(business: Business, deps: GatewayDeps): PaymentGateway | null {
  const base = { businessId: business.id, appUrl: deps.appUrl, credentials: deps.credentials };
  if (business.paymentProvider === "azul") {
    const azul = createAzulPayments({ ...base, paymentPageUrl: deps.azulPaymentPageUrl });
    return { provider: "azul", displayName: "Azul", payments: azul, buildHandoff: (d) => azul.buildPaymentForm(d) };
  }
  if (business.paymentProvider === "cardnet") {
    const cardnet = createCardnetPayments({
      ...base,
      apiUrl: deps.cardnetApiUrl,
      sessions: deps.cardnetSessions,
      fetch: deps.fetch,
      sleep: deps.sleep,
      logActivity: deps.logActivity,
    });
    return { provider: "cardnet", displayName: "Cardnet", payments: cardnet, buildHandoff: (d) => cardnet.startCheckout(d) };
  }
  return null;
}

/**
 * Production wiring. Global env supplies only Keeper-level config (APP_URL, gateway base URLs,
 * ENCRYPTION_KEY); merchant credentials always come from the business's `integrations` row.
 */
export function gatewayDepsFromEnv(
  env: ServerEnv,
  db: SupabaseClient,
  logActivity: (entry: ActivityEntry) => Promise<void>,
): GatewayDeps {
  return {
    appUrl: env.APP_URL,
    credentials: new IntegrationCredentials(new SupabaseIntegrationRepo(db), env.ENCRYPTION_KEY),
    cardnetSessions: new ActivityLogCardnetSessionStore(db, env.ENCRYPTION_KEY),
    azulPaymentPageUrl: env.AZUL_PAYMENT_PAGE_URL,
    cardnetApiUrl: env.CARDNET_API_URL,
    logActivity,
  };
}
