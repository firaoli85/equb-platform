import { redirect } from "next/navigation";
import { listMySessions } from "@/app/actions/sessions";
import { getCurrentUser } from "@/lib/auth";
import { SessionList } from "@/components/session-list";

export const dynamic = "force-dynamic";

// "WHERE YOU ARE SIGNED IN" — the member's own view (ruling 4).
//
// This is the member's half of the security model that replaced the second
// factor: they signed in with four digits, so they get to see every device
// that did, and end any of them. Their own sessions only (2.8) — the
// organizer's view of a member lives on the admin person page and shows
// history, not a switch.
export default async function MemberSecurityPage() {
  const claims = await getCurrentUser();
  if (!claims) redirect("/login");

  const result = await listMySessions();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-black text-gray-900 dark:text-white">Where you are signed in</h1>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 text-pretty">
          Every device currently signed in to your account. If you see one you do not recognise,
          sign it out and set a new PIN.
        </p>
      </div>

      <section className="rounded-2xl bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm px-3.5 py-3.5">
        {!result.ok ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {result.error}
          </p>
        ) : (
          // `now` is stamped on the server so the "2 hours ago" labels match
          // on first paint instead of shifting after hydration.
          <SessionList sessions={result.data} now={Date.now()} />
        )}
      </section>

      {/* gray-600, not gray-500: measured 4.34:1 on the page background, and
          this is 12px body text needing 4.5:1. */}
      <p className="px-1 text-xs text-gray-600 dark:text-gray-400 text-pretty">
        Signing out happens automatically too: after 7 days without using your account, and 30 days
        after signing in, whichever comes first.
      </p>
    </div>
  );
}
