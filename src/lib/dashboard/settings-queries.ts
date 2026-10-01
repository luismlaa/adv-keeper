import { logOwnerActivity } from "./audit";
import type { OwnerContext } from "./context";

/** Saves the business name and validated settings overrides (RLS: members may update their business). */
export async function updateBusinessSettings(
  ctx: OwnerContext,
  input: { name: string; overrides: Record<string, unknown> },
): Promise<void> {
  const { data, error } = await ctx.db
    .from("businesses")
    .update({ name: input.name, settings: input.overrides })
    .eq("id", ctx.business.id)
    .select("id");
  if (error) throw new Error(`updateBusinessSettings failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Negocio no encontrado");
  await logOwnerActivity(ctx, {
    entity: "business",
    entityId: ctx.business.id,
    action: "owner_updated_settings",
    reason: "La dueña actualizó los ajustes del negocio",
    meta: { changedKeys: Object.keys(input.overrides), nameChanged: input.name !== ctx.business.name },
  });
}
