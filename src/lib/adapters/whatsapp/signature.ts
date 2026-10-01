import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-hub-signature-256";
const SIGNATURE_RE = /^sha256=([0-9a-f]{64})$/i;

export function signWhatsAppPayload(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

/**
 * Meta signs every webhook POST with `X-Hub-Signature-256: sha256=<HMAC-SHA256(rawBody, appSecret)>`.
 * Must run on the exact raw bytes, before any JSON parsing. Missing secret or header → reject.
 */
export function verifyWhatsAppSignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !header) return false;
  const hex = SIGNATURE_RE.exec(header.trim())?.[1];
  if (hex === undefined) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const received = Buffer.from(hex, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * GET subscription handshake: Meta calls `?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`
 * and expects the challenge echoed back. Returns the challenge, or null to answer 403.
 */
export function verifyWebhookHandshake(params: URLSearchParams, verifyToken: string | undefined): string | null {
  if (!verifyToken) return null;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode !== "subscribe" || token === null || challenge === null || challenge === "") return null;
  return safeEqual(token, verifyToken) ? challenge : null;
}
