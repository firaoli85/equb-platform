import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
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

  function redirectTo(pathname: string) {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const redirect = NextResponse.redirect(url);
    // The refreshed auth cookies must ride along on the redirect.
    supabaseResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  if (path.startsWith("/admin") && path !== "/admin/login" && !claimsSayAdmin(claims)) {
    return redirectTo("/admin/login");
  }
  if (path.startsWith("/me") && !claims) {
    return redirectTo("/login");
  }

  return supabaseResponse;
}
