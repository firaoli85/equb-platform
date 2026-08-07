import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hardenSessionCookie } from "./cookie-policy";
import { checkSession } from "../session-gate";
import { SESSION_COOKIE_NAME } from "../session-cookie";
import { EXPIRY_PARAM } from "../session-policy";

function claimsSayAdmin(claims: unknown): boolean {
  return (
    (claims as { app_metadata?: { is_admin?: unknown } } | null)?.app_metadata?.is_admin === true
  );
}

/**
 * Session refresh + route protection, per the official @supabase/ssr
 * pattern. Unauthenticated (or non-admin) hits on /admin/* go to
 * /admin/login; unauthenticated hits on member routes go to /login.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          // Every refresh rewrite passes through the same policy (audit H2).
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, hardenSessionCookie(options)),
          );
        },
      },
    },
  );

  // IMPORTANT: no logic between client creation and getClaims() — per the
  // Supabase docs, anything in between can cause hard-to-debug session loss.
  // getClaims validates the JWT; never trust getSession() here.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  const path = request.nextUrl.pathname;
  const isAdmin = claimsSayAdmin(claims);

  function redirectTo(pathname: string, expired?: string) {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = "";
    // The login page states WHY, so an expiry is never a mystery or an error
    // page (ruling 3).
    if (expired) url.searchParams.set(EXPIRY_PARAM, expired);
    const redirect = NextResponse.redirect(url);
    // The refreshed auth cookies must ride along on the redirect.
    supabaseResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  const loginPath = isAdmin ? "/admin/login" : "/login";

  // SESSION EXPIRY (ruling 3). Only for a request that actually carries a
  // session — a signed-out visitor does no database work here. The gate can
  // only ever END a session; the Supabase checks below still decide access.
  if (claims) {
    const gate = await checkSession({
      token: request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null,
      isAdmin,
      // From the VALIDATED claims, so a missing handle can be told apart from
      // a session that predates the record.
      authUserId: claims?.sub ?? null,
    });
    if (gate.state === "expired") {
      const redirect = redirectTo(loginPath, gate.reason);

      // BOTH cookies must go, and the Supabase ones are the ones that matter.
      //
      // Clearing only the handle achieves the opposite of the intent: the
      // next request arrives with no handle, checkSession has nothing to
      // measure and allows it, and the still-valid Supabase session lets them
      // straight back in. Observed exactly that — an expired admin bounced
      // /admin/cycle → /admin/login?expired=idle → /admin/cycle and was
      // signed in again.
      //
      // Enumerated from the REQUEST, not from supabaseResponse: the response
      // only carries cookies Supabase happened to REWRITE on this request, so
      // when no token refresh occurred that set is empty and nothing gets
      // cleared. Chunked tokens (`sb-<ref>-auth-token.0`, `.1`) are covered
      // by the same prefix.
      redirect.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.startsWith("sb-")) {
          redirect.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
        }
      }
      return redirect;
    }
  }

  if (path.startsWith("/admin") && path !== "/admin/login" && !isAdmin) {
    return redirectTo("/admin/login");
  }
  if (path.startsWith("/me") && !claims) {
    return redirectTo("/login");
  }

  return supabaseResponse;
}
