/**
 * REPAIR THE BREAKS THAT WERE BACK-DATED TO THE START OF THE CYCLE.
 *
 * The bug is fixed in app/actions/participation-close.ts — reactivate now
 * derives a missing break through `legacyBreak`, which falls back to the
 * member's LAST PAID WEEK before it falls back to the start of the cycle. This
 * repairs the row that was already written before that.
 *
 * WHAT A BAD ROW LOOKS LIKE. A break whose `fromWeek` is at or before a week
 * the member actually PAID for. That cannot be true: a break is a stretch they
 * were not part of the cycle, and money arrived for those weeks. It is the
 * signature of `(closedAtWeek ?? startWeek - 1) + 1` firing with a null
 * closing week.
 *
 * WHAT IT IS CORRECTED TO. `lastWeekWithMoney + 1` — the same answer
 * `legacyBreak` would give today. `toWeek` is left exactly as it is: when they
 * came back is a separate recorded fact and is not in question.
 *
 * MONEY IS NEVER TOUCHED. No payment, payout, ledger or cash row is read for
 * anything but evidence, and none is written. Only `participation_breaks
 * .fromWeek` moves, and only on rows that fail the test above.
 *
 *   npx tsx scripts/repair-backdated-breaks.mts            (dry run)
 *   npx tsx scripts/repair-backdated-breaks.mts --apply    (writes)
 */
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const APPLY = process.argv.includes("--apply");
const money = (c: number) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

const db = new Client({ connectionString: process.env.DIRECT_URL });
await db.connect();
const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows;
const line = (s = "") => console.log(s);

line(APPLY ? "APPLYING — rows will be written." : "DRY RUN — nothing will be written.");
line();

const rows = await q(
  `SELECT pb.id, pb."participationId", pb."fromWeek", pb."toWeek", pb.reason,
          pe."nameEnglishFirst" AS name, pa."startWeek", pa."weeklyAmount",
          pa."closedAtWeek", c.name AS cycle,
          (SELECT MAX(w."weekNumber") FROM payments pm JOIN weeks w ON w.id = pm."weekId"
            WHERE pm."participationId" = pa.id AND pm."amountPaid" > 0) AS "lastPaidWeek",
          (SELECT COUNT(*) FROM payments pm JOIN weeks w ON w.id = pm."weekId"
            WHERE pm."participationId" = pa.id AND pm."amountPaid" > 0
              AND w."weekNumber" >= pb."fromWeek"
              AND (pb."toWeek" IS NULL OR w."weekNumber" <= pb."toWeek"))::int AS "paidWeeksInsideBreak",
          (SELECT COALESCE(SUM(pm."amountPaid"),0) FROM payments pm JOIN weeks w ON w.id = pm."weekId"
            WHERE pm."participationId" = pa.id AND pm."amountPaid" > 0
              AND w."weekNumber" >= pb."fromWeek"
              AND (pb."toWeek" IS NULL OR w."weekNumber" <= pb."toWeek")) AS "moneyInsideBreak"
     FROM participation_breaks pb
     JOIN participations pa ON pa.id = pb."participationId"
     JOIN people pe ON pe.id = pa."personId"
     JOIN cycles c ON c.id = pa."cycleId"
    ORDER BY pe."nameEnglishFirst", pb."fromWeek"`,
);

line(`${rows.length} break rows in total.`);
line();

const bad = rows.filter((r) => r.paidWeeksInsideBreak > 0);
const fine = rows.filter((r) => r.paidWeeksInsideBreak === 0);

line("── ROWS THAT ARE FINE (no paid week falls inside the break)");
for (const r of fine) {
  line(`   ${r.name.padEnd(10)} ${r.fromWeek}→${r.toWeek ?? "open"}   ${r.reason}`);
}
line();

if (bad.length === 0) {
  line("── NOTHING TO REPAIR. No break covers a week the member paid for.");
  await db.end();
  process.exit(0);
}

line("── ROWS TO REPAIR");
const plan: { id: string; from: number; to: number; name: string }[] = [];
for (const r of bad) {
  const corrected = Number(r.lastPaidWeek) + 1;
  line();
  line(`   ${r.name} — ${r.cycle}`);
  line(`     break id            ${r.id}`);
  line(`     BEFORE              fromWeek ${r.fromWeek} → toWeek ${r.toWeek ?? "open"}   (${r.reason})`);
  line(`     AFTER               fromWeek ${corrected} → toWeek ${r.toWeek ?? "open"}   (${r.reason}, unchanged)`);
  line(`     why                 ${r.paidWeeksInsideBreak} week(s) they PAID fall inside this break,`);
  line(`                         totalling ${money(Number(r.moneyInsideBreak))} — a break cannot cover a week`);
  line(`                         money arrived for.`);
  line(`     last paid week      ${r.lastPaidWeek}   → the break belongs at ${corrected}`);
  line(`     weekly amount       ${money(r.weeklyAmount)}`);
  line(`     restores            ${money(r.weeklyAmount * (corrected - r.fromWeek))} to what the cycle should have collected`);
  if (corrected <= r.fromWeek) {
    line(`     SKIPPED — the correction would not move the row forward.`);
    continue;
  }
  plan.push({ id: r.id, from: r.fromWeek, to: corrected, name: r.name });
}

line();
line("── EFFECT ON THE BOOKS");
line("   Cash in hand does not move. `effectiveFinishWeek` reads only OPEN");
line("   breaks, and every row above is a CLOSED one, so no payment, payout or");
line("   cash figure is derived from it. Only what the cycle says it should");
line("   have collected changes.");
line();

if (!APPLY) {
  line(`── DRY RUN COMPLETE. ${plan.length} row(s) would change. Re-run with --apply to write.`);
  await db.end();
  process.exit(0);
}

line("── APPLYING");
await db.query("BEGIN");
try {
  for (const p of plan) {
    const res = await db.query(
      `UPDATE participation_breaks SET "fromWeek" = $1 WHERE id = $2 AND "fromWeek" = $3`,
      [p.to, p.id, p.from],
    );
    line(`   ${p.name}: ${p.from} → ${p.to}   (${res.rowCount} row)`);
    if (res.rowCount !== 1) throw new Error(`expected to update exactly 1 row for ${p.name}`);
  }
  await db.query("COMMIT");
  line("   committed.");
} catch (e) {
  await db.query("ROLLBACK");
  line(`   ROLLED BACK: ${(e as Error).message}`);
  await db.end();
  process.exit(1);
}

line();
line("── AFTER");
for (const r of await q(
  `SELECT pb."fromWeek", pb."toWeek", pb.reason, pe."nameEnglishFirst" AS name
     FROM participation_breaks pb
     JOIN participations pa ON pa.id = pb."participationId"
     JOIN people pe ON pe.id = pa."personId"
    ORDER BY pe."nameEnglishFirst", pb."fromWeek"`,
)) {
  line(`   ${r.name.padEnd(10)} ${r.fromWeek}→${r.toWeek ?? "open"}   ${r.reason}`);
}

await db.end();
