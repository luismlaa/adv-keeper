import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Azul Payment Page AuthHash: pure functions only, so a correction to the spec touches this file alone.
 *
 * ⚠️ UNVERIFIED AGAINST A REAL SANDBOX. Built from Azul's Payment Page developer documentation as
 * reproduced by public integrations (azul-go `hmac.go`, older WooCommerce/Ruby plugins). Azul publishes
 * no test vector we could check offline. Validate with the first client's sandbox credentials:
 *   1. Request hash = HMAC-SHA512(key = AuthKey, data = the 16 fields below concatenated + AuthKey).
 *      Older plugins used plain SHA-512 (no HMAC) over the same string; the 2023 docs say HMAC.
 *   2. Text encoding of the hashed string: UTF-8 here (azul-go). Azul's PHP sample converts to
 *      UTF-16LE first (`mb_convert_encoding($s, 'UTF-16LE', 'ASCII')`). Request encoding is one constant
 *      (`AZUL_REQUEST_ENCODING`); response verification accepts either encoding (both need the key).
 *   3. Response hash order = OrderNumber, Amount, AuthorizationCode, DateTime, ResponseCode, IsoCode,
 *      ResponseMessage, ErrorDescription, RRN, then AuthKey. Public integrations disagree on whether
 *      DateTime and ErrorDescription are included; we accept only this documented "full" order.
 *   4. Hex case: we send lowercase and compare case-insensitively.
 */

export type HashEncoding = "utf8" | "utf16le";

/** Exact concatenation order of the Payment Page request hash. */
export const AZUL_REQUEST_HASH_FIELDS = [
  "MerchantId",
  "MerchantName",
  "MerchantType",
  "CurrencyCode",
  "OrderNumber",
  "Amount",
  "ITBIS",
  "ApprovedUrl",
  "DeclinedUrl",
  "CancelUrl",
  "UseCustomField1",
  "CustomField1Label",
  "CustomField1Value",
  "UseCustomField2",
  "CustomField2Label",
  "CustomField2Value",
] as const;
export type AzulRequestHashField = (typeof AZUL_REQUEST_HASH_FIELDS)[number];

/** Exact concatenation order of the hash Azul appends to the Approved/Declined/Cancel redirect. */
export const AZUL_RESPONSE_HASH_FIELDS = [
  "OrderNumber",
  "Amount",
  "AuthorizationCode",
  "DateTime",
  "ResponseCode",
  "IsoCode",
  "ResponseMessage",
  "ErrorDescription",
  "RRN",
] as const;

export const AZUL_REQUEST_ENCODING: HashEncoding = "utf8";

/** The string that gets hashed: the ordered field values (missing → "") followed by the AuthKey. */
export function azulHashInput(order: readonly string[], fields: Readonly<Record<string, string | undefined>>, authKey: string): string {
  return order.map((name) => fields[name] ?? "").join("") + authKey.trim();
}

export function hmacSha512Hex(key: string, data: string, encoding: HashEncoding): string {
  return createHmac("sha512", Buffer.from(key.trim(), "utf8")).update(Buffer.from(data, encoding)).digest("hex");
}

export function signAzulRequest(
  fields: Readonly<Record<AzulRequestHashField, string>>,
  authKey: string,
  encoding: HashEncoding = AZUL_REQUEST_ENCODING,
): string {
  return hmacSha512Hex(authKey, azulHashInput(AZUL_REQUEST_HASH_FIELDS, fields, authKey), encoding);
}

function hexEquals(expectedHex: string, providedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(providedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(providedHex, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** True only when `AuthHash` is present and matches the response fields under our merchant's AuthKey. */
export function verifyAzulResponseHash(fields: Readonly<Record<string, string | undefined>>, authKey: string): boolean {
  const provided = fields.AuthHash?.trim() ?? "";
  if (provided === "" || authKey.trim() === "") return false;
  const input = azulHashInput(AZUL_RESPONSE_HASH_FIELDS, fields, authKey);
  return (["utf8", "utf16le"] as const).some((encoding) => hexEquals(hmacSha512Hex(authKey, input, encoding), provided));
}

/** Azul amounts: integer minor units without separators, at least 3 digits ("000" for zero). */
export function formatAzulAmount(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError(`Invalid Azul amount ${amountMinor}`);
  return String(amountMinor).padStart(3, "0");
}

/** Inverse of `formatAzulAmount`; null for anything that is not a plain digit string. */
export function parseAzulAmount(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,15}$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

/**
 * Azul `CurrencyCode`: "$" means Dominican pesos. ⚠️ "USD" for dollars is an assumption to validate.
 */
export function azulCurrencyCode(currency: string): string {
  if (currency === "DOP") return "$";
  if (currency === "USD") return "USD";
  throw new RangeError(`Azul Payment Page does not support currency ${currency}`);
}
