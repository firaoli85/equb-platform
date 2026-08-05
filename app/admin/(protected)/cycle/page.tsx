import Link from "next/link";
import { getActiveCycleDetail } from "@/app/actions/cycles";
import { formatDateUTC, formatMoney } from "@/lib/format";
import { calculateFinishWeek, currentWeekNumber } from "@/lib/money";
import { getSetting } from "@/lib/settings";

// The current week is derived from the calendar on every request (2.14) —
// this page must never be served from a build-time snapshot.
export const dynamic = "force-dynamic";

export default async function CyclePage() {
  const cycle = await getActiveCycleDetail();
  // Presentation mode (2.4): the action already redacted names to lucky
  // numbers and zeroed money — this flag hides the money columns so no
  // misleading $0 renders.
  const presentation = await getSetting("presentationMode");

  if (!cycle) {
    return (
      <main>
        <h1 className="mb-2 text-xl font-semibold">No active cycle</h1>
        <p className="text-sm text-gray-700">
          <Link href="/admin/cycles/new" className="underline">
            Start a new cycle
          </Link>{" "}
          to begin.
        </p>
      </main>
    );
  }

  const week = currentWeekNumber(cycle.startDate, new Date());
  const activeParticipations = cycle.participations.filter((p) => p.status === "ACTIVE");
  // The pot for THIS week counts only members whose window covers it (2.7:
  // mid-cycle joins must never break the math) — someone starting week 12
  // contributes nothing to week 5's pot, and someone finished contributes
  // nothing after their finish week.
  const effectiveWeek = Math.max(1, week);
  const weeklyPot = activeParticipations
    .filter(
      (p) =>
        p.startWeek <= effectiveWeek &&
        effectiveWeek <= calculateFinishWeek(p.startWeek, p.weeksCommitted),
    )
    .reduce((sum, p) => sum + p.weeklyAmount, 0);

  return (
    <main>
      <header className="mb-6 animate-fade-in-up">
        <h1 className="text-xl font-black text-gray-900 dark:text-white">{cycle.name}</h1>
        <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Current week
            </dt>
            <dd className="font-bold tabular-nums text-gray-900 dark:text-white" data-testid="current-week">
              {week === 0
                ? `Starts ${formatDateUTC(cycle.startDate)}`
                : `Week ${week} of ${cycle.plannedWeeks}${week > cycle.plannedWeeks ? " (past planned)" : ""}`}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Elapsed / planned
            </dt>
            <dd className="font-bold tabular-nums text-gray-900 dark:text-white">
              {Math.min(week, cycle.plannedWeeks)} / {cycle.plannedWeeks} weeks
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Members
            </dt>
            <dd className="font-bold tabular-nums text-gray-900 dark:text-white" data-testid="member-count">
              {activeParticipations.length}
            </dd>
          </div>
          {!presentation && (
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                This week’s pot
              </dt>
              <dd className="font-bold tabular-nums text-gray-900 dark:text-white" data-testid="weekly-pot">
                {formatMoney(weeklyPot)}
              </dd>
            </div>
          )}
        </dl>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm animate-fade-in-up-1">
        <Link
          href="/admin/cycle/add"
          className="inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-700 active:scale-[0.97]"
        >
          Add member
        </Link>
        {[
          { href: "/admin/payments", label: "Payments" },
          { href: "/admin/cycle/weeks", label: "Weeks" },
          { href: "/admin/cycle/draws", label: "Draws" },
          { href: "/admin/collections", label: "Collections" },
          { href: "/admin/wheel/setup", label: "Wheel setup" },
          { href: "/admin/cycle/edit", label: "Edit cycle" },
          { href: "/admin/cycle/close", label: "Close cycle" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="inline-flex items-center justify-center rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#141414] px-3.5 py-2 text-sm font-semibold text-gray-800 dark:text-gray-200 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.97]"
          >
            {l.label}
          </Link>
        ))}
      </div>

      {cycle.participations.length === 0 ? (
        <p className="text-sm text-gray-700 dark:text-gray-300">No members yet.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] shadow-sm animate-fade-in-up-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-white/[0.03] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Member
                </th>
                {!presentation && (
                  <th className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-white/[0.03] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                    Weekly
                  </th>
                )}
                <th className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-white/[0.03] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Lucky numbers
                </th>
                <th className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-white/[0.03] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Weeks
                </th>
                <th className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-white/[0.03] px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {cycle.participations.map((p) => (
                <tr
                  key={p.id}
                  className="align-top transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                >
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-2.5">
                    <Link href={`/admin/participations/${p.id}`} className="block hover:underline">
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {p.person.nameAmharic}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {p.person.nameEnglishFirst} {p.person.nameEnglishLast ?? ""}
                      </div>
                    </Link>
                  </td>
                  {!presentation && (
                    <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-2.5 tabular-nums text-gray-700 dark:text-gray-300">
                      {formatMoney(p.weeklyAmount)}
                    </td>
                  )}
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-2.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {p.luckyNumbers
                      .map((n) =>
                        presentation ? `#${n.number}` : `#${n.number} (${formatMoney(n.amount)})`,
                      )
                      .join(", ")}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-2.5 tabular-nums text-gray-700 dark:text-gray-300">
                    {p.startWeek}–{calculateFinishWeek(p.startWeek, p.weeksCommitted)}
                  </td>
                  <td className="border-b border-gray-100 dark:border-gray-800/60 px-4 py-2.5 text-gray-700 dark:text-gray-300">
                    {p.status === "ACTIVE" ? "Active" : "Closed"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
