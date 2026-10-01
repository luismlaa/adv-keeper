import { CardnetUnavailableError } from "@/lib/adapters/cardnet/payments";
import type { Adapters } from "@/lib/adapters/registry";
import { isDemoCheckoutExpired } from "@/lib/demo/checkout";
import { processPaymentWebhook, type PaymentWebhookResult } from "@/lib/demo/payment-webhook";
import { formatMoney } from "@/lib/domain/money";
import type { Appointment, Business, Deposit } from "@/lib/schemas/entities";
import type { KeeperStore } from "@/lib/store/types";
import { isLivePayProvider, type GatewayForm, type LivePayProvider, type PaymentGateway } from "./gateways";
import type { PayPage, PayPageContext } from "./html";

export interface PayFlowDeps {
  store: KeeperStore;
  clock: () => Date;
  appUrl: string;
  /** The business's live gateway (Azul or Cardnet) built from its own credentials. */
  gatewayFor: (business: Business) => PaymentGateway | null;
  log?: (event: string, meta: Record<string, unknown>) => void;
}

export interface ReturnDeps extends PayFlowDeps {
  /** Full adapter set (calendar too: confirming creates the calendar event). Payments is overridden. */
  resolveAdapters: (business: Business) => Adapters;
}

export type PageOutcome = { kind: "page"; page: PayPage; status: number };
export type HandoffOutcome = PageOutcome | { kind: "form"; form: GatewayForm; gatewayName: string };

const LINK_ID = /^[A-Za-z0-9_-]{1,128}$/;
const NOT_FOUND: PageOutcome = { kind: "page", page: { kind: "not_found" }, status: 404 };

interface PayContext {
  provider: LivePayProvider;
  deposit: Deposit;
  business: Business;
  appointment: Appointment;
  gateway: PaymentGateway;
  view: PayPageContext;
}

/** Everything comes from the store; the URL only names the link. Wrong provider = not found. */
async function loadPayContext(deps: PayFlowDeps, provider: string, linkId: string): Promise<PayContext | null> {
  if (!isLivePayProvider(provider) || !LINK_ID.test(linkId)) return null;
  const deposit = await deps.store.getDepositByLinkId(linkId);
  if (!deposit || deposit.provider !== provider) return null;
  const business = await deps.store.getBusinessById(deposit.businessId);
  if (!business || business.paymentProvider !== provider) return null;
  const appointment = await deps.store.getAppointment(business.id, deposit.appointmentId);
  if (!appointment) return null;
  const gateway = deps.gatewayFor(business);
  if (!gateway || gateway.provider !== provider) return null;
  const view: PayPageContext = {
    businessName: business.name,
    amountLabel: formatMoney(deposit.amountMinor, deposit.currency),
    retryUrl: `${deps.appUrl.replace(/\/+$/, "")}/api/pay/${provider}/${encodeURIComponent(deposit.linkId)}`,
  };
  return { provider, deposit, business, appointment, gateway, view };
}

const isExpired = (deposit: Deposit, appointment: Appointment, now: Date) =>
  isDemoCheckoutExpired({ depositStatus: deposit.status, appointmentStatus: appointment.status, expiresAt: deposit.expiresAt }, now);

const paidPage = (appointment: Appointment, view: PayPageContext): PageOutcome => ({
  kind: "page",
  page: { kind: "paid", confirmed: appointment.status === "confirmed" || appointment.status === "completed", context: view },
  status: 200,
});

const expiredPage = (view: PayPageContext): PageOutcome => ({ kind: "page", page: { kind: "expired", context: view }, status: 410 });

/**
 * GET /api/pay/<provider>/<linkId>: the link the client receives. Paid → receipt, expired → friendly
 * refusal, otherwise the gateway hand-off (Azul signed form / Cardnet session) for the stored amount.
 */
export async function prepareHandoff(deps: PayFlowDeps, provider: string, linkId: string): Promise<HandoffOutcome> {
  const ctx = await loadPayContext(deps, provider, linkId);
  if (ctx === null) return NOT_FOUND;
  const { deposit, appointment, business, gateway, view } = ctx;
  if (deposit.status === "paid") return paidPage(appointment, view);
  if (isExpired(deposit, appointment, deps.clock())) return expiredPage(view);

  try {
    const form = await gateway.buildHandoff(deposit);
    if (ctx.provider === "azul") {
      await deps.store.logActivity({
        businessId: business.id,
        actor: "payments",
        entity: "deposit",
        entityId: deposit.id,
        action: "payment_handoff",
        reason: "Client sent to the Azul Payment Page to pay the deposit",
        meta: { provider: "azul", linkId: deposit.linkId },
      });
    }
    return { kind: "form", form, gatewayName: gateway.displayName };
  } catch (error) {
    deps.log?.("pay_handoff.failed", { provider, linkId, businessId: business.id, error: error instanceof Error ? error.name : "unknown" });
    return { kind: "page", page: { kind: "unavailable", context: view }, status: 503 };
  }
}

const OUTCOMES: Record<LivePayProvider, readonly string[]> = {
  azul: ["approved", "declined", "cancel"],
  cardnet: ["approved", "cancel"],
};

/** What we hand to `processPaymentWebhook`: only the fields the provider's verifier reads. */
function verificationBody(provider: LivePayProvider, linkId: string, fields: URLSearchParams): string | null {
  if (provider === "azul") {
    // Azul's hashed OrderNumber IS our link id; a redirect for another order is not ours to process.
    if (fields.get("OrderNumber") !== linkId) return null;
    const copy = new URLSearchParams(fields);
    copy.delete("linkId");
    return copy.toString();
  }
  const body = new URLSearchParams({ linkId });
  const session = fields.get("SESSION");
  if (session) body.set("SESSION", session);
  return body.toString();
}

const UNVERIFIED_STATUSES: ReadonlySet<PaymentWebhookResult["status"]> = new Set([
  "invalid_signature",
  "link_mismatch",
  "provider_mismatch",
  "missing_link_id",
]);

/**
 * /api/pay/<provider>/<linkId>/return/<outcome>: the browser comes back from the gateway. The
 * callback is untrusted: it ends in `processPaymentWebhook`, which verifies it with the business's
 * adapter (Azul AuthHash / Cardnet status query) and lets `BookingService` check amount + idempotency.
 */
export async function handleGatewayReturn(
  deps: ReturnDeps,
  input: { provider: string; linkId: string; outcome: string; fields: URLSearchParams },
): Promise<PageOutcome & { result?: PaymentWebhookResult }> {
  const ctx = await loadPayContext(deps, input.provider, input.linkId);
  if (ctx === null || !OUTCOMES[ctx.provider].includes(input.outcome)) return NOT_FOUND;
  const { provider, deposit, appointment, business, gateway, view } = ctx;

  if (deposit.status === "paid") return paidPage(appointment, view); // duplicate return: nothing to do
  if (input.outcome === "cancel") {
    return isExpired(deposit, appointment, deps.clock()) ? expiredPage(view) : { kind: "page", page: { kind: "not_completed", context: view }, status: 200 };
  }

  const rawBody = verificationBody(provider, deposit.linkId, input.fields);
  if (rawBody === null) {
    await deps.store.logActivity({
      businessId: business.id,
      actor: "payments",
      entity: "deposit",
      entityId: deposit.id,
      action: "payment_return_mismatch",
      reason: "Gateway return carried another order number — ignored, nothing changed",
      meta: { provider, linkId: deposit.linkId },
    });
    return { kind: "page", page: { kind: "unverified", context: view }, status: 400 };
  }

  let result: PaymentWebhookResult;
  try {
    result = await processPaymentWebhook(
      {
        store: deps.store,
        resolveAdapters: (b) => ({ ...deps.resolveAdapters(b), payments: gateway.payments }),
        clock: deps.clock,
        log: deps.log,
      },
      { provider, rawBody, headers: new Headers() },
    );
  } catch (error) {
    if (error instanceof CardnetUnavailableError) return { kind: "page", page: { kind: "unavailable", context: view }, status: 503 };
    throw error;
  }

  const [freshDeposit, freshAppointment] = await Promise.all([
    deps.store.getDepositByLinkId(deposit.linkId),
    deps.store.getAppointment(business.id, appointment.id),
  ]);
  if (freshDeposit?.status === "paid" && freshAppointment) return { ...paidPage(freshAppointment, view), result };
  if (UNVERIFIED_STATUSES.has(result.status) || result.reason === "amount_mismatch") {
    return { kind: "page", page: { kind: "unverified", context: view }, status: result.httpStatus, result };
  }
  if (isExpired(freshDeposit ?? deposit, freshAppointment ?? appointment, deps.clock())) return { ...expiredPage(view), result };
  return { kind: "page", page: { kind: "not_completed", context: view }, status: 200, result };
}
