import type { SupabaseClient } from "@supabase/supabase-js";
import { BLOCKING_STATUSES } from "@/lib/domain/appointment-state";
import { activityEntrySchema, type ActivityEntry, type Appointment, type ApprovalRequest, type Business, type Client, type Deposit, type PackageTemplate, type Service } from "@/lib/schemas/entities";
import {
  fromAppointment,
  fromDeposit,
  toAppointment,
  toApprovalRequest,
  toBusiness,
  toClient,
  toClientPackage,
  toDeposit,
  toPackageTemplate,
  toService,
} from "./rows";
import type { ClientPackageView, KeeperStore, NewApprovalRequest, NotificationRecord } from "./types";

const UNIQUE_VIOLATION = "23505";

export class StoreError extends Error {
  constructor(operation: string, cause: { message: string; code?: string }) {
    super(`${operation} failed: ${cause.message}${cause.code ? ` (${cause.code})` : ""}`);
    this.name = "StoreError";
  }
}

/** KeeperStore over Supabase using the service-role client; every query filters by business_id. */
export class SupabaseStore implements KeeperStore {
  constructor(private readonly db: SupabaseClient) {}

  async getBusinessById(businessId: string): Promise<Business | null> {
    const { data, error } = await this.db.from("businesses").select("*").eq("id", businessId).maybeSingle();
    if (error) throw new StoreError("getBusinessById", error);
    return data ? toBusiness(data) : null;
  }

  async getBusinessBySlug(slug: string): Promise<Business | null> {
    const { data, error } = await this.db.from("businesses").select("*").eq("slug", slug).maybeSingle();
    if (error) throw new StoreError("getBusinessBySlug", error);
    return data ? toBusiness(data) : null;
  }

  async listActiveServices(businessId: string): Promise<Service[]> {
    const { data, error } = await this.db
      .from("services")
      .select("*")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("sort");
    if (error) throw new StoreError("listActiveServices", error);
    return data.map(toService);
  }

  async getService(businessId: string, serviceId: string): Promise<Service | null> {
    const { data, error } = await this.db
      .from("services")
      .select("*")
      .eq("business_id", businessId)
      .eq("id", serviceId)
      .maybeSingle();
    if (error) throw new StoreError("getService", error);
    return data ? toService(data) : null;
  }

  async listActivePackageTemplates(businessId: string): Promise<PackageTemplate[]> {
    const { data, error } = await this.db
      .from("package_templates")
      .select("*")
      .eq("business_id", businessId)
      .eq("active", true);
    if (error) throw new StoreError("listActivePackageTemplates", error);
    return data.map(toPackageTemplate);
  }

  async findOrCreateClient(businessId: string, phone: string, name: string | null): Promise<Client> {
    const { data, error } = await this.db
      .from("clients")
      .upsert({ business_id: businessId, phone, name }, { onConflict: "business_id,phone", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error) throw new StoreError("findOrCreateClient", error);
    if (data) return toClient(data);
    const existing = await this.db.from("clients").select("*").eq("business_id", businessId).eq("phone", phone).single();
    if (existing.error) throw new StoreError("findOrCreateClient(select)", existing.error);
    return toClient(existing.data);
  }

  async getClient(businessId: string, clientId: string): Promise<Client | null> {
    const { data, error } = await this.db
      .from("clients")
      .select("*")
      .eq("business_id", businessId)
      .eq("id", clientId)
      .maybeSingle();
    if (error) throw new StoreError("getClient", error);
    return data ? toClient(data) : null;
  }

  async setClientNameIfMissing(businessId: string, clientId: string, name: string): Promise<void> {
    const { error } = await this.db
      .from("clients")
      .update({ name })
      .eq("business_id", businessId)
      .eq("id", clientId)
      .is("name", null);
    if (error) throw new StoreError("setClientNameIfMissing", error);
  }

  async listClientPackages(businessId: string, clientId: string): Promise<ClientPackageView[]> {
    const { data, error } = await this.db
      .from("client_packages")
      .select("*, package_templates(*, services(name))")
      .eq("business_id", businessId)
      .eq("client_id", clientId);
    if (error) throw new StoreError("listClientPackages", error);
    return data.map((row) => {
      const templateRow = row.package_templates as Record<string, unknown> & { services: { name: string } | null };
      const template = toPackageTemplate(templateRow);
      return { clientPackage: toClientPackage(row), template, serviceName: templateRow.services?.name ?? template.name };
    });
  }

  async listBlockingAppointments(businessId: string, from: Date, to: Date): Promise<Appointment[]> {
    const { data, error } = await this.db
      .from("appointments")
      .select("*")
      .eq("business_id", businessId)
      .in("status", [...BLOCKING_STATUSES])
      .lt("starts_at", to.toISOString())
      .gt("ends_at", from.toISOString());
    if (error) throw new StoreError("listBlockingAppointments", error);
    return data.map(toAppointment);
  }

  async getAppointment(businessId: string, appointmentId: string): Promise<Appointment | null> {
    const { data, error } = await this.db
      .from("appointments")
      .select("*")
      .eq("business_id", businessId)
      .eq("id", appointmentId)
      .maybeSingle();
    if (error) throw new StoreError("getAppointment", error);
    return data ? toAppointment(data) : null;
  }

  async insertAppointment(appointment: Appointment): Promise<Appointment> {
    const { data, error } = await this.db.from("appointments").insert(fromAppointment(appointment)).select("*").single();
    if (!error) return toAppointment(data);
    if (error.code !== UNIQUE_VIOLATION) throw new StoreError("insertAppointment", error);
    const existing = await this.db
      .from("appointments")
      .select("*")
      .eq("business_id", appointment.businessId)
      .eq("client_id", appointment.clientId)
      .eq("starts_at", appointment.startsAt)
      .in("status", [...BLOCKING_STATUSES])
      .single();
    if (existing.error) throw new StoreError("insertAppointment(existing)", existing.error);
    return toAppointment(existing.data);
  }

  async updateAppointment(appointment: Appointment): Promise<Appointment> {
    const { data, error } = await this.db
      .from("appointments")
      .update(fromAppointment(appointment))
      .eq("business_id", appointment.businessId)
      .eq("id", appointment.id)
      .select("*")
      .single();
    if (error) throw new StoreError("updateAppointment", error);
    return toAppointment(data);
  }

  async listExpiredHolds(now: Date): Promise<Appointment[]> {
    const { data, error } = await this.db
      .from("appointments")
      .select("*")
      .eq("status", "hold_pending_deposit")
      .lte("hold_expires_at", now.toISOString())
      .limit(500);
    if (error) throw new StoreError("listExpiredHolds", error);
    return data.map(toAppointment);
  }

  async insertDeposit(deposit: Deposit): Promise<Deposit> {
    const { data, error } = await this.db.from("deposits").insert(fromDeposit(deposit)).select("*").single();
    if (error) throw new StoreError("insertDeposit", error);
    return toDeposit(data);
  }

  async getOpenDepositForAppointment(businessId: string, appointmentId: string): Promise<Deposit | null> {
    const { data, error } = await this.db
      .from("deposits")
      .select("*")
      .eq("business_id", businessId)
      .eq("appointment_id", appointmentId)
      .in("status", ["pending", "paid"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new StoreError("getOpenDepositForAppointment", error);
    return data ? toDeposit(data) : null;
  }

  async getDepositByLinkId(linkId: string): Promise<Deposit | null> {
    const { data, error } = await this.db.from("deposits").select("*").eq("link_id", linkId).maybeSingle();
    if (error) throw new StoreError("getDepositByLinkId", error);
    return data ? toDeposit(data) : null;
  }

  async updateDeposit(deposit: Deposit): Promise<Deposit> {
    const { data, error } = await this.db
      .from("deposits")
      .update(fromDeposit(deposit))
      .eq("business_id", deposit.businessId)
      .eq("id", deposit.id)
      .select("*")
      .single();
    if (error) throw new StoreError("updateDeposit", error);
    return toDeposit(data);
  }

  async insertApprovalRequest(request: NewApprovalRequest): Promise<ApprovalRequest> {
    const { data, error } = await this.db
      .from("approval_requests")
      .insert({
        business_id: request.businessId,
        client_id: request.clientId,
        appointment_id: request.appointmentId,
        kind: request.kind,
        details: request.details,
      })
      .select("*")
      .single();
    if (error) throw new StoreError("insertApprovalRequest", error);
    return toApprovalRequest(data);
  }

  async recordNotification(record: NotificationRecord): Promise<boolean> {
    const { error } = await this.db.from("notifications_sent").insert({
      business_id: record.businessId,
      client_id: record.clientId,
      kind: record.kind,
      dedupe_key: record.dedupeKey,
      channel: record.channel,
    });
    if (!error) return true;
    if (error.code === UNIQUE_VIOLATION) return false;
    throw new StoreError("recordNotification", error);
  }

  async logActivity(entry: ActivityEntry): Promise<void> {
    const e = activityEntrySchema.parse(entry);
    const { error } = await this.db.from("activity_log").insert({
      business_id: e.businessId,
      actor: e.actor,
      entity: e.entity,
      entity_id: e.entityId,
      action: e.action,
      reason: e.reason,
      meta: e.meta,
    });
    if (error) throw new StoreError("logActivity", error);
  }
}
