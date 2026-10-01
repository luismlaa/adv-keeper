import type { PaymentProvider } from "./types";

/** A live business without a real gateway (Azul/Cardnet) configured. */
export class PaymentsUnavailableError extends Error {
  readonly code = "payments_not_configured" as const;

  constructor(readonly businessId: string) {
    super("El negocio no tiene pasarela de pago configurada (Azul o Cardnet)");
    this.name = "PaymentsUnavailableError";
  }
}

/**
 * Live businesses never fall back to the demo checkout (it would confirm bookings without real money):
 * creating a link fails loudly and no confirmation is ever accepted.
 */
export function unavailablePayments(businessId: string): PaymentProvider {
  return {
    kind: "fake",
    async createDepositLink() {
      throw new PaymentsUnavailableError(businessId);
    },
    async verifyWebhook() {
      return null;
    },
  };
}
