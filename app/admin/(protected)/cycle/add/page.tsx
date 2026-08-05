import Link from "next/link";
import { getActiveCycleDetail } from "@/app/actions/cycles";
import { listPeople } from "@/app/actions/people";
import { PresentationHidden } from "@/components/presentation-hidden";
import { currentWeekNumber } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { AddMemberWizard } from "./add-member-wizard";

export const dynamic = "force-dynamic";

export default async function AddMemberPage() {
  // The wizard is names and amounts (2.4).
  if (await getSetting("presentationMode")) return <PresentationHidden what="Add member" />;
  const cycle = await getActiveCycleDetail();

  if (!cycle) {
    return (
      <main>
        <h1 className="mb-2 text-xl font-semibold">No active cycle</h1>
        <p className="text-sm text-gray-700">
          <Link href="/admin/cycles/new" className="underline">
            Start a new cycle
          </Link>{" "}
          before adding members.
        </p>
      </main>
    );
  }

  const peopleResult = await listPeople();
  if (!peopleResult.ok) {
    return (
      <main>
        <h1 className="mb-2 text-xl font-semibold">Add member</h1>
        <p role="alert" className="text-sm text-red-800">
          {peopleResult.error}
        </p>
      </main>
    );
  }

  // Numbers already used in this cycle — for immediate manual validation.
  const takenNumbers = cycle.participations.flatMap((p) =>
    p.luckyNumbers.map((n) => n.number),
  );

  // The cycle's numbering choice, made at creation (fresh unless carryover).
  const modeRow = await prisma.setting.findUnique({
    where: { key: `numberingMode:${cycle.id}` },
  });
  let numberingMode: "fresh" | "carryover" = "fresh";
  try {
    if (modeRow && JSON.parse(modeRow.value) === "carryover") numberingMode = "carryover";
  } catch {
    numberingMode = "fresh";
  }

  // Each person's numbers from the most recent previous cycle (for carry-over
  // previews in the wizard).
  const previousCycle = await prisma.cycle.findFirst({
    where: { id: { not: cycle.id } },
    orderBy: { createdAt: "desc" },
    include: { luckyNumbers: { include: { participation: { select: { personId: true } } } } },
  });
  const prevNumbersByPerson: Record<string, number[]> = {};
  if (previousCycle) {
    for (const n of previousCycle.luckyNumbers) {
      (prevNumbersByPerson[n.participation.personId] ??= []).push(n.number);
    }
    for (const key of Object.keys(prevNumbersByPerson)) {
      prevNumbersByPerson[key].sort((a, b) => a - b);
    }
  }

  return (
    <main>
      <h1 className="mb-6 text-xl font-semibold">Add member to {cycle.name}</h1>
      <AddMemberWizard
        cycle={{
          id: cycle.id,
          name: cycle.name,
          plannedWeeks: cycle.plannedWeeks,
          unitAmount: cycle.unitAmount,
          feePercent: cycle.feePercent,
        }}
        currentWeek={currentWeekNumber(cycle.startDate, new Date())}
        startDateISO={cycle.startDate.toISOString()}
        takenNumbers={takenNumbers}
        numberingMode={numberingMode}
        prevNumbersByPerson={prevNumbersByPerson}
        people={peopleResult.data.map((p) => ({
          id: p.id,
          nameAmharic: p.nameAmharic,
          nameEnglishFirst: p.nameEnglishFirst,
          nameEnglishLast: p.nameEnglishLast,
          phone: p.phone,
          inActiveCycle: p.inActiveCycle,
        }))}
      />
    </main>
  );
}
