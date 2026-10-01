import { describe, expect, it, vi } from "vitest";
import { runDemoReset, type DemoResetEnv } from "@/lib/demo/reset";
import type { SeedDemoOptions } from "@/lib/demo/seed";
import { checkDemoBudgetExhausted, startOfLocalDay, type DemoBudgetDeps } from "@/lib/rate-limit/demo-budget";
import { NOW } from "../helpers/fixtures";

const env: DemoResetEnv = {
  CRON_SECRET: "cron-secret-1234567890",
  DEMO_BUSINESS_SLUG: "spa-demo",
  APP_URL: "https://keeper.test",
  DEMO_OWNER_EMAIL: "demo@keeper.app",
  DEMO_OWNER_PASSWORD: "demo-password",
};

function resetDeps() {
  const seed = vi.fn(async (opts: SeedDemoOptions) => ({ businessId: opts.slug, ownerUserId: "u", counts: { clients: 20 } }));
  return { seed, deps: { env, seed, clock: () => NOW } };
}

describe("demo reset cron", () => {
  it("returns 401 and never seeds without the cron secret", async () => {
    const { seed, deps } = resetDeps();
    const noHeader = await runDemoReset(new Request("https://keeper.test/api/cron/demo-reset"), deps);
    const wrong = await runDemoReset(
      new Request("https://keeper.test/api/cron/demo-reset", { headers: { authorization: "Bearer nope-nope-nope-nope-" } }),
      deps,
    );
    expect(noHeader.httpStatus).toBe(401);
    expect(wrong.httpStatus).toBe(401);
    expect(seed).not.toHaveBeenCalled();
  });

  it("re-seeds the demo tenant with the configured slug and owner when authorized", async () => {
    const { seed, deps } = resetDeps();
    const result = await runDemoReset(
      new Request("https://keeper.test/api/cron/demo-reset", { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }),
      deps,
    );
    expect(result.httpStatus).toBe(200);
    expect(seed).toHaveBeenCalledWith({
      now: NOW,
      slug: "spa-demo",
      appUrl: "https://keeper.test",
      ownerEmail: "demo@keeper.app",
      ownerPassword: "demo-password",
    });
  });
});

describe("demo daily message budget", () => {
  function budgetDeps(used: number, mode: "demo" | "live" = "demo"): DemoBudgetDeps & { since: Date[] } {
    const since: Date[] = [];
    return {
      since,
      getBusiness: async (id) => ({ id, integrationMode: mode }),
      countClientMessagesSince: async (_id, from) => {
        since.push(from);
        return used;
      },
      dailyBudget: 1500,
      clock: () => NOW,
    };
  }

  it("counts from local midnight in Santo Domingo (UTC-4)", () => {
    // NOW is 2026-09-28 08:00 local → midnight local is 04:00Z.
    expect(startOfLocalDay(NOW).toISOString()).toBe("2026-09-28T04:00:00.000Z");
    // 23:30 local on the 28th is 03:30Z on the 29th — still the 28th locally.
    expect(startOfLocalDay(new Date("2026-09-29T03:30:00.000Z")).toISOString()).toBe("2026-09-28T04:00:00.000Z");
  });

  it("is exhausted only once today's client messages reach the budget", async () => {
    const under = budgetDeps(1499);
    expect(await checkDemoBudgetExhausted(under, "biz")).toBe(false);
    expect(under.since[0]!.toISOString()).toBe("2026-09-28T04:00:00.000Z");
    expect(await checkDemoBudgetExhausted(budgetDeps(1500), "biz")).toBe(true);
  });

  it("never caps live businesses or unknown ids", async () => {
    const live = budgetDeps(99_999, "live");
    expect(await checkDemoBudgetExhausted(live, "biz")).toBe(false);
    expect(live.since).toHaveLength(0);
    expect(await checkDemoBudgetExhausted({ ...budgetDeps(99_999), getBusiness: async () => null }, "biz")).toBe(false);
  });
});
