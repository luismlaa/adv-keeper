import { createHmac, timingSafeEqual } from "node:crypto";
import {
  paymentEventSchema,
  type DepositLink,
  type DepositLinkRequest,
  type PaymentEvent,
  type PaymentProvider,
} from "./types";

export const DEMO_SIGNATURE_HEADER = "x-keeper-demo-signature";

export function signDemoPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Simulated gateway for the demo tenant: links point at our own `/pay/demo/[linkId]` checkout, which
 * posts an HMAC-signed confirmation to the payments webhook — the same path a real gateway takes.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly kind = "fake" as const;

  constructor(
    private readonly appUrl: string,
    private readonly webhookSecret: string,
  ) {}

  async createDepositLink(request: DepositLinkRequest): Promise<DepositLink> {
    const linkId = `demo_${request.reference.slice(0, 8)}_${crypto.randomUUID().slice(0, 8)}`;
    return { linkId, url: `${this.appUrl.replace(/\/$/, "")}/pay/demo/${linkId}` };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null> {
    const provided = headers.get(DEMO_SIGNATURE_HEADER);
    if (provided === null || !/^[0-9a-f]+$/i.test(provided)) return null;
    const expected = Buffer.from(signDemoPayload(rawBody, this.webhookSecret), "hex");
    const actual = Buffer.from(provided, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
      const parsed = paymentEventSchema.safeParse(JSON.parse(rawBody));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
