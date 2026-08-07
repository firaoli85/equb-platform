import { PresentationHidden } from "@/components/presentation-hidden";
import { newCycleStartBounds } from "@/lib/date-bounds";
import { cycleFinishPreview, resolveWeekDate, storedWeekDates } from "@/lib/commitment";
import { formatDateLongUTC } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { NewCycleForm } from "./new-cycle-form";

export const dynamic = "force-dynamic";

// Starting a cycle is a money decision AND a calendar decision.
//
// The money projection is STRUCTURAL — weeks × unitAmount — so this page no
// longer loads a roster for it. It loads the ACTIVE cycle instead, for the one
// thing only the server knows: when the current cycle actually ends, which is
// the earliest a new one may start.
export default async function NewCyclePage() {
  if (await getSetting("presentationMode")) return <PresentationHidden what="New cycle" />;

  const active = await prisma.cycle.findFirst({
    where: { status: "ACTIVE" },
    include: { weeks: { orderBy: { weekNumber: "asc" } } },
  });

  // 2.14: the STORED week date is authoritative. Only when no row exists does
  // the finish get computed from the start date — the same rule every finish
  // line on the platform follows.
  let activeCycle: {
    name: string;
    finalWeekDate: Date;
    finalWeekLabel: string;
  } | null = null;

  if (active) {
    const stored = storedWeekDates(active.weeks);
    const preview = cycleFinishPreview({
      cycleStartDate: active.startDate,
      plannedWeeks: active.plannedWeeks,
      stored,
    });
    // The cycle may be RUNNING LONG (2.7): its real last week is whichever is
    // later — the planned finish, or the last week row that actually exists.
    const lastRow = active.weeks.at(-1) ?? null;
    const plannedFinish =
      preview === null
        ? null
        : resolveWeekDate({
            weekNumber: preview.finishWeek,
            stored,
            cycleStartDate: active.startDate,
          })?.date ?? null;

    const finalWeekDate =
      lastRow && plannedFinish
        ? lastRow.date > plannedFinish
          ? lastRow.date
          : plannedFinish
        : (plannedFinish ?? lastRow?.date ?? null);

    if (finalWeekDate) {
      activeCycle = {
        name: active.name,
        finalWeekDate,
        finalWeekLabel: formatDateLongUTC(finalWeekDate),
      };
    }
  }

  const startBounds = newCycleStartBounds({ activeCycle });

  return (
    <main className="space-y-5">
      <header className="animate-fade-in-up">
        <h1 className="text-xl font-black text-gray-900 dark:text-white">Start a new cycle</h1>
        <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
          The projection below uses real money so the weeks choice is a real choice.
        </p>
      </header>
      <NewCycleForm startBounds={startBounds} />
    </main>
  );
}
