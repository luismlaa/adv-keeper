import type { Adapters } from "@/lib/adapters/registry";
import { BookingService, type PaymentOutcome } from "@/lib/booking/booking-service";
import { paymentProviderSchema, type Business, type Deposit } from "@/lib/schemas/entities";
import type { KeeperStore } from "@/lib/store/types";

export type PaymentProviderKind = Business["paymentProvider"];

export interface PaymentWebhookDeps {
  store: KeeperStore;
  /** Resolves the business's adapters (demo → fakes, live → gateway). Injected so tests stay offline. */
  resolveAdapters: (business: Business) => Adapters;
  clock: () => Date;
  /** Operational log (stdout). Business-context events also go to activity_log via the store. */
  log?: (event: string, meta: Record<string, unknown>) => void;
}

export interface PaymentWebhookInput {
  /** The `[provider]` route segment, untrusted. */
  provider: string;
  rawBody: string;
  headers: Headers;
  /** Query string of the webhook URL — some gateways put the order id there. */
  query?: URLSearchParams;
}

export type PaymentWebhookStatus =
  | "confirmed"
  | "already_processed"
  | "ignored"
  | "unknown_provider"
  | "missing_link_id"
  | "provider_mismatch"
  | "invalid_signature"
  | "link_mismatch";

export interface PaymentWebhookResult {
  httpStatus: 200 | 400 | 401 | 404;
  status: PaymentWebhookStatus;
  reason?: string;
}

/**
 * Field names under which each gateway echoes our link id. Parsing is deliberately lenient: this only
 * locates the deposit so we know whose adapter must verify the payload. Nothing here is trusted until
 * `verifyWebhook` accepts the signature.
 */
const LINK_ID_KEYS: Record<PaymentProviderKind, readonly string[]> = {
  fake: ["linkId"],
  azul: ["linkId", "CustomOrderId", "OrderNumber", "orderNumber"],
  cardnet: ["linkId", "OrdenId", "OrderId", "orderId", "Reference"],
};
const GENERIC_LINK_ID_KEYS = ["linkId", "link_id", "reference"] as const;

function flatFields(rawBody: string): Record<string, unknown> {
  const trimmed = rawBody.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // fall through to form parsing
    }
    return {};
  }
  return Object.fromEntries(new URLSearchParams(trimmed));
}

/** Best-effort link id extraction from a JSON or form-encoded body (or the query string). */
export function extractLinkId(provider: PaymentProviderKind, rawBody: string, query?: URLSearchParams): string | null {
  const fields = flatFields(rawBody);
  const keys = [...LINK_ID_KEYS[provider], ...GENERIC_LINK_ID_KEYS];
  for (const key of keys) {
    const fromBody = fields[key];
    if (typeof fromBody === "string" && fromBody.trim() !== "") return fromBody.trim();
    const fromQuery = query?.get(key);
    if (fromQuery) return fromQuery.trim();
  }
  return null;
}

function outcomeResult(outcome: PaymentOutcome): PaymentWebhookResult {
  switch (outcome.status) {
    case "confirmed":
      return { httpStatus: 200, status: "confirmed" };
    case "already_processed":
      return { httpStatus: 200, status: "already_processed" };
    case "ignored":
      return { httpStatus: 200, status: "ignored", reason: outcome.reason };
  }
}

/**
 * Payments webhook use-case, shared by every gateway (`/api/webhooks/payments/[provider]`):
 * locate the deposit by link id → load its business → check the route provider matches → verify the
 * signature with the business's adapter → hand the verified event to `BookingService.handlePaymentEvent`.
 *
 * HTTP semantics: 200 for processed, duplicate or ignored events (so gateways stop retrying),
 * 401 for a bad signature (nothing changes), 400 for malformed/misrouted calls, 404 for unknown providers.
 */
export async function processPaymentWebhook(
  deps: PaymentWebhookDeps,
  input: PaymentWebhookInput,
): Promise<PaymentWebhookResult> {
  const log = deps.log ?? (() => undefined);
  const provider = paymentProviderSchema.safeParse(input.provider);
  if (!provider.success) {
    log("payment_webhook.unknown_provider", { provider: input.provider });
    return { httpStatus: 404, status: "unknown_provider" };
  }

  const linkId = extractLinkId(provider.data, input.rawBody, input.query);
  if (linkId === null) {
    log("payment_webhook.missing_link_id", { provider: provider.data });
    return { httpStatus: 400, status: "missing_link_id" };
  }

  const deposit: Deposit | null = await deps.store.getDepositByLinkId(linkId);
  if (!deposit) {
    // Nothing to change and nothing we could verify against: acknowledge so the gateway stops retrying.
    log("payment_webhook.unknown_link", { provider: provider.data, linkId });
    return { httpStatus: 200, status: "ignored", reason: "unknown_link" };
  }

  const business = await deps.store.getBusinessById(deposit.businessId);
  if (!business) {
    log("payment_webhook.business_missing", { linkId, businessId: deposit.businessId });
    return { httpStatus: 200, status: "ignored", reason: "business_missing" };
  }

  const context = { provider: provider.data, linkId, businessId: business.id, depositId: deposit.id };
  if (business.paymentProvider !== provider.data || deposit.provider !== provider.data) {
    log("payment_webhook.provider_mismatch", { ...context, businessProvider: business.paymentProvider, depositProvider: deposit.provider });
    await deps.store.logActivity({
      businessId: business.id,
      actor: "payments",
      entity: "deposit",
      entityId: deposit.id,
      action: "webhook_provider_mismatch",
      reason: `Webhook arrived on the ${provider.data} route but the business uses ${business.paymentProvider} — rejected`,
      meta: { routeProvider: provider.data, businessProvider: business.paymentProvider, depositProvider: deposit.provider },
    });
    return { httpStatus: 400, status: "provider_mismatch" };
  }

  const adapters = deps.resolveAdapters(business);
  const event = await adapters.payments.verifyWebhook(input.rawBody, input.headers);
  if (event === null) {
    log("payment_webhook.invalid_signature", context);
    await deps.store.logActivity({
      businessId: business.id,
      actor: "payments",
      entity: "deposit",
      entityId: deposit.id,
      action: "webhook_signature_invalid",
      reason: "Payment confirmation failed signature verification — ignored, nothing changed",
      meta: { provider: provider.data, linkId },
    });
    return { httpStatus: 401, status: "invalid_signature" };
  }
  if (event.linkId !== deposit.linkId) {
    log("payment_webhook.link_mismatch", { ...context, eventLinkId: event.linkId });
    return { httpStatus: 400, status: "link_mismatch" };
  }

  const booking = new BookingService({ store: deps.store, adapters, clock: deps.clock });
  const outcome = await booking.handlePaymentEvent(event);
  const result = outcomeResult(outcome);
  log("payment_webhook.processed", { ...context, outcome: result.status, reason: result.reason, providerTxnId: event.providerTxnId });
  return result;
}
