import { describe, expect, it } from "vitest";
import { createGoogleCalendar, mapFreeBusy, type ActivityLogger } from "@/lib/adapters/google/calendar";
import { GoogleApiError, GoogleDisconnectedError, GoogleNotConnectedError } from "@/lib/adapters/google/errors";
import { fetchWithRetry } from "@/lib/adapters/google/http";
import { GOOGLE_TOKEN_URL, TokenCache } from "@/lib/adapters/google/token";
import { IntegrationCredentials, MemoryIntegrationRepo } from "@/lib/integrations/repo";
import type { ActivityEntry } from "@/lib/schemas/entities";

const KEY = "c".repeat(64);
const BIZ = "11111111-1111-4111-8111-111111111111";
const API = "https://www.googleapis.com/calendar/v3";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Responder = (call: Call) => Response;

/** Records every request and answers from a queue of responders (the last one repeats). */
function mockFetch(responders: Responder[]) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)]!;
    return responder(call);
  };
  return { fn, calls };
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const tokenOk = (token = "access-1", expiresIn = 3600) => json(200, { access_token: token, expires_in: expiresIn, token_type: "Bearer" });
const noSleep = async () => undefined;

async function setup(responders: Responder[], opts: { connected?: boolean; now?: () => number; logs?: ActivityEntry[] } = {}) {
  const credentials = new IntegrationCredentials(new MemoryIntegrationRepo(), KEY);
  if (opts.connected !== false) await credentials.save(BIZ, "google_calendar", { refreshToken: "refresh-xyz", calendarId: "primary" }, "dueña@gmail.com");
  const http = mockFetch(responders);
  const logs = opts.logs ?? [];
  const logActivity: ActivityLogger = async (entry) => {
    logs.push(entry);
  };
  const calendar = createGoogleCalendar({
    clientId: "cid",
    clientSecret: "csecret",
    credentials,
    businessId: BIZ,
    fetch: http.fn,
    logActivity,
    tokenCache: new TokenCache(),
    now: opts.now,
    sleep: noSleep,
  });
  return { calendar, calls: http.calls, logs };
}

const range = { start: new Date("2026-10-01T12:00:00Z"), end: new Date("2026-10-02T04:00:00Z") };

describe("token refresh and caching", () => {
  it("refreshes once with the stored refresh token and reuses the cached access token", async () => {
    const { calendar, calls } = await setup([tokenOk(), json(200, { calendars: { primary: { busy: [] } } })]);
    await calendar.getBusy("primary", range);
    await calendar.getBusy("primary", range);
    const tokenCalls = calls.filter((c) => c.url === GOOGLE_TOKEN_URL);
    expect(tokenCalls).toHaveLength(1);
    const form = new URLSearchParams(tokenCalls[0]!.body);
    expect(Object.fromEntries(form)).toEqual({ client_id: "cid", client_secret: "csecret", grant_type: "refresh_token", refresh_token: "refresh-xyz" });
    expect(tokenCalls[0]!.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const apiCalls = calls.filter((c) => c.url.startsWith(API));
    expect(apiCalls).toHaveLength(2);
    apiCalls.forEach((c) => expect(c.headers.Authorization).toBe("Bearer access-1"));
  });

  it("refreshes again once the cached token is about to expire", async () => {
    let now = 1_000_000;
    let tokenN = 0;
    const responder: Responder = (call) =>
      call.url === GOOGLE_TOKEN_URL ? tokenOk(`access-${++tokenN}`, 3600)() : json(200, { calendars: { primary: { busy: [] } } })();
    const { calendar, calls } = await setup([responder], { now: () => now });
    await calendar.getBusy("primary", range);
    now += 3600_000 - 30_000; // inside the 60s safety margin
    await calendar.getBusy("primary", range);
    expect(calls.filter((c) => c.url === GOOGLE_TOKEN_URL)).toHaveLength(2);
    expect(calls.at(-1)!.headers.Authorization).toBe("Bearer access-2");
  });

  it("drops the cached token and retries once when the API answers 401", async () => {
    let tokenN = 0;
    let apiN = 0;
    const responder: Responder = (call) => {
      if (call.url === GOOGLE_TOKEN_URL) return tokenOk(`access-${++tokenN}`)();
      return ++apiN === 1 ? json(401, { error: { status: "UNAUTHENTICATED" } })() : json(200, { calendars: { primary: { busy: [] } } })();
    };
    const { calendar, calls } = await setup([responder]);
    await expect(calendar.getBusy("primary", range)).resolves.toEqual([]);
    expect(calls.filter((c) => c.url === GOOGLE_TOKEN_URL)).toHaveLength(2);
  });
});

describe("invalid_grant", () => {
  it("logs 'Google desconectado' to activity_log and throws a typed error", async () => {
    const { calendar, logs, calls } = await setup([json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." })]);
    const error = await calendar.getBusy("primary", range).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleDisconnectedError);
    expect((error as GoogleDisconnectedError).code).toBe("google_disconnected");
    expect(calls).toHaveLength(1); // 4xx is never retried
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ businessId: BIZ, action: "google_disconnected", reason: "Google desconectado, reconectar en Ajustes", entity: "integration" });
    expect(JSON.stringify(logs)).not.toContain("refresh-xyz");
  });

  it("other token errors are GoogleApiError without logging a disconnect", async () => {
    const { calendar, logs } = await setup([json(401, { error: "invalid_client" })]);
    const error = await calendar.getBusy("primary", range).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleApiError);
    expect((error as GoogleApiError).detail).toBe("invalid_client");
    expect(logs).toHaveLength(0);
  });

  it("a business without an integration row gets GoogleNotConnectedError and no HTTP call", async () => {
    const { calendar, calls } = await setup([tokenOk()], { connected: false });
    await expect(calendar.getBusy("primary", range)).rejects.toBeInstanceOf(GoogleNotConnectedError);
    expect(calls).toHaveLength(0);
  });
});

describe("freeBusy → Interval", () => {
  it("sends the freeBusy query and maps busy blocks to Interval[]", async () => {
    const { calendar, calls } = await setup([
      tokenOk(),
      json(200, {
        kind: "calendar#freeBusy",
        calendars: {
          primary: {
            busy: [
              { start: "2026-10-01T14:00:00Z", end: "2026-10-01T15:30:00Z" },
              { start: "2026-10-01T18:00:00-04:00", end: "2026-10-01T19:00:00-04:00" },
            ],
          },
        },
      }),
    ]);
    const busy = await calendar.getBusy("primary", range);
    expect(busy).toEqual([
      { start: new Date("2026-10-01T14:00:00Z"), end: new Date("2026-10-01T15:30:00Z") },
      { start: new Date("2026-10-01T22:00:00Z"), end: new Date("2026-10-01T23:00:00Z") },
    ]);
    const req = calls[1]!;
    expect(req.url).toBe(`${API}/freeBusy`);
    expect(req.method).toBe("POST");
    expect(JSON.parse(req.body!)).toEqual({ timeMin: "2026-10-01T12:00:00.000Z", timeMax: "2026-10-02T04:00:00.000Z", items: [{ id: "primary" }] });
  });

  it("defaults an empty calendarRef to the stored calendar id", async () => {
    const { calendar, calls } = await setup([tokenOk(), json(200, { calendars: { primary: { busy: [] } } })]);
    await calendar.getBusy("", range);
    expect(JSON.parse(calls[1]!.body!).items).toEqual([{ id: "primary" }]);
  });

  it("mapFreeBusy rejects per-calendar errors and skips malformed blocks", () => {
    expect(() => mapFreeBusy({ calendars: { primary: { errors: [{ domain: "global", reason: "notFound" }], busy: [] } } }, "primary")).toThrow(/notFound/);
    expect(() => mapFreeBusy({}, "primary")).toThrow(GoogleApiError);
    expect(mapFreeBusy({ calendars: { "a@b.com": { busy: [{ start: "x", end: "y" }, { start: "2026-10-01T10:00:00Z" }] } } }, "primary")).toEqual([]);
  });

  it("retries on 5xx and 429 with backoff, then succeeds", async () => {
    let apiN = 0;
    const responder: Responder = (call) => {
      if (call.url === GOOGLE_TOKEN_URL) return tokenOk()();
      apiN++;
      if (apiN === 1) return json(503, {})();
      if (apiN === 2) return json(429, {})();
      return json(200, { calendars: { primary: { busy: [] } } })();
    };
    const { calendar } = await setup([responder]);
    await expect(calendar.getBusy("primary", range)).resolves.toEqual([]);
    expect(apiN).toBe(3);
  });

  it("gives up after the retry budget and surfaces the status", async () => {
    const { calendar } = await setup([tokenOk(), json(500, { error: { status: "INTERNAL" } })]);
    await expect(calendar.getBusy("primary", range)).rejects.toMatchObject({ name: "GoogleApiError", status: 500, detail: "INTERNAL" });
  });
});

describe("events API request shape", () => {
  const event = {
    calendarRef: "primary",
    summary: "Facial hidratante — María",
    description: "Reservado por Keeper",
    start: new Date("2026-10-01T14:00:00Z"),
    end: new Date("2026-10-01T15:00:00Z"),
  };

  it("createEvent POSTs to events.insert with a client-chosen id and returns Google's id", async () => {
    const { calendar, calls } = await setup([tokenOk(), (call) => json(200, { id: JSON.parse(call.body!).id, status: "confirmed" })()]);
    const { eventId } = await calendar.createEvent(event);
    const req = calls[1]!;
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${API}/calendars/primary/events?sendUpdates=none`);
    expect(req.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(req.body!);
    expect(body).toEqual({
      id: expect.stringMatching(/^[0-9a-v]{5,1024}$/),
      summary: "Facial hidratante — María",
      description: "Reservado por Keeper",
      start: { dateTime: "2026-10-01T14:00:00.000Z" },
      end: { dateTime: "2026-10-01T15:00:00.000Z" },
    });
    expect(eventId).toBe(body.id);
  });

  it("a retried insert that already landed (409) resolves with the same id instead of duplicating", async () => {
    const { calendar, calls } = await setup([tokenOk(), json(502, {}), json(409, { error: { status: "ALREADY_EXISTS" } })]);
    const { eventId } = await calendar.createEvent(event);
    const inserts = calls.filter((c) => c.method === "POST" && c.url.includes("/events"));
    expect(inserts).toHaveLength(2);
    expect(JSON.parse(inserts[0]!.body!).id).toBe(JSON.parse(inserts[1]!.body!).id);
    expect(eventId).toBe(JSON.parse(inserts[0]!.body!).id);
  });

  it("encodes non-primary calendar ids in the path", async () => {
    const { calendar, calls } = await setup([tokenOk(), json(200, { id: "evt" })]);
    await calendar.createEvent({ ...event, calendarRef: "spa@group.calendar.google.com" });
    expect(calls[1]!.url).toBe(`${API}/calendars/spa%40group.calendar.google.com/events?sendUpdates=none`);
  });

  it("deleteEvent sends DELETE and treats 404/410 as already deleted", async () => {
    const ok = await setup([tokenOk(), () => new Response(null, { status: 204 })]);
    await ok.calendar.deleteEvent("primary", "abc123");
    expect(ok.calls[1]).toMatchObject({ method: "DELETE", url: `${API}/calendars/primary/events/abc123?sendUpdates=none` });
    expect(ok.calls[1]!.headers.Authorization).toBe("Bearer access-1");

    const gone = await setup([tokenOk(), json(410, { error: { status: "GONE" } })]);
    await expect(gone.calendar.deleteEvent("primary", "abc123")).resolves.toBeUndefined();

    const forbidden = await setup([tokenOk(), json(403, { error: { status: "PERMISSION_DENIED" } })]);
    await expect(forbidden.calendar.deleteEvent("primary", "abc123")).rejects.toMatchObject({ status: 403 });
  });

  it("kind is google", async () => {
    const { calendar } = await setup([tokenOk()]);
    expect(calendar.kind).toBe("google");
  });
});

describe("fetchWithRetry", () => {
  it("does not retry 4xx and rethrows network errors after the last attempt", async () => {
    const four = mockFetch([json(400, {})]);
    expect((await fetchWithRetry("https://x", {}, { fetch: four.fn, sleep: noSleep })).status).toBe(400);
    expect(four.calls).toHaveLength(1);

    let n = 0;
    const failing = async () => {
      n++;
      throw new TypeError("network down");
    };
    await expect(fetchWithRetry("https://x", {}, { fetch: failing, sleep: noSleep, retries: 2 })).rejects.toThrow("network down");
    expect(n).toBe(3);
  });
});
