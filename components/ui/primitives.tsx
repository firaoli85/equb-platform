// The shared admin UI layer (2.25: THE design pass) — thin compositions of
// the ported member design tokens so admin and portal read as one product.
// Server-safe: no state, no handlers. Everything money-or-count is tabular.

import type { ReactNode } from "react";

// ————— Surfaces —————

export function Card({
  children,
  className = "",
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  /** hero = the one emphasized card on a page (2.1: the cash position). */
  tone?: "default" | "hero" | "danger";
}) {
  const toneCls =
    tone === "hero"
      ? "border-2 border-indigo-200 dark:border-indigo-900 bg-white dark:bg-[#141414]"
      : tone === "danger"
        ? "border-2 border-red-500 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
        : "border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414]";
  return <section className={`rounded-2xl shadow-sm ${toneCls} ${className}`}>{children}</section>;
}

export function CardHeader({
  title,
  sub,
  right,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div>
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

// ————— Status pills (the member system's DNA, verbatim) —————

export type PillTone = "good" | "attention" | "problem" | "neutral" | "accent";

const PILL_TONES: Record<PillTone, string> = {
  good: "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900",
  attention:
    "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900",
  problem: "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-900",
  neutral:
    "text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-gray-700",
  accent:
    "text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800",
};

export function Pill({
  tone,
  children,
  className = "",
}: {
  tone: PillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums ${PILL_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ————— Buttons (press feedback on everything tappable) —————

export const buttonCls = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-700 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#141414] px-4 py-2 text-sm font-semibold text-gray-800 dark:text-gray-200 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-100 dark:hover:bg-white/5 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none",
  danger:
    "inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-300 dark:border-red-800 px-4 py-2 text-sm font-semibold text-red-700 dark:text-red-400 transition-[background-color,transform] duration-150 ease-out hover:bg-red-50 dark:hover:bg-red-950/40 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none",
  /**
   * A destructive action that is ALWAYS on screen (one per row) rather than
   * one the organizer went looking for. It stays unmistakably red and keeps
   * its full label, but it does not shout from every row — the outlined
   * `danger` button turned a read-first page into a wall of red boxes. The
   * weight belongs in the confirmation, not the list.
   */
  dangerQuiet:
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-red-700 dark:text-red-400 transition-[background-color,transform] duration-150 ease-out hover:bg-red-50 dark:hover:bg-red-950/40 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none",
} as const;

// ————— Tables (Twenty-density: quiet rows, tabular figures) —————

export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] shadow-sm ${className}`}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
  className = "",
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <th
      className={`sticky top-0 z-10 border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-white/[0.03] px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 text-${align} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  numeric = false,
  className = "",
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`border-b border-gray-100 dark:border-gray-800/60 px-4 py-2.5 text-gray-800 dark:text-gray-200 ${numeric ? "tabular-nums" : ""} text-${align} ${className}`}
    >
      {children}
    </td>
  );
}

export const trHoverCls =
  "transition-colors duration-150 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20";

// ————— Fields (2.10: state is visible) —————

export const inputCls =
  "w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-600";

export function Field({
  label,
  children,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-400">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-gray-600 dark:text-gray-400">{hint}</span>}
    </label>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: "ok" | "err" | "info";
  children: ReactNode;
}) {
  const cls =
    kind === "err"
      ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400"
      : kind === "ok"
        ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400"
        : "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-white/5 dark:text-gray-300";
  return (
    <p
      role={kind === "err" ? "alert" : "status"}
      className={`rounded-xl border px-3.5 py-2.5 text-sm ${cls}`}
    >
      {children}
    </p>
  );
}

// ————— Empty state —————

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] px-6 py-12 text-center shadow-sm">
      <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
