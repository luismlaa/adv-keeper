import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie and keeps signed-out visitors away from the owner dashboard.
 * This is only an optimistic check: every dashboard page and server action re-verifies the user, and
 * Postgres RLS scopes every query to her business.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // getUser() validates the JWT with Supabase Auth (and refreshes it when needed).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const isLogin = pathname === "/login";

  if (!user && !isLogin) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return withCookies(NextResponse.redirect(loginUrl), response);
  }
  if (user && isLogin) {
    const agendaUrl = request.nextUrl.clone();
    agendaUrl.pathname = "/agenda";
    agendaUrl.search = "";
    return withCookies(NextResponse.redirect(agendaUrl), response);
  }
  return response;
}

/** Carry refreshed auth cookies over to a redirect response. */
function withCookies(target: NextResponse, source: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export const config = {
  // Dashboard routes + login only; the public site, client chat, payments and APIs are untouched.
  matcher: [
    "/login",
    "/agenda/:path*",
    "/clientas/:path*",
    "/reactivar/:path*",
    "/aprobaciones/:path*",
    "/servicios/:path*",
    "/ajustes/:path*",
  ],
};
