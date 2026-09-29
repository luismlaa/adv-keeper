import type { BookingService } from "@/lib/booking/booking-service";
import type { BusinessSettings } from "@/lib/config/business-settings";
import { DomainError } from "@/lib/domain/errors";
import { computeDeposit, formatMoney } from "@/lib/domain/money";
import { nextSessionLabel, packageProgress } from "@/lib/domain/packages";
import { formatLocal, zonedWallTime } from "@/lib/domain/time";
import type { Business, Client } from "@/lib/schemas/entities";
import type { KeeperStore } from "@/lib/store/types";
import { TOOL_TIERS, TURN_LIMITS } from "./approvals";
import { isToolName, toolInputSchemas, type ToolInput, type ToolName } from "./tools";

export interface ToolContext {
  business: Business;
  client: Client;
  settings: BusinessSettings;
  store: KeeperStore;
  booking: BookingService;
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } };

export type ToolExecutor = (name: string, rawInput: unknown) => Promise<ToolResult>;

const MAX_SLOTS_RETURNED = 12;

const fail = (code: string, message: string): ToolResult => ({ ok: false, error: { code, message } });

/**
 * Builds the executor for ONE client turn. It validates every input with zod, enforces the tier
 * table and per-turn caps, scopes everything to the current business + client, and converts
 * domain errors into structured results the model can read (never throws for business errors).
 */
export function createToolExecutor(ctx: ToolContext): ToolExecutor {
  let calls = 0;
  let holds = 0;
  let approvals = 0;

  return async (name, rawInput) => {
    calls += 1;
    if (calls > TURN_LIMITS.maxToolCalls) return fail("turn_limit", "Too many tool calls this turn; answer the client now.");
    if (!isToolName(name)) return fail("unknown_tool", `Tool "${name}" does not exist`);

    const parsed = toolInputSchemas[name].safeParse(rawInput ?? {});
    if (!parsed.success) {
      await ctx.store.logActivity({
        businessId: ctx.business.id,
        actor: "concierge",
        entity: "tool_call",
        entityId: null,
        action: "blocked_invalid_input",
        reason: `Rejected ${name} input at the schema boundary`,
        meta: { clientId: ctx.client.id, issues: parsed.error.issues.map((i) => i.message) },
      });
      return fail("invalid_input", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
    }

    if (name === "create_booking_hold" && ++holds > TURN_LIMITS.maxHoldsPerTurn) {
      return fail("turn_limit", "Only one booking per message. Confirm this one with the client first.");
    }
    if (name === "request_owner_approval" && ++approvals > TURN_LIMITS.maxApprovalRequestsPerTurn) {
      return fail("turn_limit", "The owner already has this request.");
    }

    try {
      return { ok: true, data: await run(ctx, name, parsed.data) };
    } catch (error) {
      if (error instanceof DomainError) return fail(error.code, error.message);
      throw error;
    }
  };
}

async function run(ctx: ToolContext, name: ToolName, input: unknown): Promise<unknown> {
  // Exhaustive by tier table: a tool without a tier would fail the Record type in approvals.ts.
  void TOOL_TIERS[name];
  switch (name) {
    case "list_services":
      return listServices(ctx);
    case "check_availability":
      return checkAvailability(ctx, input as ToolInput<"check_availability">);
    case "create_booking_hold":
      return createHold(ctx, input as ToolInput<"create_booking_hold">);
    case "create_deposit_link":
      return createDepositLink(ctx, input as ToolInput<"create_deposit_link">);
    case "get_client_packages":
      return getClientPackages(ctx);
    case "request_owner_approval":
      return requestApproval(ctx, input as ToolInput<"request_owner_approval">);
  }
}

async function listServices(ctx: ToolContext) {
  const { currency, locale, deposit } = ctx.settings;
  const services = await ctx.store.listActiveServices(ctx.business.id);
  return services.map((s) => ({
    service_id: s.id,
    name: s.name,
    category: s.category,
    description: s.description,
    duration_min: s.durationMin,
    price: formatMoney(s.priceMinor, currency, locale),
    deposit: formatMoney(computeDeposit(s.priceMinor, deposit, s.depositOverrideMinor), currency, locale),
  }));
}

async function checkAvailability(ctx: ToolContext, input: ToolInput<"check_availability">) {
  const [y, m, d] = input.date_from.split("-").map(Number) as [number, number, number];
  const from = zonedWallTime(y, m - 1, d, "00:00", ctx.settings.timezone);
  const slots = await ctx.booking.availability(ctx.business.id, input.service_id, from, input.days);
  return {
    timezone: ctx.settings.timezone,
    total_found: slots.length,
    slots: slots.slice(0, MAX_SLOTS_RETURNED).map((s) => ({
      starts_at: s.toISOString(),
      label: formatLocal(s, ctx.settings.timezone, ctx.settings.locale),
    })),
  };
}

async function createHold(ctx: ToolContext, input: ToolInput<"create_booking_hold">) {
  if (input.client_name !== null) await ctx.store.setClientNameIfMissing(ctx.business.id, ctx.client.id, input.client_name);
  const appointment = await ctx.booking.createHold({
    businessId: ctx.business.id,
    clientId: ctx.client.id,
    serviceId: input.service_id,
    startsAt: new Date(input.starts_at),
    clientPackageId: input.client_package_id,
    source: "chat",
  });
  const { currency, locale, timezone } = ctx.settings;
  return {
    appointment_id: appointment.id,
    status: appointment.status,
    when: formatLocal(new Date(appointment.startsAt), timezone, locale),
    price: formatMoney(appointment.priceMinor, currency, locale),
    deposit: formatMoney(appointment.depositMinor, currency, locale),
    deposit_required: appointment.status === "hold_pending_deposit",
    hold_expires_at: appointment.holdExpiresAt,
    next_step:
      appointment.status === "hold_pending_deposit"
        ? "Call create_deposit_link and send the link to the client."
        : "Confirmed with her package — tell the client it is booked.",
  };
}

async function createDepositLink(ctx: ToolContext, input: ToolInput<"create_deposit_link">) {
  const appointment = await ctx.store.getAppointment(ctx.business.id, input.appointment_id);
  if (!appointment || appointment.clientId !== ctx.client.id) {
    throw new DomainError("appointment_not_found", "That booking does not belong to this client");
  }
  const deposit = await ctx.booking.createDepositLink(ctx.business.id, appointment.id);
  return {
    url: deposit.url,
    amount: formatMoney(deposit.amountMinor, deposit.currency, ctx.settings.locale),
    expires_at: formatLocal(new Date(deposit.expiresAt), ctx.settings.timezone, ctx.settings.locale),
    status: deposit.status,
  };
}

async function getClientPackages(ctx: ToolContext) {
  const packages = await ctx.store.listClientPackages(ctx.business.id, ctx.client.id);
  return packages.map(({ clientPackage, template, serviceName }) => {
    const progress = packageProgress(clientPackage);
    return {
      client_package_id: clientPackage.id,
      name: template.name,
      service_id: template.serviceId,
      service_name: serviceName,
      status: clientPackage.status,
      used: progress.used,
      remaining: progress.remaining,
      next: clientPackage.status === "active" ? nextSessionLabel(clientPackage) : null,
    };
  });
}

async function requestApproval(ctx: ToolContext, input: ToolInput<"request_owner_approval">) {
  if (input.appointment_id !== null) {
    const appointment = await ctx.store.getAppointment(ctx.business.id, input.appointment_id);
    if (!appointment || appointment.clientId !== ctx.client.id) {
      throw new DomainError("appointment_not_found", "That booking does not belong to this client");
    }
  }
  const request = await ctx.store.insertApprovalRequest({
    businessId: ctx.business.id,
    clientId: ctx.client.id,
    appointmentId: input.appointment_id,
    kind: input.kind,
    details: input.details,
  });
  await ctx.store.logActivity({
    businessId: ctx.business.id,
    actor: "concierge",
    entity: "approval_request",
    entityId: request.id,
    action: "queued_for_owner",
    reason: `Client asked for ${input.kind}, which only the owner can decide`,
    meta: { clientId: ctx.client.id },
  });
  return {
    request_id: request.id,
    status: "pending_owner",
    tell_client: `${ctx.settings.ownerDisplayName} revisa tu solicitud y te confirma pronto.`,
  };
}
