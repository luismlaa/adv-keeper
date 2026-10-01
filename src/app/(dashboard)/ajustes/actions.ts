"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorToState, type ActionState } from "@/lib/dashboard/action-state";
import { formToRecord } from "@/lib/dashboard/catalog-form";
import { requireOwnerContext } from "@/lib/dashboard/context";
import { parseSettingsForm } from "@/lib/dashboard/settings-form";
import { updateBusinessSettings } from "@/lib/dashboard/settings-queries";

const businessName = z.string().trim().min(1, "Nombre del negocio: requerido").max(120);

export async function saveSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const form = formToRecord(formData);
  const ctx = await requireOwnerContext();
  const name = businessName.safeParse(form.businessName ?? "");
  const result = parseSettingsForm(form, ctx.settings, ctx.overrides);
  const errors = [...(name.success ? [] : name.error.issues.map((i) => i.message)), ...(result.ok ? [] : result.errors)];
  if (!name.success || !result.ok) return { status: "error", message: "Revisa el formulario:", errors };
  try {
    await updateBusinessSettings(ctx, { name: name.data, overrides: result.overrides });
  } catch (error) {
    return errorToState(error);
  }
  revalidatePath("/", "layout");
  return { status: "ok", message: "Ajustes guardados." };
}
