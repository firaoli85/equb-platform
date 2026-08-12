"use client";

import { useState } from "react";
import { ownWeekLabel } from "@/lib/member-window";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";

// Ported: the member schedule calendar with the direction-aware month
// transition (slides the way you navigate; opacity-only under
// prefers-reduced-motion).

export type CalendarWeek = {
  weekNumber: number;
  date: string; // YYYY-MM-DD (UTC)
  status: "PAID" | "LATE" | "DEFERRED" | "SKIPPED" | "PARTIAL" | "PENDING";
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_HEADS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const STATUS_CELL: Record<CalendarWeek["status"], string> = {
  PAID: "bg-emerald-700 text-white",
  LATE: "bg-red-600 text-white",
  DEFERRED: "bg-sky-800 text-white",
  SKIPPED: "bg-gray-600 text-white",
  PARTIAL: "bg-amber-400 text-amber-950",
  PENDING: "ring-2 ring-inset ring-indigo-400 dark:ring-indigo-500 text-indigo-700 dark:text-indigo-300",
};

const STATUS_DOT: Record<CalendarWeek["status"], string> = {
  PAID: "bg-emerald-700",
  LATE: "bg-red-600",
  DEFERRED: "bg-sky-800",
  SKIPPED: "bg-gray-600",
  PARTIAL: "bg-amber-400",
  PENDING: "bg-indigo-500",
};

const LEGEND = [
  { key: "PENDING" as const, label: "Upcoming" },
  { key: "PAID" as const, label: "Paid" },
  { key: "PARTIAL" as const, label: "Partial" },
  { key: "LATE" as const, label: "Late" },
  { key: "DEFERRED" as const, label: "Deferred" },
  { key: "SKIPPED" as const, label: "Skipped" },
];

export function EqubCalendar({
  weeks,
  defaultMonth,
  totalWeeks,
}: {
  weeks: CalendarWeek[];
  defaultMonth: string; // "YYYY-MM"
  /** How many weeks they are paying for — their own denominator (2.22). */
  totalWeeks: number;
}) {
  const [displayMonth, setDisplayMonth] = useState(defaultMonth);
  const [direction, setDirection] = useState(0);
  const reduce = useReducedMotion();

  const [yearStr, monthStr] = displayMonth.split("-");
  const year = parseInt(yearStr, 10);
  const month1 = parseInt(monthStr, 10);
  const monthIdx = month1 - 1;

  const dateStatus = new Map<string, CalendarWeek["status"]>();
  const dateWeekNum = new Map<string, number>();
  for (const w of weeks) {
    dateStatus.set(w.date, w.status);
    dateWeekNum.set(w.date, w.weekNumber);
  }

  const firstDow = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay();
  const totalDays = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  const todayStr = new Date().toISOString().slice(0, 10);

  function shiftMonth(delta: number) {
    setDirection(delta);
    const d = new Date(Date.UTC(year, monthIdx + delta, 1));
    setDisplayMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  return (
    <div className="bg-white dark:bg-[#141414] rounded-2xl border border-gray-100 dark:border-gray-800 p-5 shadow-sm animate-fade-in-up">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => shiftMonth(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-95"
          style={{
            transitionProperty: "color, background-color, transform",
            transitionDuration: "150ms, 150ms, 100ms",
            transitionTimingFunction: "ease-out",
          }}
          aria-label="Previous month"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <p className="text-sm font-bold text-gray-900 dark:text-white">
          {MONTH_NAMES[monthIdx]} {year}
        </p>
        <button
          onClick={() => shiftMonth(1)}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-95"
          style={{
            transitionProperty: "color, background-color, transform",
            transitionDuration: "150ms, 150ms, 100ms",
            transitionTimingFunction: "ease-out",
          }}
          aria-label="Next month"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADS.map((d) => (
          <div key={d} className="text-center text-[10px] font-bold text-gray-500 dark:text-gray-400 py-1">
            {d}
          </div>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={displayMonth}
          initial={{ opacity: 0, x: reduce ? 0 : direction * motionTokens.distance.sm }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduce ? 0 : -direction * motionTokens.distance.sm }}
          transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
        >
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e${i}`} />;

              const dateStr = `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const status = dateStatus.get(dateStr);
              const weekNum = dateWeekNum.get(dateStr);
              const isEqub = status !== undefined;
              const isToday = dateStr === todayStr;

              const cellCls = isEqub
                ? STATUS_CELL[status]
                : isToday
                  ? "ring-1 ring-inset ring-gray-300 dark:ring-gray-600 text-gray-700 dark:text-gray-300"
                  : "text-gray-600 dark:text-gray-400";

              const statusLabel =
                status === "PAID"
                  ? "Paid"
                  : status === "LATE"
                    ? "Late"
                    : status === "DEFERRED"
                      ? "Deferred — still owed, not chased"
                      : status === "SKIPPED"
                        ? "Skipped — nobody owed this week"
                        : status === "PARTIAL"
                          ? "Partial"
                          : "Upcoming";

              return (
                <div key={day} className="flex items-center justify-center py-0.5">
                  <div
                    className={`w-8 h-8 flex items-center justify-center rounded-full text-[12px] font-bold select-none ${cellCls}`}
                    title={
                      isEqub && weekNum != null
                        ? `${ownWeekLabel(weekNum, totalWeeks)} — ${statusLabel}`
                        : undefined
                    }
                  >
                    {day}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-x-4 gap-y-1 mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex-wrap">
            {LEGEND.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[key]}`} />
                <span className="text-[10px] text-gray-500 dark:text-gray-400">{label}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
