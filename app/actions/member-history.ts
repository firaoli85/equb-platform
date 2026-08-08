"use server";

import { linkCurrentUserToPerson } from "@/app/actions/auth";
import { ledgerBalance, ledgerStory } from "@/lib/ledger";
import { mine, type PastCycle } from "@/lib/member-history";
import { prisma } from "@/lib/prisma";

// THE MEMBER'S OWN HISTORY.
//
// Read from the FROZEN ARCHIVE (2.9), so this and the organizer's archive page
// render the same snapshot and cannot disagree. Built from CycleArchive rather
// than from Cycle, because a closed cycle can be deleted and its record is
// meant to outlive it — building from Cycle would hide exactly the records
// that most need keeping.
//
// PRIVACY (2.8). The stored snapshot holds every member's figures. `mine()`
// extracts one row server-side and only that row is returned; the blob never
// crosses the wire.

export type MyHistory = {
  cycles: PastCycle[];
  carried: {
    /** Cents outstanding across every cycle, derived from the ledger. */
    balance: number;
    /** Where each part of it came from, newest first. */
    story: { description: string; amount: number; runningTotal: number; occurredAt: string }[];
  };
};

export async function getMyPastCycles(): Promise<
  { ok: true; data: MyHistory } | { ok: false; error: string }
> {
  try {
    const linked = await linkCurrentUserToPerson();
    if (!linked.ok) return { ok: false as const, error: "signed-out" };
    const person = linked.data;

    // Presentation mode (2.4) is deliberately NOT consulted. It exists so the
    // organizer can share his screen without showing the group's money; a
    // member reading their own record on their own phone is not that. The
    // guard that matters here is that only the caller's own row is ever built.

    // Every cycle this person took part in that has a written record. The
    // participation join is what makes it theirs; the archive is what makes
    // it readable.
    const participations = await prisma.participation.findMany({
      where: { personId: person.id },
      select: {
        cycleId: true,
        cycle: {
          select: { id: true, name: true, status: true, startDate: true, closedAt: true },
        },
      },
    });

    const closedIds = participations
      .filter((p) => p.cycle.status === "CLOSED")
      .map((p) => p.cycleId);

    const archives =
      closedIds.length > 0
        ? await prisma.cycleArchive.findMany({
            where: { cycleId: { in: closedIds } },
            orderBy: { closedAt: "desc" },
          })
        : [];

    const byCycle = new Map(participations.map((p) => [p.cycleId, p.cycle]));

    const cycles = archives.map((a) => {
      const cycle = byCycle.get(a.cycleId);
      return mine({
        cycleId: a.cycleId,
        raw: a.data,
        personId: person.id,
        fallback: {
          cycleName: a.cycleName || cycle?.name || "A previous cycle",
          startDate: cycle?.startDate ?? null,
          closedAt: a.closedAt ?? cycle?.closedAt ?? null,
        },
      });
    });

    // A closed cycle with no archive row should not exist — closing writes one
    // — but if it does, the member is told the cycle happened rather than
    // being shown a shorter history than they lived.
    const archived = new Set(archives.map((a) => a.cycleId));
    for (const p of participations) {
      if (p.cycle.status !== "CLOSED" || archived.has(p.cycleId)) continue;
      cycles.push(
        mine({
          cycleId: p.cycleId,
          raw: "",
          personId: person.id,
          fallback: {
            cycleName: p.cycle.name,
            startDate: p.cycle.startDate,
            closedAt: p.cycle.closedAt,
          },
        }),
      );
    }

    const entries = await prisma.ledgerEntry.findMany({
      where: { personId: person.id },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    });

    return {
      ok: true as const,
      data: {
        cycles,
        carried: {
          balance: ledgerBalance(entries),
          // Newest first: what they owe NOW is the question, and the most
          // recent movement is the one that answers it.
          story: ledgerStory(entries)
            .entries.map((e) => ({
              description: e.description,
              amount: e.type === "DEBT" ? e.amount : -e.amount,
              runningTotal: e.balanceAfter,
              occurredAt: e.occurredAt.toISOString(),
            }))
            .reverse(),
        },
      },
    };
  } catch (e) {
    console.error("getMyPastCycles failed:", e);
    return { ok: false as const, error: "Could not load your past cycles." };
  }
}
