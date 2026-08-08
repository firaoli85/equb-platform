import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyPastCycles } from "@/app/actions/member-history";
import { PastCycleCard } from "@/components/member/past-cycle-card";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

// PAST CYCLES — the member's own copy of their financial record.
//
// Why it exists: without this, the only record of what a member paid into a
// twenty-week cycle, what they received and what they still owe sits with the
// organizer. That is not an acceptable place for it to sit alone.
//
// Why it lives under Account and not on the home screen: a finished cycle's
// figures must never be readable as the current one. Account is somewhere you
// GO to look something up — the home screen is where you read what is
// happening now.

export default async function MyHistoryPage() {
  const result = await getMyPastCycles();
  if (!result.ok) {
    if (result.error === "signed-out") redirect("/login");
    return (
      <p className="py-10 text-center text-sm text-gray-600 dark:text-gray-300">{result.error}</p>
    );
  }
  const { cycles, carried } = result.data;

  return (
    <div className="space-y-4">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link
            href="/me/security"
            className="inline-flex min-h-11 items-center text-gray-600 hover:underline dark:text-gray-400"
          >
            ← Account
          </Link>
        </p>
        <h1 className="text-xl font-black text-gray-900 dark:text-white">Past cycles</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 text-pretty">
          Your record of every cycle you have finished. It stays here for good — this is your
          copy, not the organizer&rsquo;s.
        </p>
      </header>

      {/* The carried balance leads when there is one: it is the only thing on
          this page that is still live, and the only thing a member might need
          to act on. */}
      {carried.balance > 0 && (
        <section
          aria-labelledby="carried"
          className="animate-fade-in-up-1 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 dark:border-amber-900 dark:bg-amber-950/25"
        >
          <h2
            id="carried"
            className="text-[11px] font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300"
          >
            Carried balance
          </h2>
          <p className="mt-0.5 text-2xl font-black tabular-nums text-amber-900 dark:text-amber-200">
            {formatMoney(carried.balance)}
          </p>
          <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90 text-pretty">
            Still owed from a finished cycle. It follows you rather than being written off, and
            it is the same money the cycle below ended with — not an extra charge.
          </p>

          {carried.story.length > 0 && (
            <>
              <h3 className="mt-4 text-[11px] font-bold uppercase tracking-wider text-amber-900/80 dark:text-amber-300/80">
                Where it came from
              </h3>
              <ul className="mt-1.5 divide-y divide-amber-200/70 dark:divide-amber-900/50">
                {carried.story.map((entry, i) => (
                  <li
                    key={`${entry.occurredAt}-${i}`}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2"
                  >
                    <span className="text-sm text-amber-900 dark:text-amber-200">
                      {entry.description}
                    </span>
                    <span className="text-[11px] tabular-nums text-amber-900/70 dark:text-amber-300/70">
                      {new Date(entry.occurredAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        timeZone: "UTC",
                      })}
                    </span>
                    <span
                      className={`ml-auto text-sm font-bold tabular-nums ${
                        entry.amount >= 0
                          ? "text-amber-900 dark:text-amber-200"
                          : "text-emerald-800 dark:text-emerald-300"
                      }`}
                    >
                      {entry.amount >= 0 ? "+" : "−"}
                      {formatMoney(Math.abs(entry.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {cycles.length === 0 ? (
        <p className="animate-fade-in-up-1 rounded-2xl border border-gray-200 bg-white px-5 py-6 text-center text-sm text-gray-600 dark:border-gray-800 dark:bg-[#141414] dark:text-gray-400">
          You have not finished a cycle yet. When one ends, your record of it appears here and
          stays.
        </p>
      ) : (
        <ul className="space-y-4">
          {cycles.map((cycle, i) => (
            <li key={cycle.cycleId}>
              <PastCycleCard
                cycle={cycle}
                className={i === 0 ? "animate-fade-in-up-1" : "animate-fade-in-up-2"}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
