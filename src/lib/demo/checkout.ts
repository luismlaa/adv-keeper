import { DEMO_SIGNATURE_HEADER, signDemoPayload } from "@/lib/adapters/payments/fake";
import type { PaymentEvent } from "@/lib/adapters/payments/types";
import { resolveBusinessSettings } from "@/lib/config/business-settings";
import { formatMoney } from "@/lib/domain/money";
import { formatLocal } from "@/lib/domain/time";
import type { Appointment, Deposit } from "@/lib/schemas/entities";
import type { KeeperStore } from "@/lib/store/types";

export interface DemoCheckoutView {
  linkId: string;
  businessName: string;
  businessSlug: string;
  serviceName: string;
  appointmentLabel: string;
  amountMinor: number;
  amountLabel: string;
  depositStatus: Deposit["status"];
  appointmentStatus: Appointment["status"];
  expiresAt: string;
}

/**
 * Everything the simulated checkout shows, read from the store (never from the URL).
 * Returns null when the link doesn't exist or doesn't belong to a demo business on the fake gateway.
 */
export async function loadDemoCheckout(store: KeeperStore, linkId: string): Promise<DemoCheckoutView | null> {
  const deposit = await store.getDepositByLinkId(linkId);
  if (!deposit || deposit.provider !== "fake") return null;
  const business = await store.getBusinessById(deposit.businessId);
  if (!business || business.integrationMode !== "demo" || business.paymentProvider !== "fake") return null;
  const appointment = await store.getAppointment(business.id, deposit.appointmentId);
  if (!appointment) return null;
  const service = await store.getService(business.id, appointment.serviceId);
  const settings = resolveBusinessSettings(business.settings);
  return {
    linkId: deposit.linkId,
    businessName: business.name,
    businessSlug: business.slug,
    serviceName: service?.name ?? "Servicio",
    appointmentLabel: formatLocal(new Date(appointment.startsAt), settings.timezone),
    amountMinor: deposit.amountMinor,
    amountLabel: formatMoney(deposit.amountMinor, deposit.currency),
    depositStatus: deposit.status,
    appointmentStatus: appointment.status,
    expiresAt: deposit.expiresAt,
  };
}

/**
 * A pending link can no longer be paid once its hold is gone or its window elapsed — even if the
 * holds-expiry cron hasn't run yet (it only runs daily on Vercel Hobby).
 */
export function isDemoCheckoutExpired(view: Pick<DemoCheckoutView, "depositStatus" | "appointmentStatus" | "expiresAt">, now: Date): boolean {
  if (view.depositStatus === "paid") return false;
  if (view.depositStatus !== "pending") return true;
  return view.appointmentStatus !== "hold_pending_deposit" || new Date(view.expiresAt).getTime() <= now.getTime();
}

/** The signed request the simulated checkout sends to the payments webhook — same shape a gateway uses. */
export function buildDemoPaymentRequest(
  view: Pick<DemoCheckoutView, "linkId" | "amountMinor">,
  secret: string,
  providerTxnId: string,
): { body: string; headers: Record<string, string> } {
  const event: PaymentEvent = { linkId: view.linkId, providerTxnId, amountMinor: view.amountMinor, status: "paid" };
  const body = JSON.stringify(event);
  return { body, headers: { "content-type": "application/json", [DEMO_SIGNATURE_HEADER]: signDemoPayload(body, secret) } };
}
