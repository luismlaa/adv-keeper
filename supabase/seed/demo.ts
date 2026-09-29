/**
 * Seeds (or resets) the demo tenant in the Supabase project configured in .env.local.
 * Usage: npm run seed:demo
 */
import { getServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { seedDemo } from "@/lib/demo/seed";

async function main(): Promise<void> {
  const env = getServerEnv();
  const result = await seedDemo(createAdminClient(env), {
    now: new Date(),
    slug: env.DEMO_BUSINESS_SLUG,
    appUrl: env.APP_URL,
    ownerEmail: env.DEMO_OWNER_EMAIL,
    ownerPassword: env.DEMO_OWNER_PASSWORD,
  });
  console.log(`Demo tenant "${env.DEMO_BUSINESS_SLUG}" seeded`, result);
  console.log(`Owner login: ${env.DEMO_OWNER_EMAIL} (password from DEMO_OWNER_PASSWORD)`);
}

main().catch((error: unknown) => {
  console.error("Demo seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
