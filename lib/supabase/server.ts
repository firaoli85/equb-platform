import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { hardenSessionCookie } from "./cookie-policy";

/**
 * Server client for Server Components, Server Actions, and Route Handlers.
 * Follows the official @supabase/ssr getAll/setAll cookie contract. Every
 * cookie written here passes through hardenSessionCookie (audit H2).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, hardenSessionCookie(options)),
            );
          } catch {
            // Called from a Server Component, where cookies cannot be
            // written. Safe to ignore — the proxy refreshes sessions.
          }
        },
      },
    },
  );
}
