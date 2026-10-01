"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorToState, type ActionState } from "@/lib/dashboard/action-state";
import { formToRecord, parsePackageTemplateForm, parseServiceForm } from "@/lib/dashboard/catalog-form";
import { deleteOrDeactivate, savePackageTemplate, saveService } from "@/lib/dashboard/catalog-queries";
import { requireOwnerContext } from "@/lib/dashboard/context";

const optionalId = z.union([z.uuid(), z.literal("")]).transform((v) => (v === "" ? null : v));

export async function saveServiceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const form = formToRecord(formData);
  const id = optionalId.safeParse(form.id ?? "");
  if (!id.success) return { status: "error", message: "Solicitud inválida." };
  const parsed = parseServiceForm(form);
  if (!parsed.ok) return { status: "error", message: "Revisa el formulario:", errors: parsed.errors };
  const ctx = await requireOwnerContext();
  try {
    await saveService(ctx, id.data, parsed.value);
  } catch (error) {
    return errorToState(error);
  }
  revalidatePath("/servicios");
  return { status: "ok", message: id.data === null ? "Servicio agregado." : "Servicio actualizado." };
}

export async function savePackageTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const form = formToRecord(formData);
  const id = optionalId.safeParse(form.id ?? "");
  if (!id.success) return { status: "error", message: "Solicitud inválida." };
  const parsed = parsePackageTemplateForm(form);
  if (!parsed.ok) return { status: "error", message: "Revisa el formulario:", errors: parsed.errors };
  const ctx = await requireOwnerContext();
  try {
    await savePackageTemplate(ctx, id.data, parsed.value);
  } catch (error) {
    return errorToState(error);
  }
  revalidatePath("/servicios");
  return { status: "ok", message: id.data === null ? "Paquete creado." : "Paquete actualizado." };
}

const deleteInput = z.object({ id: z.uuid(), table: z.enum(["services", "package_templates"]) });

export async function deleteCatalogItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = deleteInput.safeParse({ id: formData.get("id"), table: formData.get("table") });
  if (!parsed.success) return { status: "error", message: "Solicitud inválida." };
  const ctx = await requireOwnerContext();
  try {
    const outcome = await deleteOrDeactivate(ctx, parsed.data.table, parsed.data.id);
    revalidatePath("/servicios");
    return {
      status: "ok",
      message: outcome === "deleted" ? "Eliminado." : "Tiene citas o paquetes vendidos asociados, así que lo desactivamos en vez de borrarlo.",
    };
  } catch (error) {
    return errorToState(error);
  }
}
