// PER-MEMBER PAYMENT CONSISTENCY — docs/ADMIN_IA.md §5.4.
//
// A dot strip per member, one dot per week of THEIR OWN window.
//
// Consistency is a pattern over time per person, and the pattern is what
// carries the meaning: three reds in a row is a different fact from three reds
// scattered. Ground truth 2.15 already says the grid is good at exactly this —
// "spotting patterns (streaks of red, people paid ahead)" — so this is that,
// compressed to one row per member so twenty-seven members fit on a screen.
//
// REFUSED: a percentage per member. "84% consistent" hides whether they are
// recovering or falling apart, which is the only thing worth knowing.
// REFUSED: a heatmap. Twenty-seven by twenty with five states is a
// legend-reading exercise, not a glance.
//
// NEVER COLOUR ALONE (rule 4): paid is filled, partial is half-filled,
// deferred is hollow with a ring, overdue is filled AND squared off, not-due
// is a bare tick. The strip survives greyscale.

import Link from "next/link";
import type { ConsistencyState } from "@/lib/chart";
import { longestOverdueRun } from "@/lib/chart";

export type MemberStrip = {
  participationId: string;
  name: string;
  /** One state per week of the member's OWN window, in week order. */
  weeks: readonly { weekNumber: number; state: ConsistencyState }[];
};

const DOT: Record<ConsistencyState, { cls: string; title: string }> = {
  paid: {
    cls: "bg-emerald-600 dark:bg-emerald-500 rounded-full",
    title: "paid in full",
  },
  partial: {
    // Half-filled: the shape says "some of it", before any colour is read.
    cls: "rounded-full bg-gradient-to-r from-indigo-600 from-50% to-gray-200 to-50% dark:from-indigo-400 dark:to-gray-800",
    title: "part paid",
  },
  deferred: {
    cls: "rounded-full border-2 border-gray-400 dark:border-gray-500",
    title: "deferred — not chased, still owed",
  },
  overdue: {
    // Square, not round: the one state that must be findable by shape alone.
    cls: "bg-red-600 dark:bg-red-500 rounded-[2px]",
    title: "overdue",
  },
  "not-due": {
    cls: "bg-gray-200 dark:bg-gray-800 rounded-full",
    title: "not due yet",
  },
};

const LEGEND: ConsistencyState[] = ["paid", "partial", "deferred", "overdue", "not-due"];
const LEGEND_LABEL: Record<ConsistencyState, string> = {
  paid: "Paid",
  partial: "Part paid",
  deferred: "Deferred",
  overdue: "Overdue",
  "not-due": "Not due yet",
};

export function ConsistencyStrip({
  members,
  className = "",
}: {
  members: readonly MemberStrip[];
  className?: string;
}) {
  if (members.length === 0) {
    return (
      <div
        className={`rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-[#141414] ${className}`}
      >
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Payment consistency</h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          Nobody is in the cycle yet.
        </p>
      </div>
    );
  }

  // Worst run first. The organizer opens this screen to find the person who is
  // slipping, and alphabetical order hides them among people who are fine.
  const rows = members
    .map((m) => ({
      ...m,
      run: longestOverdueRun(m.weeks.map((w) => w.state)),
      overdue: m.weeks.filter((w) => w.state === "overdue").length,
    }))
    .sort((a, b) => b.run - a.run || b.overdue - a.overdue || a.name.localeCompare(b.name));

  const worst = rows[0];

  return (
    <figure
      className={`rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-[#141414] ${className}`}
    >
      <figcaption className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Payment consistency</h2>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
            One dot per week of each member&rsquo;s own window — longest overdue run first
          </p>
        </div>
        {worst.run > 0 && (
          <p className="text-right">
            <span className="block text-xl font-black tabular-nums text-red-700 dark:text-red-400">
              {worst.run} week{worst.run === 1 ? "" : "s"}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-400">
              longest run, {worst.name.split(" — ").pop()}
            </span>
          </p>
        )}
      </figcaption>

      <div className="overflow-x-auto px-5 pb-2 touch-pan-x">
        <ul className="min-w-[320px] space-y-px">
          {rows.map((m) => (
            <li key={m.participationId} className="flex items-center gap-3 py-0.5">
              <Link
                href={`/admin/participations/${m.participationId}`}
                // `flex items-center` with a height floor, not a bare inline
                // link: as text alone this was a 16px-tall target in a row of
                // 20 dots, and a thumb aiming for the name hit a week instead.
                className="flex h-8 w-32 shrink-0 items-center truncate text-xs font-semibold text-gray-900 hover:text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:text-white dark:hover:text-indigo-300 sm:w-44"
                title={m.name}
              >
                {m.name}
              </Link>
              <span className="flex flex-1 flex-wrap gap-[3px]">
                {m.weeks.map((w) => (
                  <Link
                    key={w.weekNumber}
                    href={`/admin/payments?week=${w.weekNumber}`}
                    aria-label={`${m.name}, week ${w.weekNumber}: ${DOT[w.state].title}`}
                    title={`Week ${w.weekNumber} — ${DOT[w.state].title}`}
                    // The dot is 8px; the hit area around it is not. A 3px gap
                    // between 8px dots would be a 20-target minefield at 390px,
                    // so each dot sits inside its own 16px reach.
                    className="flex h-4 w-[11px] items-center justify-center rounded-[3px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600"
                  >
                    <span className={`h-2 w-2 ${DOT[w.state].cls}`} />
                  </Link>
                ))}
              </span>
              {m.run > 1 && (
                <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-1.5 text-[10px] font-bold tabular-nums text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
                  {m.run} in a row
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-gray-100 px-5 py-3 dark:border-gray-800/60">
        {LEGEND.map((state) => (
          <li key={state} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 ${DOT[state].cls}`} />
            <span className="text-xs text-gray-600 dark:text-gray-400">{LEGEND_LABEL[state]}</span>
          </li>
        ))}
      </ul>

      <table className="sr-only">
        <caption>Payment consistency by member and week</caption>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Weeks paid</th>
            <th scope="col">Weeks overdue</th>
            <th scope="col">Longest overdue run</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.participationId}>
              <th scope="row">{m.name}</th>
              <td>{m.weeks.filter((w) => w.state === "paid").length}</td>
              <td>{m.overdue}</td>
              <td>{m.run}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-600 dark:border-gray-800/60 dark:text-gray-400">
        A strip is the length of that member&rsquo;s own commitment, so a late joiner shows fewer
        dots rather than a run of missing weeks. Deferred weeks are still owed — they are simply
        not chased.
      </p>
    </figure>
  );
}
