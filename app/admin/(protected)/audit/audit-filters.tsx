"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/controls";
import { DatePicker } from "@/components/ui/date-picker";
import { buttonCls } from "@/components/ui/primitives";
import { AUDIT_ACTIONS } from "@/lib/audit-query";

// THE FILTER BAR. State lives in the URL, not in this component: a filtered
// view of the record is something to keep, send to yourself, or come back to
// — and the back button has to mean what it looks like it means.

export function AuditFilters({
  entities,
  people,
}: {
  entities: string[];
  people: { id: string; label: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  const get = (key: string) => params.get(key) ?? "";

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Any change to WHAT is shown returns to the first page. Staying on page
    // 7 of a list that now has two pages shows nothing, which reads as
    // "there are no entries" rather than "you are past the end".
    next.delete("page");
    router.push(`/admin/audit?${next.toString()}`);
  }

  const anything = ["action", "entity", "person", "from", "to"].some((k) => get(k) !== "");

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Action
        </span>
        <Select
          value={get("action")}
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
          value={get("entity")}
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
          value={get("person")}
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
          value={get("from")}
          onChange={(v) => set("from", v)}
          ariaLabel="Filter from date"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          To
        </span>
        <DatePicker value={get("to")} onChange={(v) => set("to", v)} ariaLabel="Filter to date" />
      </label>

      {anything && (
        <button
          type="button"
          onClick={() => router.push("/admin/audit")}
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
