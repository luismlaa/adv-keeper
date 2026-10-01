"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentInstant, errorToState, type ActionState } from "@/lib/dashboard/action-state";
import { requireOwnerContext } from "@/lib/dashboard/context";
import { reengageClient, type ReengageOutcome } from "@/lib/dashboard/reactivation-queries";

/**
 * On success the client drops out of the list, so the confirmation + message preview is shown by the
 * page from the URL (`?enviado=<id>`) — it survives the re-render and works without JavaScript.
 */
export async function reengageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const clientId = z.uuid().safeParse(formData.get("clientId"));
  if (!clientId.success) return { status: "error", message: "Solicitud inválida." };
  const ctx = await requireOwnerContext();
  let outcome: ReengageOutcome;
  try {
    outcome = await reengageClient(ctx, clientId.data, currentInstant());
  } catch (error) {
    return errorToState(error);
  }
  revalidatePath("/reactivar");
  redirect(`/reactivar?enviado=${clientId.data}${outcome.sent ? "" : "&repetido=1"}`);
}
