import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFrom(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes hex");
  return key;
}

/**
 * AES-256-GCM with a random IV. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts).
 * `context` is bound as AAD (e.g. `${businessId}:google_calendar`), so a ciphertext copied to another
 * business or provider row fails to decrypt.
 */
export function encryptSecret(plaintext: string, hexKey: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(hexKey), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** Inverse of `encryptSecret`. Throws on a wrong key, wrong context or tampered payload. */
export function decryptSecret(payload: string, hexKey: string, context: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error("Unrecognized encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(hexKey), Buffer.from(iv, "base64url"), { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
