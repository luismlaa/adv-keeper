/**
 * Shared HTTP plumbing for Google calls: injectable `fetch`, a per-attempt timeout and bounded
 * exponential backoff that retries only on 429 and 5xx (never on 4xx, which will not get better).
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number) => Promise<void>;

export interface HttpOptions {
  fetch: FetchLike;
  sleep?: Sleep;
  timeoutMs?: number;
  /** Extra attempts after the first one. */
  retries?: number;
  baseDelayMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 300;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Sends the request, retrying retryable statuses. Returns the last response (possibly an error status)
 * so callers can map it; network errors and timeouts on the final attempt are rethrown.
 */
export async function fetchWithRetry(url: string, init: RequestInit, options: HttpOptions): Promise<Response> {
  const sleep = options.sleep ?? realSleep;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const baseDelay = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (let attempt = 0; ; attempt++) {
    const isLast = attempt >= retries;
    try {
      const response = await options.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!isRetryableStatus(response.status) || isLast) return response;
    } catch (error) {
      if (isLast) throw error;
    }
    await sleep(baseDelay * 2 ** attempt);
  }
}

/** Best-effort JSON body; null when the body is empty or not JSON. */
export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
