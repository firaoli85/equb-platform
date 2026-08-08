import Link from "next/link";
import type { PageInfo } from "@/lib/paging";

// THE PAGER, AND THE SENTENCE THAT GOES WITH IT.
//
// The sentence is not optional and is rendered even on a single page. That is
// the whole point: a list showing part of itself while looking whole is how
// someone concludes a record does not exist. "All 12 receipts." costs one line
// and removes the doubt permanently.
//
// STATE IN THE URL, like the audit log. A page is linkable, survives a reload,
// and the back button works — and because these are plain links to a
// server-rendered page, only the rows on the current page are ever queried.

export function Pager({
  info,
  hrefFor,
  noun,
  summary,
  label,
  className = "",
}: {
  info: PageInfo;
  /** Builds the href for a page — the caller owns its own query shape. */
  hrefFor: (page: number) => string;
  noun: { one: string; many: string };
  /** Overrides the default sentence when the screen has a better one. */
  summary?: string;
  /** Names the control for a screen reader: "Receipt pages". */
  label: string;
  className?: string;
}) {
  const line =
    summary ??
    (info.total === 0
      ? `No ${noun.many}.`
      : info.pages === 1
        ? info.total === 1
          ? `1 ${noun.one}.`
          : `All ${info.total} ${noun.many}.`
        : `${info.firstShown}–${info.lastShown} of ${info.total} ${noun.many}.`);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ${className}`}
    >
      {/* Announced when it changes, so a screen-reader user knows the list
          moved without having to hunt for the difference. */}
      <p
        role="status"
        aria-live="polite"
        className="text-xs tabular-nums text-gray-600 dark:text-gray-400"
      >
        {line}
      </p>

      {info.pages > 1 && (
        <nav aria-label={label} className="flex items-center gap-1">
          <PageLink
            href={hrefFor(info.page - 1)}
            enabled={info.hasPrevious}
            label="Previous page"
          >
            ←
          </PageLink>
          <span className="px-2 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-300">
            {info.page} / {info.pages}
          </span>
          <PageLink href={hrefFor(info.page + 1)} enabled={info.hasNext} label="Next page">
            →
          </PageLink>
        </nav>
      )}
    </div>
  );
}

/**
 * One step. Disabled is a `<span>`, not a dimmed link: a link that goes
 * nowhere is still focusable and still followable by keyboard, and a keyboard
 * user pressing it lands back on the page they are already on with no
 * explanation.
 */
function PageLink({
  href,
  enabled,
  label,
  children,
}: {
  href: string;
  enabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const shape =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-sm font-bold";
  if (!enabled) {
    return (
      <span
        aria-hidden="true"
        className={`${shape} border-gray-200 text-gray-300 dark:border-gray-800 dark:text-gray-700`}
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      scroll={false}
      className={`${shape} border-gray-300 text-gray-800 transition-[background-color,border-color,transform] duration-150 ease-out hover:border-indigo-400 hover:text-indigo-700 active:scale-[0.96] dark:border-gray-700 dark:text-gray-200 dark:hover:border-indigo-600 dark:hover:text-indigo-300`}
    >
      {children}
    </Link>
  );
}

/** The line a capped, unpaged list shows once it has actually been cut. */
export function TruncationNotice({ notice }: { notice: string | null }) {
  if (!notice) return null;
  return (
    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
      {notice}
    </p>
  );
}
