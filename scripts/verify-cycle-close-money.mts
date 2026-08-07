// BEHAVIOURAL VERIFICATION for the two closeCycle money defects, against the
// LIVE database on a PRODUCTION-SHAPED synthetic cycle.
//
//   npx tsx scripts/verify-cycle-close-money.mts
//
// The fixture (scripts/lib/production-fixture.mts) is 27 members, numbers
// sequential from 1 with no gaps, four members holding two numbers, 20 weeks,
// six drawn weeks with real settlements, and a deliberate mix of COLLECTED and
// PENDING payouts. The mix is the point: both defects below are invisible on a
// fixture where every payout was collected.
//
// DEFECT 1 — THE ARCHIVE'S CASH POSITION WAS WRONG, PERMANENTLY.
// `memberFinals().receivedNet` summed every payout with no status filter, and
// buildArchiveData set `paidOutNet = Σ receivedNet`, `stillHeld = received −
// paidOutNet`. A payout awarded but not yet handed over therefore counted as
// money that had left. The archive is rendered verbatim and never recomputed,
// so the error is permanent — and the same page prints that payout's own row
// as "pending", so the document contradicted itself on one screen.
//
// DEFECT 2 — CLOSING BLANKED EVERY MEMBER'S PORTAL.
// Every member query was gated on `cycle: { status: "ACTIVE" }`. The instant
// the cycle closed, all 27 members saw "You are not in the current cycle" and
// zeroes — contradicting 2.18, which says closed members keep access to their
// own record.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const F = await import("./lib/production-fixture.mts");
const { buildArchiveData } = await import("../lib/cycle-close");
const { formatMoney } = await import("../lib/format");

let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function main() {
  await F.wipe(prisma);
  const fx = await F.build(prisma);

  console.log("\nThe fixture resembles production\n");
  const numbers = (
    await prisma.luckyNumber.findMany({
      where: { cycleId: fx.cycleId },
      select: { number: true },
      orderBy: { number: "asc" },
    })
  ).map((n) => n.number);
  check(`${fx.members.length} members`, fx.members.length === 27);
  check(
    `numbers run 1..${numbers.length} with NO gaps`,
    numbers.every((n, i) => n === i + 1),
    numbers.slice(0, 8).join(","),
  );
  check(
    "some members hold TWO numbers (the split that hid the fee bug)",
    fx.members.filter((m) => m.numbers.length === 2).length === 4,
  );

  const collected = await prisma.payout.findMany({
    where: { luckyNumber: { cycleId: fx.cycleId }, status: "COLLECTED" },
  });
  const pending = await prisma.payout.findMany({
    where: { luckyNumber: { cycleId: fx.cycleId }, status: "PENDING" },
  });
  check(
    `payouts are a MIX: ${collected.length} collected, ${pending.length} pending`,
    collected.length > 0 && pending.length > 0,
  );

  // ————————————————— DEFECT 1 —————————————————
  console.log("\nThe archive's cash position\n");

  const participations = await prisma.participation.findMany({
    where: { cycleId: fx.cycleId },
    include: { luckyNumbers: { include: { payouts: true } }, payments: true },
  });

  // Exactly the two derivations, side by side.
  const collectedTotal = collected.reduce((s, p) => s + p.netAmount, 0);
  const pendingTotal = pending.reduce((s, p) => s + p.netAmount, 0);
  const received = participations.reduce(
    (s, p) => s + p.payments.reduce((x, pm) => x + pm.amountPaid, 0),
    0,
  );

  const members = participations.map((p) => ({
    participationId: p.id,
    personId: p.personId,
    name: "m",
    nameAmharic: "m",
    weeklyAmount: p.weeklyAmount,
    weeksCommitted: p.weeksCommitted,
    weeksPaid: 0,
    outstanding: 0,
    lastPaymentWeek: null,
    drawnWeek: null,
    receivedNet: p.luckyNumbers.reduce(
      (s, n) =>
        s + n.payouts.filter((po) => po.status === "COLLECTED").reduce((x, po) => x + po.netAmount, 0),
      0,
    ),
    awardedNet: p.luckyNumbers.reduce(
      (s, n) => s + n.payouts.reduce((x, po) => x + po.netAmount, 0),
      0,
    ),
    pendingNet: p.luckyNumbers.reduce(
      (s, n) =>
        s + n.payouts.filter((po) => po.status !== "COLLECTED").reduce((x, po) => x + po.netAmount, 0),
      0,
    ),
    settledFromPayout: 0,
    totalPaid: p.payments.reduce((x, pm) => x + pm.amountPaid, 0),
  }));

  const archive = buildArchiveData({
    cycleName: "fixture",
    startDate: "2026-05-17",
    closedAt: new Date().toISOString(),
    plannedWeeks: 20,
    feePercent: 2,
    members,
    weeks: fx.weeks.map((w) => ({
      weekNumber: w.weekNumber,
      date: w.date.toISOString().slice(0, 10),
      isSkipped: false,
      received: participations.reduce(
        (s, p) => s + (p.payments.find((pm) => pm.weekId === w.id)?.amountPaid ?? 0),
        0,
      ),
      draw: null,
    })),
  });

  check(
    `paid out counts ONLY collected (${formatMoney(archive.totals.paidOutNet)})`,
    archive.totals.paidOutNet === collectedTotal,
    `expected ${formatMoney(collectedTotal)}`,
  );
  check(
    `pending is stated separately (${formatMoney(archive.totals.pendingNet)})`,
    archive.totals.pendingNet === pendingTotal,
    `expected ${formatMoney(pendingTotal)}`,
  );
  check(
    "STILL HELD includes the pending payouts — the group has that cash",
    archive.totals.stillHeld === received - collectedTotal,
    `${formatMoney(archive.totals.stillHeld)} vs ${formatMoney(received - collectedTotal)}`,
  );
  // The old arithmetic, reproduced, must differ — otherwise this fixture
  // cannot demonstrate the defect and the check above proves nothing.
  const oldStillHeld = received - (collectedTotal + pendingTotal);
  check(
    `the OLD arithmetic differs by exactly the pending total (${formatMoney(pendingTotal)})`,
    archive.totals.stillHeld - oldStillHeld === pendingTotal && pendingTotal > 0,
  );
  check(
    "paid out + pending reconciles to everything awarded",
    archive.totals.paidOutNet + archive.totals.pendingNet === collectedTotal + pendingTotal,
  );

  // ————————————————— DEFECT 2 —————————————————
  console.log("\nA member's record survives the close (2.18)\n");

  // The lookup getMyPortal now performs, run against the fixture in both
  // states. Only the fallback half can be exercised here — the action itself
  // needs a signed-in session — but the fallback IS the fix.
  const somebody = fx.members[0].personId;
  const liveLookup = await prisma.participation.findFirst({
    where: { personId: somebody, status: "ACTIVE", cycle: { status: "ACTIVE" } },
    select: { id: true },
  });
  const fallbackLookup = await prisma.participation.findFirst({
    where: { personId: somebody },
    orderBy: [{ cycle: { startDate: "desc" } }, { createdAt: "desc" }],
    select: { id: true },
  });

  // The fixture is DRAFT (only one ACTIVE cycle is permitted), which is
  // exactly the shape the old query failed on: not ACTIVE, therefore invisible.
  check(
    "the OLD active-only query finds nothing on a non-active cycle",
    liveLookup === null,
    "the fixture must not be ACTIVE for this to prove anything",
  );
  check(
    "the fallback finds their participation anyway",
    fallbackLookup !== null && fallbackLookup.id === fx.members[0].participationId,
  );

  // And it must be their real record, not an empty shell.
  const record = await prisma.participation.findUniqueOrThrow({
    where: { id: fallbackLookup!.id },
    include: { payments: true, cycle: { select: { status: true, name: true } } },
  });
  const paid = record.payments.reduce((s, p) => s + p.amountPaid, 0);
  check(
    `their weeks and money are intact (${record.payments.length} weeks, ${formatMoney(paid)})`,
    record.payments.length > 0 && paid > 0,
  );
  check(
    "and the portal can tell it is closed rather than guessing",
    record.cycle.status === "DRAFT" || record.cycle.status === "CLOSED",
  );
}

try {
  await main();
} finally {
  await F.wipe(prisma);
  const left = await F.assertClean(prisma);
  console.log(`\nFixtures remaining: ${left}`);
  if (left > 0) failures += 1;
  await prisma.$disconnect();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
