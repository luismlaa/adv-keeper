import { afterEach, describe, expect, it } from "vitest";
import { MemoryCardnetSessionStore } from "@/lib/adapters/cardnet/session-store";
import { GoogleNotConnectedError } from "@/lib/adapters/google/errors";
import { createLiveAdapterFactory, liveAdapterFactory, type LiveServices } from "@/lib/adapters/live";
import { MessagingUnavailableError, messagingUnavailable } from "@/lib/adapters/messaging/unavailable";
import { PaymentsUnavailableError } from "@/lib/adapters/payments/unavailable";
import { IntegrationNotAvailableError, registerLiveAdapters, resolveAdapters } from "@/lib/adapters/registry";
import { BookingService } from "@/lib/booking/booking-service";
import { parseServerEnv, type ServerEnv } from "@/lib/config/env";
import { IntegrationCredentials, MemoryIntegrationRepo } from "@/lib/integrations/repo";
import type { Business } from "@/lib/schemas/entities";
import { MemoryStore } from "@/lib/store/memory";
import { business as base, client, laser, laserPackage, laserTemplate, NOW, TUESDAY_10 } from "../helpers/fixtures";

const KEY = "d".repeat(64);
const env: ServerEnv = parseServerEnv({
  APP_URL: "https://keeper.test",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  ANTHROPIC_API_KEY: "sk-test",
  ENCRYPTION_KEY: KEY,
  CRON_SECRET: "cron-secret-for-tests-123",
  DEMO_OWNER_PASSWORD: "demo-password",
  DEMO_PAYMENT_WEBHOOK_SECRET: "demo-webhook-secret-123",
  WHATSAPP_TOKEN: "meta-system-token",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
});

const live: Business = { ...base, integrationMode: "live", paymentProvider: "azul", googleCalendarId: "primary", whatsappPhoneNumberId: "1098765432" };

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function harness(responses: Array<() => Response> = []) {
  const store = new MemoryStore({ businesses: [live], services: [laser], packageTemplates: [laserTemplate], clients: [client], clientPackages: [laserPackage] });
  const services: LiveServices = {
    credentials: new IntegrationCredentials(new MemoryIntegrationRepo(), KEY),
    cardnetSessions: new MemoryCardnetSessionStore(),
    logActivity: (entry) => store.logActivity(entry),
  };
  const calls: Call[] = [];
  const warnings: string[] = [];
  const factory = createLiveAdapterFactory({
    services: () => services,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected fetch ${url}`);
      return next();
    },
    sleep: async () => undefined,
    warn: (event) => warnings.push(event),
  });
  return { store, services, calls, warnings, adapters: (b: Business = live) => factory(b, env) };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const range = { start: TUESDAY_10, end: new Date(TUESDAY_10.getTime() + 3_600_000) };

afterEach(() => registerLiveAdapters(liveAdapterFactory));

describe("registry", () => {
  it("still resolves the fakes for a demo business", () => {
    const adapters = resolveAdapters({ ...live, integrationMode: "demo", paymentProvider: "fake" }, env);
    expect([adapters.calendar.kind, adapters.payments.kind, adapters.messaging.kind]).toEqual(["fake", "fake", "web"]);
  });

  it("resolves the live adapters for a live business through the default registered factory", () => {
    const adapters = resolveAdapters(live, env);
    expect([adapters.calendar.kind, adapters.payments.kind, adapters.messaging.kind]).toEqual(["google", "azul", "whatsapp"]);
    expect(resolveAdapters({ ...live, paymentProvider: "cardnet" }, env).payments.kind).toBe("cardnet");
  });

  it("throws the typed error only when no live factory is registered", () => {
    registerLiveAdapters(undefined);
    expect(() => resolveAdapters(live, env)).toThrow(IntegrationNotAvailableError);
  });
});

describe("live messaging", () => {
  it("sends templates from the business's own WhatsApp number", async () => {
    const h = harness([json({ messages: [{ id: "wamid.ABC" }] })]);
    const result = await h.adapters().messaging.sendTemplate({ to: "+18095550001", template: "reactivation", variables: ["Mariela", "Spa Test"], previewText: "…" });
    expect(result.messageId).toBe("wamid.ABC");
    expect(h.calls[0]?.url).toBe("https://graph.facebook.com/v23.0/1098765432/messages");
    expect((h.calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer meta-system-token");
  });

  it("degrades to a typed error when the business has no phone number id or Keeper has no token", async () => {
    const h = harness();
    const noNumber = h.adapters({ ...live, whatsappPhoneNumberId: null }).messaging;
    expect(messagingUnavailable(noNumber)?.code).toBe("whatsapp_phone_number_missing");
    await expect(noNumber.sendText({ to: "+18095550001", text: "hola" })).rejects.toBeInstanceOf(MessagingUnavailableError);

    const noToken = createLiveAdapterFactory({ services: () => h.services })(live, { ...env, WHATSAPP_TOKEN: undefined }).messaging;
    expect(messagingUnavailable(noToken)?.code).toBe("whatsapp_token_missing");
    expect(h.calls).toHaveLength(0);
  });
});

describe("live calendar", () => {
  it("maps Google freeBusy when the business is connected", async () => {
    const h = harness([
      json({ access_token: "access-1", expires_in: 3600, token_type: "Bearer" }),
      json({ calendars: { primary: { busy: [{ start: "2026-09-29T14:00:00Z", end: "2026-09-29T15:00:00Z" }] } } }),
    ]);
    await h.services.credentials.save(live.id, "google_calendar", { refreshToken: "refresh-wiring-1", calendarId: "primary" });
    expect(await h.adapters().calendar.getBusy("primary", range)).toEqual([{ start: new Date("2026-09-29T14:00:00Z"), end: new Date("2026-09-29T15:00:00Z") }]);
    expect(h.calls.map((c) => new URL(c.url).pathname)).toEqual(["/token", "/calendar/v3/freeBusy"]);
  });

  it("without a Google connection: no external busy blocks, events skipped, deletes are no-ops", async () => {
    const h = harness();
    const calendar = h.adapters().calendar;
    expect(await calendar.getBusy("primary", range)).toEqual([]);
    await expect(calendar.createEvent({ calendarRef: "primary", summary: "x", description: "", start: range.start, end: range.end })).rejects.toBeInstanceOf(GoogleNotConnectedError);
    await expect(calendar.deleteEvent("primary", "evt1")).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(0);
    expect(h.warnings).toEqual(["busy_skipped", "delete_skipped"]);
  });

  it("logs a revoked connection (invalid_grant) to activity_log and keeps serving availability", async () => {
    const h = harness([json({ error: "invalid_grant" }, 400)]);
    await h.services.credentials.save(live.id, "google_calendar", { refreshToken: "refresh-revoked", calendarId: "primary" });
    expect(await h.adapters().calendar.getBusy("primary", range)).toEqual([]);
    expect(h.store.activity.at(-1)).toMatchObject({ businessId: live.id, action: "google_disconnected" });
  });

  it("treats a Keeper without Google OAuth configured as not connected", async () => {
    const h = harness();
    const calendar = createLiveAdapterFactory({ services: () => h.services, warn: () => undefined })(live, { ...env, GOOGLE_CLIENT_ID: undefined }).calendar;
    expect(await calendar.getBusy("primary", range)).toEqual([]);
  });

  it("confirms a booking without Google and logs the skipped calendar event", async () => {
    const h = harness();
    const booking = new BookingService({ store: h.store, adapters: h.adapters(), clock: () => NOW });
    const appointment = await booking.createHold({
      businessId: live.id,
      clientId: client.id,
      serviceId: laser.id,
      startsAt: TUESDAY_10,
      clientPackageId: laserPackage.id,
      source: "whatsapp",
    });
    expect(appointment).toMatchObject({ status: "confirmed", calendarEventId: null });
    expect(h.store.activity.find((a) => a.action === "calendar_event_skipped")).toMatchObject({
      entityId: appointment.id,
      meta: { code: "google_not_connected" },
    });
  });
});

describe("live payments", () => {
  it("picks the gateway by business.paymentProvider", () => {
    const h = harness();
    expect(h.adapters({ ...live, paymentProvider: "azul" }).payments.kind).toBe("azul");
    expect(h.adapters({ ...live, paymentProvider: "cardnet" }).payments.kind).toBe("cardnet");
  });

  it("never falls back to the demo checkout for a live business", async () => {
    const payments = harness().adapters({ ...live, paymentProvider: "fake" }).payments;
    await expect(
      payments.createDepositLink({ reference: "r", amountMinor: 100, currency: "DOP", description: "d", expiresAt: NOW, customerPhone: "+1809" }),
    ).rejects.toBeInstanceOf(PaymentsUnavailableError);
    expect(await payments.verifyWebhook("{}", new Headers())).toBeNull();
  });
});
