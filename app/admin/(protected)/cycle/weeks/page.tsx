import Link from "next/link";
import { getActiveCycle } from "@/app/actions/cycles";
import { PresentationHidden } from "@/components/presentation-hidden";
import { getSetting } from "@/lib/settings";
import { WeekEditor } from "./week-editor";

export const dynamic = "force-dynamic";

export default async function WeeksPage() {
  // Week notes are free organizer text and week editing is not a mid-call
  // activity (2.4). The action blanks notes too — this renders the calmer
  // notice.
  if (await getSetting("presentationMode")) return <PresentationHidden what="Weeks" />;
  const cycle = await getActiveCycle();
  if (!cycle) {
    return (
      <main>
        <p className="text-sm">
          No active cycle. <Link href="/admin/cycles/new" className="underline">Start one</Link>.
        </p>
      </main>
    );
  }
  return (
    <main>
      <p className="mb-4 text-sm">
        <Link href="/admin/cycle" className="underline">← Cycle</Link>
      </p>
      <h1 className="mb-6 text-xl font-semibold">Weeks — {cycle.name}</h1>
      <div className="max-w-2xl space-y-2">
        {cycle.weeks.map((w, i) => (
          <WeekEditor
            key={w.id}
            plannedWeeks={cycle.plannedWeeks}
            previousWeek={
              i > 0
                ? {
                    weekNumber: cycle.weeks[i - 1].weekNumber,
                    date: cycle.weeks[i - 1].date.toISOString().slice(0, 10),
                  }
                : null
            }
            nextWeek={
              i < cycle.weeks.length - 1
                ? {
                    weekNumber: cycle.weeks[i + 1].weekNumber,
                    date: cycle.weeks[i + 1].date.toISOString().slice(0, 10),
                  }
                : null
            }
            week={{
              id: w.id,
              weekNumber: w.weekNumber,
              date: w.date.toISOString().slice(0, 10),
              isSkipped: w.isSkipped,
              notes: w.notes,
            }}
          />
        ))}
      </div>
    </main>
  );
}
