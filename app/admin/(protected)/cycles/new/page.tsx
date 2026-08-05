import { PresentationHidden } from "@/components/presentation-hidden";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { NewCycleForm } from "./new-cycle-form";

export const dynamic = "force-dynamic";

// Starting a cycle is a money decision — the form projects real dollars from
// the most recent cycle's roster (2.1: no dead figures, never "$0" as if it
// were an answer).
export default async function NewCyclePage() {
  if (await getSetting("presentationMode")) return <PresentationHidden what="New cycle" />;

  // The most recent cycle with members — ACTIVE first, else latest.
  const previous = await prisma.cycle.findFirst({
    where: { participations: { some: {} } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      participations: {
        where: { status: "ACTIVE" },
        select: { id: true, weeklyAmount: true },
      },
    },
  });

  const baseline =
    previous && previous.participations.length > 0
      ? {
          cycleName: previous.name,
          members: previous.participations.map((p) => ({
            id: p.id,
            weeklyAmount: p.weeklyAmount,
          })),
        }
      : null;

  return (
    <main className="space-y-5">
      <header className="animate-fade-in-up">
        <h1 className="text-xl font-black text-gray-900 dark:text-white">Start a new cycle</h1>
        <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
          The projection below uses real money so the weeks choice is a real choice.
        </p>
      </header>
      <NewCycleForm baseline={baseline} />
    </main>
  );
}
