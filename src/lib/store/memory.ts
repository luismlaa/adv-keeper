import { BLOCKING_STATUSES } from "@/lib/domain/appointment-state";
import { activityEntrySchema, type ActivityEntry, type Appointment, type ApprovalRequest, type Business, type Client, type ClientPackage, type Deposit, type PackageTemplate, type Service } from "@/lib/schemas/entities";
import type { ClientPackageView, KeeperStore, NewApprovalRequest, NotificationRecord } from "./types";

export interface MemorySeed {
  businesses?: readonly Business[];
  services?: readonly Service[];
  packageTemplates?: readonly PackageTemplate[];
  clients?: readonly Client[];
  clientPackages?: readonly ClientPackage[];
  appointments?: readonly Appointment[];
  deposits?: readonly Deposit[];
}

/**
 * In-memory KeeperStore for tests and the smoke flow. Collections are replaced (never mutated in
 * place) on every write, and reads return copies.
 */
export class MemoryStore implements KeeperStore {
  businesses: readonly Business[];
  services: readonly Service[];
  packageTemplates: readonly PackageTemplate[];
  clients: readonly Client[];
  clientPackages: readonly ClientPackage[];
  appointments: readonly Appointment[];
  deposits: readonly Deposit[];
  approvals: readonly ApprovalRequest[] = [];
  notifications: readonly NotificationRecord[] = [];
  activity: readonly ActivityEntry[] = [];

  constructor(seed: MemorySeed = {}) {
    this.businesses = [...(seed.businesses ?? [])];
    this.services = [...(seed.services ?? [])];
    this.packageTemplates = [...(seed.packageTemplates ?? [])];
    this.clients = [...(seed.clients ?? [])];
    this.clientPackages = [...(seed.clientPackages ?? [])];
    this.appointments = [...(seed.appointments ?? [])];
    this.deposits = [...(seed.deposits ?? [])];
  }

  async getBusinessById(businessId: string): Promise<Business | null> {
    return copy(this.businesses.find((b) => b.id === businessId));
  }

  async getBusinessBySlug(slug: string): Promise<Business | null> {
    return copy(this.businesses.find((b) => b.slug === slug));
  }

  async listActiveServices(businessId: string): Promise<Service[]> {
    return this.services.filter((s) => s.businessId === businessId && s.active).map((s) => ({ ...s }));
  }

  async getService(businessId: string, serviceId: string): Promise<Service | null> {
    return copy(this.services.find((s) => s.businessId === businessId && s.id === serviceId));
  }

  async listActivePackageTemplates(businessId: string): Promise<PackageTemplate[]> {
    return this.packageTemplates.filter((t) => t.businessId === businessId && t.active).map((t) => ({ ...t }));
  }

  async findOrCreateClient(businessId: string, phone: string, name: string | null): Promise<Client> {
    const existing = this.clients.find((c) => c.businessId === businessId && c.phone === phone);
    if (existing) return { ...existing };
    const client: Client = {
      id: crypto.randomUUID(),
      businessId,
      phone,
      name,
      email: null,
      notes: null,
      lastVisitAt: null,
      lastReengagedAt: null,
    };
    this.clients = [...this.clients, client];
    return { ...client };
  }

  async getClient(businessId: string, clientId: string): Promise<Client | null> {
    return copy(this.clients.find((c) => c.businessId === businessId && c.id === clientId));
  }

  async setClientNameIfMissing(businessId: string, clientId: string, name: string): Promise<void> {
    this.clients = this.clients.map((c) => (c.businessId === businessId && c.id === clientId && c.name === null ? { ...c, name } : c));
  }

  async listClientPackages(businessId: string, clientId: string): Promise<ClientPackageView[]> {
    return this.clientPackages
      .filter((p) => p.businessId === businessId && p.clientId === clientId)
      .flatMap((p) => {
        const template = this.packageTemplates.find((t) => t.id === p.packageTemplateId);
        if (!template) return [];
        const service = this.services.find((s) => s.id === template.serviceId);
        return [{ clientPackage: { ...p }, template: { ...template }, serviceName: service?.name ?? template.name }];
      });
  }

  async listBlockingAppointments(businessId: string, from: Date, to: Date): Promise<Appointment[]> {
    return this.appointments
      .filter(
        (a) =>
          a.businessId === businessId &&
          BLOCKING_STATUSES.includes(a.status) &&
          new Date(a.startsAt) < to &&
          new Date(a.endsAt) > from,
      )
      .map((a) => ({ ...a }));
  }

  async getAppointment(businessId: string, appointmentId: string): Promise<Appointment | null> {
    return copy(this.appointments.find((a) => a.businessId === businessId && a.id === appointmentId));
  }

  async insertAppointment(appointment: Appointment): Promise<Appointment> {
    const existing = this.appointments.find(
      (a) =>
        a.businessId === appointment.businessId &&
        a.clientId === appointment.clientId &&
        a.startsAt === appointment.startsAt &&
        BLOCKING_STATUSES.includes(a.status),
    );
    if (existing) return { ...existing };
    this.appointments = [...this.appointments, { ...appointment }];
    return { ...appointment };
  }

  async updateAppointment(appointment: Appointment): Promise<Appointment> {
    this.appointments = this.appointments.map((a) => (a.id === appointment.id ? { ...appointment } : a));
    return { ...appointment };
  }

  async listExpiredHolds(now: Date): Promise<Appointment[]> {
    return this.appointments
      .filter((a) => a.status === "hold_pending_deposit" && a.holdExpiresAt !== null && new Date(a.holdExpiresAt) <= now)
      .map((a) => ({ ...a }));
  }

  async insertDeposit(deposit: Deposit): Promise<Deposit> {
    this.deposits = [...this.deposits, { ...deposit }];
    return { ...deposit };
  }

  async getOpenDepositForAppointment(businessId: string, appointmentId: string): Promise<Deposit | null> {
    return copy(
      this.deposits.find(
        (d) => d.businessId === businessId && d.appointmentId === appointmentId && (d.status === "pending" || d.status === "paid"),
      ),
    );
  }

  async getDepositByLinkId(linkId: string): Promise<Deposit | null> {
    return copy(this.deposits.find((d) => d.linkId === linkId));
  }

  async updateDeposit(deposit: Deposit): Promise<Deposit> {
    this.deposits = this.deposits.map((d) => (d.id === deposit.id ? { ...deposit } : d));
    return { ...deposit };
  }

  async insertApprovalRequest(request: NewApprovalRequest): Promise<ApprovalRequest> {
    const row: ApprovalRequest = {
      ...request,
      id: crypto.randomUUID(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.approvals = [...this.approvals, row];
    return { ...row };
  }

  async recordNotification(record: NotificationRecord): Promise<boolean> {
    if (this.notifications.some((n) => n.dedupeKey === record.dedupeKey)) return false;
    this.notifications = [...this.notifications, { ...record }];
    return true;
  }

  async logActivity(entry: ActivityEntry): Promise<void> {
    this.activity = [...this.activity, activityEntrySchema.parse(entry)];
  }
}

function copy<T extends object>(value: T | undefined): T | null {
  return value === undefined ? null : { ...value };
}
