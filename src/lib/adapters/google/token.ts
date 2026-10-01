import { createHash } from "node:crypto";
import { z } from "zod";
import { GoogleApiError, GoogleDisconnectedError, googleErrorReason } from "./errors";
import { fetchWithRetry, readJson, type HttpOptions } from "./http";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Refresh a little early so a token never expires mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/** In-memory access-token cache. Keys never contain the refresh token itself (only a short hash). */
export class TokenCache {
  private readonly entries = new Map<string, CachedToken>();

  get(key: string, now: number): string | null {
    const entry = this.entries.get(key);
    if (entry === undefined || entry.expiresAt - EXPIRY_MARGIN_MS <= now) return null;
    return entry.accessToken;
  }

  set(key: string, token: CachedToken): void {
    this.entries.set(key, token);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}

/** Process-wide cache: adapters are built per request, the access token outlives them (~1h). */
export const sharedTokenCache = new TokenCache();

/**
 * Cache key bound to the business AND the refresh token, so reconnecting a different Google account
 * never serves the previous account's access token.
 */
export function tokenCacheKey(businessId: string, refreshToken: string): string {
  return `${businessId}:${createHash("sha256").update(refreshToken).digest("hex").slice(0, 16)}`;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  scope: z.string().optional(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/** POSTs a form to Google's token endpoint. `invalid_grant` becomes `GoogleDisconnectedError`. */
export async function postTokenRequest(
  client: OAuthClient,
  params: Record<string, string>,
  http: HttpOptions,
  context: { businessId: string; operation: string },
): Promise<TokenResponse> {
  const body = new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...params });
  const response = await fetchWithRetry(
    GOOGLE_TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() },
    http,
  );
  const json = await readJson(response);
  if (!response.ok) {
    const reason = googleErrorReason(json);
    if (reason === "invalid_grant") throw new GoogleDisconnectedError(context.businessId);
    throw new GoogleApiError(context.operation, response.status, reason);
  }
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) throw new GoogleApiError(context.operation, response.status, "malformed token response");
  return parsed.data;
}

export function refreshAccessToken(client: OAuthClient, refreshToken: string, businessId: string, http: HttpOptions): Promise<TokenResponse> {
  return postTokenRequest(client, { grant_type: "refresh_token", refresh_token: refreshToken }, http, {
    businessId,
    operation: "token refresh",
  });
}
