/**
 * The owner types prices in pesos (RD$); we store integer centavos. Parsing is strict and never goes
 * through floating-point multiplication: "1,500.50" → 150050.
 */
export function parsePesosToMinor(raw: string): number | null {
  const cleaned = raw.trim().replace(/^RD\$\s*/i, "").replace(/\$/g, "").replace(/[\s,]/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const pesos = Number(match[1]);
  const centavos = Number((match[2] ?? "").padEnd(2, "0"));
  return pesos * 100 + centavos;
}

/** Inverse for form defaults: 150050 → "1500.50", 350000 → "3500". */
export function minorToPesosInput(minor: number): string {
  const pesos = Math.trunc(minor / 100);
  const centavos = Math.abs(minor % 100);
  return centavos === 0 ? String(pesos) : `${pesos}.${String(centavos).padStart(2, "0")}`;
}
