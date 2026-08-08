"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import { formatMoney } from "@/lib/format";

// A key figure with a label, big tabular number, and a sub-line. Money
// figures count up on entry (once, quick, reduced-motion gated) — the
// dashboard's numbers should land, not just appear.
export function StatCard({
  label,
  cents,
  figure,
  sub,
  href,
  emphasis = false,
  delayClass = "",
}: {
  label: string;
  /** Money in cents — counted up and formatted. Use `figure` for non-money. */
  cents?: number;
  figure?: string;
  sub?: string;
  /** 2.1: no dead figures — every stat can drill down. */
  href?: string;
  emphasis?: boolean;
  delayClass?: string;
}) {
  const reduce = useReducedMotion();
  // NULL MEANS "NOT ANIMATING", AND NULL RENDERS THE TRUTH.
  //
  // This was `useState(0)`, so the server rendered every money figure as $0
  // and only hydration corrected it. On a money screen that is the worst
  // possible default: the dashboard's cash position, the cash tabs and every
  // drill-down served $0 in their HTML, flashed to the real number when the
  // bundle landed, and stayed at $0 for good if it never did — with no error
  // anywhere to say so.
  //
  // The figure is now the truth by default and the animation is an overlay on
  // top of it, which is the right way round: the count-up is decoration, and
  // decoration must never be what decides what a number says.
  const [display, setDisplay] = useState<number | null>(null);

  useEffect(() => {
    if (cents === undefined || reduce) return;
    const ctrl = animate(0, cents, {
      duration: motionTokens.duration.slow,
      ease: motionTokens.easing.smooth,
      onUpdate: (v: number) => setDisplay(Math.round(v)),
      // Land on the exact stored value. Easing arithmetic can finish a hair
      // short, and a cash position reading $12,499 instead of $12,500 because
      // of a rounding error in an animation is not a figure anyone can trust.
      onComplete: () => setDisplay(cents),
    });
    return () => ctrl.stop();
  }, [cents, reduce]);

  const big = cents !== undefined ? formatMoney(display ?? cents) : (figure ?? "—");

  const inner = (
    <>
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">
        {label}
      </p>
      <p
        className={`mt-1 font-black tabular-nums leading-none text-gray-900 dark:text-white ${
          emphasis ? "text-3xl" : "text-2xl"
        }`}
      >
        {big}
      </p>
      {sub && <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400">{sub}</p>}
    </>
  );

  const cardCls = `block rounded-2xl border bg-white dark:bg-[#141414] px-5 py-4 shadow-sm animate-fade-in-up ${delayClass} ${
    emphasis
      ? "border-indigo-200 dark:border-indigo-900"
      : "border-gray-200 dark:border-gray-800"
  }`;

  if (href) {
    return (
      <Link
        href={href}
        className={`${cardCls} transition-[border-color,transform] duration-150 ease-out hover:border-indigo-300 dark:hover:border-indigo-700 active:scale-[0.99]`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={cardCls}>{inner}</div>;
}
