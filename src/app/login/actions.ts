"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSessionClient } from "@/lib/db/server";
import { safeNextPath, type ActionState } from "@/lib/dashboard/action-state";

const credentials = z.object({
  email: z.email("Escribe un correo válido").max(200),
  password: z.string().min(1, "Escribe tu contraseña").max(200),
});

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    console.warn("[login] sign-in failed", { email: parsed.data.email, code: error.code ?? error.name });
    return { status: "error", message: "Correo o contraseña incorrectos." };
  }
  redirect(safeNextPath(formData.get("next")));
}
