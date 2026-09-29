import type {
  ActivityEntry,
  Appointment,
  ApprovalKind,
  ApprovalRequest,
  Business,
  Client,
  ClientPackage,
  Deposit,
  PackageTemplate,
  Service,
} from "@/lib/schemas/entities";
import type { NotificationKind } from "@/lib/domain/reminders";

export interface ClientPackageView {
  clientPackage: ClientPackage;
  template: PackageTemplate;
  serviceName: string;
}

export interface NewApprovalRequest {
  businessId: string;
  clientId: string;
  appointmentId: string | null;
  kind: ApprovalKind;
  details: string;
}

export interface NotificationRecord {
  businessId: string;
  clientId: string;
  kind: NotificationKind;
  dedupeKey: string;
  channel: "web" | "whatsapp" | "recording";
}

/**
 * Persistence port. Every method is scoped by `businessId` where it applies so a bug in the caller
 * can never cross tenants. Implementations: in-memory (tests, smoke) and Supabase (app).
 */
export interface KeeperStore {
  getBusinessById(businessId: string): Promise<Business | null>;
  getBusinessBySlug(slug: string): Promise<Business | null>;

  listActiveServices(businessId: string): Promise<Service[]>;
  getService(businessId: string, serviceId: string): Promise<Service | null>;
  listActivePackageTemplates(businessId: string): Promise<PackageTemplate[]>;

  findOrCreateClient(businessId: string, phone: string, name: string | null): Promise<Client>;
  getClient(businessId: string, clientId: string): Promise<Client | null>;
  /** Sets the name only when it is still unknown — never overwrites what the owner recorded. */
  setClientNameIfMissing(businessId: string, clientId: string, name: string): Promise<void>;
  listClientPackages(businessId: string, clientId: string): Promise<ClientPackageView[]>;

  /** Appointments in blocking statuses (hold/confirmed) overlapping [from, to). */
  listBlockingAppointments(businessId: string, from: Date, to: Date): Promise<Appointment[]>;
  getAppointment(businessId: string, appointmentId: string): Promise<Appointment | null>;
  /** Idempotent on (businessId, clientId, startsAt): returns the existing row when it already exists. */
  insertAppointment(appointment: Appointment): Promise<Appointment>;
  updateAppointment(appointment: Appointment): Promise<Appointment>;
  listExpiredHolds(now: Date): Promise<Appointment[]>;

  insertDeposit(deposit: Deposit): Promise<Deposit>;
  getOpenDepositForAppointment(businessId: string, appointmentId: string): Promise<Deposit | null>;
  getDepositByLinkId(linkId: string): Promise<Deposit | null>;
  updateDeposit(deposit: Deposit): Promise<Deposit>;

  insertApprovalRequest(request: NewApprovalRequest): Promise<ApprovalRequest>;

  /** Returns false when `dedupeKey` was already recorded — the caller must not send again. */
  recordNotification(record: NotificationRecord): Promise<boolean>;

  logActivity(entry: ActivityEntry): Promise<void>;
}
