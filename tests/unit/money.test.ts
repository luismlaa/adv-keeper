import { describe, expect, it } from "vitest";
import { computeDeposit, formatMoney } from "@/lib/domain/money";

const policy = { percent: 30, minimumMinor: 50000, roundToMinor: 5000 };

describe("computeDeposit", () => {
  it("takes the percentage and rounds up to the configured step", () => {
    expect(computeDeposit(350000, policy)).toBe(105000); // 30% of RD$3,500 = RD$1,050
    expect(computeDeposit(380000, policy)).toBe(115000); // RD$1,140 → RD$1,150
  });

  it("applies the minimum but never exceeds the price", () => {
    expect(computeDeposit(150000, policy)).toBe(50000);
    expect(computeDeposit(30000, policy)).toBe(30000);
  });

  it("honours a per-service override, capped at the price", () => {
    expect(computeDeposit(350000, policy, 100000)).toBe(100000);
    expect(computeDeposit(80000, policy, 100000)).toBe(80000);
  });

  it("is zero for free services", () => {
    expect(computeDeposit(0, policy)).toBe(0);
  });
});

describe("formatMoney", () => {
  it("formats DOP as RD$", () => {
    expect(formatMoney(350000, "DOP")).toMatch(/^RD\$\s?3,500$/);
  });
});
