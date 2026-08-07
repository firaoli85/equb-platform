import { expiryNotice, isExpiryReason, type SessionRole } from "@/lib/session-policy";

// WHY YOU ARE BACK AT THE LOGIN SCREEN (ruling 3).
//
// An expired session redirects here, and the redirect carries the reason. A
// member who was quietly signed out and shown a bare login form assumes the
// app is broken or that they typed something wrong; one sentence prevents
// both. Never an error page, never a stack trace, never "unauthorized".
//
// Rendered on the server: the reason arrives as a query parameter and the
// wording comes from lib/session-policy.ts, so it stays the same sentence
// wherever it appears.

export function SessionExpiredNotice({
  reason,
  role,
}: {
  reason: string | string[] | undefined;
  role: SessionRole;
}) {
  const value = (Array.isArray(reason) ? reason[0] : reason) ?? null;
  // An unrecognised value shows nothing rather than a guess — the parameter
  // is in a URL anyone can edit.
  if (!isExpiryReason(value)) return null;

  return (
    <p
      role="status"
      className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 text-pretty"
    >
      {expiryNotice(value, role)}
    </p>
  );
}
