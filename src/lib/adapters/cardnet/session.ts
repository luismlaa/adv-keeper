import { paymentEventSchema, type PaymentEvent } from "../payments/types";
import type { CardnetCredentials } from "./credentials";

/**
 * Cardnet hosted checkout ("sessions" API): pure request builders and response interpretation, so a
 * correction to the spec touches this file alone.
 *
 * ⚠️ UNVERIFIED AGAINST A REAL SANDBOX. Flow and field names follow Cardnet's public integration guide
 * as reproduced by public integrations (lab.cardnet.com.do):
 *   1. POST {base}/sessions with the JSON below → `{ "SESSION": "...", "session-key": "..." }`.
 *   2. Browser form-POSTs `SESSION` to {base}/authorize (Cardnet's hosted page; card data stays there).
 *   3. Cardnet sends the browser back to ReturnUrl/CancelUrl (form field `SESSION`).
 *   4. Server asks GET {base}/sessions/{SESSION}?sk={session-key} for the result. That query, not the
 *      browser callback, is what we trust.
 * Uncertain: Amount/Tax format (we send 12-digit zero-padded minor units), whether the status response
 * echoes Amount/OrdenId/TransactionID (checked only when present), and approval = ResponseCode "00".
 */

export const CARDNET_SANDBOX_API_URL = "https://lab.cardnet.com.do";

const ISO_CURRENCY: Record<string, string> = { DOP: "214", USD: "840" };

/** 12-digit, zero-padded minor units (RD$200.00 → "000000020000"). */
export function formatCardnetAmount(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > 999_999_999_999) {
    throw new RangeError(`Invalid Cardnet amount ${amountMinor}`);
  }
  return String(amountMinor).padStart(12, "0");
}

export function parseCardnetAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value.trim())) return null;
  return Number.parseInt(value.trim(), 10);
}

/** Cardnet's page shows MerchantName in upper-case ASCII; strip accents so "Salón" survives. */
export function cardnetMerchantName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,&-]/g, "")
    .toUpperCase()
    .slice(0, 40)
    .trim();
}

/** ISO 4217 numeric code Cardnet expects ("214" = DOP). */
export function cardnetCurrencyCode(currency: string): string {
  const code = ISO_CURRENCY[currency];
  if (code === undefined) throw new RangeError(`Cardnet does not support currency ${currency}`);
  return code;
}

export interface CardnetSessionInput {
  credentials: CardnetCredentials;
  /** Our link id, sent as `OrdenId`. */
  linkId: string;
  /** 6-digit transaction number, unique per session. */
  transactionId: string;
  amountMinor: number;
  currency: string;
  returnUrl: string;
  cancelUrl: string;
}

export function buildCardnetSessionRequest(input: CardnetSessionInput): Record<string, string> {
  const currencyCode = cardnetCurrencyCode(input.currency);
  if (!/^\d{6}$/.test(input.transactionId)) throw new RangeError("Cardnet TransactionId must be 6 digits");
  const c = input.credentials;
  return {
    TransactionType: "0200", // sale
    CurrencyCode: currencyCode,
    AcquiringInstitutionCode: c.acquiringInstitutionCode,
    MerchantType: c.merchantType,
    MerchantNumber: c.merchantNumber,
    MerchantTerminal: c.merchantTerminal,
    ...(c.merchantTerminalAmex === undefined ? {} : { MerchantTerminal_amex: c.merchantTerminalAmex }),
    ReturnUrl: input.returnUrl,
    CancelUrl: input.cancelUrl,
    PageLanguaje: "ESP", // sic: Cardnet's field name
    OrdenId: input.linkId,
    TransactionId: input.transactionId,
    Tax: formatCardnetAmount(0),
    MerchantName: cardnetMerchantName(c.merchantName),
    Amount: formatCardnetAmount(input.amountMinor),
  };
}

export interface CardnetSessionCreated {
  session: string;
  sessionKey: string;
}

export function parseCardnetSessionResponse(body: unknown): CardnetSessionCreated | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const session = record.SESSION;
  const sessionKey = record["session-key"];
  if (typeof session !== "string" || typeof sessionKey !== "string") return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(session) || sessionKey.trim() === "") return null;
  return { session, sessionKey };
}

export function cardnetStatusUrl(apiUrl: string, session: string, sessionKey: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/sessions/${encodeURIComponent(session)}?sk=${encodeURIComponent(sessionKey)}`;
}

export interface CardnetExpected {
  linkId: string;
  session: string;
  transactionId: string;
  /** The amount WE put in the session (from the stored deposit). */
  amountMinor: number;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

function firstOf(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
  return undefined;
}

/**
 * Turns Cardnet's status-query response into a payment event, or null when it is unusable or
 * contradicts the session we created (different order/transaction). The amount reported by Cardnet
 * wins when present, so a mismatch reaches `BookingService` and is flagged for the owner.
 */
export function interpretCardnetStatus(body: unknown, expected: CardnetExpected): PaymentEvent | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const responseCode = str(record.ResponseCode);
  if (responseCode === undefined) return null;

  const orderId = str(firstOf(record, ["OrdenId", "OrdenID", "OrderId", "OrderID"]));
  if (orderId !== undefined && orderId !== expected.linkId) return null;
  const txnId = str(firstOf(record, ["TransactionId", "TransactionID"]));
  if (txnId !== undefined && txnId !== expected.transactionId) return null;

  const reported = firstOf(record, ["Amount", "amount"]);
  const amountMinor = reported === undefined ? expected.amountMinor : parseCardnetAmount(reported);
  if (amountMinor === null || amountMinor <= 0) return null;

  const approved = responseCode === "00";
  const providerTxnId =
    str(record.RetrivalReferenceNumber) ?? str(record.RetrievalReferenceNumber) ?? str(record.TxToken) ?? `session:${expected.session}`;
  const parsed = paymentEventSchema.safeParse({
    linkId: expected.linkId,
    providerTxnId,
    amountMinor,
    status: approved ? "paid" : "failed",
  });
  return parsed.success ? parsed.data : null;
}
