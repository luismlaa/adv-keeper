import { NextResponse } from "next/server";
import { beginGoogleConnection } from "@/lib/adapters/google/connect";
import { NONCE_COOKIE } from "@/lib/adapters/google/oauth-state";
import { ajustesRedirect, loadGoogleConfig, loginRedirect, nonceCookieOptions, resolveConnectingOwner } from "@/lib/adapters/google/route-support";

/** GET → Google consent screen. Linked from the "Conectar Google Calendar" button in /ajustes. */
export async function GET(request: Request) {
  const config = loadGoogleConfig();
  if (config === null) {
    console.error("[google-oauth] start refused: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
    return ajustesRedirect(request, "error", "not_configured");
  }

  const owner = await resolveConnectingOwner();
  if (owner.kind === "login") return loginRedirect(request);
  if (owner.kind === "refused") return ajustesRedirect(request, "error", owner.reason);

  const { ctx } = owner;
  const { url, nonce } = beginGoogleConnection({
    client: { clientId: config.clientId },
    appUrl: config.env.APP_URL,
    secret: config.env.ENCRYPTION_KEY,
    owner: { userId: ctx.userId, businessId: ctx.business.id, email: ctx.email },
    now: Date.now(),
  });

  const response = NextResponse.redirect(url);
  response.cookies.set(NONCE_COOKIE, nonce, nonceCookieOptions(config.env.APP_URL));
  return response;
}
