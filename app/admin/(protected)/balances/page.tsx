import Link from "next/link";
import { listCarriedBalances } from "@/app/actions/ledger";
import { PresentationHidden } from "@/components/presentation-hidden";
import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  Pill,
} from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { Pager } from "@/components/ui/pager";
import { formatDateUTC, formatMoney } from "@/lib/format";
import { PAGE_SIZES, parsePage, parsePageSize } from "@/lib/paging";
import { PageSizeSelect } from "@/components/ui/page-size";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";

export const dynamic = "force-dynamic";

// CARRIED BALANCES (2.18) — money owed TO the organizer, in one place, the
// mirror of "Who is waiting" (money owed BY him). Balances live on the PERSON,
// so nothing here depends on a cycle still existing.
export default async function BalancesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[]; pageSize?: string | string[] }>;
}) {
  const query = await searchParams;
  const pageSize = parsePageSize(query.pageSize, PAGE_SIZES.balances);
  const result = await listCarriedBalances({ page: parsePage(query.page), pageSize });
  if (!result.ok) {
    if (result.error === PRESENTATION_HIDDEN) return <PresentationHidden what="Carried balances" />;
    return (
      <main className="space-y-4">
        <Alert kind="err">{result.error}</Alert>
      </main>
    );
  }
  const { rows, total, page } = result.data;

  return (
    <main className="space-y-6">
      <header className="animate-fade-in-up">
        <p className="mb-1 text-sm">
          <Link href="/admin" className="text-gray-600 dark:text-gray-400 hover:underline">
            ← Dashboard
          </Link>
        </p>
        <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
          Carried balances
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400 text-pretty">
          What members still owe from earlier cycles. A balance belongs to the person, not the
          cycle — it survives the cycle being closed or deleted, and it can be settled or written
          off at any time, whether or not they are in a cycle now.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Carried in total"
          cents={total}
          emphasis={total > 0}
          sub={
            rows.length === 0
              ? "nobody carries a balance"
              : `across ${rows.length} ${rows.length === 1 ? "person" : "people"}`
          }
        />
        <StatCard
          label="Largest"
          cents={rows[0]?.balance ?? 0}
          sub={rows[0] ? rows[0].name : "—"}
          delayClass="animate-fade-in-up-1"
        />
        <StatCard
          label="Written off to date"
          cents={rows.reduce((s, r) => s + r.forgiven, 0)}
          sub="across the people listed here"
          delayClass="animate-fade-in-up-2"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nobody carries a balance."
          hint="A balance appears when a cycle closes with someone short, or when a terms change leaves a gap."
        />
      ) : (
        <Card className="animate-fade-in-up-2">
          <CardHeader
            title="Who carries one"
            sub="largest first — open a person to see the whole story and settle it"
          />
          <ul className="border-t border-gray-100 dark:border-gray-800/60">
            {rows.map((r) => (
              <li
                key={r.personId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-100 dark:border-gray-800/60 px-5 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/people/${r.personId}?tab=payout`}
                      className="truncate text-sm font-bold text-gray-900 dark:text-white hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.nameAmharic && (
                      <span className="truncate text-xs text-gray-600 dark:text-gray-400">
                        {r.nameAmharic}
                      </span>
                    )}
                    {r.forgiven > 0 && (
                      <Pill tone="neutral">{formatMoney(r.forgiven)} written off</Pill>
                    )}
                  </div>
                  {/* WHERE IT CAME FROM — the point of the ledger. */}
                  <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400 text-pretty">
                    {r.origins.length > 0 ? r.origins.join(" · ") : "No recorded origin"}
                    {r.oldest !== null && ` · since ${formatDateUTC(new Date(r.oldest))}`}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-base font-black tabular-nums leading-none text-gray-900 dark:text-white">
                    {formatMoney(r.balance)}
                  </p>
                  <p className="mt-1 text-[11px] tabular-nums text-gray-600 dark:text-gray-400">
                    {formatMoney(r.raised)} raised · {formatMoney(r.repaid)} repaid
                  </p>
                </div>

                <Link
                  href={`/admin/people/${r.personId}?tab=payout`}
                  className="min-h-11 md:min-h-8 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200 transition-[background-color,transform] duration-150 ease-out hover:bg-gray-50 dark:hover:bg-white/5 active:scale-[0.97]"
                >
                  Settle
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {/* Always rendered, even on one page: a list that shows part of
          itself while looking whole is how someone concludes a debt was
          settled when it was only on page two. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pager
          info={page}
          noun={{ one: "person carries a balance", many: "people carry a balance" }}
          label="Balance pages"
          hrefFor={(n) => `/admin/balances?page=${n}${pageSize !== PAGE_SIZES.balances ? `&pageSize=${pageSize}` : ""}`}
        />
        <PageSizeSelect dflt={PAGE_SIZES.balances} storageKey="admin-balances-page-size" />
      </div>

    </main>
  );
}
