import { z } from "zod";

/**
 * Server-side environment. Parsed lazily so that build steps and unit tests that never touch
 * a given integration don't need every secret present. Integration-specific groups are optional
 * as a whole and validated by `requireEnv` at the point of use.
 */
const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

export const serverEnvSchema = z.object({
  APP_URL: z.url().default("http://localhost:3000"),

  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5"),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(1024),

  WHATSAPP_TOKEN: optionalString,
  WHATSAPP_VERIFY_TOKEN: optionalString,
  WHATSAPP_APP_SECRET: optionalString,
  WHATSAPP_GRAPH_VERSION: z.string().default("v23.0"),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,

  AZUL_MERCHANT_ID: optionalString,
  AZUL_MERCHANT_NAME: optionalString,
  AZUL_AUTH_KEY: optionalString,
  AZUL_PAYMENT_PAGE_URL: optionalString,

  CARDNET_MERCHANT_ID: optionalString,
  CARDNET_TERMINAL_ID: optionalString,
  CARDNET_API_URL: optionalString,

  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "ENCRYPTION_KEY must be 32 bytes hex (64 chars)"),
  CRON_SECRET: z.string().min(16),

  DEMO_BUSINESS_SLUG: z.string().default("spa-demo"),
  DEMO_OWNER_EMAIL: z.email().default("demo@keeper.app"),
  DEMO_OWNER_PASSWORD: z.string().min(8),
  DEMO_PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  DEMO_MAX_MESSAGES_PER_SESSION: z.coerce.number().int().positive().default(30),
  DEMO_DAILY_MESSAGE_BUDGET: z.coerce.number().int().positive().default(1500),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new EnvError(`Invalid server environment — ${issues}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/** Narrow an optional integration group to present values, failing loudly with the missing keys. */
export function requireEnv<K extends keyof ServerEnv>(
  env: ServerEnv,
  keys: readonly K[],
  integration: string,
): { [P in K]-?: NonNullable<ServerEnv[P]> } {
  const missing = keys.filter((k) => env[k] === undefined);
  if (missing.length > 0) {
    throw new EnvError(`${integration} is not configured — missing ${missing.join(", ")}`);
  }
  return Object.fromEntries(keys.map((k) => [k, env[k]])) as { [P in K]-?: NonNullable<ServerEnv[P]> };
}
