import Link from "next/link";
import { auditPeopleOptions, listAuditLog } from "@/app/actions/audit";
import { PresentationHidden } from "@/components/presentation-hidden";
import { auditEntityHint, auditEntityHref } from "@/lib/audit-links";
import { getSetting } from "@/lib/settings";
import { AuditFilters, AuditPager } from "./audit-filters";
import { PageSizeSelect } from "@/components/ui/page-size";
import { AUDIT_PAGE_SIZE } from "@/lib/audit-query";
import { parsePageSize } from "@/lib/paging";

export const dynamic = "force-dynamic";

// THE RECORD, READABLE (D-32, 2.14). Fifty at a time, filtered by action, by
// what was changed, by whom it was about, and by date — with the current
// filter stated in a sentence so a narrowed list can never be mistaken for an
// empty history.

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The audit log narrates everything (2.4). The action refuses too — this
  // guard just renders the calmer notice.
  if (await getSetting("presentationMode")) return <PresentationHidden what="Audit log" />;

  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
  };

  const [result, people] = await Promise.all([
    listAuditLog({
      action: one("action"),
      entity: one("entity"),
      personId: one("person"),
      from: one("from"),
      to: one("to"),
      page: one("page"),
      pageSize: parsePageSize(one("pageSize") ?? undefined, AUDIT_PAGE_SIZE),
    }),
    auditPeopleOptions(),
  ]);

  return (
    <main>
      <h1 className="mb-1 text-xl font-semibold">Audit log</h1>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        Every organizer correction, as it happened. Entries are never edited or removed — a
        mistaken entry is answered by a new one.
      </p>

      {!result.ok ? (
        <p role="alert" className="text-sm text-red-800 dark:text-red-400">
          {result.error}
        </p>
      ) : (
        <>
          <AuditFilters
            entities={result.data.entities}
            people={people.ok ? people.data : []}
          />

          <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">{result.data.summary}</p>

          {result.data.personName && (
            <p className="mb-3 text-xs text-gray-600 dark:text-gray-400">
              Matched two ways: entries filed against {result.data.personName}&apos;s own records,
              plus entries that name them — which is how a deleted payout or receipt is still
              found after the record it pointed at is gone.
            </p>
          )}

          {result.data.rows.length === 0 ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {result.data.filtered
                ? "Nothing matches those filters. Clear them to see the whole record."
                : "No changes recorded yet."}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-300 dark:border-gray-700 text-left">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Entity</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 font-medium">What changed</th>
                </tr>
              </thead>
              <tbody>
                {result.data.rows.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-gray-200 dark:border-gray-800 align-top"
                  >
                    <td className="whitespace-nowrap py-2 pr-4 tabular-nums text-gray-600 dark:text-gray-400">
                      {new Date(entry.createdAt).toLocaleString("en-US")}
                    </td>
                    {/* §8: the entity leads to the record it changed. Text
                        when there is nowhere honest to go — a deletion, or a
                        row with no screen of its own (lib/audit-links.ts). */}
                    <td className="py-2 pr-4">
                      {(() => {
                        const href = auditEntityHref(entry);
                        return href === null ? (
                          entry.entity
                        ) : (
                          <Link
                            href={href}
                            title={auditEntityHint(entry.entity)}
                            className="font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-400"
                          >
                            {entry.entity}
                          </Link>
                        );
                      })()}
                    </td>
                    <td className="py-2 pr-4">{entry.action}</td>
                    <td className="py-2">
                      {entry.summary}
                      {(entry.before || entry.after) && (
                        <details className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                          <summary className="cursor-pointer">from / to</summary>
                          {entry.before && (
                            <pre className="overflow-x-auto">before: {entry.before}</pre>
                          )}
                          {entry.after && (
                            <pre className="overflow-x-auto">after:  {entry.after}</pre>
                          )}
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <AuditPager info={result.data.info} />
            <PageSizeSelect dflt={AUDIT_PAGE_SIZE} storageKey="admin-audit-page-size" />
          </div>
        </>
      )}
    </main>
  );
}
