import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { resolveBusinessSettings, type BusinessSettings } from "@/lib/config/business-settings";
import { createSessionClient } from "@/lib/db/server";
import type { Business } from "@/lib/schemas/entities";
import { toBusiness } from "@/lib/store/rows";

/**
 * The signed-in owner and her business. `db` is the RLS session client: every query through it is
 * tenant-scoped by Postgres (`is_member()`), so the dashboard never needs to trust a business id
 * coming from the browser.
 */
export interface OwnerContext {
  db: SupabaseClient;
  userId: string;
  email: string | null;
  business: Business;
  settings: BusinessSettings;
  /** Raw `businesses.settings` overrides (what /ajustes edits). */
  overrides: Record<string, unknown>;
}

export class NoBusinessError extends Error {
  constructor() {
    super("This user is not a member of any business");
    this.name = "NoBusinessError";
  }
}

async function loadOwnerContext(): Promise<OwnerContext | null> {
  const db = await createSessionClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;

  // MVP: an owner belongs to one business. If she has several, the oldest membership wins.
  const { data, error } = await db
    .from("memberships")
    .select("business_id, created_at, businesses(*)")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load membership: ${error.message}`);
  const businessRow = data?.businesses as Record<string, unknown> | null | undefined;
  if (!businessRow) throw new NoBusinessError();

  const business = toBusiness(businessRow);
  const overrides =
    business.settings !== null && typeof business.settings === "object" && !Array.isArray(business.settings)
      ? (business.settings as Record<string, unknown>)
      : {};
  return { db, userId: auth.user.id, email: auth.user.email ?? null, business, settings: resolveBusinessSettings(overrides), overrides };
}

/** Per-request memoized: the layout and the page share one lookup. */
export const getOwnerContext = cache(loadOwnerContext);

/** For pages and server actions: redirects to /login when there is no session. */
export async function requireOwnerContext(): Promise<OwnerContext> {
  const ctx = await getOwnerContext();
  if (ctx === null) redirect("/login");
  return ctx;
}
