"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion-tokens";
import { AnchoredPopover } from "./anchored-popover";

// The crafted form controls — one look everywhere, replacing every stock
// browser control. Concentric radii (outer 12px = inner 8px + 4px padding),
// tabular numerals on anything numeric, calm 2px focus rings, quick
// ease-out motion, 44px hit areas, reduced-motion gated.

// ————— Select (custom listbox — never native) —————

export type SelectOption<V extends string = string> = {
  value: V;
  label: string;
  disabled?: boolean;
};

export function Select<V extends string = string>({
  value,
  onChange,
  options,
  ariaLabel = "Select",
  disabled = false,
  className = "",
  testId,
}: {
  value: V;
  onChange: (v: V) => void;
  options: SelectOption<V>[];
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  /** Forwarded to the trigger — the stock <select> this replaces had one. */
  testId?: string;
}) {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listboxId = useId();

  const current = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    // Outside-click and Escape are owned by AnchoredPopover: the list is
    // portalled to body, so rootRef no longer contains it and a contains()
    // check here would close the menu on every click INSIDE it.
  }, [open, options, value]);

  function move(dir: 1 | -1) {
    setActive((a) => {
      let next = a;
      for (let i = 0; i < options.length; i++) {
        next = (next + dir + options.length) % options.length;
        if (!options[next].disabled) break;
      }
      return next;
    });
  }

  function onKey(e: React.KeyboardEvent) {
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(1); break;
      case "ArrowUp": e.preventDefault(); move(-1); break;
      case "Enter":
      case " ": {
        e.preventDefault();
        const opt = options[active];
        if (opt && !opt.disabled) {
          onChange(opt.value);
          setOpen(false);
        }
        break;
      }
      case "Escape": e.preventDefault(); setOpen(false); break;
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        data-testid={testId}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3.5 py-2.5 text-left text-sm text-gray-900 dark:text-white transition-[border-color,transform] duration-150 ease-out hover:border-gray-400 dark:hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-600 active:scale-[0.99] disabled:opacity-40"
        style={{ minHeight: "44px" }}
      >
        {/* THE LABEL IS CLIPPED, NOT SPILLED. Triggers carry a fixed width
            (w-20 through w-72 across the app) and some option labels are long
            — "Week 12 — Aug 7, 2026 (this week)" is wider than w-64. Without
            min-w-0 a flex child refuses to shrink below its content, so the
            text ran under the chevron and past the border. */}
        <span
          className={`min-w-0 truncate ${current ? "" : "text-gray-400 dark:text-gray-600"}`}
          title={current?.label}
        >
          {current?.label ?? "Choose…"}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400 transition-transform duration-150 ease-out ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* PORTALLED (UI_STANDARDS 10b). Inside a Table the old absolutely
          positioned list was clipped at the table's overflow-x-auto edge —
          the options simply vanished. AnchoredPopover measures this trigger
          and positions against the viewport instead. */}
      <AnchoredPopover
        anchorRef={triggerRef}
        open={open}
        onRequestClose={() => setOpen(false)}
        matchTriggerWidth
      >
        <AnimatePresence>
          {open && (
          <motion.ul
            key="list"
            id={listboxId}
            role="listbox"
            ref={listRef}
            initial={{ opacity: 0, scale: reduce ? 1 : 0.97, y: reduce ? 0 : -motionTokens.distance.xs }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{
              opacity: 0,
              scale: reduce ? 1 : 0.98,
              // Exits are quicker than enters (~65%) — a pick should snap shut.
              transition: { duration: motionTokens.duration.fast * 0.65, ease: motionTokens.easing.smooth },
            }}
            transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
            style={{ transformOrigin: "top" }}
            className="max-h-64 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1f1f1f] p-1 shadow-lg shadow-black/10 dark:shadow-black/50"
          >
            {options.map((o, i) => {
              const isSelected = o.value === value;
              const isActive = i === active;
              return (
                <li key={o.value} role="option" aria-selected={isSelected} aria-disabled={o.disabled}>
                  <button
                    type="button"
                    disabled={o.disabled}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-100 disabled:opacity-40 ${
                      isActive
                        ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200"
                        : "text-gray-800 dark:text-gray-200"
                    }`}
                    style={{ minHeight: "40px" }}
                  >
                    {o.label}
                    {isSelected && (
                      <svg className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </motion.ul>
          )}
        </AnimatePresence>
      </AnchoredPopover>
    </div>
  );
}

// ————— Checkbox —————

export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 text-sm ${disabled ? "opacity-40" : "cursor-pointer"}`}
      style={{ minHeight: "28px" }}
    >
      <span className="relative mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-[background-color,border-color,transform] duration-150 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 peer-active:scale-90 ${
            checked
              ? "border-indigo-600 bg-indigo-600"
              : "border-gray-400 dark:border-gray-600 bg-white dark:bg-[#1a1a1a]"
          }`}
        >
          {checked && (
            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
            </svg>
          )}
        </span>
      </span>
      <span className="text-gray-800 dark:text-gray-200">{label}</span>
    </label>
  );
}

// ————— Radio —————

export function Radio({
  checked,
  onSelect,
  name,
  label,
  disabled = false,
}: {
  checked: boolean;
  onSelect: () => void;
  name: string;
  label: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-2.5 text-sm ${disabled ? "opacity-40" : "cursor-pointer"}`}
      style={{ minHeight: "28px" }}
    >
      <span className="relative mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <input
          type="radio"
          name={name}
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-[border-color,transform] duration-150 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 peer-active:scale-90 ${
            checked ? "border-[5.5px] border-indigo-600" : "border border-gray-400 dark:border-gray-600 bg-white dark:bg-[#1a1a1a]"
          }`}
        />
      </span>
      <span className="text-gray-800 dark:text-gray-200">{label}</span>
    </label>
  );
}

// ————— Toggle —————

export function Toggle({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center gap-3 text-sm ${disabled ? "opacity-40" : "cursor-pointer"}`}
      style={{ minHeight: "28px" }}
    >
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors duration-150 ease-out peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500/40 ${
            on ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-700"
          }`}
        >
          <span
            className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out ${
              on ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </span>
      </span>
      <span className="text-gray-800 dark:text-gray-200">{label}</span>
    </label>
  );
}

// ————— Amount input ($, tabular) and plain number input —————

export function AmountInput({
  value,
  onChange,
  placeholder = "0.00",
  ariaLabel = "Amount in dollars",
  disabled = false,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-center text-sm font-semibold text-gray-600 dark:text-gray-400"
      >
        $
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] py-2.5 pl-8 pr-3.5 text-sm tabular-nums text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-600 disabled:opacity-40"
        style={{ minHeight: "44px" }}
      />
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  ariaLabel = "Number",
  disabled = false,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number | string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] px-3.5 py-2.5 text-sm tabular-nums text-gray-900 dark:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-600 disabled:opacity-40 ${className}`}
      style={{ minHeight: "44px" }}
    />
  );
}
