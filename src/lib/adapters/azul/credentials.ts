import { z } from "zod";

/**
 * Per-business Azul merchant credentials, stored encrypted in `integrations` (provider `azul`).
 * Each spa is its own Azul merchant; Keeper never holds a shared merchant account.
 */
export const azulCredentialsSchema = z.strictObject({
  merchantId: z.string().trim().min(1),
  /** Name shown on the Payment Page, exactly as Azul registered it (it is part of the AuthHash). */
  merchantName: z.string().trim().min(1),
  /** Azul calls this the merchant type; their samples use "ECommerce". */
  merchantType: z.string().trim().min(1).default("ECommerce"),
  /** HMAC key for the AuthHash. Secret. */
  authKey: z.string().trim().min(1),
  /** Sent as `TerminalId` (not hashed). ⚠️ Default "00000001" comes from public samples. */
  terminalId: z.string().trim().min(1).default("00000001"),
});
export type AzulCredentials = z.infer<typeof azulCredentialsSchema>;
