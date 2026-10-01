import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServerEnv } from "@/lib/config/env";
import { createAdminClient } from "@/lib/db/admin";
import { IntegrationCredentials, SupabaseIntegrationRepo } from "@/lib/integrations/repo";
import type { ActivityEntry, Business } from "@/lib/schemas/entities";
import { SupabaseStore } from "@/lib/store/supabase";
import { notConnectedCalendar, withConnectionFallback, type CalendarWarn } from "./calendar/connection-fallback";
import type { CalendarProvider } from "./calendar/types";
import { ActivityLogCardnetSessionStore, type CardnetSessionStore } from "./cardnet/session-store";
import { createGoogleCalendar } from "./google/calendar";
import { MessagingUnavailableError, UnavailableChannel } from "./messaging/unavailable";
import type { MessagingChannel } from "./messaging/types";
import { createPaymentGateway, gatewayDepsFromEnv } from "./payments/gateway";
import type { PaymentProvider } from "./payments/types";
import { unavailablePayments } from "./payments/unavailable";
import type { LiveAdapterFactory } from "./registry";
import { createWhatsAppChannel } from "./whatsapp/channel";

/** Satisfies every provider's injectable fetch (WhatsApp, Google, Azul, Cardnet). */
export type LiveFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What the live adapters need besides env: credentials, the Cardnet session store and the activity log. */
export interface LiveServices {
  credentials: IntegrationCredentials;
  cardnetSessions: CardnetSessionStore;
  logActivity: (entry: ActivityEntry) => Promise<void>;
}

export interface LiveAdapterOptions {
  /** Builds the services for one resolution. Default: service-role Supabase client. Tests inject memory ones. */
  services?: (env: ServerEnv) => LiveServices;
  /** Injected into every provider so tests never reach Meta, Google, Azul or Cardnet. */
  fetch?: LiveFetch;
  sleep?: (ms: number) => Promise<void>;
  warn?: CalendarWarn;
}

let adminClient: { env: ServerEnv; db: SupabaseClient } | undefined;

/** One admin client per env object (creating it does no I/O, but there is no reason to rebuild it). */
function adminDb(env: ServerEnv): SupabaseClient {
  if (adminClient?.env !== env) adminClient = { env, db: createAdminClient(env) };
  return adminClient.db;
}

export function adminLiveServices(env: ServerEnv, db: SupabaseClient = adminDb(env)): LiveServices {
  const store = new SupabaseStore(db);
  return {
    credentials: new IntegrationCredentials(new SupabaseIntegrationRepo(db), env.ENCRYPTION_KEY),
    cardnetSessions: new ActivityLogCardnetSessionStore(db, env.ENCRYPTION_KEY),
    logActivity: (entry) => store.logActivity(entry),
  };
}

/** WhatsApp on the business's own number; a typed "unavailable" channel when it is not set up. */
function liveMessaging(business: Business, env: ServerEnv, options: LiveAdapterOptions): MessagingChannel {
  if (env.WHATSAPP_TOKEN === undefined) return new UnavailableChannel(new MessagingUnavailableError("whatsapp_token_missing", business.id));
  if (business.whatsappPhoneNumberId === null || business.whatsappPhoneNumberId.trim() === "") {
    return new UnavailableChannel(new MessagingUnavailableError("whatsapp_phone_number_missing", business.id));
  }
  return createWhatsAppChannel({
    token: env.WHATSAPP_TOKEN,
    graphVersion: env.WHATSAPP_GRAPH_VERSION,
    phoneNumberId: business.whatsappPhoneNumberId,
    fetch: options.fetch,
    sleep: options.sleep,
  });
}

/** The business's Google Calendar; without a connection it reports no busy blocks and skips events. */
function liveCalendar(business: Business, env: ServerEnv, services: LiveServices, options: LiveAdapterOptions): CalendarProvider {
  const inner =
    env.GOOGLE_CLIENT_ID === undefined || env.GOOGLE_CLIENT_SECRET === undefined
      ? notConnectedCalendar(business.id)
      : createGoogleCalendar({
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          credentials: services.credentials,
          businessId: business.id,
          fetch: options.fetch,
          sleep: options.sleep,
          logActivity: services.logActivity,
        });
  return withConnectionFallback(inner, business.id, options.warn);
}

/** Azul or Cardnet by `business.paymentProvider`, with the business's own merchant credentials. */
function livePayments(business: Business, env: ServerEnv, services: LiveServices, options: LiveAdapterOptions): PaymentProvider {
  const gateway = createPaymentGateway(business, gatewayDepsFromEnv(env, { ...services, fetch: options.fetch, sleep: options.sleep }));
  return gateway?.payments ?? unavailablePayments(business.id);
}

/**
 * The factory `registry.ts` uses for `integration_mode = 'live'`. Resolving does no I/O and never
 * throws: missing pieces surface as typed errors when (and only when) they are used.
 */
export function createLiveAdapterFactory(options: LiveAdapterOptions = {}): LiveAdapterFactory {
  return (business, env) => {
    const services = (options.services ?? adminLiveServices)(env);
    return {
      messaging: liveMessaging(business, env, options),
      calendar: liveCalendar(business, env, services, options),
      payments: livePayments(business, env, services, options),
    };
  };
}

export const liveAdapterFactory: LiveAdapterFactory = createLiveAdapterFactory();
