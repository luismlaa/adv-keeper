import type { NextRequest } from "next/server";
import { completeGoogleConnection } from "@/lib/adapters/google/connect";
import { NONCE_COOKIE } from "@/lib/adapters/google/oauth-state";
import {
  ajustesRedirect,
  clearNonceCookie,
  loadGoogleConfig,
  loginRedirect,
  resolveConnectingOwner,
} from "@/lib/adapters/google/route-support";
import { logOwnerActivity } from "@/lib/dashboard/audit";
import { createAdminClient } from "@/lib/db/admin";
import { IntegrationCredentials, SupabaseIntegrationRepo } from "@/lib/integrations/repo";

/** GET ?code&state (or ?error) from Google → store the encrypted refresh token → back to /ajustes. */
export async function GET(request: NextRequest) {
  const config = loadGoogleConfig();
  if (config === null) {
    console.error("[google-oauth] callback refused: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
    return clearNonceCookie(ajustesRedirect(request, "error", "not_configured"));
  }

  const owner = await resolveConnectingOwner();
  if (owner.kind === "login") return clearNonceCookie(loginRedirect(request));
  if (owner.kind === "refused") return clearNonceCookie(ajustesRedirect(request, "error", owner.reason));
  const { ctx } = owner;
  const { env } = config;

  const result = await completeGoogleConnection({
    params: request.nextUrl.searchParams,
    nonceCookie: request.cookies.get(NONCE_COOKIE)?.value,
    owner: { userId: ctx.userId, businessId: ctx.business.id, email: ctx.email },
    client: { clientId: config.clientId, clientSecret: config.clientSecret },
    appUrl: env.APP_URL,
    secret: env.ENCRYPTION_KEY,
    credentials: new IntegrationCredentials(new SupabaseIntegrationRepo(createAdminClient(env)), env.ENCRYPTION_KEY),
    now: Date.now(),
  });

  if (!result.ok) {
    await logOwnerActivity(ctx, {
      entity: "integration",
      entityId: "google_calendar",
      action: "google_connect_failed",
      reason: `No se pudo conectar Google Calendar (${result.reason})`,
      meta: result.detail ? { detail: result.detail } : {},
    }).catch((e: unknown) => console.error("[google-oauth] activity log failed", e instanceof Error ? e.message : e));
    return clearNonceCookie(ajustesRedirect(request, "error", result.reason));
  }

  // Bookings only consult the calendar when the business has a calendar id; default to "primary".
  if (ctx.business.googleCalendarId === null) {
    const { error } = await ctx.db.from("businesses").update({ google_calendar_id: "primary" }).eq("id", ctx.business.id);
    if (error) console.error("[google-oauth] could not set google_calendar_id", { business: ctx.business.slug, error: error.message });
  }

  await logOwnerActivity(ctx, {
    entity: "integration",
    entityId: "google_calendar",
    action: "google_connected",
    reason: "La dueña conectó su Google Calendar desde Ajustes",
    meta: { accountEmail: result.accountEmail },
  }).catch((e: unknown) => console.error("[google-oauth] activity log failed", e instanceof Error ? e.message : e));

  return clearNonceCookie(ajustesRedirect(request, "conectado"));
}
