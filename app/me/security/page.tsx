import Link from "next/link";
import { redirect } from "next/navigation";
import { listMySessions } from "@/app/actions/sessions";
import { getCurrentUser } from "@/lib/auth";
import { ChangePin } from "@/components/member/change-pin";
import { SessionList } from "@/components/session-list";
import { TruncationNotice } from "@/components/ui/pager";

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
          <>
            {/* A capped list must say it was cut. This is the list a member
                reads to answer "is anything signed in that should not be?" —
                a quietly truncated answer to THAT is the worst kind. */}
            <TruncationNotice notice={result.notice} />
            <SessionList sessions={result.data} now={Date.now()} />
          </>
        )}
      </section>

      {/* CHANGE MY PIN — Door 1 of PIN self-service. The page's own copy
          above already tells a member who spots a strange device to "set a
          new PIN"; this is where that sentence stops being homework. */}
      <ChangePin />

      {/* PAST CYCLES — one quiet entry, deliberately.
          Not a tab and not on the home screen: a finished cycle's figures must
          never be readable as the current one. This is somewhere you GO to
          look something up, which is exactly what Account is for. */}
      <Link
        href="/me/history"
        className="flex min-h-11 items-center gap-3 rounded-2xl border border-gray-100 bg-white px-3.5 py-3.5 shadow-sm transition-colors hover:border-gray-200 dark:border-gray-800 dark:bg-[#141414] dark:hover:border-gray-700"
      >
        <svg
          className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 8v4l2.5 2.5M3.05 11a9 9 0 111.6 6M3 15v-4h4"
          />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-gray-900 dark:text-white">Past cycles</span>
          <span className="block text-xs text-gray-600 dark:text-gray-400">
            Your record of every cycle you have finished — kept for good
          </span>
        </span>
        <svg
          className="h-4 w-4 shrink-0 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </Link>

      {/* gray-600, not gray-500: measured 4.34:1 on the page background, and
          this is 12px body text needing 4.5:1. */}
      <p className="px-1 text-xs text-gray-600 dark:text-gray-400 text-pretty">
        Signing out happens automatically too: after 7 days without using your account, and 30 days
        after signing in, whichever comes first.
      </p>
    </div>
  );
}
