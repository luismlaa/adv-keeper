import { describe, expect, it } from "vitest";
import { beginGoogleConnection, completeGoogleConnection, type OwnerIdentity } from "@/lib/adapters/google/connect";
import { googleCredentialsSchema } from "@/lib/adapters/google/credentials";
import { buildAuthUrl, CALENDAR_SCOPES, emailFromIdToken, hasCalendarScopes, redirectUri } from "@/lib/adapters/google/oauth";
import { signState, STATE_TTL_MS, verifyState } from "@/lib/adapters/google/oauth-state";
import { GOOGLE_TOKEN_URL } from "@/lib/adapters/google/token";
import { IntegrationCredentials, MemoryIntegrationRepo } from "@/lib/integrations/repo";

const SECRET = "d".repeat(64);
const NOW = 1_800_000_000_000;
const OWNER: OwnerIdentity = { userId: "user-1", businessId: "biz-1", email: "duena@spa.do" };
const claims = { userId: "user-1", businessId: "biz-1", nonce: "nonce-0123456789abcdef" };
const expected = { userId: "user-1", businessId: "biz-1", nonce: claims.nonce };

describe("OAuth state signing", () => {
  it("round-trips for the same user, business and nonce", () => {
    const token = signState(claims, SECRET, NOW);
    expect(verifyState(token, SECRET, expected, NOW + 1000)).toEqual({ ok: true, claims });
  });

  it("rejects a tampered payload or signature", () => {
    const token = signState(claims, SECRET, NOW);
    const [data, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ u: "user-1", b: "biz-2", n: claims.nonce, exp: NOW + STATE_TTL_MS })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, SECRET, expected, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyState(`${data}.${sig.slice(0, -2)}xx`, SECRET, expected, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyState(token, "e".repeat(64), expected, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects malformed input", () => {
    expect(verifyState(undefined, SECRET, expected, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyState("nodot", SECRET, expected, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyState("a.b.c", SECRET, expected, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects an expired state", () => {
    const token = signState(claims, SECRET, NOW);
    expect(verifyState(token, SECRET, expected, NOW + STATE_TTL_MS)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a state issued for another business or another user", () => {
    const token = signState(claims, SECRET, NOW);
    expect(verifyState(token, SECRET, { ...expected, businessId: "biz-2" }, NOW)).toEqual({ ok: false, reason: "wrong_business" });
    expect(verifyState(token, SECRET, { ...expected, userId: "user-2" }, NOW)).toEqual({ ok: false, reason: "wrong_user" });
  });

  it("rejects a missing or different nonce cookie (login CSRF)", () => {
    const token = signState(claims, SECRET, NOW);
    expect(verifyState(token, SECRET, { ...expected, nonce: undefined }, NOW)).toEqual({ ok: false, reason: "nonce_mismatch" });
    expect(verifyState(token, SECRET, { ...expected, nonce: "other-nonce-0123456789" }, NOW)).toEqual({ ok: false, reason: "nonce_mismatch" });
  });
});

describe("authorization URL", () => {
  it("asks for offline access, forced consent and the calendar scopes", () => {
    const url = new URL(buildAuthUrl({ clientId: "cid.apps.googleusercontent.com", appUrl: "https://adv-keeper.vercel.app/", state: "s.t" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe("https://adv-keeper.vercel.app/api/integrations/google/callback");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("s.t");
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual(expect.arrayContaining([...CALENDAR_SCOPES]));
    expect(scopes).not.toContain("https://www.googleapis.com/auth/calendar");
  });

  it("beginGoogleConnection binds the state to the owner and a fresh nonce", () => {
    const { url, nonce } = beginGoogleConnection({ client: { clientId: "cid" }, appUrl: "http://localhost:3000", secret: SECRET, owner: OWNER, now: NOW });
    const state = new URL(url).searchParams.get("state");
    expect(new URL(url).searchParams.get("login_hint")).toBe("duena@spa.do");
    expect(verifyState(state, SECRET, { userId: "user-1", businessId: "biz-1", nonce }, NOW)).toMatchObject({ ok: true });
    expect(beginGoogleConnection({ client: { clientId: "cid" }, appUrl: "x", secret: SECRET, owner: OWNER, now: NOW }).nonce).not.toBe(nonce);
  });

  it("helpers: redirect URI, granted scopes and id_token email", () => {
    expect(redirectUri("http://localhost:3000")).toBe("http://localhost:3000/api/integrations/google/callback");
    expect(hasCalendarScopes(CALENDAR_SCOPES.join(" ") + " openid")).toBe(true);
    expect(hasCalendarScopes(CALENDAR_SCOPES[0])).toBe(false);
    expect(hasCalendarScopes(undefined)).toBe(false);
    const idToken = `h.${Buffer.from(JSON.stringify({ email: "duena@gmail.com" })).toString("base64url")}.sig`;
    expect(emailFromIdToken(idToken)).toBe("duena@gmail.com");
    expect(emailFromIdToken("garbage")).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
  });
});

describe("callback: completeGoogleConnection", () => {
  const idToken = `h.${Buffer.from(JSON.stringify({ email: "duena@gmail.com" })).toString("base64url")}.sig`;
  const grantedScope = [...CALENDAR_SCOPES, "openid", "https://www.googleapis.com/auth/userinfo.email"].join(" ");

  function harness(tokenBody: unknown, status = 200) {
    const repo = new MemoryIntegrationRepo();
    const credentials = new IntegrationCredentials(repo, SECRET);
    const requests: { url: string; body: string }[] = [];
    const fetch = async (url: string, init?: RequestInit) => {
      requests.push({ url, body: String(init?.body) });
      return new Response(JSON.stringify(tokenBody), { status });
    };
    const nonce = "nonce-callback-0123456789";
    const state = signState({ userId: OWNER.userId, businessId: OWNER.businessId, nonce }, SECRET, NOW);
    const run = (params: Record<string, string>, overrides: { nonceCookie?: string; owner?: OwnerIdentity; now?: number } = {}) =>
      completeGoogleConnection({
        params: new URLSearchParams(params),
        nonceCookie: "nonceCookie" in overrides ? overrides.nonceCookie : nonce,
        owner: overrides.owner ?? OWNER,
        client: { clientId: "cid", clientSecret: "csecret" },
        appUrl: "https://adv-keeper.vercel.app",
        secret: SECRET,
        credentials,
        now: overrides.now ?? NOW + 5_000,
        fetch,
        sleep: async () => undefined,
      });
    return { repo, credentials, requests, state, run };
  }

  it("exchanges the code and stores { refreshToken, calendarId: 'primary' } encrypted with the account email", async () => {
    const h = harness({ access_token: "a", expires_in: 3599, refresh_token: "rt-secret", scope: grantedScope, id_token: idToken });
    await expect(h.run({ code: "auth-code", state: h.state })).resolves.toEqual({ ok: true, accountEmail: "duena@gmail.com" });

    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.url).toBe(GOOGLE_TOKEN_URL);
    expect(Object.fromEntries(new URLSearchParams(h.requests[0]!.body))).toEqual({
      client_id: "cid",
      client_secret: "csecret",
      grant_type: "authorization_code",
      code: "auth-code",
      redirect_uri: "https://adv-keeper.vercel.app/api/integrations/google/callback",
    });
    expect(h.repo.rows).toHaveLength(1);
    expect(h.repo.rows[0]).toMatchObject({ businessId: "biz-1", provider: "google_calendar", accountEmail: "duena@gmail.com" });
    expect(h.repo.rows[0]!.encryptedCredentials).not.toContain("rt-secret");
    await expect(h.credentials.read("biz-1", "google_calendar", googleCredentialsSchema)).resolves.toEqual({ refreshToken: "rt-secret", calendarId: "primary" });
  });

  it("refuses tampered, expired, other-business and nonce-less callbacks without calling Google", async () => {
    const h = harness({ access_token: "a", expires_in: 3599, refresh_token: "rt", scope: grantedScope });
    await expect(h.run({ code: "c", state: h.state.slice(0, -3) + "AAA" })).resolves.toMatchObject({ ok: false, reason: "bad_signature" });
    await expect(h.run({ code: "c", state: h.state }, { now: NOW + STATE_TTL_MS + 1 })).resolves.toMatchObject({ ok: false, reason: "expired" });
    await expect(h.run({ code: "c", state: h.state }, { owner: { ...OWNER, businessId: "biz-2" } })).resolves.toMatchObject({ ok: false, reason: "wrong_business" });
    await expect(h.run({ code: "c", state: h.state }, { nonceCookie: undefined })).resolves.toMatchObject({ ok: false, reason: "nonce_mismatch" });
    expect(h.requests).toHaveLength(0);
    expect(h.repo.rows).toHaveLength(0);
  });

  it("handles a denied consent and a missing code", async () => {
    const h = harness({});
    await expect(h.run({ error: "access_denied", state: h.state })).resolves.toEqual({ ok: false, reason: "denied", detail: "access_denied" });
    await expect(h.run({ state: h.state })).resolves.toEqual({ ok: false, reason: "missing_code" });
    expect(h.requests).toHaveLength(0);
  });

  it("refuses when a calendar scope was unticked or no refresh token came back", async () => {
    const partial = harness({ access_token: "a", expires_in: 3599, refresh_token: "rt", scope: CALENDAR_SCOPES[0] });
    await expect(partial.run({ code: "c", state: partial.state })).resolves.toEqual({ ok: false, reason: "missing_scopes" });
    const noRefresh = harness({ access_token: "a", expires_in: 3599, scope: grantedScope });
    await expect(noRefresh.run({ code: "c", state: noRefresh.state })).resolves.toEqual({ ok: false, reason: "missing_refresh_token" });
    expect(partial.repo.rows).toHaveLength(0);
    expect(noRefresh.repo.rows).toHaveLength(0);
  });

  it("maps a failed code exchange (e.g. reused code) to exchange_failed", async () => {
    const h = harness({ error: "invalid_grant", error_description: "Bad Request" }, 400);
    await expect(h.run({ code: "used", state: h.state })).resolves.toEqual({ ok: false, reason: "exchange_failed", detail: "invalid_grant" });
    const down = harness({ error: { status: "UNAVAILABLE" } }, 503);
    await expect(down.run({ code: "c", state: down.state })).resolves.toMatchObject({ ok: false, reason: "exchange_failed" });
    expect(down.requests).toHaveLength(3); // initial try + 2 retries on 5xx
  });
});
