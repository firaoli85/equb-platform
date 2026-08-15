// BACKFILL FOR PHASE 3c — a payment ends a pause (f44eac3).
//
// Phase 3c clears `isDeferred` at the moment money lands, inside
// `rebuildParticipationPayments`. That fires on the recording path, an edit, a
// deletion, a commitment change and a settlement — but NOT retroactively. So a
// week that was already deferred-with-money before the fix shipped stays stale
// until that member's next payment: the grid keeps drawing the "~", the money
// keeps sitting in `amountDeferred`, and the member reads "paused" over money
// they actually sent.
//
// This finds those rows and corrects them.
//
//   DRY RUN (default):  npx tsx scripts/backfill-undefer.mts
//   APPLY:              npx tsx scripts/backfill-undefer.mts --apply
//
// THE CORRECTION IS `rebuildParticipationPayments` ITSELF, not a hand-written
// UPDATE. Setting the flag directly would be a second implementation of the
// rule — the exact defect this whole build exists to remove — and it would
// drift from the live path the day either changed. Running the real rebuild
// means the corrected row is bit-for-bit what a payment would have produced.
//
// Reads DIRECT_URL: the pooled app role sees no rows under RLS.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const { rebuildParticipationPayments } = await import("../lib/rebuild");
const { computeStanding } = await import("../lib/standing");
const { formatMoney } = await import("../lib/format");

const APPLY = process.argv.includes("--apply");

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL is not set — the pooled app role sees no rows under RLS.");
  process.exit(1);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

type Row = {
  participationId: string;
  member: string;
  cycle: string;
  weekNumber: number;
  weeklyAmount: number;
  covered: number;
  wouldBecome: string;
};

/** The member's standing as it stands right now. */
async function standingOf(participationId: string, today: Date) {
  const p = await prisma.participation.findUniqueOrThrow({
    where: { id: participationId },
    include: {
      cycle: { include: { weeks: { orderBy: { weekNumber: "asc" } } } },
      payments: true,
      person: true,
    },
  });
  const finish = p.startWeek + p.weeksCommitted - 1;
  const byWeekId = new Map(p.payments.map((x) => [x.weekId, x]));
  const windowWeeks = p.cycle.weeks
    .filter((w) => w.weekNumber >= p.startWeek && w.weekNumber <= finish)
    .map((w) => {
      const pay = byWeekId.get(w.id);
      return {
        weekNumber: w.weekNumber,
        date: w.date,
        amountDue: p.weeklyAmount,
        storedPaid: pay?.amountPaid ?? 0,
        isDeferred: pay?.isDeferred ?? false,
        isSkipped: w.isSkipped,
        markedLate: pay?.markedLateAt != null,
      };
    });
  const standing = computeStanding({
    weeklyAmount: p.weeklyAmount,
    startWeek: p.startWeek,
    weeksCommitted: p.weeksCommitted,
    cycleWeek: 0,
    today,
    windowWeeks,
    totalPaid: p.payments.reduce((s, x) => s + x.amountPaid, 0),
  });
  return { p, standing };
}

async function main() {
  const today = new Date();
  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — backfill-undefer, ${today.toISOString()}\n`);

  // THE SIGNAL IS COVERAGE, NOT THE STORED RECEIPT — and the difference is the
  // whole point.
  //
  // A first pass queried `payment.amountPaid > 0`, which is the receipt written
  // on that week's own row. Phase 3c's rule fires on money REACHING the week,
  // and coverage is re-derived oldest-first over the member's whole fungible
  // total (2.15, 2.19). Those are not the same set: a catch-up payment recorded
  // against week 14 can cover weeks 11 and 12, leaving them covered with no
  // receipt of their own. The narrow query missed exactly those — the members
  // most likely to be affected, since being behind is what puts money on a
  // later row than the week it pays for.
  //
  // So: derive every member's standing and ask it, the same way the screens do.
  const participations = await prisma.participation.findMany({ select: { id: true } });
  const byParticipation = new Map<string, number[]>();
  for (const { id } of participations) {
    const { standing } = await standingOf(id, today);
    const covered = standing.weeks
      .filter((w) => w.isDeferred && !w.isSkipped && w.coveredAtCurrentRate > 0)
      .map((w) => w.weekNumber);
    if (covered.length > 0) byParticipation.set(id, covered);
  }

  if (byParticipation.size === 0) {
    console.log(
      `Scanned ${participations.length} participations. No deferred week has money on it.\n` +
        "Nothing to correct — every remaining pause is a real one.\n",
    );
    await prisma.$disconnect();
    return;
  }

  const rows: Row[] = [];
  const totalsBefore = new Map<string, { outstanding: number; deferred: number; name: string }>();

  for (const [participationId, coveredWeeks] of byParticipation) {
    const { p, standing } = await standingOf(participationId, today);
    const name = `${p.person.nameEnglishFirst}${p.person.nameEnglishLast ? ` ${p.person.nameEnglishLast}` : ""}`;
    totalsBefore.set(participationId, {
      outstanding: standing.amountOutstanding,
      deferred: standing.amountDeferred,
      name,
    });

    console.log(`── ${name}  ·  ${p.cycle.name}  ·  $${(p.weeklyAmount / 100).toFixed(2)}/wk`);
    console.log(
      `   now: owed ${formatMoney(standing.amountOutstanding)} · paused ${formatMoney(standing.amountDeferred)} · ${standing.weeksBehind} behind`,
    );

    // EVERY paused week of theirs — the ruling reactivates the member, so a
    // paused week the money never reached is corrected too (it becomes owed).
    for (const w of standing.weeks.filter((x) => x.isDeferred)) {
      const covered = w.coveredAtCurrentRate;
      const full = covered >= w.amountDue;
      const closed = w.date.getTime() + 5 * 86_400_000 <= today.getTime();
      const wouldBecome = full
        ? "PAID"
        : covered > 0
          ? closed
            ? "PARTIAL_LATE"
            : "PARTIAL"
          : closed
            ? "LATE"
            : "UNPAID";
      const touched = coveredWeeks.includes(w.weekNumber);
      rows.push({
        participationId,
        member: name,
        cycle: p.cycle.name,
        weekNumber: w.weekNumber,
        weeklyAmount: w.amountDue,
        covered,
        wouldBecome,
      });
      console.log(
        `   week ${String(w.weekNumber).padStart(2)}  ${formatMoney(covered)} of ${formatMoney(w.amountDue)}` +
          `  ${w.status} → ${wouldBecome}${touched ? "   ← money on this week" : ""}`,
      );
    }
    console.log("");
  }

  console.log(
    `${rows.length} paused week(s) across ${byParticipation.size} member(s) would be corrected.\n`,
  );

  if (!APPLY) {
    console.log("DRY RUN — nothing was written. Re-run with --apply to correct these rows.\n");
    await prisma.$disconnect();
    return;
  }

  // ——— APPLY ———
  console.log("Applying, via rebuildParticipationPayments (the live payment path)…\n");
  for (const participationId of byParticipation.keys()) {
    await prisma.$transaction(async (tx) => {
      await rebuildParticipationPayments(tx, participationId);
    });
  }

  // ——— VERIFY (2.24): the partition held, and nothing stale remains ———
  let failures = 0;
  for (const [participationId, before] of totalsBefore) {
    const { standing } = await standingOf(participationId, today);
    const beforeTotal = before.outstanding + before.deferred;
    const afterTotal = standing.amountOutstanding + standing.amountDeferred;
    const ok = beforeTotal === afterTotal;
    if (!ok) failures++;
    console.log(
      `${ok ? "OK  " : "FAIL"} ${before.name}: owed ${formatMoney(before.outstanding)}→${formatMoney(standing.amountOutstanding)} · ` +
        `paused ${formatMoney(before.deferred)}→${formatMoney(standing.amountDeferred)} · ` +
        `total ${formatMoney(beforeTotal)}→${formatMoney(afterTotal)}`,
    );
  }

  const remaining = await prisma.payment.count({
    where: { isDeferred: true, amountPaid: { gt: 0 } },
  });
  console.log(`\nDeferred weeks still holding money: ${remaining} (expected 0)`);
  if (remaining !== 0 || failures > 0) {
    console.error(`\n${failures} member(s) failed the partition check.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log("Partition held for every member; nothing forgiven, nothing created.\n");
  await prisma.$disconnect();
}

await main();
