"use client";

import { useEffect, useState } from "react";

export type ViewMode = "list" | "grid";

/**
 * Persisted list/grid switch (Midday-style icon segmented control). The
 * chosen view survives reloads per storageKey. Renders the stored choice
 * after mount; the caller's default shows first paint.
 */
export function useViewMode(storageKey: string, initial: ViewMode): [ViewMode, (v: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(initial);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "list" || stored === "grid") setMode(stored);
    } catch {}
  }, [storageKey]);

  function set(v: ViewMode) {
    setMode(v);
    try {
      localStorage.setItem(storageKey, v);
    } catch {}
  }
  return [mode, set];
}

export function ViewToggle({
  mode,
  onChange,
  labels = { list: "List", grid: "Grid" },
}: {
  mode: ViewMode;
  onChange: (v: ViewMode) => void;
  labels?: { list: string; grid: string };
}) {
  const btn = (v: ViewMode, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      aria-pressed={mode === v}
      aria-label={`${label} view`}
      className={`min-h-11 md:min-h-8 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
        mode === v
          ? "bg-white dark:bg-[#1f1f1f] text-indigo-700 dark:text-indigo-300 shadow-sm"
          : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-white/5 p-0.5">
      {btn(
        "list",
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>,
        labels.list,
      )}
      {btn(
        "grid",
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
          />
        </svg>,
        labels.grid,
      )}
    </div>
  );
}

// ————————————————— N options, same control —————————————————
//
// Payments grew a third representation (the §5.4 consistency strip) and
// `ViewToggle` above is hard-wired to two. Rather than bend it — its two icons
// are part of what makes it readable — this is the same control generalised.
// The binary callers keep the binary component.

/** The same persistence as `useViewMode`, over any set of allowed values. */
export function usePersistedChoice<T extends string>(
  storageKey: string,
  allowed: readonly T[],
  initial: T,
): [T, (v: T) => void] {
  const [choice, setChoice] = useState<T>(initial);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored && (allowed as readonly string[]).includes(stored)) setChoice(stored as T);
    } catch {}
    // `allowed` is a literal array at every call site, so it is stable in
    // practice; keying the effect on its contents avoids depending on identity.
  }, [storageKey, allowed.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(v: T) {
    setChoice(v);
    try {
      localStorage.setItem(storageKey, v);
    } catch {}
  }
  return [choice, set];
}

export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string; icon?: React.ReactNode }[];
  /** Names the group for a screen reader — "View", "Range", and so on. */
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-xl border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-700 dark:bg-white/5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] md:min-h-8 ${
            value === o.value
              ? "bg-white text-indigo-700 shadow-sm dark:bg-[#1f1f1f] dark:text-indigo-300"
              : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
