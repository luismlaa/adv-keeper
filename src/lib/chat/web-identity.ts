import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Anonymous web-chat identity. A first-time visitor gets a random demo phone (`+1809000xxxx`) that
 * becomes her client key for that business. The cookie value is `phone.signature` (HMAC-SHA256), so a
 * visitor cannot edit the cookie to impersonate another client's phone.
 */

const WEB_PHONE_PATTERN = /^\+1809000\d{4}$/;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function chatCookieName(slug: string): string {
  return `keeper_chat_${slug}`;
}

export const chatCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: COOKIE_MAX_AGE_SECONDS,
} as const;

export function randomWebPhone(pick: (maxExclusive: number) => number = (max) => randomInt(max)): string {
  return `+1809000${pick(10_000).toString().padStart(4, "0")}`;
}

function signature(phone: string, secret: string): string {
  return createHmac("sha256", `keeper:web-chat:${secret}`).update(phone).digest("base64url");
}

export function signWebIdentity(phone: string, secret: string): string {
  return `${phone}.${signature(phone, secret)}`;
}

/** Returns the phone when the cookie value is well-formed and correctly signed, otherwise null. */
export function verifyWebIdentity(value: string | undefined, secret: string): string | null {
  if (value === undefined) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const phone = value.slice(0, dot);
  if (!WEB_PHONE_PATTERN.test(phone)) return null;
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(signature(phone, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? phone : null;
}

/**
 * Picks a web phone not yet used by any client of this business, so two visitors never share a
 * conversation. Throws after `attempts` collisions (only possible once the 10k space is nearly full).
 */
export async function allocateWebPhone(isTaken: (phone: string) => Promise<boolean>, attempts = 8, next = randomWebPhone): Promise<string> {
  for (let i = 0; i < attempts; i++) {
    const candidate = next();
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`Could not allocate a free web chat phone after ${attempts} attempts`);
}
