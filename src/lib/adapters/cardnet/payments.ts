import { randomBytes, randomInt } from "node:crypto";
import type { IntegrationCredentials } from "@/lib/integrations/repo";
import type { ActivityEntry, Deposit } from "@/lib/schemas/entities";
import type { DepositLink, DepositLinkRequest, PaymentEvent, PaymentProvider } from "../payments/types";
import { cardnetCredentialsSchema, type CardnetCredentials } from "./credentials";
import { fetchWithRetry, GatewayHttpError, type HttpOptions } from "./http";
import {
  buildCardnetSessionRequest,
  CARDNET_SANDBOX_API_URL,
  cardnetCurrencyCode,
  cardnetStatusUrl,
  interpretCardnetStatus,
  parseCardnetSessionResponse,
} from "./session";
import type { CardnetSessionRecord, CardnetSessionStore } from "./session-store";

export type CardnetOutcome = "approved" | "cancel";

export class CardnetNotConfiguredError extends Error {
  constructor(businessId: string) {
    super(`Business ${businessId} has no Cardnet credentials — connect Cardnet in Ajustes`);
    this.name = "CardnetNotConfiguredError";
  }
}

/** Cardnet did not answer usably. The caller should show "try again", never mark anything paid. */
export class CardnetUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardnetUnavailableError";
  }
}

export interface CardnetPaymentsOptions extends HttpOptions {
  businessId: string;
  appUrl: string;
  /** Gateway base URL (global env `CARDNET_API_URL`); defaults to the lab environment. */
  apiUrl?: string;
  credentials: IntegrationCredentials;
  sessions: CardnetSessionStore;
  /** Business-context audit trail (activity_log). Never receives session keys. */
  logActivity?: (entry: ActivityEntry) => Promise<void>;
}

/** The auto-submitting form that sends the browser to Cardnet's hosted page. */
export interface CardnetCheckoutForm {
  action: string;
  fields: Record<string, string>;
}

export interface CardnetPayments extends PaymentProvider {
  readonly kind: "cardnet";
  startCheckout(deposit: Pick<Deposit, "id" | "linkId" | "amountMinor" | "currency">): Promise<CardnetCheckoutForm>;
}

const trimSlash = (url: string) => url.replace(/\/+$/, "");

export function cardnetReturnUrl(appUrl: string, linkId: string, outcome: CardnetOutcome): string {
  return `${trimSlash(appUrl)}/api/pay/cardnet/${encodeURIComponent(linkId)}/return/${outcome}`;
}

/** Link ids double as Cardnet's `OrdenId`. ⚠️ Kept to 15 alphanumerics until the max length is confirmed. */
export function newCardnetLinkId(): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  return `cn${Array.from(randomBytes(13), (b) => alphabet[b % alphabet.length]).join("")}`;
}

function bodyFields(rawBody: string): Record<string, string> {
  const trimmed = rawBody.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"));
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(trimmed));
}

/**
 * Cardnet hosted checkout adapter. There is no signature on Cardnet's browser callback, so
 * `verifyWebhook` treats the callback only as a hint (link id + session) and asks Cardnet itself for
 * the result with the session key we stored when the session was created.
 */
export function createCardnetPayments(options: CardnetPaymentsOptions): CardnetPayments {
  const { businessId, appUrl, credentials, sessions } = options;
  const apiUrl = trimSlash(options.apiUrl ?? CARDNET_SANDBOX_API_URL);
  const http: HttpOptions = { fetch: options.fetch, timeoutMs: options.timeoutMs, maxRetries: options.maxRetries, sleep: options.sleep };
  const logActivity = options.logActivity ?? (async () => undefined);

  const requireCredentials = async (): Promise<CardnetCredentials> => {
    const creds = await credentials.read(businessId, "cardnet", cardnetCredentialsSchema);
    if (creds === null) throw new CardnetNotConfiguredError(businessId);
    return creds;
  };

  const audit = (depositId: string | null, action: string, reason: string, meta: Record<string, unknown> = {}) =>
    logActivity({ businessId, actor: "payments", entity: "deposit", entityId: depositId, action, reason, meta: { provider: "cardnet", ...meta } });

  async function queryStatus(record: CardnetSessionRecord): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchWithRetry(cardnetStatusUrl(apiUrl, record.session, record.sessionKey), { method: "GET", headers: { accept: "application/json" } }, http);
    } catch (error) {
      const status = error instanceof GatewayHttpError ? error.status : null;
      await audit(record.depositId, "cardnet_status_failed", "Could not reach Cardnet to confirm the payment — client can retry", { linkId: record.linkId, status });
      throw new CardnetUnavailableError("Cardnet status query failed");
    }
    if (!response.ok) {
      await audit(record.depositId, "cardnet_status_failed", `Cardnet answered ${response.status} to the status query — client can retry`, { linkId: record.linkId, status: response.status });
      throw new CardnetUnavailableError(`Cardnet status query returned ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new CardnetUnavailableError("Cardnet status response was not JSON");
    }
  }

  return {
    kind: "cardnet",

    async createDepositLink(request: DepositLinkRequest): Promise<DepositLink> {
      await requireCredentials();
      cardnetCurrencyCode(request.currency);
      const linkId = newCardnetLinkId();
      return { linkId, url: `${trimSlash(appUrl)}/api/pay/cardnet/${linkId}` };
    },

    async startCheckout(deposit) {
      const creds = await requireCredentials();
      const transactionId = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const body = buildCardnetSessionRequest({
        credentials: creds,
        linkId: deposit.linkId,
        transactionId,
        amountMinor: deposit.amountMinor,
        currency: deposit.currency,
        returnUrl: cardnetReturnUrl(appUrl, deposit.linkId, "approved"),
        cancelUrl: cardnetReturnUrl(appUrl, deposit.linkId, "cancel"),
      });

      let response: Response;
      try {
        response = await fetchWithRetry(
          `${apiUrl}/sessions`,
          { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) },
          http,
        );
      } catch {
        await audit(deposit.id, "cardnet_session_failed", "Could not reach Cardnet to open the checkout", { linkId: deposit.linkId });
        throw new CardnetUnavailableError("Cardnet session request failed");
      }
      const created = response.ok ? parseCardnetSessionResponse(await response.json().catch(() => null)) : null;
      if (created === null) {
        await audit(deposit.id, "cardnet_session_failed", `Cardnet rejected the checkout session (HTTP ${response.status})`, { linkId: deposit.linkId, status: response.status });
        throw new CardnetUnavailableError(`Cardnet session request returned ${response.status}`);
      }

      await sessions.save({
        businessId,
        depositId: deposit.id,
        linkId: deposit.linkId,
        session: created.session,
        sessionKey: created.sessionKey,
        transactionId,
        amountMinor: deposit.amountMinor,
      });
      // ⚠️ Cardnet's guide redirects with a form POST of SESSION to /authorize; confirm in the lab.
      return { action: `${apiUrl}/authorize`, fields: { SESSION: created.session } };
    },

    async verifyWebhook(rawBody: string): Promise<PaymentEvent | null> {
      const fields = bodyFields(rawBody);
      const linkId = fields.linkId?.trim();
      if (!linkId) return null;
      const session = fields.SESSION?.trim();
      const record = session ? await sessions.findBySession(businessId, session) : await sessions.latestForLink(businessId, linkId);
      // Unknown session, or a session opened for a different link: nothing we created, nothing to trust.
      if (record === null || record.linkId !== linkId) return null;
      const status = await queryStatus(record);
      return interpretCardnetStatus(status, {
        linkId: record.linkId,
        session: record.session,
        transactionId: record.transactionId,
        amountMinor: record.amountMinor,
      });
    },
  };
}
