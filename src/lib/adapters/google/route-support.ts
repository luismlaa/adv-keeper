import { NextResponse } from "next/server";
import { EnvError, getServerEnv, requireEnv, type ServerEnv } from "@/lib/config/env";
import { getOwnerContext, NoBusinessError, type OwnerContext } from "@/lib/dashboard/context";
import { NONCE_COOKIE, STATE_TTL_MS } from "./oauth-state";

/** Next.js glue shared by the start and callback route handlers (server-only). */

export const NONCE_COOKIE_PATH = "/api/integrations/google";

export interface GoogleRouteConfig {
  env: ServerEnv;
  clientId: string;
  clientSecret: string;
}

/** Null when the Keeper-level Google OAuth client (or the env as a whole) is not configured. */
export function loadGoogleConfig(): GoogleRouteConfig | null {
  try {
    const env = getServerEnv();
    const google = requireEnv(env, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], "Google Calendar");
    return { env, clientId: google.GOOGLE_CLIENT_ID, clientSecret: google.GOOGLE_CLIENT_SECRET };
  } catch (error) {
    if (error instanceof EnvError) return null;
    throw error;
  }
}

export type OwnerResolution = { kind: "ok"; ctx: OwnerContext } | { kind: "login" } | { kind: "refused"; reason: "no_business" | "not_owner" | "demo" };

/** The signed-in owner of a live business. Staff and demo tenants cannot connect a calendar. */
export async function resolveConnectingOwner(): Promise<OwnerResolution> {
  let ctx: OwnerContext | null;
  try {
    ctx = await getOwnerContext();
  } catch (error) {
    if (error instanceof NoBusinessError) return { kind: "refused", reason: "no_business" };
    throw error;
  }
  if (ctx === null) return { kind: "login" };
  if (ctx.business.integrationMode === "demo") return { kind: "refused", reason: "demo" };

  const { data, error } = await ctx.db
    .from("memberships")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("business_id", ctx.business.id)
    .maybeSingle();
  if (error) throw new Error(`Could not load membership role: ${error.message}`);
  if ((data as { role?: string } | null)?.role !== "owner") return { kind: "refused", reason: "not_owner" };
  return { kind: "ok", ctx };
}

export function ajustesRedirect(request: Request, outcome: "conectado" | "error", reason?: string): NextResponse {
  const url = new URL("/ajustes", request.url);
  url.searchParams.set("google", outcome);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url, 303);
}

export function loginRedirect(request: Request): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("next", "/ajustes");
  return NextResponse.redirect(url, 303);
}

export function nonceCookieOptions(appUrl: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: appUrl.startsWith("https://"),
    path: NONCE_COOKIE_PATH,
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  };
}

export function clearNonceCookie(response: NextResponse): NextResponse {
  response.cookies.set(NONCE_COOKIE, "", { path: NONCE_COOKIE_PATH, maxAge: 0 });
  return response;
}
