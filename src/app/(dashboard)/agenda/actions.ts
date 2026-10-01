"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { errorToState, type ActionState } from "@/lib/dashboard/action-state";
import { applyOwnerAppointmentAction } from "@/lib/dashboard/appointment-actions";
import { requireOwnerContext } from "@/lib/dashboard/context";

const input = z.object({
  appointmentId: z.uuid(),
  action: z.enum(["complete", "no_show", "cancel"]),
  reason: z.string().max(500).optional(),
});

const DONE: Readonly<Record<z.infer<typeof input>["action"], string>> = {
  complete: "Cita marcada como completada.",
  no_show: "Marcada como “no asistió”.",
  cancel: "Cita cancelada.",
};

export async function ownerAppointmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = input.safeParse({
    appointmentId: formData.get("appointmentId"),
    action: formData.get("action"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) return { status: "error", message: "Solicitud inválida." };
  const ctx = await requireOwnerContext();
  try {
    await applyOwnerAppointmentAction(ctx, parsed.data.appointmentId, parsed.data.action, parsed.data.reason ?? null);
  } catch (error) {
    return errorToState(error);
  }
  revalidatePath("/agenda");
  revalidatePath("/clientas", "layout");
  return { status: "ok", message: DONE[parsed.data.action] };
}
