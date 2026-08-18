/**
 * PROVE EVERY CONSERVATION INVARIANT RED.
 *
 * A guard nobody has watched fail is a guard nobody should trust (§5.2). This
 * plants ONE violation at a time into the real source, runs the suite, and
 * records whether the invariant that owns that law noticed.
 *
 * Every plant is restored immediately, in a finally, and the working tree is
 * verified clean at the end.
 *
 *   node scripts/prove-conservation-red.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PLANTS = [
  {
    id: "C1",
    law: "every cent is allocated exactly once",
    file: "lib/allocation.ts",
    find: "    const applied = Math.min(owed, remaining);",
    replace: "    const applied = Math.max(0, Math.min(owed, remaining) - 1);",
    expect: "C1",
  },
  {
    id: "C2",
    law: "live position is collected − handedOut",
    file: "lib/cycle-position.ts",
    find: "return input.collected - input.handedOut;",
    replace: "return input.collected;",
    expect: "C2",
  },
  {
    id: "C3",
    law: "the buckets partition every week",
    file: "lib/end-of-cycle.ts",
    find: "      currentWeekOutstanding += uncollected;",
    replace: "      currentWeekOutstanding += 0;",
    expect: "C3",
  },
  {
    id: "C4",
    law: "the fee is the cycle's percent of the gross",
    file: "lib/money.ts",
    find: "  return Math.round((gross * basisPoints) / 10_000);",
    replace: "  return Math.round((gross * basisPoints) / 20_000);",
    expect: "C4",
  },
  {
    id: "C5",
    law: "status is money + calendar",
    file: "lib/engine.ts",
    find: "      skipped || covered >= w.amountDue ? \"paid\" : covered > 0 ? \"part\" : \"none\";",
    replace: "      skipped || covered >= w.amountDue ? \"paid\" : \"paid\";",
    expect: "C5",
  },
  {
    id: "C6",
    law: "deferral outranks late and the manual mark",
    file: "lib/derived.ts",
    find: "    if (!week.isDeferred || week.isSkipped) continue;",
    replace: "    if (true || week.isSkipped) continue;",
    expect: "C6",
  },
  {
    id: "C7",
    law: "weeks credited is money ÷ the CURRENT rate",
    file: "lib/derived.ts",
    find: "  return Math.floor(totalPaid / weeklyAmount);",
    replace: "  return Math.floor(totalPaid / 25_000);",
    expect: "C7",
  },
  {
    id: "C9",
    law: "a stopped member leaves every forward expectation",
    file: "lib/participation-close.ts",
    find: "  return !inBreak(p.breaks, weekNumber);",
    replace: "  return true;",
    expect: "C9",
  },
  {
    id: "C10",
    law: "owed back is paid-in less the fee (§2.30)",
    file: "lib/final-position.ts",
    find: "  const fee = feeOnReturn(input);\n  return { fee, amount: Math.max(0, input.paidIn - fee) };",
    replace: "  const fee = feeOnReturn(input);\n  return { fee, amount: Math.max(0, input.paidIn) };",
    expect: "C10",
  },
  {
    id: "C11",
    law: "a break can never cover a week they paid for",
    file: "lib/participation-close.ts",
    find: "  const lastCounted = p.closedAtWeek ?? p.lastWeekWithMoney ?? p.startWeek - 1;",
    replace: "  const lastCounted = p.startWeek - 1;",
    expect: "C11",
  },
  {
    id: "C12",
    law: "every reader agrees with the centre",
    file: "lib/dashboard.ts",
    find: "  const currentlyHeld = livePosition({ collected: totalReceived, handedOut: totalPaidOut });",
    replace: "  const currentlyHeld = totalReceived;",
    expect: "C12",
  },
  {
    id: "C14",
    law: "a closed cycle is read-only",
    file: "app/actions/cycle-position.ts",
    find: "    const frozen = frozenCycleRefusal(p.cycle);",
    replace: "    const frozen = null;",
    expect: "C14",
  },
  {
    id: "C16",
    law: "a cycle running long keeps working",
    file: "lib/commitment.ts",
    find: "  if (last === 0) return currentWeekNumber(input.cycleStartDate, input.today);",
    replace: "  if (last === 0) return currentWeekNumber(input.cycleStartDate, input.today);\n  if (last > 20) return 20;",
    expect: "C16",
  },
  {
    id: "C19",
    law: "commitment is capped to the cycle",
    file: "lib/standing.ts",
    find: "    missingWeekRows: Math.max(0, input.weeksCommitted - windowWeeks.length),",
    replace: "    missingWeekRows: 0,",
    expect: "C19",
  },
  {
    id: "C8",
    law: "one allocation engine, oldest debt first",
    file: "lib/allocation.ts",
    find: "  for (const week of weeks) {",
    replace: "  for (const week of [...weeks].reverse()) {",
    expect: "C8",
  },
  {
    id: "C13",
    law: "a pinned settlement replays onto its week only",
    file: "lib/standing.ts",
    find: "    const applied = Math.min(pinned, w.amountDue);",
    replace: "    const applied = 0;",
    expect: "C13",
  },
  {
    id: "C17",
    law: "still-to-save is not overdue",
    file: "lib/standing.ts",
    find: "    amountOutstanding: outstanding,",
    replace: "    amountOutstanding: outstanding + 1,",
    expect: "C17",
  },
  {
    id: "C18",
    law: "a stated figure equals its derivation",
    file: "lib/engine.ts",
    find: "    totalPaid: input.totalPaid,\n    weeksCredited: credited,",
    replace: "    totalPaid: input.totalPaid + 1,\n    weeksCredited: credited,",
    expect: "C18",
  },
  {
    id: "C20",
    law: "stored week dates are authoritative",
    file: "lib/commitment.ts",
    skip: "structurally unviolatable in one line — NO money path reads cycleStartDate, which is the law itself. C20 proves its own non-vacuity instead: it asserts the start date DID move the display clock while moving no money figure.",
    expect: "C20",
  },
];

const run = (pattern) => {
  try {
    execSync(`npx vitest run lib/conservation.test.ts -t "${pattern}"`, {
      stdio: "pipe",
      encoding: "utf8",
    });
    return { failed: false };
  } catch (e) {
    return { failed: true, out: String(e.stdout ?? "") };
  }
};

const BEFORE = execSync("git status --porcelain", { encoding: "utf8" }).trim();
const results = [];
for (const p of PLANTS) {
  if (p.skip) {
    results.push({ id: p.id, law: p.law, status: "SKIPPED", note: p.skip });
    continue;
  }
  const original = readFileSync(p.file, "utf8");
  if (!original.includes(p.find)) {
    results.push({ id: p.id, law: p.law, status: "PLANT SITE NOT FOUND", note: p.find.slice(0, 60) });
    continue;
  }
  try {
    writeFileSync(p.file, original.replace(p.find, p.replace));
    const r = run(p.expect);
    results.push({
      id: p.id,
      law: p.law,
      status: r.failed ? "RED (caught)" : "***GREEN — THE GUARD DID NOT NOTICE***",
    });
  } finally {
    writeFileSync(p.file, original);
  }
}

console.log("\nINVARIANT   STATUS                                LAW");
console.log("-".repeat(100));
let bad = 0;
for (const r of results) {
  if (r.status.startsWith("***") || r.status === "PLANT SITE NOT FOUND") bad++;
  console.log(`${r.id.padEnd(11)} ${r.status.padEnd(37)} ${r.law}${r.note ? `  (${r.note})` : ""}`);
}
console.log("-".repeat(100));

const after = execSync("git status --porcelain", { encoding: "utf8" }).trim();
const leaked = after !== BEFORE;
console.log(
  leaked
    ? "A PLANT LEAKED — the tree differs from how this run found it."
    : "Every plant restored — the tree is exactly as this run found it.",
);
process.exit(bad === 0 && !leaked ? 0 : 1);
