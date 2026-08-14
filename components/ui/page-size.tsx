"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/controls";
import { PAGE_SIZE_OPTIONS } from "@/lib/paging";

// THE PAGE-SIZE CHOICE (14 Aug 2026 order): every paginated admin list
// offers 10 / 25 / 50 / 100, defaults to what it always showed, and the
// choice PERSISTS — localStorage remembers it, the URL carries it (the query
// runs on the server, so the server must be told).
//
// On a visit with no explicit ?pageSize, the stored choice is re-applied via
// router.replace after mount — same first-paint caveat as usePersistedChoice
// (components/ui/view-toggle.tsx): the default renders first, the stored
// choice follows. That is acceptable for a row count and would not be for
// anything security-relevant.

export function PageSizeSelect({
  param = "pageSize",
  /** The page param this list uses — reset when the size changes. */
  pageParam = "page",
  dflt,
  storageKey,
}: {
  param?: string;
  pageParam?: string;
  dflt: number;
  storageKey: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const options = [...new Set([...PAGE_SIZE_OPTIONS, dflt])].sort((a, b) => a - b);
  const inUrl = Number.parseInt(params.get(param) ?? "", 10);
  const current = options.includes(inUrl) ? inUrl : dflt;

  useEffect(() => {
    if (params.get(param) !== null) return; // an explicit URL wins
    let stored: number | null = null;
    try {
      stored = Number.parseInt(localStorage.getItem(storageKey) ?? "", 10) || null;
    } catch {}
    if (stored !== null && options.includes(stored) && stored !== dflt) {
      const next = new URLSearchParams(params.toString());
      next.set(param, String(stored));
      router.replace(`${pathname}?${next.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(value: string) {
    try {
      localStorage.setItem(storageKey, value);
    } catch {}
    const next = new URLSearchParams(params.toString());
    if (Number.parseInt(value, 10) === dflt) next.delete(param);
    else next.set(param, value);
    // A new size re-cuts the pages — page 4 of 25 is not page 4 of 100.
    next.delete(pageParam);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">Per page</span>
      <Select
        value={String(current)}
        onChange={choose}
        ariaLabel="Rows per page"
        className="w-20"
        options={options.map((n) => ({ value: String(n), label: String(n) }))}
      />
    </span>
  );
}
