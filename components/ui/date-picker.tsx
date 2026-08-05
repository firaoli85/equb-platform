"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";

// The platform date picker — a drop-in for <input type="date"> (same
// YYYY-MM-DD string contract) with the craft stock pickers lack:
//   presets rail · hover preview · one-click year jump · full keyboard
//   (arrows/Enter/Escape/PageUp/Down, Shift for years) · typed MM/DD/YYYY ·
//   aria-live announcements · 44px hit targets · quick ease-out open.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_HEADS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function fromIso(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return toIso(d) === iso ? d : null;
}
function parseTyped(text: string): Date | null {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
  return d.getUTCMonth() === +m[1] - 1 && d.getUTCDate() === +m[2] ? d : null;
}
function display(iso: string): string {
  const d = fromIso(iso);
  if (!d) return "";
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
function startOfWeek(d: Date): Date {
  return addDays(d, -d.getUTCDay()); // Sunday-first, matching the calendars
}
function fmtLong(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

const PRESETS: { label: string; date: () => Date }[] = [
  { label: "Today", date: () => todayUtc() },
  { label: "This week", date: () => startOfWeek(todayUtc()) },
  { label: "Last week", date: () => addDays(startOfWeek(todayUtc()), -7) },
  {
    label: "This month",
    date: () => {
      const t = todayUtc();
      return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
    },
  },
];

export function DatePicker({
  value,
  onChange,
  id,
  ariaLabel = "Date",
  className = "",
}: {
  /** YYYY-MM-DD or "" — the same contract as a native date input. */
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const liveId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const selected = fromIso(value);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(display(value));
  const [yearMode, setYearMode] = useState(false);
  // The focus cursor inside the grid; also what hover previews.
  const [cursor, setCursor] = useState<Date>(selected ?? todayUtc());
  const [hovered, setHovered] = useState<Date | null>(null);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    setTyped(display(value));
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const view = { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() };
  const preview = hovered ?? cursor;

  const cells = useMemo(() => {
    const firstDow = new Date(Date.UTC(view.year, view.month, 1)).getUTCDay();
    const total = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
    return [
      ...Array.from({ length: firstDow }, () => null as Date | null),
      ...Array.from({ length: total }, (_, i) => new Date(Date.UTC(view.year, view.month, i + 1))),
    ];
  }, [view.year, view.month]);

  function commit(d: Date, why = "selected") {
    onChange(toIso(d));
    setCursor(d);
    setAnnounce(`${fmtLong(d)} ${why}`);
    setOpen(false);
  }

  function moveCursor(days: number) {
    setHovered(null);
    setCursor((c) => addDays(c, days));
  }
  function moveMonth(n: number) {
    setHovered(null);
    setCursor((c) => {
      const d = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + n, Math.min(c.getUTCDate(), 28)));
      return d;
    });
  }
  function moveYear(n: number) {
    setHovered(null);
    setCursor((c) => new Date(Date.UTC(c.getUTCFullYear() + n, c.getUTCMonth(), Math.min(c.getUTCDate(), 28))));
  }

  function onGridKey(e: React.KeyboardEvent) {
    switch (e.key) {
      case "ArrowLeft": e.preventDefault(); moveCursor(-1); break;
      case "ArrowRight": e.preventDefault(); moveCursor(1); break;
      case "ArrowUp": e.preventDefault(); moveCursor(-7); break;
      case "ArrowDown": e.preventDefault(); moveCursor(7); break;
      case "PageUp": e.preventDefault(); if (e.shiftKey) moveYear(-1); else moveMonth(-1); break;
      case "PageDown": e.preventDefault(); if (e.shiftKey) moveYear(1); else moveMonth(1); break;
      case "Enter": e.preventDefault(); commit(cursor); break;
      case "Escape": e.preventDefault(); setOpen(false); break;
    }
  }

  const inputCls =
    "w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-600 tabular-nums";

  // Escape closes from ANYWHERE while open — trigger, presets, year grid,
  // even if focus wandered outside — not only the day grid and the input.
  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          placeholder="MM/DD/YYYY"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            const parsed = parseTyped(e.target.value);
            if (parsed) {
              onChange(toIso(parsed));
              setCursor(parsed);
              setAnnounce(`${fmtLong(parsed)} selected`);
            } else if (e.target.value.trim() === "") {
              onChange("");
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown" && open) {
              e.preventDefault();
              gridRef.current?.focus();
            }
          }}
          className={inputCls}
        />
        <button
          type="button"
          aria-label={open ? "Close calendar" : "Open calendar"}
          onClick={() => setOpen((o) => !o)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-gray-500 dark:text-gray-400 transition-[color,transform] duration-150 ease-out hover:text-indigo-600 dark:hover:text-indigo-400 active:scale-95"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        </button>
      </div>

      {/* aria-live announcement of every selection */}
      <span id={liveId} aria-live="polite" className="sr-only">
        {announce}
      </span>

      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            role="dialog"
            aria-label="Choose a date"
            initial={{ opacity: 0, scale: reduce ? 1 : 0.97, y: reduce ? 0 : -motionTokens.distance.xs }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{
              opacity: 0,
              scale: reduce ? 1 : 0.98,
              // Exits are quicker than enters (~65%) — commit and Escape snap shut.
              transition: { duration: motionTokens.duration.fast * 0.65, ease: motionTokens.easing.smooth },
            }}
            transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
            style={{ transformOrigin: "top left" }}
            className="absolute left-0 top-full z-50 mt-1.5 flex w-[21rem] overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#141414] shadow-lg shadow-black/10 dark:shadow-black/50"
          >
            {/* ————— Presets rail ————— */}
            <div className="flex w-24 shrink-0 flex-col gap-0.5 border-r border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-white/[0.03] p-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => commit(p.date(), `— ${p.label}`)}
                  className="rounded-lg px-2 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-700 dark:hover:text-indigo-300 active:scale-[0.97]"
                  style={{ minHeight: "36px" }}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => gridRef.current?.focus()}
                className="rounded-lg px-2 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-700 dark:hover:text-indigo-300 active:scale-[0.97]"
                style={{ minHeight: "36px" }}
              >
                Custom
              </button>
            </div>

            {/* ————— Month grid / year jump ————— */}
            <div className="flex-1 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => moveMonth(-1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 transition-[background-color,color,transform] duration-150 ease-out hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-800 dark:hover:text-gray-200 active:scale-95"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  {MONTHS[view.month]}{" "}
                  {/* One-click year jump — the biggest gap in stock pickers */}
                  <button
                    type="button"
                    aria-label={yearMode ? "Back to days" : "Choose a year"}
                    onClick={() => setYearMode((y) => !y)}
                    className="rounded-md px-1 py-0.5 tabular-nums text-indigo-700 dark:text-indigo-300 underline decoration-dotted underline-offset-2 transition-colors duration-150 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                  >
                    {view.year}
                  </button>
                </span>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => moveMonth(1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 transition-[background-color,color,transform] duration-150 ease-out hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-800 dark:hover:text-gray-200 active:scale-95"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              {yearMode ? (
                <div className="grid max-h-56 grid-cols-4 gap-1 overflow-y-auto py-1" role="listbox" aria-label="Year">
                  {Array.from({ length: 24 }, (_, i) => view.year - 12 + i).map((y) => (
                    <button
                      key={y}
                      type="button"
                      role="option"
                      aria-selected={y === view.year}
                      onClick={() => {
                        setCursor(new Date(Date.UTC(y, view.month, Math.min(cursor.getUTCDate(), 28))));
                        setYearMode(false);
                      }}
                      className={`rounded-lg px-1 py-2.5 text-sm tabular-nums transition-[background-color,transform] duration-150 ease-out active:scale-[0.96] ${
                        y === view.year
                          ? "bg-indigo-600 font-bold text-white"
                          : "font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
                      }`}
                      style={{ minHeight: "40px" }}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-7">
                    {DAY_HEADS.map((d) => (
                      <span key={d} className="py-1 text-center text-[10px] font-bold uppercase text-gray-500 dark:text-gray-500">
                        {d}
                      </span>
                    ))}
                  </div>
                  <div
                    ref={gridRef}
                    role="grid"
                    aria-label="Calendar"
                    tabIndex={0}
                    onKeyDown={onGridKey}
                    onMouseLeave={() => setHovered(null)}
                    className="grid grid-cols-7 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
                  >
                    {cells.map((d, i) => {
                      if (d === null) return <span key={`e${i}`} />;
                      const iso = toIso(d);
                      const isSelected = selected !== null && toIso(selected) === iso;
                      const isCursor = toIso(cursor) === iso;
                      const isPreview = hovered !== null && toIso(hovered) === iso;
                      const isToday = toIso(todayUtc()) === iso;
                      return (
                        <button
                          key={iso}
                          type="button"
                          tabIndex={-1}
                          aria-label={fmtLong(d)}
                          aria-pressed={isSelected}
                          onMouseEnter={() => setHovered(d)}
                          onClick={() => commit(d)}
                          className={`m-auto flex h-9 w-9 items-center justify-center rounded-full text-[13px] tabular-nums transition-[background-color,color,transform] duration-100 ease-out active:scale-90 ${
                            isSelected
                              ? "bg-indigo-600 font-bold text-white"
                              : isPreview
                                ? "bg-indigo-100 dark:bg-indigo-900/60 font-semibold text-indigo-800 dark:text-indigo-200"
                                : isCursor
                                  ? "ring-2 ring-inset ring-indigo-400 dark:ring-indigo-500 font-semibold text-gray-800 dark:text-gray-200"
                                  : isToday
                                    ? "ring-1 ring-inset ring-gray-300 dark:ring-gray-600 text-gray-800 dark:text-gray-200"
                                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
                          }`}
                        >
                          {d.getUTCDate()}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 border-t border-gray-100 dark:border-gray-800 pt-1.5 text-center text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
                    {fmtLong(preview)}
                  </p>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
