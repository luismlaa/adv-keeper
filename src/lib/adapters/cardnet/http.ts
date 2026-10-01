export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetch?: FetchLike;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Extra attempts after the first, only for 5xx and 429. */
  maxRetries?: number;
  /** Injected so tests don't wait. */
  sleep?: (ms: number) => Promise<void>;
}

export class GatewayHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "GatewayHttpError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const retryable = (status: number) => status === 429 || status >= 500;

/**
 * fetch with a timeout on every attempt and exponential backoff on 5xx/429 only. Network errors and
 * timeouts are not retried (a retried POST could open a second gateway session). Returns the final
 * response, which may still be non-2xx; never logs URLs (they can carry a session key).
 */
export async function fetchWithRetry(url: string, init: RequestInit, options: HttpOptions = {}): Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRetries = options.maxRetries ?? 2;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "unknown";
      throw new GatewayHttpError(`Gateway request failed (${reason})`, null);
    }
    if (!retryable(response.status) || attempt >= maxRetries) return response;
    await sleep(250 * 2 ** attempt);
  }
}
