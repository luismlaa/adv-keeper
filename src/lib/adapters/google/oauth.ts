import { postTokenRequest, type OAuthClient, type TokenResponse } from "./token";
import type { HttpOptions } from "./http";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const CALLBACK_PATH = "/api/integrations/google/callback";

export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
] as const;

/** `openid email` only to label the connection with the account email (no extra data is read). */
export const GOOGLE_SCOPES = [...CALENDAR_SCOPES, "openid", "email"] as const;

export function redirectUri(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}${CALLBACK_PATH}`;
}

export function buildAuthUrl(input: { clientId: string; appUrl: string; state: string; loginHint?: string | null }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", redirectUri(input.appUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

export function exchangeCode(client: OAuthClient, code: string, appUrl: string, businessId: string, http: HttpOptions): Promise<TokenResponse> {
  return postTokenRequest(client, { grant_type: "authorization_code", code, redirect_uri: redirectUri(appUrl) }, http, {
    businessId,
    operation: "code exchange",
  });
}

/** With granular consent the owner may untick a scope; both calendar scopes are required. */
export function hasCalendarScopes(grantedScope: string | undefined): boolean {
  if (grantedScope === undefined) return false;
  const granted = new Set(grantedScope.split(/\s+/));
  return CALENDAR_SCOPES.every((s) => granted.has(s));
}

/**
 * Reads the `email` claim of the id_token. The token came straight from Google's token endpoint over
 * TLS, so (per OpenID Connect) its signature need not be re-verified; it is only used as a label.
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}
