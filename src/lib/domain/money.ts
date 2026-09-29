import type { DepositPolicy } from "@/lib/config/business-settings";

/** All money is integer minor units (centavos). Never floats across boundaries. */

export function computeDeposit(
  priceMinor: number,
  policy: DepositPolicy,
  overrideMinor: number | null = null,
): number {
  if (priceMinor <= 0) return 0;
  if (overrideMinor !== null) return Math.min(overrideMinor, priceMinor);
  const raw = (priceMinor * policy.percent) / 100;
  const rounded = Math.ceil(raw / policy.roundToMinor) * policy.roundToMinor;
  const withFloor = Math.max(rounded, policy.minimumMinor);
  return Math.min(withFloor, priceMinor);
}

export function formatMoney(amountMinor: number, currency: string, locale = "es-DO"): string {
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
  return currency === "DOP" ? formatted.replace(/^(DOP|RD\$)\s?/, "RD$") : formatted;
}
