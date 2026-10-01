import { randomBytes } from "node:crypto";
import type { IntegrationCredentials } from "@/lib/integrations/repo";
import type { Deposit } from "@/lib/schemas/entities";
import { paymentEventSchema, type DepositLink, type DepositLinkRequest, type PaymentEvent, type PaymentProvider } from "../payments/types";
import { azulCredentialsSchema, type AzulCredentials } from "./credentials";
import { azulCurrencyCode, formatAzulAmount, parseAzulAmount, signAzulRequest, verifyAzulResponseHash } from "./hash";

/** ⚠️ Sandbox Payment Page URL from Azul's docs; production is `https://pagos.azul.com.do/PaymentPage/Default.aspx`. */
export const AZUL_SANDBOX_PAYMENT_PAGE_URL = "https://pruebas.azul.com.do/PaymentPage/";

export type AzulOutcome = "approved" | "declined" | "cancel";

export class AzulNotConfiguredError extends Error {
  constructor(businessId: string) {
    super(`Business ${businessId} has no Azul credentials — connect Azul in Ajustes`);
    this.name = "AzulNotConfiguredError";
  }
}

export interface AzulPaymentsOptions {
  businessId: string;
  /** Keeper's public URL: deposit links and Azul's return URLs live on our own domain. */
  appUrl: string;
  /** Gateway base URL (global env `AZUL_PAYMENT_PAGE_URL`); defaults to the sandbox. */
  paymentPageUrl?: string;
  credentials: IntegrationCredentials;
}

/** The auto-submitting form that hands the client to Azul's hosted page. Contains no card data. */
export interface AzulPaymentForm {
  action: string;
  fields: Record<string, string>;
}

export interface AzulPayments extends PaymentProvider {
  readonly kind: "azul";
  buildPaymentForm(deposit: Pick<Deposit, "linkId" | "amountMinor" | "currency">): Promise<AzulPaymentForm>;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export function azulReturnUrl(appUrl: string, linkId: string, outcome: AzulOutcome): string {
  return `${trimSlash(appUrl)}/api/pay/azul/${encodeURIComponent(linkId)}/return/${outcome}`;
}

/**
 * Link ids double as Azul's `OrderNumber`. ⚠️ We keep them to 15 alphanumeric characters because the
 * docs we know cap OrderNumber at 15; confirm the limit in the sandbox.
 */
export function newAzulLinkId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  return `az${Array.from(randomBytes(13), (b) => alphabet[b % alphabet.length]).join("")}`;
}

/** Response fields arrive as a query string (browser redirect) or a form post; both parse the same way. */
export function parseAzulFields(rawBody: string): Record<string, string> {
  const trimmed = rawBody.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(trimmed));
}

/**
 * Maps hash-verified Azul response fields to a payment event. Approval = `IsoCode` "00" (⚠️ to confirm;
 * `ResponseMessage` "APROBADA" is informative only). The txn id is the hashed `RRN`, so it cannot be
 * swapped without breaking the hash.
 */
export function azulFieldsToEvent(fields: Readonly<Record<string, string>>): PaymentEvent | null {
  const linkId = fields.OrderNumber?.trim();
  const amountMinor = parseAzulAmount(fields.Amount);
  if (!linkId || amountMinor === null || amountMinor <= 0) return null;
  const approved = fields.IsoCode === "00";
  const rrn = fields.RRN?.trim();
  const providerTxnId = rrn ? rrn : `${approved ? "auth" : "declined"}:${linkId}:${fields.AuthorizationCode ?? ""}:${fields.DateTime ?? ""}`;
  const parsed = paymentEventSchema.safeParse({ linkId, providerTxnId, amountMinor, status: approved ? "paid" : "failed" });
  return parsed.success ? parsed.data : null;
}

/**
 * Azul Payment Page adapter. Deposit links point at our hand-off route, which posts a signed form to
 * Azul; Azul redirects the browser back with a hashed result that `verifyWebhook` checks.
 */
export function createAzulPayments(options: AzulPaymentsOptions): AzulPayments {
  const { businessId, appUrl, credentials } = options;
  const paymentPageUrl = options.paymentPageUrl ?? AZUL_SANDBOX_PAYMENT_PAGE_URL;

  const loadCredentials = (): Promise<AzulCredentials | null> => credentials.read(businessId, "azul", azulCredentialsSchema);
  const requireCredentials = async (): Promise<AzulCredentials> => {
    const creds = await loadCredentials();
    if (creds === null) throw new AzulNotConfiguredError(businessId);
    return creds;
  };

  return {
    kind: "azul",

    async createDepositLink(request: DepositLinkRequest): Promise<DepositLink> {
      await requireCredentials(); // fail before the client gets a link that can never be paid
      azulCurrencyCode(request.currency);
      const linkId = newAzulLinkId();
      return { linkId, url: `${trimSlash(appUrl)}/api/pay/azul/${linkId}` };
    },

    async buildPaymentForm(deposit) {
      const creds = await requireCredentials();
      const hashed = {
        MerchantId: creds.merchantId,
        MerchantName: creds.merchantName,
        MerchantType: creds.merchantType,
        CurrencyCode: azulCurrencyCode(deposit.currency),
        OrderNumber: deposit.linkId,
        Amount: formatAzulAmount(deposit.amountMinor),
        ITBIS: formatAzulAmount(0), // a deposit carries no separate tax line
        ApprovedUrl: azulReturnUrl(appUrl, deposit.linkId, "approved"),
        DeclinedUrl: azulReturnUrl(appUrl, deposit.linkId, "declined"),
        CancelUrl: azulReturnUrl(appUrl, deposit.linkId, "cancel"),
        UseCustomField1: "0",
        CustomField1Label: "",
        CustomField1Value: "",
        UseCustomField2: "0",
        CustomField2Label: "",
        CustomField2Value: "",
      };
      return {
        action: paymentPageUrl,
        fields: {
          ...hashed,
          AuthHash: signAzulRequest(hashed, creds.authKey),
          // Not part of the hash (per public samples): ⚠️ confirm Azul still expects them.
          TerminalId: creds.terminalId,
          CustomOrderId: deposit.linkId,
          ShowTransactionResult: "0",
          Locale: "ES",
        },
      };
    },

    async verifyWebhook(rawBody: string): Promise<PaymentEvent | null> {
      const fields = parseAzulFields(rawBody);
      if (!fields.AuthHash) return null; // never trust an unsigned callback
      const creds = await loadCredentials();
      if (creds === null || !verifyAzulResponseHash(fields, creds.authKey)) return null;
      return azulFieldsToEvent(fields);
    },
  };
}
