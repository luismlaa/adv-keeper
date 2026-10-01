import type { IntegrationCredentials } from "@/lib/integrations/repo";
import { GOOGLE_PROVIDER, type GoogleCredentials } from "./credentials";
import { GoogleApiError, GoogleDisconnectedError } from "./errors";
import type { FetchLike, Sleep } from "./http";
import { buildAuthUrl, emailFromIdToken, exchangeCode, hasCalendarScopes } from "./oauth";
import { newNonce, signState, verifyState, type StateFailure } from "./oauth-state";
import type { OAuthClient } from "./token";
import { DEFAULT_CALENDAR_ID } from "./calendar";

/**
 * The OAuth flow minus Next.js plumbing, so the route handlers stay thin and every branch is unit
 * tested. Owner identity (user + business) always comes from the RLS-verified session, never the URL.
 */

export interface OwnerIdentity {
  userId: string;
  businessId: string;
  email: string | null;
}

export function beginGoogleConnection(input: {
  client: Pick<OAuthClient, "clientId">;
  appUrl: string;
  secret: string;
  owner: OwnerIdentity;
  now: number;
}): { url: string; nonce: string } {
  const nonce = newNonce();
  const state = signState({ userId: input.owner.userId, businessId: input.owner.businessId, nonce }, input.secret, input.now);
  return { url: buildAuthUrl({ clientId: input.client.clientId, appUrl: input.appUrl, state, loginHint: input.owner.email }), nonce };
}

export type ConnectFailure =
  | StateFailure
  | "denied"
  | "missing_code"
  | "missing_refresh_token"
  | "missing_scopes"
  | "exchange_failed";

export type ConnectResult = { ok: true; accountEmail: string | null } | { ok: false; reason: ConnectFailure; detail?: string };

export async function completeGoogleConnection(input: {
  params: URLSearchParams;
  nonceCookie: string | undefined;
  owner: OwnerIdentity;
  client: OAuthClient;
  appUrl: string;
  secret: string;
  credentials: IntegrationCredentials;
  now: number;
  fetch?: FetchLike;
  sleep?: Sleep;
}): Promise<ConnectResult> {
  const { params, owner } = input;
  const state = verifyState(params.get("state"), input.secret, { userId: owner.userId, businessId: owner.businessId, nonce: input.nonceCookie }, input.now);
  if (!state.ok) return { ok: false, reason: state.reason };
  if (params.get("error") !== null) return { ok: false, reason: "denied", detail: params.get("error") ?? undefined };
  const code = params.get("code");
  if (!code) return { ok: false, reason: "missing_code" };

  let token;
  try {
    token = await exchangeCode(input.client, code, input.appUrl, owner.businessId, { fetch: input.fetch ?? fetch, sleep: input.sleep });
  } catch (error) {
    if (error instanceof GoogleApiError || error instanceof GoogleDisconnectedError) {
      return { ok: false, reason: "exchange_failed", detail: error instanceof GoogleApiError ? `${error.status} ${error.detail ?? ""}`.trim() : "invalid_grant" };
    }
    throw error;
  }
  if (!hasCalendarScopes(token.scope)) return { ok: false, reason: "missing_scopes" };
  if (!token.refresh_token) return { ok: false, reason: "missing_refresh_token" };

  const accountEmail = emailFromIdToken(token.id_token);
  const stored: GoogleCredentials = { refreshToken: token.refresh_token, calendarId: DEFAULT_CALENDAR_ID };
  await input.credentials.save(owner.businessId, GOOGLE_PROVIDER, stored, accountEmail);
  return { ok: true, accountEmail };
}
