"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/format";

// Ported animation engine: each visible row sweeps a colored fill, then the
// star (paid, emerald SVG — never emoji) or dash (not paid) bounces in.
// Animates once per session; static under prefers-reduced-motion.

export type StampWeek = {
  id: string;
  /** THEIR ordinal — 1 is their first week, never the cycle's coordinate. */
  ownWeek: number;
  date: string;
  status: "PAID" | "LATE" | "PARTIAL_LATE" | "DEFERRED" | "SKIPPED" | "PARTIAL" | "PENDING";
  isPayoutWeek: boolean;
  /** What this week is covered by, in cents. */
  amountPaid: number;
  /** What the week costs at the current rate, in cents. */
  amountDue: number;
};

// A member reads these. DEFERRED must not look like forgiveness — the money
// is still theirs to pay; we simply are not chasing them for it.
const STATUS_LABEL: Record<StampWeek["status"], string> = {
  PAID: "Paid",
  LATE: "Late",
  DEFERRED: "Deferred",
  SKIPPED: "Skipped",
  PARTIAL: "Partial",
  PARTIAL_LATE: "Part paid",
  PENDING: "Upcoming",
};

/** The sub-line under the badge, so nobody misreads a deferral. */
const STATUS_NOTE: Partial<Record<StampWeek["status"], string>> = {
  DEFERRED: "still owed, not chased",
  SKIPPED: "nobody owed this week",
};

const BADGE_CLS: Record<StampWeek["status"], string> = {
  PAID: "text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40",
  LATE: "text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/40",
  DEFERRED: "text-sky-800 dark:text-sky-300 bg-sky-100 dark:bg-sky-900/50",
  SKIPPED: "text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700/60",
  PARTIAL: "text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40",
  // Blue, not red: money arrived (R2). Matches lib/status-labels.ts so the
  // portal and the admin grid cannot describe one week two ways.
  PARTIAL_LATE: "text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40",
  PENDING: "text-gray-500 dark:text-gray-400",
};

const FILL_MS = 420;
const MARK_MS = 220;
const SLOT_MS = FILL_MS + MARK_MS + 30;

export function WeekStampList({
  weeks,
  sessionKey,
}: {
  weeks: StampWeek[];
  sessionKey?: string;
}) {
  const storageKey = sessionKey ? `equb_tally_animated_${sessionKey}` : null;
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const queueRef = useRef<number[]>([]);
  const isRunning = useRef(false);
  const activeIdxRef = useRef<number | null>(null);
  const filledRef = useRef(new Set<number>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [filled, setFilled] = useState<Set<number>>(new Set());
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const startNextRef = useRef<() => void>(() => {});
  startNextRef.current = () => {
    if (queueRef.current.length === 0) {
      isRunning.current = false;
      if (storageKey) {
        try {
          sessionStorage.setItem(storageKey, "1");
        } catch {}
      }
      return;
    }
    isRunning.current = true;
    const nextIdx = queueRef.current.shift()!;
    activeIdxRef.current = nextIdx;
    setActiveIdx(nextIdx);

    timerRef.current = setTimeout(() => {
      filledRef.current.add(nextIdx);
      setFilled(new Set(filledRef.current));
      activeIdxRef.current = null;
      setActiveIdx(null);
      startNextRef.current();
    }, SLOT_MS);
  };

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    queueRef.current = [];
    isRunning.current = false;
    activeIdxRef.current = null;
    filledRef.current = new Set();
    setActiveIdx(null);
    setFilled(new Set());

    let alreadyAnimated = false;
    if (storageKey) {
      try {
        alreadyAnimated = sessionStorage.getItem(storageKey) === "1";
      } catch {}
    }

    if (reducedMotion || alreadyAnimated) {
      const all = new Set<number>(
        weeks.map((w, i) => (w.status !== "PENDING" ? i : -1)).filter((i) => i >= 0),
      );
      filledRef.current = all;
      setFilled(new Set(all));
      return;
    }

    function enqueue(idx: number) {
      if (filledRef.current.has(idx)) return;
      if (activeIdxRef.current === idx) return;
      const q = queueRef.current;
      if (q.includes(idx)) return;
      const pos = q.findIndex((i) => i > idx);
      if (pos === -1) q.push(idx);
      else q.splice(pos, 0, idx);
      if (!isRunning.current) startNextRef.current();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = parseInt((entry.target as HTMLElement).dataset.idx ?? "-1", 10);
          if (idx < 0 || weeks[idx]?.status === "PENDING") continue;
          enqueue(idx);
        }
      },
      { threshold: 0.15 },
    );

    rowRefs.current.filter(Boolean).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => {
      observer.disconnect();
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, reducedMotion, storageKey]);

  return (
    <div className="space-y-0.5" role="list">
      {/* The card's title renders whatever this returns, so an empty list
          left a headed card with nothing under it. */}
      {weeks.length === 0 && (
        <p className="px-2.5 py-3 text-xs text-gray-600 dark:text-gray-400">
          Your weeks appear here once the schedule is set.
        </p>
      )}
      {weeks.map((w, idx) => {
        const isActive = idx === activeIdx;
        const isDone = filled.has(idx);
        const showFill = isActive || isDone;
        const paid = w.status === "PAID";
        const notPaid =
          w.status === "LATE" ||
          w.status === "PARTIAL_LATE" ||
          w.status === "DEFERRED" ||
          w.status === "PARTIAL";
        const hasFill = paid || notPaid;
        const mark = paid ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="text-emerald-500 dark:text-emerald-400"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        ) : notPaid ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            className="text-gray-400 dark:text-gray-600"
          >
            <path d="M5 12h14" />
          </svg>
        ) : null;

        return (
          <div
            key={w.id}
            ref={(el) => {
              rowRefs.current[idx] = el;
            }}
            data-idx={String(idx)}
            role="listitem"
            className={[
              "relative overflow-hidden rounded-lg",
              w.isPayoutWeek ? "ring-1 ring-inset ring-indigo-200 dark:ring-indigo-800" : "",
            ].join(" ")}
          >
            {hasFill && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundColor: paid ? "var(--fill-green)" : "var(--fill-red)",
                  width: showFill ? "100%" : "0%",
                  transition:
                    isActive && !reducedMotion
                      ? `width ${FILL_MS}ms cubic-bezier(0.23,1,0.32,1)`
                      : "none",
                }}
                aria-hidden="true"
              />
            )}

            <div className="relative z-10 flex items-center gap-2 px-2.5 py-2 text-xs">
              <span className="w-5 text-[11px] text-center font-mono font-bold text-gray-500 dark:text-gray-400 shrink-0 tabular-nums">
                {w.ownWeek}
              </span>

              <span className="flex-1 text-gray-600 dark:text-gray-400 tabular-nums">{w.date}</span>

              {/* THE AMOUNT. A member reads down this column and the figures
                  must add up to the total on the card above. A partial shows
                  what landed against what the week costs; a skipped week owed
                  nothing, so it shows a dash rather than a misleading $0. */}
              <span className="shrink-0 tabular-nums font-semibold text-gray-900 dark:text-white">
                {w.status === "SKIPPED" ? (
                  <span className="font-normal text-gray-600 dark:text-gray-400">—</span>
                ) : w.amountPaid > 0 && w.amountPaid < w.amountDue ? (
                  <>
                    {formatMoney(w.amountPaid)}
                    <span className="font-normal text-gray-600 dark:text-gray-400">
                      {" "}
                      of {formatMoney(w.amountDue)}
                    </span>
                  </>
                ) : w.amountPaid > 0 ? (
                  formatMoney(w.amountPaid)
                ) : (
                  <span className="font-normal text-gray-600 dark:text-gray-400">
                    {formatMoney(w.amountDue)} due
                  </span>
                )}
              </span>

              {w.isPayoutWeek && (
                <span
                  className="text-[9px] font-bold uppercase tracking-wider shrink-0"
                  style={{ color: "var(--accent-text)" }}
                >
                  payout
                </span>
              )}

              <span className={`text-[10px] font-bold shrink-0 px-1.5 py-0.5 rounded-md ${BADGE_CLS[w.status]}`}>
                {STATUS_LABEL[w.status]}
              </span>

              <span className="w-5 shrink-0 text-sm leading-none text-center" aria-hidden="true">
                {mark && showFill ? (
                  <span
                    style={{
                      display: "inline-block",
                      animation:
                        isActive && !reducedMotion
                          ? `checkBounce ${MARK_MS}ms cubic-bezier(0.34,1.56,0.64,1) ${FILL_MS}ms both`
                          : "none",
                      opacity: isDone ? 1 : undefined,
                    }}
                  >
                    {mark}
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
