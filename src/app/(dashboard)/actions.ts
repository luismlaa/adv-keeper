"use server";

import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/db/server";

export async function signOut(): Promise<void> {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  redirect("/login");
}
