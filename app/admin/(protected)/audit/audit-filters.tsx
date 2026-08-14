"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/controls";
import { DatePicker } from "@/components/ui/date-picker";
import { buttonCls } from "@/components/ui/primitives";
import { AUDIT_ACTIONS } from "@/lib/audit-query";

// THE FILTER BAR. APPLIED state lives in the URL — a filtered view of the
// record is something to keep, send to yourself, or come back to, and the
// back button has to mean what it looks like it means.
//
// PICKED state lives here, and nothing fires until Apply (14 Aug 2026
// ruling: filters must not apply on change alone). Five controls used to
// push the router each — half-picked filters flashed five intermediate
// result sets, and a mis-click was already a navigation.

const FILTER_KEYS = ["action", "entity", "person", "from", "to"] as const;
type Picked = Record<(typeof FILTER_KEYS)[number], string>;

export function AuditFilters({
  entities,
  people,
}: {
  entities: string[];
  people: { id: string; label: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  const applied: Picked = {
    action: params.get("action") ?? "",
    entity: params.get("entity") ?? "",
    person: params.get("person") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  const [picked, setPicked] = useState<Picked>(applied);
  const set = (key: keyof Picked, value: string) => setPicked((p) => ({ ...p, [key]: value }));

  function apply() {
    const next = new URLSearchParams(params.toString());
    for (const key of FILTER_KEYS) {
      if (picked[key]) next.set(key, picked[key]);
      else next.delete(key);
    }
    // Any change to WHAT is shown returns to the first page. Staying on page
    // 7 of a list that now has two pages shows nothing, which reads as
    // "there are no entries" rather than "you are past the end".
    next.delete("page");
    router.push(`/admin/audit?${next.toString()}`);
  }

  const anythingApplied = FILTER_KEYS.some((k) => applied[k] !== "");
  const dirty = FILTER_KEYS.some((k) => picked[k] !== applied[k]);
  const appliedCount = FILTER_KEYS.filter((k) => applied[k] !== "").length;

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Action
        </span>
        <Select
          value={picked.action}
          onChange={(v) => set("action", v)}
          ariaLabel="Filter by action"
          className="w-32"
          options={[
            { value: "", label: "All actions" },
            ...AUDIT_ACTIONS.map((a) => ({ value: a, label: a })),
          ]}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          What
        </span>
        <Select
          value={picked.entity}
          onChange={(v) => set("entity", v)}
          ariaLabel="Filter by entity"
          className="w-40"
          options={[
            { value: "", label: "Everything" },
            ...entities.map((e) => ({ value: e, label: e })),
          ]}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Person
        </span>
        <Select
          value={picked.person}
          onChange={(v) => set("person", v)}
          ariaLabel="Filter by person"
          className="w-56"
          options={[
            { value: "", label: "Anyone" },
            ...people.map((p) => ({ value: p.id, label: p.label })),
          ]}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          From
        </span>
        <DatePicker
          value={picked.from}
          onChange={(v) => set("from", v)}
          ariaLabel="Filter from date"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          To
        </span>
        <DatePicker value={picked.to} onChange={(v) => set("to", v)} ariaLabel="Filter to date" />
      </label>

      <button
        type="button"
        onClick={apply}
        disabled={!dirty}
        className={buttonCls.primary + " !py-2 disabled:opacity-40"}
      >
        Apply
      </button>

      {/* The visible applied state: what the LIST is currently narrowed by,
          which the pickers no longer show once they are edited. */}
      {anythingApplied && (
        <span className="pb-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
          {appliedCount === 1 ? "1 filter applied" : `${appliedCount} filters applied`}
        </span>
      )}

      {anythingApplied && (
        <button
          type="button"
          onClick={() => {
            setPicked({ action: "", entity: "", person: "", from: "", to: "" });
            router.push("/admin/audit");
          }}
          className={buttonCls.ghost + " !py-2"}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

/** Page back and forward, with the position always stated in words. */
export function AuditPager({
  info,
}: {
  info: { page: number; pages: number; hasPrevious: boolean; hasNext: boolean };
}) {
  const router = useRouter();
  const params = useSearchParams();

  function go(page: number) {
    const next = new URLSearchParams(params.toString());
    if (page <= 1) next.delete("page");
    else next.set("page", String(page));
    router.push(`/admin/audit?${next.toString()}`);
  }

  if (info.pages <= 1) return null;

  return (
    <div className="mt-4 flex items-center gap-3">
      <button
        type="button"
        disabled={!info.hasPrevious}
        onClick={() => go(info.page - 1)}
        className={buttonCls.ghost + " disabled:opacity-40"}
      >
        ← Newer
      </button>
      <span className="text-sm tabular-nums text-gray-600 dark:text-gray-400">
        Page {info.page} of {info.pages}
      </span>
      <button
        type="button"
        disabled={!info.hasNext}
        onClick={() => go(info.page + 1)}
        className={buttonCls.ghost + " disabled:opacity-40"}
      >
        Older →
      </button>
    </div>
  );
}
