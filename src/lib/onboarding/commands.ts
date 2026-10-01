import { randomBytes } from "node:crypto";
import { z } from "zod";
import { azulCredentialsSchema } from "@/lib/adapters/azul/credentials";
import { cardnetCredentialsSchema } from "@/lib/adapters/cardnet/credentials";
import type { IntegrationCredentials } from "@/lib/integrations/repo";
import type { Business } from "@/lib/schemas/entities";
import type { OnboardingRepo } from "./repo";

/** Expected operator mistakes (bad input, wrong state). The CLI prints the message, no stack. */
export class OnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnboardingError";
  }
}

export interface OnboardingDeps {
  repo: OnboardingRepo;
  credentials: IntegrationCredentials;
  /** Temporary owner password generator (injectable for tests). */
  generatePassword?: () => string;
}

const slugSchema = z.string().regex(/^[a-z0-9-]{3,48}$/, "slug: 3–48 caracteres, solo a-z, 0-9 y guiones");
const emailSchema = z.email("email inválido");

const defaultPassword = () => randomBytes(12).toString("base64url");

async function requireBusiness(repo: OnboardingRepo, slug: string): Promise<Business> {
  const business = await repo.findBusinessBySlug(slug);
  if (!business) throw new OnboardingError(`No existe un negocio con slug "${slug}"`);
  return business;
}

export interface CreateBusinessInput {
  slug: string;
  name: string;
  ownerEmail: string;
}

export interface CreateBusinessResult {
  business: Business;
  ownerEmail: string;
  /** Set only when a new auth user was created; shown once by the CLI. */
  temporaryPassword: string | null;
}

/** Creates the tenant (demo mode, fake payments) and its owner. Re-running links an existing user. */
export async function createBusiness(deps: OnboardingDeps, input: CreateBusinessInput): Promise<CreateBusinessResult> {
  const slug = slugSchema.parse(input.slug.trim().toLowerCase());
  const name = z.string().trim().min(2, "nombre muy corto").parse(input.name);
  const ownerEmail = emailSchema.parse(input.ownerEmail.trim().toLowerCase());

  if (await deps.repo.findBusinessBySlug(slug)) throw new OnboardingError(`El slug "${slug}" ya está en uso`);

  const business = await deps.repo.insertBusiness({ slug, name });
  let userId = await deps.repo.findUserIdByEmail(ownerEmail);
  let temporaryPassword: string | null = null;
  if (userId === null) {
    temporaryPassword = (deps.generatePassword ?? defaultPassword)();
    userId = await deps.repo.createUser(ownerEmail, temporaryPassword);
  }
  await deps.repo.addOwnerMembership(userId, business.id);
  return { business, ownerEmail, temporaryPassword };
}

const paymentProviderSchema = z.enum(["azul", "cardnet"]);

/** Validates the merchant credentials for the provider, stores them encrypted and switches the provider. */
export async function setPayments(
  deps: OnboardingDeps,
  input: { slug: string; provider: string; credentials: unknown },
): Promise<Business> {
  const business = await requireBusiness(deps.repo, input.slug);
  const provider = paymentProviderSchema.parse(input.provider);
  const schema = provider === "azul" ? azulCredentialsSchema : cardnetCredentialsSchema;
  const parsed = schema.safeParse(input.credentials);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ");
    throw new OnboardingError(`Credenciales de ${provider} inválidas — ${fields}`);
  }
  await deps.credentials.save(business.id, provider, parsed.data);
  return deps.repo.updateBusiness(business.id, { paymentProvider: provider });
}

/** Links the business to its WhatsApp Cloud API phone number id (inbound routing + outbound sender). */
export async function setWhatsapp(deps: OnboardingDeps, input: { slug: string; phoneNumberId: string }): Promise<Business> {
  const business = await requireBusiness(deps.repo, input.slug);
  const phoneNumberId = z.string().trim().regex(/^\d{6,20}$/, "phone number id: solo dígitos").parse(input.phoneNumberId);
  const owner = await deps.repo.findBusinessByWhatsappId(phoneNumberId);
  if (owner && owner.id !== business.id) throw new OnboardingError(`Ese phone number id ya lo usa "${owner.slug}"`);
  return deps.repo.updateBusiness(business.id, { whatsappPhoneNumberId: phoneNumberId });
}

export interface ReadinessCheck {
  key: "owner" | "services" | "payments" | "whatsapp" | "google";
  ok: boolean;
  /** Blocking checks must pass before go-live; the rest are warnings. */
  blocking: boolean;
  detail: string;
}

export interface Readiness {
  business: Business;
  checks: ReadinessCheck[];
  ready: boolean;
}

/** What a business still needs before `goLive`. Google is a warning: bookings work without it. */
export async function readiness(deps: OnboardingDeps, slug: string): Promise<Readiness> {
  const business = await requireBusiness(deps.repo, slug);
  const [owners, services, google] = await Promise.all([
    deps.repo.ownerEmails(business.id),
    deps.repo.countActiveServices(business.id),
    deps.repo.hasIntegration(business.id, "google_calendar"),
  ]);
  const provider = business.paymentProvider;
  const paymentsOk = provider !== "fake" && (await deps.repo.hasIntegration(business.id, provider));

  const checks: ReadinessCheck[] = [
    { key: "owner", ok: owners.length > 0, blocking: true, detail: owners.length > 0 ? owners.join(", ") : "sin dueña" },
    { key: "services", ok: services > 0, blocking: true, detail: `${services} servicio(s) activo(s)` },
    {
      key: "payments",
      ok: paymentsOk,
      blocking: true,
      detail: provider === "fake" ? "sin pasarela (onboard set-payments)" : paymentsOk ? `${provider} con credenciales` : `${provider} sin credenciales`,
    },
    {
      key: "whatsapp",
      ok: business.whatsappPhoneNumberId !== null,
      blocking: true,
      detail: business.whatsappPhoneNumberId ?? "sin phone number id (onboard set-whatsapp)",
    },
    {
      key: "google",
      ok: google,
      blocking: false,
      detail: google ? "conectado" : "no conectado: la dueña lo conecta en Ajustes (opcional)",
    },
  ];
  return { business, checks, ready: checks.every((c) => c.ok || !c.blocking) };
}

/** Flips the business to live once every blocking check passes. */
export async function goLive(deps: OnboardingDeps, slug: string): Promise<Readiness> {
  const status = await readiness(deps, slug);
  if (!status.ready) {
    const missing = status.checks.filter((c) => c.blocking && !c.ok).map((c) => `${c.key} (${c.detail})`);
    throw new OnboardingError(`No se puede pasar a live; falta: ${missing.join("; ")}`);
  }
  const business = await deps.repo.updateBusiness(status.business.id, { integrationMode: "live" });
  return { ...status, business };
}

/** Back to demo mode (stops crons and live adapters for this business) without deleting anything. */
export async function pause(deps: OnboardingDeps, slug: string): Promise<Business> {
  const business = await requireBusiness(deps.repo, slug);
  return deps.repo.updateBusiness(business.id, { integrationMode: "demo" });
}
