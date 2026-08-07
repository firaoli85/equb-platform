import Link from "next/link";
import { getPlatformSettings } from "@/app/actions/settings";
import { DangerZone } from "@/components/admin/setting-row";
import { Alert, buttonCls } from "@/components/ui/primitives";
import { CycleRulesForm } from "./cycle-rules-form";

export const dynamic = "force-dynamic";

export default async function CycleSettingsPage() {
  const result = await getPlatformSettings();
  if (!result.ok) return <Alert kind="err">{result.error}</Alert>;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-base font-bold text-gray-900 dark:text-white">Cycle rules</h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          Rules about money and time, kept together. Each one is read at the moment it matters,
          so a change applies to the very next cycle event — nothing is baked in.
        </p>
      </section>

      <CycleRulesForm initial={result.data} />

      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">
          Set per cycle, not here
        </h2>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          The fee percent, the planned week count, the weekly unit and the numbering choice all
          belong to <em>one</em> cycle and are fixed when it is created — a platform-wide default
          would silently rewrite what a running cycle agreed to.
        </p>
        <p className="mt-3">
          <Link
            href="/admin/cycles/new"
            className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
          >
            Start a new cycle →
          </Link>
        </p>
      </section>

      {/* Framer's shape: the irreversible action lives in its own bordered
          region at the foot, never as a sibling of a toggle. This is the
          complaint that started the IA rework, answered structurally. */}
      <DangerZone title="Ends a cycle">
        <p className="max-w-prose text-sm leading-relaxed text-gray-800 dark:text-gray-200">
          Closing writes a carried debt onto every member who is short, freezes the archive, and
          makes the whole cycle read-only. It cannot be undone by reopening — the ledger entries
          stay written.
        </p>
        <Link href="/admin/cycle/close" className={buttonCls.danger}>
          Review and close the cycle
        </Link>
      </DangerZone>
    </div>
  );
}
