// Import the real Cycle 1 from equb-migration-export.json (project root).
// Idempotent: aborts if the cycle already exists, and every PaymentEvent
// carries a deterministic idempotencyKey. EVERYTHING runs in ONE serializable
// transaction; the expected verification figures are checked INSIDE the
// transaction and any mismatch rolls the whole import back (D-2: live data
// migrates intact — wrong data is never committed).
//
// Run:  npx tsx scripts/import-cycle.mts
import { readFileSync, existsSync } from "node:fs";
import { config } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../lib/generated/prisma/client";
import { splitIntoLuckyNumbers } from "../lib/money";

config({ path: ".env.local", quiet: true });

const FILE = "equb-migration-export.json";
const CYCLE_NAME = "Cycle 1 2026";

// The figures the import MUST reproduce (from the export's own books).
const EXPECT = {
  members: 26,
  weeks: 20,
  luckyNumbers: 29,
  payments: 520,
  draws: 10,
  payouts: 14,
  totalCollectedCents: 19_717_500, // $197,175.00
  totalPaidOutCents: 12_495_000, // $124,950.00
  currentlyHeldCents: 7_222_500, // $72,225.00
};

if (!existsSync(FILE)) {
  console.error(
    `${FILE} not found at the project root. Place the export file there and re-run:\n  npx tsx scripts/import-cycle.mts`,
  );
  process.exit(1);
}

// ————— strict readers: fail loudly, never guess —————
function fail(msg: string): never {
  console.error(`IMPORT ABORTED (nothing written): ${msg}`);
  process.exit(1);
}
function req<T>(obj: Record<string, unknown>, keys: string[], where: string): T {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  fail(`missing ${keys.join("|")} in ${where}; present keys: ${Object.keys(obj).join(", ")}`);
}
function opt<T>(obj: Record<string, unknown>, keys: string[]): T | null {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  return null;
}
/** Optional string; empty/whitespace becomes null. */
function str(obj: Record<string, unknown>, keys: string[]): string | null {
  const v = opt<unknown>(obj, keys);
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function cents(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${where} must be a non-negative integer in CENTS, got ${JSON.stringify(value)}`);
  }
  return value;
}
function date(value: unknown, where: string): Date {
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) fail(`${where} is not a valid date: ${JSON.stringify(value)}`);
  return d;
}
function mapMethod(raw: unknown): "ZELLE" | "CASH" | "OTHER" | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const m = String(raw).toUpperCase();
  if (m === "ZELLE") return "ZELLE";
  if (m === "CASH") return "CASH";
  return "OTHER";
}

const raw = JSON.parse(readFileSync(FILE, "utf8"));
const cycleContext = req<Record<string, unknown>>(raw, ["cycleContext"], "export root");
const weeksIn = req<Record<string, unknown>[]>(raw, ["weeks"], "export root");
const membersIn = req<Record<string, unknown>[]>(raw, ["members"], "export root");
const paymentsIn = req<Record<string, unknown>[]>(raw, ["payments"], "export root");
const collectionsIn = req<Record<string, unknown>[]>(raw, ["collections"], "export root");

const startDate = date(req(cycleContext, ["EQUB_START", "startDate"], "cycleContext"), "EQUB_START");
const totalWeeks = req<number>(cycleContext, ["TOTAL_WEEKS", "totalWeeks"], "cycleContext");
if (totalWeeks !== EXPECT.weeks) fail(`TOTAL_WEEKS is ${totalWeeks}, expected ${EXPECT.weeks}`);
if (weeksIn.length !== EXPECT.weeks) fail(`weeks array has ${weeksIn.length}, expected ${EXPECT.weeks}`);
if (membersIn.length !== EXPECT.members) fail(`members array has ${membersIn.length}, expected ${EXPECT.members}`);
if (paymentsIn.length !== EXPECT.payments) fail(`payments array has ${paymentsIn.length}, expected ${EXPECT.payments}`);
if (collectionsIn.length !== EXPECT.payouts) fail(`collections array has ${collectionsIn.length}, expected ${EXPECT.payouts}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// Idempotency: the cycle's existence marks a completed import (partial
// states are impossible — one transaction).
const existing = await prisma.cycle.findFirst({ where: { name: CYCLE_NAME } });
if (existing) {
  console.log(`"${CYCLE_NAME}" already exists (${existing.id}) — nothing to do. Import is idempotent.`);
  await prisma.$disconnect();
  process.exit(0);
}

const UNIT_AMOUNT = 100_000;

try {
  const summary = await prisma.$transaction(
    async (tx) => {
      // ————— Cycle + weeks —————
      const cycle = await tx.cycle.create({
        data: {
          name: CYCLE_NAME,
          startDate,
          plannedWeeks: totalWeeks,
          unitAmount: UNIT_AMOUNT,
          feePercent: 2.0,
          status: "ACTIVE",
        },
      });
      const weekByNumber = new Map<number, { id: string; date: Date }>();
      for (const w of weeksIn) {
        const weekNumber = req<number>(w, ["weekNumber", "week"], "week");
        const created = await tx.week.create({
          data: {
            cycleId: cycle.id,
            weekNumber,
            date: date(req(w, ["date"], `week ${weekNumber}`), `week ${weekNumber} date`),
            isSkipped: opt<boolean>(w, ["isSkipped", "skipped"]) ?? false,
            notes: opt<string>(w, ["notes"]) ?? null,
          },
        });
        weekByNumber.set(weekNumber, created);
      }

      // ————— Members: Person + Participation + LuckyNumbers —————
      const participationByWheel = new Map<number, string>();
      const luckyIdByNumber = new Map<number, string>();
      let luckyCount = 0;
      for (const m of membersIn) {
        const wheelNumber = req<number>(m, ["wheelNumber", "luckyNumber"], "member");
        const weeklyAmount = cents(
          req(m, ["weeklyAmount", "weeklyAmountCents"], `member #${wheelNumber}`),
          `member #${wheelNumber} weeklyAmount`,
        );
        if (weeklyAmount < 10_000) {
          fail(
            `member #${wheelNumber} weeklyAmount ${weeklyAmount} looks like dollars, not cents — aborting rather than importing 100x-wrong money`,
          );
        }
        const person = await tx.person.create({
          data: {
            nameAmharic: String(req(m, ["nameAmharic"], `member #${wheelNumber}`)),
            nameEnglishFirst: String(req(m, ["nameEnglishFirst", "firstName"], `member #${wheelNumber}`)),
            nameEnglishLast: str(m, ["nameEnglishLast", "lastName"]),
            phone: str(m, ["phone"]),
          },
        });
        const participation = await tx.participation.create({
          data: {
            cycleId: cycle.id,
            personId: person.id,
            weeklyAmount,
            startWeek: 1,
            weeksCommitted: totalWeeks,
          },
        });
        participationByWheel.set(wheelNumber, participation.id);

        const amounts = splitIntoLuckyNumbers(weeklyAmount, UNIT_AMOUNT);
        const extra = opt<number>(m, ["extraWheelNumber"]);
        const numbers = [wheelNumber, ...(extra !== null ? [extra] : [])];
        if (numbers.length !== amounts.length) {
          fail(
            `member #${wheelNumber}: split of ${weeklyAmount} gives ${amounts.length} numbers but export lists ${numbers.length} (extraWheelNumber ${extra})`,
          );
        }
        for (let i = 0; i < amounts.length; i++) {
          const n = await tx.luckyNumber.create({
            data: {
              participationId: participation.id,
              cycleId: cycle.id,
              number: numbers[i],
              amount: amounts[i],
            },
          });
          luckyIdByNumber.set(numbers[i], n.id);
          luckyCount++;
        }
      }

      // ————— Payments: stored facts only (LATE is derived, never stored) —————
      let paymentCount = 0;
      let collectedCents = 0;
      for (const p of paymentsIn) {
        const weekNumber = req<number>(p, ["weekNumber", "week"], "payment");
        const wheel = req<number>(
          p,
          ["memberWheelNumber", "luckyNumber", "wheelNumber"],
          `payment week ${weekNumber}`,
        );
        const status = String(req(p, ["status"], `payment ${weekNumber}/${wheel}`)).toUpperCase();
        const participationId = participationByWheel.get(wheel);
        const week = weekByNumber.get(weekNumber);
        if (!participationId || !week) fail(`payment references unknown member #${wheel} or week ${weekNumber}`);

        let amountPaid = 0;
        let isDeferred = false;
        if (status === "PAID") {
          // The row's own weekly amount is authoritative — it survives any
          // mid-cycle rate change that the member list cannot represent.
          amountPaid = cents(
            req(p, ["memberWeeklyAmount"], `paid ${weekNumber}/${wheel}`),
            `payment ${weekNumber}/${wheel} memberWeeklyAmount`,
          );
        } else if (status === "PARTIAL") {
          amountPaid = cents(req(p, ["paidAmount", "amountPaid"], `partial ${weekNumber}/${wheel}`), "paidAmount");
        } else if (status === "DEFERRED") isDeferred = true;
        else if (status !== "PENDING" && status !== "LATE") {
          fail(`payment ${weekNumber}/${wheel} has unknown status ${status}`);
        }

        const method = mapMethod(opt(p, ["method"]));
        const paidAtRaw = opt(p, ["paidAt", "date"]);
        const paidAt = paidAtRaw !== null ? date(paidAtRaw, `payment ${weekNumber}/${wheel} paidAt`) : null;
        const payment = await tx.payment.create({
          data: {
            weekId: week.id,
            participationId,
            amountPaid,
            isDeferred,
            method,
            paidAt,
            notes: str(p, ["notes"]),
          },
        });
        paymentCount++;
        collectedCents += amountPaid;

        if (amountPaid > 0) {
          const event = await tx.paymentEvent.create({
            data: {
              participationId,
              amount: amountPaid,
              method,
              receivedAt: paidAt ?? week.date,
              idempotencyKey: `import-${weekNumber}-${wheel}`,
              notes: "Imported from the old app",
            },
          });
          await tx.paymentAllocation.create({
            data: { eventId: event.id, paymentId: payment.id, amount: amountPaid },
          });
        }
      }

      // ————— Draws: a Slot holding the winner numbers, then the Draw —————
      let drawCount = 0;
      for (const w of weeksIn) {
        const weekNumber = req<number>(w, ["weekNumber", "week"], "week");
        const winners = opt<number[]>(w, ["winnerNumbers", "winners"]);
        if (!winners || winners.length === 0) continue;
        const slot = await tx.slot.create({
          data: { cycleId: cycle.id, position: weekNumber },
        });
        for (const n of winners) {
          const luckyId = luckyIdByNumber.get(n);
          if (!luckyId) fail(`week ${weekNumber} winner #${n} is not a known lucky number`);
          await tx.slotMember.create({ data: { slotId: slot.id, luckyNumberId: luckyId } });
        }
        await tx.draw.create({
          data: { weekId: weekByNumber.get(weekNumber)!.id, slotId: slot.id, drawnAt: weekByNumber.get(weekNumber)!.date },
        });
        drawCount++;
      }

      // ————— Payouts from collections —————
      let payoutCount = 0;
      let paidOutCents = 0;
      for (const c of collectionsIn) {
        const wheel = req<number>(c, ["luckyNumber", "wheelNumber", "winnerNumber"], "collection");
        const luckyId = luckyIdByNumber.get(wheel);
        if (!luckyId) fail(`collection references unknown lucky number #${wheel}`);
        const status = String(req(c, ["status"], `collection #${wheel}`)).toUpperCase();
        if (status !== "COLLECTED" && status !== "PENDING") {
          fail(`collection #${wheel} has unknown status ${status}`);
        }
        const collectedAtRaw = opt(c, ["collectedAt", "paidAt"]);
        const draw = await tx.draw.findFirst({
          where: { slot: { members: { some: { luckyNumberId: luckyId } } } },
        });
        const payout = await tx.payout.create({
          data: {
            luckyNumberId: luckyId,
            drawId: draw?.id ?? null,
            grossAmount: cents(req(c, ["computedGrossCents"], `collection #${wheel}`), "computedGrossCents"),
            feeAmount: cents(req(c, ["computedFeeCents"], `collection #${wheel}`), "computedFeeCents"),
            netAmount: cents(req(c, ["computedNetCents"], `collection #${wheel}`), "computedNetCents"),
            status: status as "COLLECTED" | "PENDING",
            method: mapMethod(opt(c, ["method"])),
            paidAt: collectedAtRaw !== null ? date(collectedAtRaw, `collection #${wheel} collectedAt`) : null,
            notes: str(c, ["notes"]),
          },
        });
        payoutCount++;
        if (payout.status === "COLLECTED") paidOutCents += payout.netAmount;
      }

      // ————— VERIFY inside the transaction; mismatch rolls everything back —————
      const held = collectedCents - paidOutCents;
      const figures = {
        members: membersIn.length,
        weeks: weeksIn.length,
        luckyNumbers: luckyCount,
        payments: paymentCount,
        draws: drawCount,
        payouts: payoutCount,
        totalCollectedCents: collectedCents,
        totalPaidOutCents: paidOutCents,
        currentlyHeldCents: held,
      };
      const mismatches = (Object.keys(EXPECT) as (keyof typeof EXPECT)[]).filter(
        (k) => figures[k] !== EXPECT[k],
      );
      if (mismatches.length > 0) {
        throw new Error(
          `VERIFICATION FAILED — rolling back. ` +
            mismatches.map((k) => `${k}: got ${figures[k]}, expected ${EXPECT[k]}`).join("; "),
        );
      }
      return figures;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 30_000,
      timeout: 300_000,
    },
  );

  const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  console.log("IMPORT COMMITTED AND VERIFIED:");
  console.log(`  members        ${summary.members}`);
  console.log(`  weeks          ${summary.weeks}`);
  console.log(`  lucky numbers  ${summary.luckyNumbers}`);
  console.log(`  payments       ${summary.payments}`);
  console.log(`  draws          ${summary.draws}`);
  console.log(`  payouts        ${summary.payouts}`);
  console.log(`  total collected  ${usd(summary.totalCollectedCents)}`);
  console.log(`  total paid out   ${usd(summary.totalPaidOutCents)}`);
  console.log(`  currently held   ${usd(summary.currentlyHeldCents)}`);
} catch (e) {
  console.error("IMPORT ROLLED BACK — nothing was committed.");
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
