import type { ServerEnv } from "@/lib/config/env";
import type { Business } from "@/lib/schemas/entities";
import { FakeCalendar } from "./calendar/fake";
import { liveAdapterFactory } from "./live";
import type { CalendarProvider } from "./calendar/types";
import { WebChannel } from "./messaging/web";
import type { MessagingChannel } from "./messaging/types";
import { FakePaymentProvider } from "./payments/fake";
import type { PaymentProvider } from "./payments/types";

export interface Adapters {
  calendar: CalendarProvider;
  payments: PaymentProvider;
  messaging: MessagingChannel;
}

export type LiveAdapterFactory = (business: Business, env: ServerEnv) => Adapters;

export class IntegrationNotAvailableError extends Error {
  constructor(business: Business) {
    super(`Business "${business.slug}" is in live mode but no live adapters are registered`);
    this.name = "IntegrationNotAvailableError";
  }
}

/**
 * Live integrations: WhatsApp + Google Calendar + Azul/Cardnet (`live.ts`). `live.ts` only imports types
 * from this module, so taking its factory as the default here has no import cycle at runtime.
 */
let liveFactory: LiveAdapterFactory | undefined = liveAdapterFactory;

/** Replaces the live factory (tests); `undefined` unregisters it. */
export function registerLiveAdapters(factory: LiveAdapterFactory | undefined): void {
  liveFactory = factory;
}

export function demoAdapters(env: Pick<ServerEnv, "APP_URL" | "DEMO_PAYMENT_WEBHOOK_SECRET">): Adapters {
  return {
    calendar: new FakeCalendar(),
    payments: new FakePaymentProvider(env.APP_URL, env.DEMO_PAYMENT_WEBHOOK_SECRET),
    messaging: new WebChannel(),
  };
}

export function resolveAdapters(business: Business, env: ServerEnv): Adapters {
  if (business.integrationMode === "demo") return demoAdapters(env);
  if (liveFactory === undefined) throw new IntegrationNotAvailableError(business);
  return liveFactory(business, env);
}
