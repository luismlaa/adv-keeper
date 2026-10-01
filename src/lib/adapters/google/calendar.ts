import { randomUUID } from "node:crypto";
import type { CalendarEventInput, CalendarProvider } from "@/lib/adapters/calendar/types";
import type { Interval } from "@/lib/domain/time";
import type { IntegrationCredentials } from "@/lib/integrations/repo";
import type { ActivityEntry } from "@/lib/schemas/entities";
import { googleCredentialsSchema, GOOGLE_PROVIDER, type GoogleCredentials } from "./credentials";
import { GoogleApiError, GoogleDisconnectedError, GoogleNotConnectedError, googleErrorReason } from "./errors";
import { fetchWithRetry, readJson, type FetchLike, type HttpOptions, type Sleep } from "./http";
import { refreshAccessToken, sharedTokenCache, tokenCacheKey, type TokenCache } from "./token";

export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
export const DEFAULT_CALENDAR_ID = "primary";

export type ActivityLogger = (entry: ActivityEntry) => Promise<void>;

export interface GoogleCalendarOptions {
  clientId: string;
  clientSecret: string;
  credentials: IntegrationCredentials;
  businessId: string;
  fetch?: FetchLike;
  /** Writes to `activity_log` (D4 passes `store.logActivity`). Without it, events go to the server log. */
  logActivity?: ActivityLogger;
  tokenCache?: TokenCache;
  now?: () => number;
  sleep?: Sleep;
  timeoutMs?: number;
}

interface BusyBlock {
  start?: unknown;
  end?: unknown;
}

/** Maps a freeBusy response to `Interval[]` for one calendar. Throws when Google reports a per-calendar error. */
export function mapFreeBusy(body: unknown, calendarId: string): Interval[] {
  const calendars = (body as { calendars?: Record<string, { busy?: BusyBlock[]; errors?: { reason?: string }[] }> } | null)?.calendars;
  if (calendars === undefined || calendars === null) throw new GoogleApiError("freeBusy", 200, "missing calendars");
  // Google keys the result by the requested id; fall back to the only entry if it normalised the key.
  const entries = Object.values(calendars);
  const calendar = calendars[calendarId] ?? (entries.length === 1 ? entries[0] : undefined);
  if (calendar === undefined) throw new GoogleApiError("freeBusy", 200, "calendar not in response");
  if (calendar.errors !== undefined && calendar.errors.length > 0) {
    throw new GoogleApiError("freeBusy", 200, calendar.errors[0]?.reason ?? "calendar error");
  }
  return (calendar.busy ?? []).flatMap((block) => {
    if (typeof block.start !== "string" || typeof block.end !== "string") return [];
    const start = new Date(block.start);
    const end = new Date(block.end);
    return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start ? [] : [{ start, end }];
  });
}

/** Event ids must be base32hex (0-9, a-v), 5–1024 chars: a dash-less UUID qualifies. */
export function newEventId(): string {
  return randomUUID().replace(/-/g, "");
}

/**
 * Live `CalendarProvider` backed by the business's own Google Calendar. The refresh token comes from
 * `integrations` (encrypted); access tokens are cached in memory until shortly before they expire.
 */
export function createGoogleCalendar(options: GoogleCalendarOptions): CalendarProvider {
  const { businessId } = options;
  const http: HttpOptions = { fetch: options.fetch ?? fetch, sleep: options.sleep, timeoutMs: options.timeoutMs };
  const cache = options.tokenCache ?? sharedTokenCache;
  const now = options.now ?? Date.now;
  const log: ActivityLogger =
    options.logActivity ??
    (async (entry) => {
      console.warn("[google-calendar]", entry.action, { businessId: entry.businessId, reason: entry.reason });
    });

  let credentialsPromise: Promise<GoogleCredentials> | undefined;
  const loadCredentials = (): Promise<GoogleCredentials> => {
    credentialsPromise ??= options.credentials.read(businessId, GOOGLE_PROVIDER, googleCredentialsSchema).then((c) => {
      if (c === null) throw new GoogleNotConnectedError(businessId);
      return c;
    });
    return credentialsPromise;
  };

  async function accessToken(): Promise<string> {
    const { refreshToken } = await loadCredentials();
    const key = tokenCacheKey(businessId, refreshToken);
    const cached = cache.get(key, now());
    if (cached !== null) return cached;
    try {
      const token = await refreshAccessToken(options, refreshToken, businessId, http);
      cache.set(key, { accessToken: token.access_token, expiresAt: now() + token.expires_in * 1000 });
      return token.access_token;
    } catch (error) {
      if (error instanceof GoogleDisconnectedError) {
        await log({
          businessId,
          actor: "system:google-calendar",
          entity: "integration",
          entityId: GOOGLE_PROVIDER,
          action: "google_disconnected",
          reason: "Google desconectado, reconectar en Ajustes",
        }).catch(() => undefined);
      }
      throw error;
    }
  }

  async function invalidateToken(): Promise<void> {
    const { refreshToken } = await loadCredentials();
    cache.delete(tokenCacheKey(businessId, refreshToken));
  }

  /** Authorized call; a 401 (token revoked early) drops the cached token and retries once. */
  async function call(path: string, init: { method: string; headers?: Record<string, string>; body?: string }): Promise<Response> {
    const send = async () =>
      fetchWithRetry(`${GOOGLE_CALENDAR_API}${path}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` } }, http);
    const response = await send();
    if (response.status !== 401) return response;
    await invalidateToken();
    return send();
  }

  async function resolveRef(calendarRef: string): Promise<string> {
    const ref = calendarRef.trim();
    return ref !== "" ? ref : (await loadCredentials()).calendarId || DEFAULT_CALENDAR_ID;
  }

  const json = { "Content-Type": "application/json" };

  return {
    kind: "google",

    async getBusy(calendarRef: string, range: Interval): Promise<Interval[]> {
      const id = await resolveRef(calendarRef);
      const response = await call("/freeBusy", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ timeMin: range.start.toISOString(), timeMax: range.end.toISOString(), items: [{ id }] }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new GoogleApiError("freeBusy", response.status, googleErrorReason(body));
      return mapFreeBusy(body, id);
    },

    async createEvent(input: CalendarEventInput): Promise<{ eventId: string }> {
      const id = await resolveRef(input.calendarRef);
      // Client-chosen id: a retried POST that already succeeded answers 409 instead of duplicating.
      const eventId = newEventId();
      const response = await call(`/calendars/${encodeURIComponent(id)}/events?sendUpdates=none`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          id: eventId,
          summary: input.summary,
          description: input.description,
          start: { dateTime: input.start.toISOString() },
          end: { dateTime: input.end.toISOString() },
        }),
      });
      if (response.status === 409) return { eventId };
      const body = await readJson(response);
      if (!response.ok) throw new GoogleApiError("events.insert", response.status, googleErrorReason(body));
      const returned = (body as { id?: unknown } | null)?.id;
      return { eventId: typeof returned === "string" ? returned : eventId };
    },

    async deleteEvent(calendarRef: string, eventId: string): Promise<void> {
      const id = await resolveRef(calendarRef);
      const response = await call(`/calendars/${encodeURIComponent(id)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
        method: "DELETE",
      });
      // 404/410: already gone — deleting is idempotent.
      if (response.ok || response.status === 404 || response.status === 410) return;
      throw new GoogleApiError("events.delete", response.status, googleErrorReason(await readJson(response)));
    },
  };
}
