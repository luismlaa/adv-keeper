import type { Adapters } from "@/lib/adapters/registry";
import type { PaymentEvent } from "@/lib/adapters/payments/types";
import { resolveBusinessSettings, type BusinessSettings } from "@/lib/config/business-settings";
import { transition } from "@/lib/domain/appointment-state";
import { DomainError } from "@/lib/domain/errors";
import { computeDeposit } from "@/lib/domain/money";
import { computeAvailableSlots, isSlotAvailable } from "@/lib/domain/slots";
import { addMinutes, DAY_MS, type Interval } from "@/lib/domain/time";
import type { Appointment, Business, Deposit, Service } from "@/lib/schemas/entities";
import type { KeeperStore } from "@/lib/store/types";

export interface BookingDeps {
  store: KeeperStore;
  adapters: Adapters;
  clock: () => Date;
}

export type PaymentOutcome =
  | { status: "confirmed"; appointment: Appointment; deposit: Deposit }
  | { status: "already_processed"; deposit: Deposit }
  | { status: "ignored"; reason: string };

/**
 * Booking use-cases shared by the concierge agent, the owner dashboard and the webhooks.
 * Prices and deposits are always computed here from the stored catalog — never taken from callers.
 */
export class BookingService {
  constructor(private readonly deps: BookingDeps) {}

  private settings(business: Business): BusinessSettings {
    return resolveBusinessSettings(business.settings);
  }

  private async requireBusiness(businessId: string): Promise<Business> {
    const business = await this.deps.store.getBusinessById(businessId);
    if (!business) throw new DomainError("business_not_found", `Business ${businessId} not found`);
    return business;
  }

  private async requireService(businessId: string, serviceId: string): Promise<Service> {
    const service = await this.deps.store.getService(businessId, serviceId);
    if (!service || !service.active) throw new DomainError("service_not_found", "Ese servicio no existe o no está disponible");
    return service;
  }

  private async busyIntervals(business: Business, range: Interval): Promise<Interval[]> {
    const [appointments, calendarBusy] = await Promise.all([
      this.deps.store.listBlockingAppointments(business.id, range.start, range.end),
      business.googleCalendarId === null
        ? Promise.resolve([])
        : this.deps.adapters.calendar.getBusy(business.googleCalendarId, range),
    ]);
    return [...appointments.map((a) => ({ start: new Date(a.startsAt), end: new Date(a.endsAt) })), ...calendarBusy];
  }

  async availability(businessId: string, serviceId: string, from: Date, days: number): Promise<Date[]> {
    const business = await this.requireBusiness(businessId);
    const service = await this.requireService(businessId, serviceId);
    const s = this.settings(business);
    const now = this.deps.clock();
    const start = from < now ? now : from;
    const span = Math.min(days, s.bookingHorizonDays);
    const busy = await this.busyIntervals(business, { start, end: new Date(start.getTime() + (span + 1) * DAY_MS) });
    return computeAvailableSlots({
      now,
      from: start,
      days: span,
      timezone: s.timezone,
      weeklyHours: s.weeklyHours,
      durationMin: service.durationMin,
      bufferMin: s.bufferMinutes,
      stepMin: s.slotStepMinutes,
      minLeadMinutes: s.minLeadMinutes,
      horizonDays: s.bookingHorizonDays,
      busy,
    });
  }

  /** Places a time-limited hold. Idempotent per (business, client, start). */
  async createHold(input: {
    businessId: string;
    clientId: string;
    serviceId: string;
    startsAt: Date;
    clientPackageId: string | null;
    source: Appointment["source"];
  }): Promise<Appointment> {
    const business = await this.requireBusiness(input.businessId);
    const service = await this.requireService(input.businessId, input.serviceId);
    const client = await this.deps.store.getClient(input.businessId, input.clientId);
    if (!client) throw new DomainError("client_not_found", "Client not found");
    const s = this.settings(business);
    const now = this.deps.clock();
    const end = addMinutes(input.startsAt, service.durationMin);

    const busy = await this.busyIntervals(business, { start: addMinutes(input.startsAt, -s.bufferMinutes - service.durationMin), end: addMinutes(end, s.bufferMinutes) });
    const ownExisting = (await this.deps.store.listBlockingAppointments(business.id, input.startsAt, end)).find(
      (a) => a.clientId === client.id && a.startsAt === input.startsAt.toISOString(),
    );
    if (ownExisting) return ownExisting;

    const free = isSlotAvailable(
      {
        now,
        timezone: s.timezone,
        weeklyHours: s.weeklyHours,
        durationMin: service.durationMin,
        bufferMin: s.bufferMinutes,
        stepMin: s.slotStepMinutes,
        minLeadMinutes: s.minLeadMinutes,
        horizonDays: s.bookingHorizonDays,
        busy,
      },
      input.startsAt,
    );
    if (!free) throw new DomainError("slot_unavailable", "Ese horario ya no está disponible");

    if (input.clientPackageId !== null) {
      const packages = await this.deps.store.listClientPackages(business.id, client.id);
      const pkg = packages.find((p) => p.clientPackage.id === input.clientPackageId);
      const valid =
        pkg !== undefined &&
        pkg.clientPackage.status === "active" &&
        pkg.clientPackage.sessionsUsed < pkg.clientPackage.sessionsTotal &&
        pkg.template.serviceId === service.id;
      if (!valid) throw new DomainError("package_invalid", "Ese paquete no aplica para este servicio o no tiene sesiones disponibles");
    }

    const usesPackage = input.clientPackageId !== null;
    const appointment = await this.deps.store.insertAppointment({
      id: crypto.randomUUID(),
      businessId: business.id,
      clientId: client.id,
      serviceId: service.id,
      clientPackageId: input.clientPackageId,
      startsAt: input.startsAt.toISOString(),
      endsAt: end.toISOString(),
      status: "hold_pending_deposit",
      priceMinor: usesPackage ? 0 : service.priceMinor,
      depositMinor: usesPackage ? 0 : computeDeposit(service.priceMinor, s.deposit, service.depositOverrideMinor),
      holdExpiresAt: addMinutes(now, s.holdMinutes).toISOString(),
      calendarEventId: null,
      source: input.source,
      notes: null,
    });

    await this.deps.store.logActivity({
      businessId: business.id,
      actor: input.source === "owner" ? "owner" : "concierge",
      entity: "appointment",
      entityId: appointment.id,
      action: "hold_created",
      reason: `Hold for ${service.name} while the client pays the deposit`,
      meta: { clientId: client.id, startsAt: appointment.startsAt, depositMinor: appointment.depositMinor },
    });

    // Prepaid package sessions need no deposit: confirm immediately.
    return appointment.depositMinor === 0 ? this.confirm(business, appointment, "deposit_not_required") : appointment;
  }

  /** Returns the open link for the appointment, creating one if needed (idempotent). */
  async createDepositLink(businessId: string, appointmentId: string): Promise<Deposit> {
    const business = await this.requireBusiness(businessId);
    const appointment = await this.deps.store.getAppointment(businessId, appointmentId);
    if (!appointment) throw new DomainError("appointment_not_found", "Appointment not found");
    if (appointment.status !== "hold_pending_deposit") {
      throw new DomainError("deposit_not_needed", `Appointment is ${appointment.status}; no deposit link needed`);
    }
    const existing = await this.deps.store.getOpenDepositForAppointment(businessId, appointmentId);
    if (existing) return existing;

    const [service, client] = await Promise.all([
      this.requireService(businessId, appointment.serviceId),
      this.deps.store.getClient(businessId, appointment.clientId),
    ]);
    if (!client) throw new DomainError("client_not_found", "Client not found");
    const s = this.settings(business);
    const expiresAt = appointment.holdExpiresAt === null ? addMinutes(this.deps.clock(), s.holdMinutes) : new Date(appointment.holdExpiresAt);

    const link = await this.deps.adapters.payments.createDepositLink({
      reference: appointment.id,
      amountMinor: appointment.depositMinor,
      currency: s.currency,
      description: `Anticipo ${service.name} — ${business.name}`,
      expiresAt,
      customerPhone: client.phone,
    });

    const deposit = await this.deps.store.insertDeposit({
      id: crypto.randomUUID(),
      businessId,
      appointmentId,
      provider: this.deps.adapters.payments.kind,
      linkId: link.linkId,
      url: link.url,
      amountMinor: appointment.depositMinor,
      currency: s.currency,
      status: "pending",
      providerTxnId: null,
      expiresAt: expiresAt.toISOString(),
      paidAt: null,
    });

    await this.deps.store.logActivity({
      businessId,
      actor: "concierge",
      entity: "deposit",
      entityId: deposit.id,
      action: "deposit_link_created",
      reason: "Client must pay the deposit to secure the appointment",
      meta: { appointmentId, amountMinor: deposit.amountMinor, provider: deposit.provider },
    });
    return deposit;
  }

  /** Handles a verified gateway confirmation. Safe to call repeatedly with the same event. */
  async handlePaymentEvent(event: PaymentEvent): Promise<PaymentOutcome> {
    const deposit = await this.deps.store.getDepositByLinkId(event.linkId);
    if (!deposit) return { status: "ignored", reason: "unknown_link" };
    if (deposit.status === "paid") return { status: "already_processed", deposit };
    if (event.status !== "paid") return { status: "ignored", reason: "payment_not_successful" };
    if (event.amountMinor !== deposit.amountMinor) {
      await this.deps.store.logActivity({
        businessId: deposit.businessId,
        actor: "payments",
        entity: "deposit",
        entityId: deposit.id,
        action: "amount_mismatch",
        reason: "Gateway amount differs from expected deposit — needs owner review",
        meta: { expected: deposit.amountMinor, received: event.amountMinor, providerTxnId: event.providerTxnId },
      });
      return { status: "ignored", reason: "amount_mismatch" };
    }

    const business = await this.requireBusiness(deposit.businessId);
    const paid = await this.deps.store.updateDeposit({
      ...deposit,
      status: "paid",
      providerTxnId: event.providerTxnId,
      paidAt: this.deps.clock().toISOString(),
    });
    const appointment = await this.deps.store.getAppointment(deposit.businessId, deposit.appointmentId);
    if (!appointment) return { status: "ignored", reason: "appointment_missing" };
    if (appointment.status !== "hold_pending_deposit") {
      // Paid after the hold expired or was cancelled: keep the money recorded, let the owner decide.
      await this.deps.store.logActivity({
        businessId: business.id,
        actor: "payments",
        entity: "appointment",
        entityId: appointment.id,
        action: "late_payment",
        reason: `Deposit paid while appointment was ${appointment.status} — owner must rebook or refund`,
        meta: { depositId: paid.id },
      });
      return { status: "ignored", reason: "appointment_not_on_hold" };
    }
    const confirmed = await this.confirm(business, appointment, "deposit_paid");
    return { status: "confirmed", appointment: confirmed, deposit: paid };
  }

  private async confirm(
    business: Business,
    appointment: Appointment,
    why: "deposit_paid" | "deposit_not_required",
  ): Promise<Appointment> {
    const service = await this.requireService(business.id, appointment.serviceId);
    const confirmed = transition(appointment, why === "deposit_paid" ? "deposit_paid" : "owner_confirmed_without_deposit");
    const event =
      business.googleCalendarId === null
        ? null
        : await this.deps.adapters.calendar.createEvent({
            calendarRef: business.googleCalendarId,
            summary: `${service.name} (Keeper)`,
            description: `Cita confirmada por Keeper · ${why === "deposit_paid" ? "anticipo pagado" : "sesión de paquete"}`,
            start: new Date(appointment.startsAt),
            end: new Date(appointment.endsAt),
          });
    const saved = await this.deps.store.updateAppointment({ ...confirmed, calendarEventId: event?.eventId ?? null });
    await this.deps.store.logActivity({
      businessId: business.id,
      actor: why === "deposit_paid" ? "payments" : "concierge",
      entity: "appointment",
      entityId: saved.id,
      action: "confirmed",
      reason: why === "deposit_paid" ? "Deposit paid — slot secured" : "Package session — no deposit required",
      meta: { calendarEventId: saved.calendarEventId },
    });
    return saved;
  }

  /** Releases holds whose deposit window elapsed. Returns the expired appointments. */
  async expireHolds(): Promise<Appointment[]> {
    const now = this.deps.clock();
    const expired = await this.deps.store.listExpiredHolds(now);
    const results: Appointment[] = [];
    for (const appointment of expired) {
      const saved = await this.deps.store.updateAppointment(transition(appointment, "hold_expired"));
      const deposit = await this.deps.store.getOpenDepositForAppointment(appointment.businessId, appointment.id);
      if (deposit && deposit.status === "pending") await this.deps.store.updateDeposit({ ...deposit, status: "expired" });
      await this.deps.store.logActivity({
        businessId: appointment.businessId,
        actor: "system",
        entity: "appointment",
        entityId: appointment.id,
        action: "hold_expired",
        reason: "Deposit not paid within the hold window — slot released",
        meta: {},
      });
      results.push(saved);
    }
    return results;
  }
}
