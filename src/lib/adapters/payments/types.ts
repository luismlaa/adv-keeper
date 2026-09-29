import { z } from "zod";

export interface DepositLinkRequest {
  /** Our appointment id — echoed back by the gateway so webhooks map to the booking. */
  reference: string;
  amountMinor: number;
  currency: string;
  description: string;
  expiresAt: Date;
  customerPhone: string;
}

export interface DepositLink {
  linkId: string;
  url: string;
}

export const paymentEventSchema = z.object({
  linkId: z.string().min(1),
  providerTxnId: z.string().min(1),
  amountMinor: z.number().int().positive(),
  status: z.enum(["paid", "failed"]),
});
export type PaymentEvent = z.infer<typeof paymentEventSchema>;

/**
 * Hosted-payment-page gateway (Azul Payment Page / Cardnet checkout). Keeper only creates links and
 * verifies confirmations — card data never touches our servers.
 */
export interface PaymentProvider {
  readonly kind: "fake" | "azul" | "cardnet";
  createDepositLink(request: DepositLinkRequest): Promise<DepositLink>;
  /** Returns the verified event, or null when the signature/authenticity check fails. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null>;
}
