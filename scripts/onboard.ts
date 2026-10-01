/**
 * Operator CLI to onboard a real business (service role, reads .env.local).
 *
 *   npm run onboard -- create        --slug spa-luna --name "Spa Luna" --owner-email ana@spaluna.do
 *   npm run onboard -- set-payments  --slug spa-luna --provider azul --credentials ../secrets/spa-luna-azul.json
 *   npm run onboard -- set-whatsapp  --slug spa-luna --phone-number-id 123456789012345
 *   npm run onboard -- status        --slug spa-luna
 *   npm run onboard -- go-live       --slug spa-luna
 *   npm run onboard -- pause         --slug spa-luna
 *
 * Credentials are read from a JSON file (never from argv, so they don't land in shell history) and
 * stored encrypted. Keep that file outside the repo and delete it after loading.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { getServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { IntegrationCredentials, SupabaseIntegrationRepo } from "@/lib/integrations/repo";
import {
  createBusiness,
  goLive,
  OnboardingError,
  pause,
  readiness,
  setPayments,
  setWhatsapp,
  type OnboardingDeps,
  type Readiness,
} from "@/lib/onboarding/commands";
import { SupabaseOnboardingRepo } from "@/lib/onboarding/repo";

const USAGE = "Uso: npm run onboard -- <create|set-payments|set-whatsapp|status|go-live|pause> --slug <slug> [opciones] (ver scripts/onboard.ts)";

function required(values: Record<string, string | boolean | undefined>, key: string): string {
  const value = values[key];
  if (typeof value !== "string" || value.trim() === "") throw new OnboardingError(`Falta --${key}. ${USAGE}`);
  return value;
}

function printReadiness(status: Readiness): void {
  console.log(`\n${status.business.name} (${status.business.slug}) · modo ${status.business.integrationMode}`);
  for (const c of status.checks) console.log(`  ${c.ok ? "✅" : c.blocking ? "❌" : "⚠️ "} ${c.key.padEnd(9)} ${c.detail}`);
  console.log(status.ready ? "\nListo para go-live." : "\nFalta completar lo marcado con ❌.");
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      slug: { type: "string" },
      name: { type: "string" },
      "owner-email": { type: "string" },
      provider: { type: "string" },
      credentials: { type: "string" },
      "phone-number-id": { type: "string" },
    },
    strict: true,
  });

  const env = getServerEnv();
  const db = createAdminClient(env);
  const deps: OnboardingDeps = {
    repo: new SupabaseOnboardingRepo(db),
    credentials: new IntegrationCredentials(new SupabaseIntegrationRepo(db), env.ENCRYPTION_KEY),
  };
  const slug = () => required(values, "slug");

  switch (command) {
    case "create": {
      const result = await createBusiness(deps, { slug: slug(), name: required(values, "name"), ownerEmail: required(values, "owner-email") });
      console.log(`✅ Negocio "${result.business.name}" creado (${result.business.slug}, modo demo, id ${result.business.id})`);
      console.log(`   Dueña: ${result.ownerEmail}`);
      if (result.temporaryPassword) {
        console.log(`   Contraseña temporal (se muestra UNA vez, compártela por un canal privado): ${result.temporaryPassword}`);
      } else {
        console.log("   La usuaria ya existía: se agregó como dueña con su contraseña actual.");
      }
      console.log(`   Login: ${env.APP_URL}/login → que cargue servicios, paquetes y ajustes desde el dashboard.`);
      return;
    }
    case "set-payments": {
      const file = required(values, "credentials");
      let credentials: unknown;
      try {
        credentials = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        throw new OnboardingError(`No pude leer el JSON de credenciales en ${file}`);
      }
      const business = await setPayments(deps, { slug: slug(), provider: required(values, "provider"), credentials });
      console.log(`✅ ${business.slug}: pasarela ${business.paymentProvider}, credenciales guardadas cifradas. Ya puedes borrar ${file}.`);
      return;
    }
    case "set-whatsapp": {
      const business = await setWhatsapp(deps, { slug: slug(), phoneNumberId: required(values, "phone-number-id") });
      console.log(`✅ ${business.slug}: WhatsApp phone number id ${business.whatsappPhoneNumberId}`);
      return;
    }
    case "status":
      printReadiness(await readiness(deps, slug()));
      return;
    case "go-live": {
      const status = await goLive(deps, slug());
      printReadiness(status);
      console.log(`🚀 ${status.business.slug} está en modo live.`);
      return;
    }
    case "pause": {
      const business = await pause(deps, slug());
      console.log(`⏸️  ${business.slug} volvió a modo demo (crons y adapters live desactivados para este negocio).`);
      return;
    }
    default:
      throw new OnboardingError(USAGE);
  }
}

main().catch((error: unknown) => {
  if (error instanceof OnboardingError) console.error(`❌ ${error.message}`);
  else if (error instanceof Error && error.name === "ZodError") console.error(`❌ Dato inválido: ${error.message}`);
  else console.error("❌ Onboarding falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
