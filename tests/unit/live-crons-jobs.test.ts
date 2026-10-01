import { describe, expect, it } from "vitest";
import { FakeCalendar } from "@/lib/adapters/calendar/fake";
import { RecordingChannel } from "@/lib/adapters/messaging/recording";
import type { MessagingChannel } from "@/lib/adapters/messaging/types";
import { MessagingUnavailableError, UnavailableChannel } from "@/lib/adapters/messaging/unavailable";
import { FakePaymentProvider } from "@/lib/adapters/payments/fake";
import type { Adapters } from "@/lib/adapters/registry";
import { runHoldsExpiry } from "@/lib/crons/holds-expiry";
import { runCronRequest } from "@/lib/crons/http";
import { runPackageNudges } from "@/lib/crons/package-nudges";
import { isoWeekKey, runReactivationScan } from "@/lib/crons/reactivation-scan";
import { runReminders } from "@/lib/crons/reminders";
import type { CronDeps } from "@/lib/crons/runner";
import { DAY_MS, HOUR_MS } from "@/lib/domain/time";
import { buildTemplateMessage } from "@/lib/notifications/templates";
import type { Appointment, Business, Client } from "@/lib/schemas/entities";
import { MemoryStore } from "@/lib/store/memory";
import { business as base, client, facial, laser, laserPackage, laserTemplate, NOW, otherClient, WEBHOOK_SECRET } from "../helpers/fixtures";
import { MemoryCronRepo } from "../helpers/memory-cron-repo";

const live: Business = { ...base, integrationMode: "live", paymentProvider: "azul", whatsappPhoneNumberId: "1098765432" };
const demo: Business = { ...base, id: "66666666-6666-4666-8666-666666666666", slug: "spa-demo", name: "Spa Demo", integrationMode: "demo", paymentProvider: "fake" };
const demoClient: Client = { ...client, id: "77777777-7777-4777-8777-777777777777", businessId: demo.id, phone: "+18095559999" };

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();
let seq = 0;
function appt(overrides: Partial<Appointment> & Pick<Appointment, "businessId" | "clientId" | "startsAt" | "status">): Appointment {
  seq += 1;
  const start = new Date(overrides.startsAt);
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, "0")}`,
    serviceId: facial.id,
    clientPackageId: null,
    endsAt: new Date(start.getTime() + HOUR_MS).toISOString(),
    priceMinor: 350000,
    depositMinor: 105000,
    holdExpiresAt: null,
    calendarEventId: null,
    source: "chat",
    notes: null,
    ...overrides,
  };
}

function world(options: { liveMessaging?: MessagingChannel } = {}) {
  const fiftyDaysAgo = at(-50 * DAY_MS);
  const store = new MemoryStore({
    businesses: [live, demo],
    services: [facial, laser, { ...facial, id: "88888888-8888-4888-8888-888888888888", businessId: demo.id }],
    packageTemplates: [laserTemplate, { ...laserTemplate, id: "99999999-9999-4999-8999-999999999999", businessId: demo.id }],
    clients: [{ ...client, lastVisitAt: fiftyDaysAgo }, otherClient, { ...demoClient, lastVisitAt: fiftyDaysAgo }],
    clientPackages: [
      laserPackage,
      { ...laserPackage, id: "55555555-5555-4555-8555-999999999999", businessId: demo.id, clientId: demoClient.id, packageTemplateId: "99999999-9999-4999-8999-999999999999" },
    ],
    appointments: [
      // Live: one reminder due (22h ahead), one too soon (1h ahead), one completed package session 50 days ago.
      appt({ businessId: live.id, clientId: otherClient.id, startsAt: at(22 * HOUR_MS), status: "confirmed" }),
      appt({ businessId: live.id, clientId: otherClient.id, startsAt: at(1 * HOUR_MS), status: "confirmed" }),
      appt({ businessId: live.id, clientId: client.id, serviceId: laser.id, clientPackageId: laserPackage.id, startsAt: fiftyDaysAgo, status: "completed" }),
      appt({ businessId: live.id, clientId: otherClient.id, startsAt: at(3 * DAY_MS), status: "hold_pending_deposit", holdExpiresAt: at(-60_000) }),
      // Demo: the same situations, which must all be left alone.
      appt({ businessId: demo.id, clientId: demoClient.id, startsAt: at(22 * HOUR_MS), status: "confirmed" }),
      appt({ businessId: demo.id, clientId: demoClient.id, clientPackageId: "55555555-5555-4555-8555-999999999999", startsAt: fiftyDaysAgo, status: "completed" }),
      appt({ businessId: demo.id, clientId: demoClient.id, startsAt: at(4 * DAY_MS), status: "hold_pending_deposit", holdExpiresAt: at(-60_000) }),
    ],
  });
  const liveMessaging = options.liveMessaging ?? new RecordingChannel();
  const demoMessaging = new RecordingChannel();
  const adaptersFor = (b: Business): Adapters => ({
    calendar: new FakeCalendar(),
    payments: new FakePaymentProvider("https://keeper.test", WEBHOOK_SECRET),
    messaging: b.integrationMode === "live" ? liveMessaging : demoMessaging,
  });
  const deps: CronDeps = { store, repo: new MemoryCronRepo(store), resolveAdapters: adaptersFor, clock: () => NOW };
  return { store, deps, liveMessaging, demoMessaging };
}

const recorded = (channel: MessagingChannel) => (channel as RecordingChannel).sent;

describe("reminders cron", () => {
  it("sends the day_before_reminder template once, and nothing new on the second run", async () => {
    const w = world();
    const first = await runReminders(w.deps);
    expect(first).toMatchObject({ job: "reminders", businesses: 1, done: 1, failed: 0, skipped: 0 });
    const [sent] = recorded(w.liveMessaging);
    const expected = buildTemplateMessage("day_before_reminder", {
      clientName: otherClient.name,
      serviceName: facial.name,
      businessName: live.name,
      startsAt: new Date(at(22 * HOUR_MS)),
      timezone: "America/Santo_Domingo",
    });
    expect(sent).toEqual({ type: "template", to: otherClient.phone, ...expected });
    expect(w.store.notifications).toHaveLength(1);
    expect(w.store.activity.at(-1)).toMatchObject({ businessId: live.id, action: "day_before_reminder_sent", actor: "system:cron" });

    const second = await runReminders(w.deps);
    expect(second).toMatchObject({ done: 0, duplicates: 1 });
    expect(recorded(w.liveMessaging)).toHaveLength(1);
    expect(w.store.notifications).toHaveLength(1);
  });

  it("never messages demo businesses", async () => {
    const w = world();
    await runReminders(w.deps);
    await runPackageNudges(w.deps);
    expect(recorded(w.demoMessaging)).toHaveLength(0);
    expect(w.store.notifications.every((n) => n.businessId === live.id)).toBe(true);
  });

  it("skips a live business without WhatsApp, claiming nothing, so it is sent once configured", async () => {
    const unavailable = new UnavailableChannel(new MessagingUnavailableError("whatsapp_phone_number_missing", live.id));
    const w = world({ liveMessaging: unavailable });
    const summary = await runReminders(w.deps);
    expect(summary).toMatchObject({ done: 0, skipped: 1 });
    expect(summary.results[0]).toEqual({ businessId: live.id, status: "skipped", reason: "whatsapp_phone_number_missing" });
    expect(w.store.notifications).toHaveLength(0);

    const configured = new RecordingChannel();
    const retry = await runReminders({ ...w.deps, resolveAdapters: (b) => ({ ...w.deps.resolveAdapters(b), messaging: configured }) });
    expect(retry.done).toBe(1);
    expect(configured.sent).toHaveLength(1);
  });

  it("logs a failed send for the owner and does not retry it (at most once)", async () => {
    const failing: MessagingChannel = {
      kind: "whatsapp",
      sendText: async () => ({ messageId: "x" }),
      sendTemplate: async () => {
        throw new Error("Graph API 500");
      },
    };
    const w = world({ liveMessaging: failing });
    expect(await runReminders(w.deps)).toMatchObject({ done: 0, failed: 1 });
    expect(w.store.activity.at(-1)).toMatchObject({ action: "day_before_reminder_failed", businessId: live.id });
    expect(await runReminders(w.deps)).toMatchObject({ done: 0, failed: 0, duplicates: 1 });
  });

  it("keeps going when one business fails", async () => {
    const w = world();
    const second: Business = { ...live, id: "12121212-1212-4212-8212-121212121212", slug: "spa-dos" };
    const repo = new MemoryCronRepo(w.store);
    const deps: CronDeps = {
      ...w.deps,
      repo: Object.assign(Object.create(repo) as MemoryCronRepo, {
        listLiveBusinesses: async () => [second, live],
        listReminderCandidates: async (businessId: string, from: Date, to: Date) => {
          if (businessId === second.id) throw new Error("db down");
          return repo.listReminderCandidates(businessId, from, to);
        },
      }),
    };
    const summary = await runReminders(deps);
    expect(summary.results.map((r) => r.status)).toEqual(["failed", "ok"]);
    expect(summary.done).toBe(1);
  });
});

describe("package-nudges cron", () => {
  it("nudges 'sesión 4 de 10' once per session and nothing on the second run", async () => {
    const w = world();
    expect(await runPackageNudges(w.deps)).toMatchObject({ done: 1, failed: 0 });
    const [sent] = recorded(w.liveMessaging);
    expect(sent).toMatchObject({ type: "template", template: "package_nudge", to: client.phone });
    expect(sent?.type === "template" && sent.previewText).toContain("Te toca la sesión 4 de 10");
    expect(w.store.notifications.map((n) => n.dedupeKey)).toEqual([`package_nudge:${laserPackage.id}:4`]);

    expect(await runPackageNudges(w.deps)).toMatchObject({ done: 0, duplicates: 1 });
    expect(recorded(w.liveMessaging)).toHaveLength(1);
  });
});

describe("reactivation-scan cron", () => {
  it("writes one weekly digest to activity_log and messages nobody", async () => {
    const w = world();
    expect(await runReactivationScan(w.deps)).toMatchObject({ done: 1 });
    const digest = w.store.activity.filter((a) => a.action === "reactivation_digest");
    expect(digest).toHaveLength(1);
    expect(digest[0]).toMatchObject({ businessId: live.id, entityId: "2026-W40", meta: { count: 1, clients: [{ clientId: client.id }] } });
    expect(recorded(w.liveMessaging)).toHaveLength(0);
    expect(w.store.notifications).toHaveLength(0);

    expect(await runReactivationScan(w.deps)).toMatchObject({ done: 0, duplicates: 1 });
    expect(w.store.activity.filter((a) => a.action === "reactivation_digest")).toHaveLength(1);
  });

  it("computes ISO weeks on the local calendar", () => {
    expect(isoWeekKey(new Date("2026-09-28T12:00:00Z"), "America/Santo_Domingo")).toBe("2026-W40");
    // 03:30Z on Monday is still Sunday 23:30 in Santo Domingo → the previous ISO week.
    expect(isoWeekKey(new Date("2026-09-28T03:30:00Z"), "America/Santo_Domingo")).toBe("2026-W39");
    expect(isoWeekKey(new Date("2027-01-01T15:00:00Z"), "America/Santo_Domingo")).toBe("2026-W53");
  });
});

describe("holds-expiry cron", () => {
  it("expires live and demo holds without messaging anyone, and the second run finds nothing", async () => {
    const w = world();
    const holdIds = w.store.appointments.filter((a) => a.status === "hold_pending_deposit").map((a) => a.id);
    expect(await runHoldsExpiry(w.deps)).toMatchObject({ job: "holds-expiry", businesses: 2, done: 2 });
    const holds = w.store.appointments.filter((a) => holdIds.includes(a.id));
    expect(holds.find((a) => a.businessId === live.id)?.status).toBe("expired");
    expect(holds.find((a) => a.businessId === demo.id)?.status).toBe("expired");
    expect(w.store.activity.filter((a) => a.action === "hold_expired").map((a) => a.businessId).sort()).toEqual([live.id, demo.id].sort());
    expect(recorded(w.liveMessaging)).toHaveLength(0);
    expect(w.store.notifications).toHaveLength(0);
    expect(await runHoldsExpiry(w.deps)).toMatchObject({ done: 0 });
  });
});

describe("cron HTTP handler", () => {
  const SECRET = "cron-secret-for-tests-123";
  const call = (auth?: string) =>
    runCronRequest(new Request("https://keeper.test/api/cron/reminders", { headers: auth ? { authorization: auth } : {} }), {
      job: "reminders",
      run: runReminders,
      cronSecret: SECRET,
      deps: () => world().deps,
    });

  it("rejects calls without the bearer secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-secret-wrong-secret")).status).toBe(401);
  });

  it("runs the job with the secret and reports totals", async () => {
    const response = await call(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, job: "reminders", done: 1 });
  });
});
