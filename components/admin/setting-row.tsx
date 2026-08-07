"use client";

import { useId, type ReactNode } from "react";
import { inputCls } from "@/components/ui/primitives";

// ONE APPEARANCE FOR EVERY SETTING (UI_STANDARDS rule 3).
//
// The old settings page hand-rolled each control: raw `<input type="checkbox">`
// with `className="mt-0.5"`, a `<strong>` label, a `<br/>`, then prose. Every
// row drifted a little from the next, and there was no way to add a row without
// copying the drift.
//
// A settings page is a LIST, not a set of cards — nested cards are always wrong
// (impeccable), and a card per toggle makes five decisions look like five
// documents. So: one bordered container, hairline-divided rows, and these two
// components as the only way to make one.

/** The container. Rows are its children; it draws the divisions. */
export function SettingList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] shadow-sm">
      {children}
    </div>
  );
}

/**
 * A real switch, not a checkbox.
 *
 * `role="switch"` announces "on/off" rather than "checked", which is what this
 * actually is, and a button gives a 44px target without inflating a 16px box
 * (UI_STANDARDS rule 2). The state is also written in words underneath, because
 * a switch's position is colour-and-geometry only — and colour is never the
 * only carrier of meaning (rule 12).
 */
export function SettingSwitch({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  /** Written state, e.g. "ON — sends are attempted". Shown under the description. */
  state,
  /** Amber when this setting being on/off is worth noticing. */
  tone = "neutral",
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  state?: ReactNode;
  tone?: "neutral" | "attention" | "danger";
}) {
  const id = useId();
  const descId = `${id}-desc`;
  return (
    <div
      className={`flex items-start gap-4 px-5 py-4 ${
        tone === "danger"
          ? "bg-red-50/60 dark:bg-red-950/20"
          : tone === "attention"
            ? "bg-amber-50/60 dark:bg-amber-950/20"
            : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="block text-sm font-bold text-gray-900 dark:text-white"
        >
          {label}
        </label>
        <p id={descId} className="mt-1 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {description}
        </p>
        {state && <p className="mt-1.5 text-sm font-semibold">{state}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{ touchAction: "manipulation" }}
        // The 44px target is the padding; the track inside is 44×24.
        className="group -m-2 shrink-0 rounded-xl p-2 transition-transform duration-150 ease-out active:scale-[0.94] disabled:opacity-40 disabled:pointer-events-none"
      >
        <span
          className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-200 ease-out ${
            checked
              ? "bg-indigo-600 dark:bg-indigo-500"
              : "bg-gray-300 dark:bg-gray-700"
          } group-focus-visible:ring-2 group-focus-visible:ring-indigo-500/50 group-focus-visible:ring-offset-2 dark:group-focus-visible:ring-offset-[#141414]`}
        >
          <span
            className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
              checked ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </span>
      </button>
    </div>
  );
}

/** A numeric setting, with its unit and its bounds stated rather than implied. */
export function SettingNumber({
  label,
  description,
  value,
  onChange,
  min,
  max,
  unit,
  disabled = false,
}: {
  label: string;
  description: ReactNode;
  value: string;
  onChange: (next: string) => void;
  min: number;
  max: number;
  unit: string;
  disabled?: boolean;
}) {
  const id = useId();
  const descId = `${id}-desc`;
  return (
    <div className="flex flex-wrap items-start gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-sm font-bold text-gray-900 dark:text-white">
          {label}
        </label>
        <p id={descId} className="mt-1 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          {description}
        </p>
      </div>
      <div className="shrink-0">
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={value}
            disabled={disabled}
            aria-describedby={descId}
            onChange={(e) => onChange(e.target.value)}
            className={inputCls + " w-24 tabular-nums"}
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">{unit}</span>
        </div>
        <p className="mt-1 text-right text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
          {min}–{max}
        </p>
      </div>
    </div>
  );
}

/**
 * A bordered region at the FOOT of a page for actions that cannot be undone.
 *
 * Framer's "Danger Zone" shape. It exists so a destructive control is never a
 * sibling of a routine toggle — which is the specific complaint that started
 * the IA rework: closing a cycle sat next to a notification switch.
 */
export function DangerZone({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-red-300 dark:border-red-900 bg-red-50/40 dark:bg-red-950/10">
      <h2 className="border-b border-red-200 dark:border-red-900/60 px-5 py-3 text-sm font-bold text-red-800 dark:text-red-400">
        {title}
      </h2>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}
