import { FakeCalendar } from "@/lib/adapters/calendar/fake";
import { RecordingChannel } from "@/lib/adapters/messaging/recording";
import { FakePaymentProvider } from "@/lib/adapters/payments/fake";
import type { Adapters } from "@/lib/adapters/registry";
import { BookingService } from "@/lib/booking/booking-service";
import type { Business, Client, ClientPackage, PackageTemplate, Service } from "@/lib/schemas/entities";
import { MemoryStore } from "@/lib/store/memory";

/** Monday 2026-09-28 08:00 in Santo Domingo (UTC-4, no DST). */
export const NOW = new Date("2026-09-28T12:00:00.000Z");
export const WEBHOOK_SECRET = "test-webhook-secret-123456";

export const business: Business = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "spa-test",
  name: "Spa Test",
  integrationMode: "demo",
  paymentProvider: "fake",
  googleCalendarId: "demo",
  whatsappPhoneNumberId: null,
  settings: { ownerDisplayName: "Ana" },
};

export const facial: Service = {
  id: "22222222-2222-4222-8222-222222222222",
  businessId: business.id,
  name: "Limpieza facial",
  description: "",
  category: "Facial",
  durationMin: 60,
  priceMinor: 350000,
  depositOverrideMinor: null,
  active: true,
};

export const laser: Service = { ...facial, id: "22222222-2222-4222-8222-333333333333", name: "Láser piernas", category: "Láser", priceMinor: 450000 };

export const client: Client = {
  id: "33333333-3333-4333-8333-333333333333",
  businessId: business.id,
  name: "Mariela",
  phone: "+18095550001",
  email: null,
  notes: null,
  lastVisitAt: null,
  lastReengagedAt: null,
};

export const otherClient: Client = { ...client, id: "33333333-3333-4333-8333-444444444444", phone: "+18095550002", name: "Laura" };

export const laserTemplate: PackageTemplate = {
  id: "44444444-4444-4444-8444-444444444444",
  businessId: business.id,
  serviceId: laser.id,
  name: "Láser piernas · 10 sesiones",
  sessionsTotal: 10,
  priceMinor: 3600000,
  intervalDays: 30,
  active: true,
};

export const laserPackage: ClientPackage = {
  id: "55555555-5555-4555-8555-555555555555",
  businessId: business.id,
  clientId: client.id,
  packageTemplateId: laserTemplate.id,
  sessionsTotal: 10,
  sessionsUsed: 3,
  status: "active",
  purchasedAt: "2026-06-01T12:00:00.000Z",
  expiresAt: null,
};

export interface Harness {
  store: MemoryStore;
  adapters: Adapters;
  messaging: RecordingChannel;
  payments: FakePaymentProvider;
  booking: BookingService;
  setNow: (d: Date) => void;
}

export function harness(): Harness {
  let now = NOW;
  const store = new MemoryStore({
    businesses: [business],
    services: [facial, laser],
    packageTemplates: [laserTemplate],
    clients: [client, otherClient],
    clientPackages: [laserPackage],
  });
  const messaging = new RecordingChannel();
  const payments = new FakePaymentProvider("https://keeper.test", WEBHOOK_SECRET);
  const adapters: Adapters = { calendar: new FakeCalendar(), payments, messaging };
  const booking = new BookingService({ store, adapters, clock: () => now });
  return { store, adapters, messaging, payments, booking, setNow: (d) => (now = d) };
}

/** 10:00 local on Tuesday 2026-09-29. */
export const TUESDAY_10 = new Date("2026-09-29T14:00:00.000Z");
