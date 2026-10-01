import { z } from "zod";

/**
 * Per-business Cardnet merchant data, stored encrypted in `integrations` (provider `cardnet`).
 * ⚠️ Cardnet's hosted-checkout session API, as publicly documented, takes no API secret: the merchant
 * number + terminal identify the merchant and the per-session `session-key` protects the status query.
 * Confirm with Cardnet whether an API key/IP allowlist is required for production.
 */
export const cardnetCredentialsSchema = z.strictObject({
  merchantNumber: z.string().trim().regex(/^\d+$/),
  merchantTerminal: z.string().trim().regex(/^\d+$/),
  /** Optional separate terminal for Amex (Cardnet's `MerchantTerminal_amex`). */
  merchantTerminalAmex: z.string().trim().regex(/^\d+$/).optional(),
  merchantName: z.string().trim().min(1),
  /** The merchant category code Cardnet assigned at affiliation (their samples use "7997"). */
  merchantType: z.string().trim().regex(/^\d{4}$/),
  /** ⚠️ "349" (Cardnet as acquirer) in every public sample. */
  acquiringInstitutionCode: z.string().trim().regex(/^\d+$/).default("349"),
});
export type CardnetCredentials = z.infer<typeof cardnetCredentialsSchema>;
