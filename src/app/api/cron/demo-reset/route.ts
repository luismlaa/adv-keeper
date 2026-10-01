import { getServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { runDemoReset } from "@/lib/demo/reset";
import { seedDemo } from "@/lib/demo/seed";

/** Vercel Cron (GET, `Authorization: Bearer $CRON_SECRET`): re-seeds the demo tenant every night. */
export async function GET(request: Request): Promise<Response> {
  const env = getServerEnv();
  try {
    const result = await runDemoReset(request, {
      env,
      seed: (opts) => seedDemo(createAdminClient(env), opts),
      clock: () => new Date(),
    });
    if (result.httpStatus === 200) console.info("[demo-reset] demo tenant re-seeded", JSON.stringify(result.body));
    else console.warn("[demo-reset] unauthorized call rejected");
    return Response.json(result.body, { status: result.httpStatus });
  } catch (error) {
    console.error("[demo-reset] failed", error instanceof Error ? error.message : String(error));
    return Response.json({ error: "demo_reset_failed" }, { status: 500 });
  }
}
