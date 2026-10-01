import type { AppointmentStatus, Client, ClientPackage } from "@/lib/schemas/entities";
import { toClient, toClientPackage } from "@/lib/store/rows";
import { lastVisit, packageOutlook, sanitizeSearch, type PackageOutlook } from "./clients";
import type { OwnerContext } from "./context";

type Row = Record<string, unknown>;

export interface ClientListItem {
  id: string;
  name: string | null;
  phone: string;
  lastVisitAt: string | null;
}

export async function listClients(ctx: OwnerContext, rawQuery: string | string[] | undefined): Promise<ClientListItem[]> {
  const q = sanitizeSearch(rawQuery);
  let query = ctx.db
    .from("clients")
    .select("id, name, phone, last_visit_at")
    .eq("business_id", ctx.business.id)
    .order("name", { ascending: true, nullsFirst: false })
    .limit(200);
  if (q !== "") query = query.or(`name.ilike.*${q}*,phone.ilike.*${q}*`);
  const { data, error } = await query;
  if (error) throw new Error(`listClients failed: ${error.message}`);
  return (data as Row[]).map((r) => ({
    id: String(r.id),
    name: (r.name as string | null) ?? null,
    phone: String(r.phone),
    lastVisitAt: r.last_visit_at ? new Date(String(r.last_visit_at)).toISOString() : null,
  }));
}

export interface ClientHistoryItem {
  id: string;
  startsAt: string;
  status: AppointmentStatus;
  serviceName: string;
  priceMinor: number;
  clientPackageId: string | null;
}

export interface ClientPackageCard {
  clientPackage: ClientPackage;
  name: string;
  serviceName: string;
  intervalDays: number;
  outlook: PackageOutlook;
}

export interface ClientDetail {
  client: Client;
  lastVisitAt: string | null;
  packages: ClientPackageCard[];
  history: ClientHistoryItem[];
}

export async function getClientDetail(ctx: OwnerContext, clientId: string, now: Date): Promise<ClientDetail | null> {
  const [clientRes, packagesRes, historyRes] = await Promise.all([
    ctx.db.from("clients").select("*").eq("business_id", ctx.business.id).eq("id", clientId).maybeSingle(),
    ctx.db
      .from("client_packages")
      .select("*, package_templates(name, interval_days, services(name))")
      .eq("business_id", ctx.business.id)
      .eq("client_id", clientId)
      .order("purchased_at", { ascending: false }),
    ctx.db
      .from("appointments")
      .select("id, starts_at, status, price_minor, client_package_id, services(name)")
      .eq("business_id", ctx.business.id)
      .eq("client_id", clientId)
      .order("starts_at", { ascending: false })
      .limit(100),
  ]);
  for (const res of [clientRes, packagesRes, historyRes]) {
    if (res.error) throw new Error(`getClientDetail failed: ${res.error.message}`);
  }
  if (!clientRes.data) return null;

  const client = toClient(clientRes.data);
  const history: ClientHistoryItem[] = ((historyRes.data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    startsAt: new Date(String(r.starts_at)).toISOString(),
    status: r.status as AppointmentStatus,
    serviceName: ((r.services ?? {}) as { name?: string }).name ?? "Servicio",
    priceMinor: Number(r.price_minor),
    clientPackageId: (r.client_package_id as string | null) ?? null,
  }));

  const packages: ClientPackageCard[] = ((packagesRes.data ?? []) as Row[]).map((r) => {
    const tpl = (r.package_templates ?? {}) as { name?: string; interval_days?: number; services?: { name?: string } | null };
    const clientPackage = toClientPackage(r);
    const intervalDays = Number(tpl.interval_days ?? 30);
    return {
      clientPackage,
      name: tpl.name ?? "Paquete",
      serviceName: tpl.services?.name ?? "",
      intervalDays,
      outlook: packageOutlook(clientPackage, intervalDays, history, now),
    };
  });

  return { client, lastVisitAt: lastVisit(history, client.lastVisitAt), packages, history };
}

/** Owner-editable contact fields. */
export async function updateClientContact(
  ctx: OwnerContext,
  clientId: string,
  fields: { name: string | null; email: string | null; notes: string | null },
): Promise<void> {
  const { data, error } = await ctx.db
    .from("clients")
    .update(fields)
    .eq("business_id", ctx.business.id)
    .eq("id", clientId)
    .select("id");
  if (error) throw new Error(`updateClientContact failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Clienta no encontrada");
}
