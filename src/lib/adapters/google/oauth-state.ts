import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * OAuth `state`: `<base64url(json)>.<hmac>`, HMAC-SHA256 keyed from ENCRYPTION_KEY. It binds the
 * redirect to the signed-in user, her business and a nonce kept in an httpOnly cookie, and expires
 * after `STATE_TTL_MS`, so a stolen or replayed callback URL cannot attach a calendar to another tenant.
 */

export const STATE_TTL_MS = 10 * 60_000;
export const NONCE_COOKIE = "keeper_google_oauth";

const payloadSchema = z.strictObject({
  u: z.string().min(1),
  b: z.string().min(1),
  n: z.string().min(16),
  exp: z.number().int().positive(),
});

export interface StateClaims {
  userId: string;
  businessId: string;
  nonce: string;
}

export type StateFailure = "malformed" | "bad_signature" | "expired" | "nonce_mismatch" | "wrong_user" | "wrong_business";
export type StateVerification = { ok: true; claims: StateClaims } | { ok: false; reason: StateFailure };

export function newNonce(): string {
  return randomBytes(24).toString("base64url");
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", `keeper:google-oauth-state:${secret}`).update(data).digest("base64url");
}

export function signState(claims: StateClaims, secret: string, now: number, ttlMs = STATE_TTL_MS): string {
  const data = Buffer.from(JSON.stringify({ u: claims.userId, b: claims.businessId, n: claims.nonce, exp: now + ttlMs })).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Verifies signature first, then expiry, nonce cookie, user and business — in that order. */
export function verifyState(
  token: string | null | undefined,
  secret: string,
  expected: { userId: string; businessId: string; nonce: string | null | undefined },
  now: number,
): StateVerification {
  if (!token) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [data, signature] = parts as [string, string];
  if (!safeEqual(signature, sign(data, secret))) return { ok: false, reason: "bad_signature" };

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  const payload = parsed.data;

  if (payload.exp <= now) return { ok: false, reason: "expired" };
  if (!expected.nonce || !safeEqual(payload.n, expected.nonce)) return { ok: false, reason: "nonce_mismatch" };
  if (payload.u !== expected.userId) return { ok: false, reason: "wrong_user" };
  if (payload.b !== expected.businessId) return { ok: false, reason: "wrong_business" };
  return { ok: true, claims: { userId: payload.u, businessId: payload.b, nonce: payload.n } };
}
