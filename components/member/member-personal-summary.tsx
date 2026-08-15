"use client";

import { useState, useEffect } from "react";
import { motion, useReducedMotion, animate } from "motion/react";
import { springs, motionTokens } from "@/lib/motion-tokens";
import { InitialAvatar } from "@/components/ui/initial-avatar";

interface Props {
  displayName: string;
  paidCount: number;
  lateCount: number;
  totalWeeks: number;
  /** "You joined in week 9. Your weeks run from 9 to 18." — late joiners only. */
  joinedLine?: string | null;
}

// The "You" card (ported hero): identity, private-to-you cue, and the
// progress ring as the sole hero with a count-up. Everything counts THEIR
// window only (2.22) — totalWeeks is weeksCommitted, never the cycle's.
export function MemberPersonalSummary({
  displayName,
  paidCount,
  lateCount,
  totalWeeks,
  joinedLine,
}: Props) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  // NULL MEANS "NOT ANIMATING", AND NULL RENDERS THE TRUTH.
  //
  // These were `useState(0)`, so the server rendered "0 of 20 weeks paid" and
  // a 0% bar for every member, corrected only once the bundle hydrated. On a
  // slow phone — which is what these members are on — a savings portal opening
  // with your contributions at zero is the most alarming wrong number the
  // product could show, and it stayed wrong for good with scripting off.
  const [displayCount, setDisplayCount] = useState<number | null>(null);
  const [displayPct, setDisplayPct] = useState<number | null>(null);

  const pct = totalWeeks > 0 ? Math.min(Math.round((paidCount / totalWeeks) * 100), 100) : 0;
  const remainingWeeks = Math.max(0, totalWeeks - paidCount);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (reduce) {
      setDisplayCount(paidCount);
      setDisplayPct(pct);
      return;
    }
    const ctrl = animate(0, paidCount, {
      duration: motionTokens.duration.slow,
      ease: motionTokens.easing.smooth,
      onUpdate: (v: number) => {
        const n = Math.round(v);
        setDisplayCount(n);
        setDisplayPct(totalWeeks > 0 ? Math.min(Math.round((n / totalWeeks) * 100), 100) : 0);
      },
      // Land on the stored figures exactly. Easing arithmetic can finish a
      // hair short, and a member reading 19 of 20 weeks when they have paid
      // all 20 would be right to think something is wrong.
      onComplete: () => {
        setDisplayCount(paidCount);
        setDisplayPct(pct);
      },
    });
    return () => ctrl.stop();
  }, [mounted, paidCount, totalWeeks, pct, reduce]);

  return (
    <div
      className="rounded-2xl animate-fade-in-up"
      style={{ background: "var(--hero-bg)", boxShadow: "var(--hero-shadow)" }}
    >
      <div className="px-5 pt-4 pb-4">
        {/* ── Identity row ─────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-2 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <InitialAvatar name={displayName} size="sm" />
            <div className="min-w-0">
              <h1 className="text-xl font-black text-blue-900 dark:text-white leading-tight text-balance">
                {displayName}
              </h1>
              <p className="text-[11px] text-blue-900/55 dark:text-white/55 mt-0.5">
                Your personal Equb account
              </p>
            </div>
          </div>
          {/* Privacy badge */}
          <div className="flex items-center gap-1 pt-1.5 shrink-0">
            <svg
              className="w-3 h-3 text-blue-900/40 dark:text-white/40 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <span className="text-[9px] font-medium text-blue-900/40 dark:text-white/40">
              Only visible to you
            </span>
          </div>
        </div>

        {/* ── Progress ring — the card's sole hero ──────────────── */}
        <div className="flex justify-center mb-3">
          <div
            className="relative w-[108px] h-[108px]"
            role="img"
            aria-label={`${pct}% complete — ${paidCount} of ${totalWeeks} weeks paid, ${remainingWeeks} remaining`}
          >
            <svg width="108" height="108" aria-hidden="true">
              <circle
                cx="54"
                cy="54"
                r="44"
                fill="none"
                stroke="currentColor"
                strokeWidth="7"
                className="text-blue-900/15 dark:text-white/15"
              />
              <g transform="rotate(-90, 54, 54)">
                <motion.circle
                  cx="54"
                  cy="54"
                  r="44"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="7"
                  strokeLinecap="round"
                  className="text-blue-700 dark:text-white"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: mounted ? pct / 100 : 0 }}
                  transition={reduce ? { duration: 0 } : springs.release}
                />
              </g>
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-0.5">
              <span className="text-2xl font-black text-blue-900 dark:text-white tabular-nums leading-none">
                {displayPct ?? pct}%
              </span>
              <span className="text-[10px] font-bold text-blue-900/60 dark:text-white/60 tabular-nums leading-none">
                {displayCount ?? paidCount}/{totalWeeks} wks
              </span>
            </div>
          </div>
        </div>

        {/* ── Calm supporting line ──────────────────────────────── */}
        <p className="text-center text-[11px] text-blue-900/55 dark:text-white/55">
          <span className="tabular-nums font-semibold text-blue-900/75 dark:text-white/75">
            {remainingWeeks} week{remainingWeeks === 1 ? "" : "s"} remaining
          </span>
          <span className="mx-1.5 opacity-50">·</span>
          {lateCount === 0 ? (
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              Perfect record
            </span>
          ) : (
            <span className="tabular-nums font-semibold text-red-600 dark:text-red-400">
              {lateCount} late
            </span>
          )}
        </p>

        {/* ── Late joiner — one calm line (2.22), never accusatory ── */}
        {joinedLine && (
          <p className="mt-3 text-center text-[11px] text-blue-900/60 dark:text-white/60 rounded-lg bg-white/40 dark:bg-white/5 px-3 py-2">
            {joinedLine}
          </p>
        )}
      </div>
    </div>
  );
}
