"use client";

// The group (2.8): progress shared for accountability — name, weeks paid,
// one status pill. NEVER amounts, lucky numbers, payouts, or phones; the
// server sends none of them (member_progress view), so there is nothing
// here to leak. The viewer's own row is pinned and elevated.

export type GroupPeer = {
  participationId: string;
  nameAmharic: string;
  nameEnglishFirst: string;
  weeksPaid: number;
  weeksBehind: number;
};

function CurrentPill() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border shrink-0 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900">
      <svg
        className="w-3 h-3 shrink-0"
        fill="none"
        viewBox="0 0 12 12"
        stroke="currentColor"
        strokeWidth={2.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
      </svg>
      Current
    </span>
  );
}

function BehindPill({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center text-[11px] font-semibold px-2.5 py-0.5 rounded-full border shrink-0 tabular-nums text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900">
      {count} behind
    </span>
  );
}

export function MemberGroupList({
  viewer,
  peers,
  currentWeek,
  plannedWeeks,
  currentCount,
  totalMembers,
}: {
  viewer: {
    nameAmharic: string;
    nameEnglishFirst: string;
    weeksPaid: number;
    weeksBehind: number;
    weeksCommitted: number | null;
  } | null;
  peers: GroupPeer[];
  currentWeek: number;
  plannedWeeks: number;
  currentCount: number;
  totalMembers: number;
}) {
  // Alphabetical grouping by English first name (server pre-sorts).
  type Group = { letter: string; members: GroupPeer[] };
  const groups: Group[] = [];
  for (const m of peers) {
    const letter = m.nameEnglishFirst[0]?.toUpperCase() ?? "#";
    if (groups.length === 0 || groups[groups.length - 1].letter !== letter) {
      groups.push({ letter, members: [m] });
    } else {
      groups[groups.length - 1].members.push(m);
    }
  }

  const viewerName = viewer
    ? `${viewer.nameEnglishFirst} / ${viewer.nameAmharic}`
    : "";
  const viewerInitial = ([...(viewer?.nameEnglishFirst ?? "?")][0] ?? "?").toUpperCase();
  const viewerOnTrack = (viewer?.weeksBehind ?? 0) === 0;
  const viewerTotal = viewer?.weeksCommitted ?? null;
  const viewerPct =
    viewer && viewerTotal ? Math.min((viewer.weeksPaid / viewerTotal) * 100, 100) : 0;

  let globalIdx = 0;

  return (
    <div className="space-y-4">
      {/* ── Summary header ────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-gray-900 dark:text-white text-balance">
            The group
          </h1>
          <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5 tabular-nums">
            {totalMembers} members · Week {currentWeek} of {plannedWeeks}
          </p>
        </div>
        <div className="text-right shrink-0 pt-0.5">
          <p className="text-2xl font-black tabular-nums leading-none text-emerald-600 dark:text-emerald-400">
            {currentCount}/{totalMembers}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-widest mt-1 text-emerald-700 dark:text-emerald-400">
            current this week
          </p>
        </div>
      </div>

      {/* ── Your own row — pinned, accent-tinted, elevated ────────── */}
      {viewer && (
        <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 px-4 pt-3.5 pb-3.5 shadow-sm">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full bg-indigo-200/80 dark:bg-indigo-900/60 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-sm shrink-0 select-none"
              aria-hidden="true"
            >
              {viewerInitial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-snug text-gray-900 dark:text-white truncate">
                <span className="text-indigo-600 dark:text-indigo-400">You</span>
                <span aria-hidden="true" className="text-gray-600 dark:text-gray-400 mx-1.5">
                  ·
                </span>
                {viewerName}
              </p>
              <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5 tabular-nums">
                {viewer.weeksPaid}
                {viewerTotal !== null ? ` of ${viewerTotal}` : ""} weeks paid
              </p>
            </div>
            {viewerOnTrack ? <CurrentPill /> : <BehindPill count={viewer.weeksBehind} />}
          </div>
          {viewerTotal !== null && (
            <div
              className="mt-3 h-1 rounded-full overflow-hidden bg-indigo-100 dark:bg-indigo-900/50"
              role="progressbar"
              aria-valuenow={viewer.weeksPaid}
              aria-valuemin={0}
              aria-valuemax={viewerTotal}
              aria-label={`${viewer.weeksPaid} of ${viewerTotal} weeks paid`}
            >
              <div
                className="h-full rounded-full bg-indigo-500 dark:bg-indigo-400"
                style={{ width: `${viewerPct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Everyone else — plain rows, alphabetical ──────────────── */}
      {peers.length > 0 && (
        <div className="rounded-2xl overflow-hidden bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm">
          {groups.map((group, gi) => (
            <div key={group.letter}>
              <div
                className={[
                  "px-4 py-2 bg-gray-50/70 dark:bg-white/[0.02]",
                  gi > 0 ? "border-t border-gray-100 dark:border-gray-800" : "",
                ].join(" ")}
              >
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                  {group.letter}
                </span>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {group.members.map((m) => {
                  const idx = globalIdx++;
                  const onTrack = m.weeksBehind === 0;
                  const initial = (m.nameEnglishFirst[0] ?? m.nameAmharic[0] ?? "?").toUpperCase();
                  return (
                    <div
                      key={m.participationId}
                      className={`w-full flex items-center gap-3 px-4 py-3${idx < 9 ? " animate-fade-in-up" : ""}`}
                      style={
                        idx < 9
                          ? { minHeight: "56px", animationDelay: `${idx * 0.07}s` }
                          : { minHeight: "56px" }
                      }
                    >
                      <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-sm shrink-0 select-none">
                        {initial}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate leading-snug">
                          {m.nameEnglishFirst}
                        </p>
                        <p className="text-[11px] text-gray-600 dark:text-gray-400 truncate mt-0.5 tabular-nums leading-snug">
                          {m.weeksPaid} week{m.weeksPaid === 1 ? "" : "s"} paid
                        </p>
                      </div>
                      {onTrack ? <CurrentPill /> : <BehindPill count={m.weeksBehind} />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {peers.length === 0 && (
        <p className="text-center py-10 text-sm text-gray-600 dark:text-gray-400">
          No other members yet.
        </p>
      )}

      {/* ── Privacy notice (2.8) ──────────────────────────────────── */}
      <p className="text-center text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed px-2">
        Payment progress is shared for accountability. Amounts, lucky numbers, and payouts stay
        private.
      </p>
    </div>
  );
}
