import Link from "next/link";
import { PresentationHidden } from "@/components/presentation-hidden";
import { SETTLEMENT_EVENT_WHERE } from "@/lib/draw-settlement";
import { prisma } from "@/lib/prisma";
import { formatDateUTC } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import { undoDrawConsequences } from "@/lib/undo-draw";
import { DrawEditor } from "./draw-editor";
import { EmptyState } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function DrawsPage() {
  // Draw history names its winners (2.4). The wheel setup still shows which
  // slots are drawn without identity.
  if (await getSetting("presentationMode")) return <PresentationHidden what="Draws" />;
  const cycle = await prisma.cycle.findFirst({
    where: { status: "ACTIVE" },
    include: {
      weeks: { orderBy: { weekNumber: "asc" }, include: { draws: true } },
      slots: {
        orderBy: { position: "asc" },
        include: {
          members: { include: { luckyNumber: { include: { participation: { include: { person: true } } } } } },
          draws: true,
        },
      },
    },
  });
  if (!cycle) {
    return (
      <main className="space-y-4">
        <h1 className="text-xl font-black text-gray-900 dark:text-white">Draws</h1>
        <EmptyState
          title="No cycle is running."
          hint="Draws belong to a cycle. Start one, and the weeks you draw appear here."
        />
      </main>
    );
  }

  const draws = await prisma.draw.findMany({
    where: { week: { cycleId: cycle.id } },
    include: {
      week: true,
      payouts: { include: { luckyNumber: true } },
      slot: { include: { members: { include: { luckyNumber: { include: { participation: { include: { person: true } } } } } } } },
    },
    orderBy: { week: { weekNumber: "asc" } },
  });

  // Week contributions settled from each payout, for computed consequences.
  const settlementEvents = await prisma.paymentEvent.findMany({
    where: SETTLEMENT_EVENT_WHERE,
    select: { settlementPayoutId: true, amount: true },
  });
  const settlementByPayout = new Map<string, number>();
  for (const event of settlementEvents) {
    if (event.settlementPayoutId) {
      settlementByPayout.set(
        event.settlementPayoutId,
        (settlementByPayout.get(event.settlementPayoutId) ?? 0) + event.amount,
      );
    }
  }

  const weekOptions = cycle.weeks.map((w) => ({
    id: w.id,
    label: `Week ${w.weekNumber} (${formatDateUTC(w.date)})${w.draws.length > 0 ? " — has a draw" : ""}`,
    hasDraw: w.draws.length > 0,
  }));
  const slotOptions = cycle.slots.map((s) => ({
    id: s.id,
    label:
      `Slot ${s.position}: ` +
      s.members
        .map((m) => `#${m.luckyNumber.number} ${m.luckyNumber.participation.person.nameEnglishFirst}`)
        .join(", ") +
      (s.draws.length > 0 ? " — already won" : ""),
    hasWon: s.draws.length > 0,
  }));

  return (
    <main>
      <p className="mb-4 text-sm">
        <Link href="/admin/cycle" className="text-gray-600 dark:text-gray-400 hover:underline">← Cycle</Link>
      </p>
      <h1 className="mb-2 text-2xl font-black text-gray-900 dark:text-white">Draws — {cycle.name}</h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        One draw per week; a slot wins once per cycle. Violations are reported plainly, never
        applied silently.
      </p>
      {draws.length === 0 ? (
        <EmptyState
          title="No draws recorded yet."
          hint="A draw is recorded from the wheel. Once a week is drawn it appears here, editable and undoable."
        />
      ) : (
        <div className="max-w-2xl space-y-3">
          {draws.map((d) => (
            <DrawEditor
              key={d.id}
              draw={{
                id: d.id,
                weekId: d.weekId,
                weekNumber: d.week.weekNumber,
                slotId: d.slotId,
                winners: d.slot.members
                  .map((m) => `#${m.luckyNumber.number} ${m.luckyNumber.participation.person.nameEnglishFirst}`)
                  .join(", "),
              }}
              undo={undoDrawConsequences({
                weekNumber: d.week.weekNumber,
                slotNumbers: d.slot.members.map((m) => m.luckyNumber.number),
                payouts: d.payouts.map((p) => ({
                  payoutId: p.id,
                  number: p.luckyNumber.number,
                  netAmount: p.netAmount,
                  status: p.status,
                  settlementAmount: settlementByPayout.get(p.id) ?? 0,
                })),
              })}
              cycleName={cycle.name}
              weekOptions={weekOptions}
              slotOptions={slotOptions}
            />
          ))}
        </div>
      )}
    </main>
  );
}
