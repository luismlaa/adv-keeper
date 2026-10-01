"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentInstant, errorToState, type ActionState } from "@/lib/dashboard/action-state";
import { resolveApproval } from "@/lib/dashboard/approvals-queries";
import { requireOwnerContext } from "@/lib/dashboard/context";

const input = z.object({
  approvalId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
});

export async function resolveApprovalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = input.safeParse({
    approvalId: formData.get("approvalId"),
    decision: formData.get("decision"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) return { status: "error", message: "Solicitud inválida." };
  const ctx = await requireOwnerContext();
  try {
    await resolveApproval(ctx, parsed.data.approvalId, parsed.data.decision, parsed.data.note ?? null, currentInstant());
  } catch (error) {
    return errorToState(error);
  }
  revalidatePath("/", "layout");
  return { status: "ok", message: parsed.data.decision === "approved" ? "Aprobada." : "Rechazada." };
}
