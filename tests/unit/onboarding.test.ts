import { describe, expect, it } from "vitest";
import { z } from "zod";
import { IntegrationCredentials, MemoryIntegrationRepo, type IntegrationProvider } from "@/lib/integrations/repo";
import { createBusiness, goLive, OnboardingError, pause, readiness, setPayments, setWhatsapp, type OnboardingDeps } from "@/lib/onboarding/commands";
import type { BusinessPatch, NewBusiness, OnboardingRepo } from "@/lib/onboarding/repo";
import type { Business } from "@/lib/schemas/entities";

const KEY = "c".repeat(64);

class MemoryOnboardingRepo implements OnboardingRepo {
  businesses: Business[] = [];
  users = new Map<string, string>(); // email → id
  memberships: { userId: string; businessId: string }[] = [];
  services = new Map<string, number>();

  constructor(private readonly integrations: MemoryIntegrationRepo) {}

  async findBusinessBySlug(slug: string) {
    return this.businesses.find((b) => b.slug === slug) ?? null;
  }
  async findBusinessByWhatsappId(id: string) {
    return this.businesses.find((b) => b.whatsappPhoneNumberId === id) ?? null;
  }
  async insertBusiness(input: NewBusiness) {
    const b: Business = {
      id: `00000000-0000-4000-8000-${String(this.businesses.length + 1).padStart(12, "0")}`,
      slug: input.slug,
      name: input.name,
      integrationMode: "demo",
      paymentProvider: "fake",
      googleCalendarId: null,
      whatsappPhoneNumberId: null,
      settings: {},
    };
    this.businesses.push(b);
    return b;
  }
  async updateBusiness(id: string, patch: BusinessPatch) {
    const i = this.businesses.findIndex((b) => b.id === id);
    this.businesses[i] = { ...this.businesses[i]!, ...patch };
    return this.businesses[i]!;
  }
  async findUserIdByEmail(email: string) {
    return this.users.get(email) ?? null;
  }
  async createUser(email: string) {
    const id = `user-${this.users.size + 1}`;
    this.users.set(email, id);
    return id;
  }
  async addOwnerMembership(userId: string, businessId: string) {
    if (!this.memberships.some((m) => m.userId === userId && m.businessId === businessId)) this.memberships.push({ userId, businessId });
  }
  async ownerEmails(businessId: string) {
    const ids = this.memberships.filter((m) => m.businessId === businessId).map((m) => m.userId);
    return [...this.users].filter(([, id]) => ids.includes(id)).map(([email]) => email);
  }
  async countActiveServices(businessId: string) {
    return this.services.get(businessId) ?? 0;
  }
  async hasIntegration(businessId: string, provider: IntegrationProvider) {
    return (await this.integrations.get(businessId, provider)) !== null;
  }
}

function setup() {
  const integrations = new MemoryIntegrationRepo();
  const repo = new MemoryOnboardingRepo(integrations);
  const deps: OnboardingDeps = { repo, credentials: new IntegrationCredentials(integrations, KEY), generatePassword: () => "temp-pass-123" };
  return { repo, integrations, deps };
}

const AZUL = { merchantId: "39038540035", merchantName: "SPA LUNA", authKey: "s3cr3t-auth-key" };
const create = (deps: OnboardingDeps, slug = "spa-luna") => createBusiness(deps, { slug, name: "Spa Luna", ownerEmail: "Ana@SpaLuna.do" });

describe("onboarding: create", () => {
  it("creates a demo-mode tenant with fake payments and an owner with a one-time password", async () => {
    const { repo, deps } = setup();
    const result = await create(deps);
    expect(result.business).toMatchObject({ slug: "spa-luna", integrationMode: "demo", paymentProvider: "fake" });
    expect(result).toMatchObject({ ownerEmail: "ana@spaluna.do", temporaryPassword: "temp-pass-123" });
    expect(await repo.ownerEmails(result.business.id)).toEqual(["ana@spaluna.do"]);
  });

  it("links an existing user without resetting her password, and refuses a taken or invalid slug", async () => {
    const { repo, deps } = setup();
    repo.users.set("ana@spaluna.do", "user-existing");
    expect((await create(deps)).temporaryPassword).toBeNull();
    await expect(create(deps)).rejects.toThrow(OnboardingError);
    await expect(create(deps, "Spa Luna!")).rejects.toThrow();
  });
});

describe("onboarding: payments and WhatsApp", () => {
  it("stores Azul credentials encrypted and switches the provider", async () => {
    const { integrations, deps } = setup();
    const { business } = await create(deps);
    const updated = await setPayments(deps, { slug: "spa-luna", provider: "azul", credentials: AZUL });
    expect(updated.paymentProvider).toBe("azul");
    expect(integrations.rows[0]!.encryptedCredentials).not.toContain("s3cr3t-auth-key");
    const stored = await deps.credentials.read(business.id, "azul", z.object({ authKey: z.string(), terminalId: z.string() }));
    expect(stored).toEqual({ authKey: "s3cr3t-auth-key", terminalId: "00000001" });
  });

  it("rejects incomplete credentials and unknown providers without saving anything", async () => {
    const { integrations, deps } = setup();
    await create(deps);
    await expect(setPayments(deps, { slug: "spa-luna", provider: "azul", credentials: { merchantId: "1" } })).rejects.toThrow(/authKey/);
    await expect(setPayments(deps, { slug: "spa-luna", provider: "stripe", credentials: AZUL })).rejects.toThrow();
    await expect(setPayments(deps, { slug: "nope", provider: "azul", credentials: AZUL })).rejects.toThrow(/No existe/);
    expect(integrations.rows).toHaveLength(0);
  });

  it("sets the WhatsApp phone number id and refuses one used by another business", async () => {
    const { deps } = setup();
    await create(deps);
    await create(deps, "spa-sol");
    expect((await setWhatsapp(deps, { slug: "spa-luna", phoneNumberId: "123456789012345" })).whatsappPhoneNumberId).toBe("123456789012345");
    await expect(setWhatsapp(deps, { slug: "spa-sol", phoneNumberId: "123456789012345" })).rejects.toThrow(/spa-luna/);
    await expect(setWhatsapp(deps, { slug: "spa-sol", phoneNumberId: "+1 809" })).rejects.toThrow();
  });
});

describe("onboarding: readiness and go-live", () => {
  it("blocks go-live until owner, services, payment credentials and WhatsApp are set; Google is only a warning", async () => {
    const { repo, deps } = setup();
    const { business } = await create(deps);

    const before = await readiness(deps, "spa-luna");
    expect(before.ready).toBe(false);
    expect(before.checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(["services", "payments", "whatsapp", "google"]);
    await expect(goLive(deps, "spa-luna")).rejects.toThrow(/services.*payments.*whatsapp/);

    repo.services.set(business.id, 6);
    await setPayments(deps, { slug: "spa-luna", provider: "azul", credentials: AZUL });
    await setWhatsapp(deps, { slug: "spa-luna", phoneNumberId: "123456789012345" });

    const live = await goLive(deps, "spa-luna");
    expect(live.business.integrationMode).toBe("live");
    expect(live.checks.find((c) => c.key === "google")).toMatchObject({ ok: false, blocking: false });

    expect((await pause(deps, "spa-luna")).integrationMode).toBe("demo");
  });

  it("does not count a provider switch without credentials as ready", async () => {
    const { repo, deps } = setup();
    const { business } = await create(deps);
    await repo.updateBusiness(business.id, { paymentProvider: "cardnet" });
    const status = await readiness(deps, "spa-luna");
    expect(status.checks.find((c) => c.key === "payments")).toMatchObject({ ok: false, detail: "cardnet sin credenciales" });
  });
});
