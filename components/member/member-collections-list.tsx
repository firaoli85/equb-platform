"use client";

import { formatDateUTC } from "@/lib/format";

// Collections (2.8): draw history by NUMBER only — never names, never
// amounts, never payment methods. A multi-number slot is ONE row (they
// shared the draw). The caller's own status is pinned on top.

export type DrawRow = {
  weekNumber: number;
  date: Date;
  numbers: number[];
};

export type MyNumber = {
  number: number;
  drawnWeekNumber: number | null;
  /** The DAY they won — what the member reads. The week number is not shown. */
  drawnDate: Date | null;
  collected: boolean;
};

function numbersLabel(numbers: number[]): string {
  return numbers.map((n) => `#${n}`).join(" & ");
}

export function MemberCollectionsList({
  draws,
  myNumbers,
  nextDraw,
  currentWeek,
}: {
  draws: DrawRow[];
  myNumbers: MyNumber[];
  nextDraw: { weekNumber: number; date: Date } | null;
  currentWeek: number;
}) {
  const myNumberSet = new Set(myNumbers.map((n) => n.number));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black text-gray-900 dark:text-white text-balance">
          Collections
        </h1>
        <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5 tabular-nums">
          Who has been drawn, by lucky number
        </p>
      </div>

      {/* ── Your own draw status — pinned ─────────────────────────── */}
      <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 px-4 py-3.5 shadow-sm space-y-1.5">
        {myNumbers.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            You have no lucky numbers in this cycle.
          </p>
        ) : (
          myNumbers.map((n) => (
            <p key={n.number} className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
              <span className="text-indigo-600 dark:text-indigo-400">Your draw:</span> #{n.number},{" "}
              {/* Dates, not cycle weeks (2.22). "You won in week 14" is a
                  coordinate the reader has never seen. */}
              {n.collected && n.drawnDate !== null
                ? `you collected on ${formatDateUTC(n.drawnDate)}`
                : n.drawnDate !== null
                  ? `you won on ${formatDateUTC(n.drawnDate)}`
                  : "still in the draw"}
            </p>
          ))
        )}
        {nextDraw && (
          <p className="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums pt-1 border-t border-indigo-100 dark:border-indigo-900/50">
            Next draw: {formatDateUTC(nextDraw.date)}
          </p>
        )}
      </div>

      {/* ── Draw history — numbers only ───────────────────────────── */}
      {draws.length === 0 ? (
        <p className="text-center py-10 text-sm text-gray-600 dark:text-gray-400">
          No draws yet — the first one starts the history.
        </p>
      ) : (
        <div className="rounded-2xl overflow-hidden bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm divide-y divide-gray-100 dark:divide-gray-800">
          {draws.map((d, idx) => {
            const isMine = d.numbers.some((n) => myNumberSet.has(n));
            return (
              <div
                key={d.weekNumber}
                className={`flex items-center gap-3 px-4 py-3${idx < 9 ? " animate-fade-in-up" : ""}`}
                style={idx < 9 ? { minHeight: "52px", animationDelay: `${idx * 0.07}s` } : { minHeight: "52px" }}
              >
                {/* THE DAY, NOT THE CYCLE WEEK (UI_STANDARDS 8c, and this
                    file's own rule two cards up). A draw belongs to the whole
                    group, so there is no member-relative week to convert to —
                    the date is the coordinate every member already shares. */}
                <span className="flex h-9 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  <span className="text-[9px] font-bold uppercase leading-none tracking-wide">
                    {d.date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
                  </span>
                  <span className="text-[12px] font-black leading-tight tabular-nums">
                    {d.date.toLocaleDateString("en-US", { day: "numeric", timeZone: "UTC" })}
                  </span>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                    {numbersLabel(d.numbers)}
                    {d.numbers.length > 1 && (
                      <span className="font-normal text-gray-600 dark:text-gray-400"> — shared draw</span>
                    )}
                    {isMine && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                        you
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-gray-600 dark:text-gray-400 tabular-nums mt-0.5">
                    {formatDateUTC(d.date)}
                  </p>
                </div>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="text-gold-500 shrink-0"
                  aria-hidden="true"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-center text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed px-2">
        Draws are shown by lucky number. Who holds which number stays private.
      </p>
    </div>
  );
}
