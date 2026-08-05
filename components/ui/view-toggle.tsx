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
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] ${
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
