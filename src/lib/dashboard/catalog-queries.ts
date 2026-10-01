import type { PackageTemplate, Service } from "@/lib/schemas/entities";
import { toPackageTemplate, toService } from "@/lib/store/rows";
import { logOwnerActivity } from "./audit";
import type { PackageTemplateRowInput, ServiceRowInput } from "./catalog-form";
import type { OwnerContext } from "./context";

type Row = Record<string, unknown>;
const FK_VIOLATION = "23503";

export async function listServices(ctx: OwnerContext): Promise<Service[]> {
  const { data, error } = await ctx.db
    .from("services")
    .select("*")
    .eq("business_id", ctx.business.id)
    .order("active", { ascending: false })
    .order("sort", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`listServices failed: ${error.message}`);
  return (data as Row[]).map(toService);
}

export async function listPackageTemplates(ctx: OwnerContext): Promise<PackageTemplate[]> {
  const { data, error } = await ctx.db
    .from("package_templates")
    .select("*")
    .eq("business_id", ctx.business.id)
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw new Error(`listPackageTemplates failed: ${error.message}`);
  return (data as Row[]).map(toPackageTemplate);
}

export async function saveService(ctx: OwnerContext, id: string | null, input: ServiceRowInput): Promise<string> {
  const query =
    id === null
      ? ctx.db.from("services").insert({ ...input, business_id: ctx.business.id })
      : ctx.db.from("services").update(input).eq("business_id", ctx.business.id).eq("id", id);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`saveService failed: ${error.message}`);
  const savedId = (data as Row[] | null)?.[0]?.id;
  if (!savedId) throw new Error("Servicio no encontrado");
  await logOwnerActivity(ctx, {
    entity: "service",
    entityId: String(savedId),
    action: id === null ? "owner_created" : "owner_updated",
    reason: id === null ? "La dueña agregó un servicio al catálogo" : "La dueña editó un servicio del catálogo",
    meta: { price_minor: input.price_minor, deposit_override_minor: input.deposit_override_minor, active: input.active },
  });
  return String(savedId);
}

export async function savePackageTemplate(ctx: OwnerContext, id: string | null, input: PackageTemplateRowInput): Promise<string> {
  const query =
    id === null
      ? ctx.db.from("package_templates").insert({ ...input, business_id: ctx.business.id })
      : ctx.db.from("package_templates").update(input).eq("business_id", ctx.business.id).eq("id", id);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`savePackageTemplate failed: ${error.message}`);
  const savedId = (data as Row[] | null)?.[0]?.id;
  if (!savedId) throw new Error("Paquete no encontrado");
  await logOwnerActivity(ctx, {
    entity: "package_template",
    entityId: String(savedId),
    action: id === null ? "owner_created" : "owner_updated",
    reason: id === null ? "La dueña creó un paquete" : "La dueña editó un paquete",
    meta: { price_minor: input.price_minor, sessions_total: input.sessions_total, active: input.active },
  });
  return String(savedId);
}

/**
 * Delete when nothing references the row; otherwise deactivate it (appointments and sold packages keep
 * pointing at it). Returns what actually happened.
 */
export async function deleteOrDeactivate(
  ctx: OwnerContext,
  table: "services" | "package_templates",
  id: string,
): Promise<"deleted" | "deactivated"> {
  const entity = table === "services" ? "service" : "package_template";
  const del = await ctx.db.from(table).delete().eq("business_id", ctx.business.id).eq("id", id).select("id");
  if (!del.error && (del.data?.length ?? 0) > 0) {
    await logOwnerActivity(ctx, { entity, entityId: id, action: "owner_deleted", reason: "La dueña eliminó un elemento del catálogo sin uso" });
    return "deleted";
  }
  if (del.error && del.error.code !== FK_VIOLATION) throw new Error(`delete failed: ${del.error.message}`);
  const upd = await ctx.db.from(table).update({ active: false }).eq("business_id", ctx.business.id).eq("id", id).select("id");
  if (upd.error) throw new Error(`deactivate failed: ${upd.error.message}`);
  if ((upd.data?.length ?? 0) === 0) throw new Error("No encontrado");
  await logOwnerActivity(ctx, {
    entity,
    entityId: id,
    action: "owner_deactivated",
    reason: "La dueña quiso eliminarlo pero tiene citas o paquetes asociados; se desactivó",
  });
  return "deactivated";
}
