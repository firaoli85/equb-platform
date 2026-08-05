import Link from "next/link";
import { getActiveCycleDetail } from "@/app/actions/cycles";
import { PresentationHidden } from "@/components/presentation-hidden";
import { getSetting } from "@/lib/settings";
import { CycleEditForm } from "./cycle-edit-form";

export const dynamic = "force-dynamic";

export default async function CycleEditPage() {
  // The cycle's money configuration (2.4).
  if (await getSetting("presentationMode")) return <PresentationHidden what="Edit cycle" />;
  const cycle = await getActiveCycleDetail();
  if (!cycle) {
    return (
      <main>
        <p className="text-sm">No active cycle.</p>
      </main>
    );
  }
  return (
    <main>
      <p className="mb-4 text-sm">
        <Link href="/admin/cycle" className="underline">← Cycle</Link>
      </p>
      <h1 className="mb-6 text-xl font-semibold">Edit cycle</h1>
      <CycleEditForm
        cycle={{
          id: cycle.id,
          name: cycle.name,
          startDate: cycle.startDate.toISOString().slice(0, 10),
          plannedWeeks: cycle.plannedWeeks,
          unitAmount: cycle.unitAmount,
          feePercent: cycle.feePercent,
        }}
        members={cycle.participations
          .filter((p) => p.status === "ACTIVE")
          .map((p) => ({
            id: p.id,
            name: `${p.person.nameAmharic} — ${p.person.nameEnglishFirst}`,
            weeklyAmount: p.weeklyAmount,
            weeksCommitted: p.weeksCommitted,
          }))}
      />
    </main>
  );
}
