"use server";

import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/config/env";
import { createSessionClient } from "@/lib/db/server";

export interface OwnerLoginState {
  error: string | null;
}

/**
 * "Soy la dueña": signs in as the shared demo owner (credentials live only on the server) and opens the
 * dashboard. The demo password is reset by every nightly seed, so a prospect can't lock others out.
 */
export async function enterAsDemoOwner(): Promise<OwnerLoginState> {
  const env = getServerEnv();
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: env.DEMO_OWNER_EMAIL,
    password: env.DEMO_OWNER_PASSWORD,
  });
  if (error) {
    console.error("[demo] owner sign-in failed", { status: error.status, message: error.message });
    return { error: "No pudimos abrir el panel de la dueña ahora mismo. Intenta de nuevo en un momento." };
  }
  redirect("/agenda");
}
