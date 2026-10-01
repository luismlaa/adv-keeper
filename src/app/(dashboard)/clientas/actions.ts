"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorToState, type ActionState } from "@/lib/dashboard/action-state";
import { logOwnerActivity } from "@/lib/dashboard/audit";
import { updateClientContact } from "@/lib/dashboard/clients-queries";
import { requireOwnerContext } from "@/lib/dashboard/context";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const contactSchema = z.object({
  clientId: z.uuid(),
  name: optionalText(120),
  email: optionalText(200).refine((v) => v === null || z.email().safeParse(v).success, "Correo inválido"),
  notes: optionalText(2000),
});

export async function updateClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = contactSchema.safeParse({
    clientId: formData.get("clientId"),
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { status: "error", message: "Revisa los datos.", errors: parsed.error.issues.map((i) => i.message) };
  const ctx = await requireOwnerContext();
  const { clientId, ...fields } = parsed.data;
  try {
    await updateClientContact(ctx, clientId, fields);
    await logOwnerActivity(ctx, {
      entity: "client",
      entityId: clientId,
      action: "owner_updated_contact",
      reason: "La dueña actualizó los datos o notas de la clienta",
    });
  } catch (error) {
    return errorToState(error);
  }
  revalidatePath(`/clientas/${clientId}`);
  return { status: "ok", message: "Datos guardados." };
}
