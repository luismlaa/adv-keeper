import { createAzulPayments } from "@/lib/adapters/azul/payments";
import { createCardnetPayments } from "@/lib/adapters/cardnet/payments";
import type { CardnetSessionStore } from "@/lib/adapters/cardnet/session-store";
import type { FetchLike } from "@/lib/adapters/cardnet/http";
import type { PaymentProvider } from "@/lib/adapters/payments/types";
import type { ServerEnv } from "@/lib/config/env";
import type { IntegrationCredentials } from "@/lib/integrations/repo";
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

/** Per-request services the gateways need (built on the admin client in production, in memory in tests). */
export type GatewayServices = Pick<GatewayDeps, "credentials" | "cardnetSessions" | "logActivity" | "fetch" | "sleep">;

/**
 * Production wiring. Global env supplies only Keeper-level config (APP_URL, gateway base URLs);
 * merchant credentials always come from the business's encrypted `integrations` row.
 */
export function gatewayDepsFromEnv(
  env: Pick<ServerEnv, "APP_URL" | "AZUL_PAYMENT_PAGE_URL" | "CARDNET_API_URL">,
  services: GatewayServices,
): GatewayDeps {
  return {
    ...services,
    appUrl: env.APP_URL,
    azulPaymentPageUrl: env.AZUL_PAYMENT_PAGE_URL,
    cardnetApiUrl: env.CARDNET_API_URL,
  };
}
