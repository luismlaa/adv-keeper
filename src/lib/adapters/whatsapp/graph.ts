/**
 * Minimal Meta Graph API client: one POST with a timeout, retried with exponential backoff only on
 * 429 and 5xx. Errors never include the access token.
 */

export const GRAPH_BASE_URL = "https://graph.facebook.com";
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 300;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class WhatsAppApiError extends Error {
  constructor(
    readonly status: number,
    /** Meta's numeric error code (e.g. 131047 = outside the 24h window, 132001 = template missing). */
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

export interface GraphPostOptions {
  fetch: FetchLike;
  token: string;
  url: string;
  body: unknown;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Injected so tests don't wait for real backoff. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function graphError(status: number, payload: unknown): WhatsAppApiError {
  const err = (payload as { error?: { message?: unknown; code?: unknown } } | null)?.error;
  const code = typeof err?.code === "number" ? err.code : null;
  const detail = typeof err?.message === "string" ? err.message : "unknown error";
  return new WhatsAppApiError(status, code, `WhatsApp Graph API ${status}${code === null ? "" : ` (code ${code})`}: ${detail}`);
}

export async function graphPost(options: GraphPostOptions): Promise<unknown> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: WhatsAppApiError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await options.fetch(options.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const payload = await readJson(response);
    if (response.ok) return payload;

    lastError = graphError(response.status, payload);
    if (!isRetryableStatus(response.status) || attempt === maxAttempts) break;
    await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
  }
  throw lastError ?? new WhatsAppApiError(0, null, "WhatsApp Graph API request failed");
}
