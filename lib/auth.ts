import { prisma } from "./prisma";
import { createClient } from "./supabase/server";

// SERVER-ONLY auth guards. Admin identity lives in the Supabase JWT's
// app_metadata (is_admin: true) — app_metadata can be written ONLY with the
// service role key, never by a user, unlike user_metadata which users can
// edit themselves. Members can therefore never grant themselves the claim.

export type AuthClaims = {
  sub: string;
  phone?: string;
  app_metadata?: Record<string, unknown>;
} & Record<string, unknown>;

/** Pure check, unit-testable: does this claims object carry the admin flag? */
export function isAdminClaims(claims: AuthClaims | null): boolean {
  return claims?.app_metadata?.is_admin === true;
}

/** Validated claims of the signed-in user, or null. Never throws. */
export async function getCurrentUser(): Promise<AuthClaims | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;
    return data.claims as AuthClaims;
  } catch {
    // Outside a request scope (scripts, tests): not signed in.
    return null;
  }
}

/** The organizer, or an error result. First statement of every admin action. */
export async function requireAdmin() {
  const claims = await getCurrentUser();
  if (!claims) return { ok: false as const, error: "Not signed in." };
  if (!isAdminClaims(claims)) {
    return { ok: false as const, error: "Not authorized — organizer only." };
  }
  return { ok: true as const, userId: claims.sub };
}

/** The signed-in member's Person row, or an error result. */
export async function requireMember() {
  const claims = await getCurrentUser();
  if (!claims) return { ok: false as const, error: "Not signed in." };
  const person = await prisma.person.findUnique({ where: { authUserId: claims.sub } });
  if (!person) {
    return { ok: false as const, error: "No member record is linked to this sign-in." };
  }
  return { ok: true as const, person, userId: claims.sub, isAdmin: isAdminClaims(claims) };
}
