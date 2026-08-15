# Financial Audit — Pass 1: The Money Map

## Why this audit exists

The audit was triggered by the `/admin/this-week` **Short $0** report on week 11. The
"Short" card computed `expected − received` where `received` was every cent recorded
against that week's payment rows, while its label promised "what never came in". Money
paid ahead by members who were already covered netted against money genuinely missing,
so the card read `$0` while two in-window members still owed `$750` between them. The
arithmetic and the words on the card were describing two different quantities.

That is a map problem before it is a bug problem. Nobody could say, from the code alone,
how many different things in this platform are called "expected", how many are called
"received", or which one a given screen was showing.

## What Pass 1 is

Pass 1 **describes**. It does not judge, does not rank, does not propose fixes, and does
not call anything a bug. Where a quantity is computed in more than one place, that fact
is **recorded** and the locations are listed — which of them is right is explicitly out
of scope. Where two names clearly mean the same money, that is recorded as a suspected
synonym, not as a defect.

Scope is money and standing only: any value representing money, amounts owed, amounts
owed to a member, fees, payouts, balances, or a member's position in the cycle (current
week, finish week, weeks credited, weeks behind, status). Pagination, colours, sort
orders and counts of unrelated things are out of scope.

Every claim carries a `file:line`. Where a source could not be established, the document
says **SOURCE NOT FOUND** rather than guessing; all of those are collected again in
*Gaps in this map*.

Money is stored in **integer CENTS** everywhere except one column: `Cycle.feePercent`
is a `Float` percentage (`prisma/schema.prisma:150`, default `2.0`). Every other
exception found is called out in the row or entry that carries it.

Ground truth for the domain rules is `EQUB_GROUND_TRUTH.md`; §2.14 is the
money-is-truth rule (a stored value that could be derived is drift unless the schema or
the rules say otherwise).

## What Passes 2 and 3 will do

- **Pass 2 — integrity.** Takes the *Flagged for Pass 2* list and the *Gaps* list and
  asks, per quantity, whether the implementations agree, and where they cannot.
- **Pass 3 — display.** Takes the *surfaces* recorded against every quantity here and
  asks whether the words on the screen match the arithmetic behind them — the class of
  problem that produced the trigger bug.

---

# Part A — The Stored Truth

**71 stored columns** are money-bearing, standing-bearing, or a decision/calendar fact
that money derives from. All amounts are integer cents unless the row says otherwise.

Two independent sweeps produced this table; it is deduplicated by `Model.column`, with
`written by` lists unioned. Where the two sweeps classified a column's **kind**
differently, both labels are shown as `A / B (sweeps disagree)` — the disagreement itself
is data for Pass 2 and is repeated in *Gaps in this map*.

Columns marked **WRITER NOT RECORDED** had no write site captured by either sweep. That
is a gap in this map, not a claim that nothing writes them.

## Cycle

| Column | Type | Kind | Meaning | Schema | Written by |
|---|---|---|---|---|---|
| `startDate` | DateTime | calendar-fact | The real calendar day the cycle began — the day week 1 falls on. Every week date, the current week, and every "has this window closed" test descends from it. §2.14 names current week as derived from cycle start + today, never stored. | `prisma/schema.prisma:147` | `app/actions/cycles.ts:129`, `app/actions/edits.ts:2220`, `scripts/import-cycle.mts:120`. `edits.ts:2220` (updateCycle) moves the start date but deliberately leaves existing `Week.date` rows alone (audit summary at `edits.ts:2243`). |
| `plannedWeeks` | Int | organizer-decision / calendar-fact (sweeps disagree) | How many weeks the organizer committed the group to (the plan, not the actual length). Also the default cap on a member's `weeksCommitted` (§2.22). §2.7 tracks planned vs actual separately; actual length is the count of Week rows, which live data shows can exceed this (23 weeks generated on a 20-week plan). | `prisma/schema.prisma:148` | `app/actions/cycles.ts:130`, `app/actions/edits.ts:2221`, `scripts/import-cycle.mts:121`. Shrinking it deletes Week rows at `edits.ts:2214` after refusing when any removed week carries money/deferral/draw (`edits.ts:2189-2213`). |
| `unitAmount` | Int (cents) | organizer-decision / money-fact (sweeps disagree) | The unit a weekly contribution is sliced into when creating lucky numbers. Default 100000 = $1,000. | `prisma/schema.prisma:149` | `app/actions/cycles.ts:131`, `app/actions/edits.ts:2222`, `scripts/import-cycle.mts:122`. Feeds `splitIntoLuckyNumbers` (`lib/money.ts:55`), whose outputs sum to `Participation.weeklyAmount`. Import hardcodes `100_000` at `scripts/import-cycle.mts:111` and uses it at `:176`. |
| `feePercent` | Float | organizer-decision / money-fact (sweeps disagree) | The management fee the organizer charges, as a PERCENT of gross. **NOT CENTS** — the only non-cent money column in the schema (default 2.0). §2.30 requires it be read from the cycle, never a constant. | `prisma/schema.prisma:150` | `app/actions/cycles.ts:132`, `app/actions/edits.ts:2223`, `scripts/import-cycle.mts:123`. Read by `calculatePayout` at `app/actions/wheel.ts:688`, `app/actions/week-winners.ts:234`, `app/actions/manual-payout.ts:465`. |
| `status` | CycleStatus | organizer-decision | DRAFT / ACTIVE / CLOSED — whether this cycle is the live one and whether its books are frozen. CLOSED freezes every money write in the cycle. Schema comment 159-162: a raw-SQL partial unique index `one_active_cycle` enforces at most one ACTIVE row, which Prisma cannot express. | `prisma/schema.prisma:151` | Four writers: `app/actions/cycles.ts:133` (DRAFT or ACTIVE at creation), `app/actions/cycles.ts:319` (activates a draft), `app/actions/cycle-close.ts:376` (CLOSED), `scripts/import-cycle.mts:124`. Cycle rows are also deleted at `cycle-close.ts:491` and `cycles.ts:394`. |
| `closedAt` | DateTime? | calendar-fact | When the cycle was actually closed — the moment shortfalls were crystallised onto the carried ledger. Copied into `CycleArchive.closedAt` (`schema:491`) so the record survives cycle deletion. | `prisma/schema.prisma:153` | `app/actions/cycle-close.ts:376` |

## Week

| Column | Type | Kind | Meaning | Schema | Written by |
|---|---|---|---|---|---|
| `weekNumber` | Int | calendar-fact | The cycle-relative week index, unique per cycle. Every window, arrears and allocation calculation is expressed in these. Member-facing text must translate it into the MEMBER's own numbering (§2.28, `lib/member-week-dates.ts`). | `prisma/schema.prisma:169` | `app/actions/cycles.ts:136`, `lib/participation-rules.ts:80-81`, `scripts/import-cycle.mts:133`. `participation-rules.ts:81` (`ensureWeeksThrough`) generates override weeks past `plannedWeeks`; `pruneOrphanOverrideWeeks` deletes them again at `participation-rules.ts:141`. |
| `date` | DateTime | calendar-fact | The actual calendar date of this week — the stored date the elapsed / window-closed test reads. `lib/contribution.ts:11-12` and `:70-72` state OVERDUE depends on each week's own stored date, so this is the calendar half of every LATE and behind derivation. | `prisma/schema.prisma:170` | `app/actions/cycles.ts:137`, `lib/participation-rules.ts:80-81`, `app/actions/edits.ts:1713`, `scripts/import-cycle.mts:134`. Three generators (`cycles.ts:135` generateWeekDates, `participation-rules.ts:75` nextWeekDates, import) plus one hand edit (`edits.ts:1713`, bounded by neighbouring weeks at `edits.ts:1702`). |
| `isSkipped` | Boolean | organizer-decision | The organizer declared this week not collected — a cycle-wide week that owes nothing from anybody. Allocation skips it entirely. | `prisma/schema.prisma:171` | `app/actions/edits.ts:1713`, `scripts/import-cycle.mts:135`. Toggling it re-runs `rebuildParticipationPayments` for EVERY participation in the cycle (`edits.ts:1717-1725`). `edits.ts` doc at 1665 says there is no skip control in the UI. Read as a per-week input by the allocation engine (`lib/rebuild.ts:48, :91, :111`) and by paymentStatus (`lib/derived.test.ts:71`). |

## Participation

| Column | Type | Kind | Meaning | Schema | Written by |
|---|---|---|---|---|---|
| `weeklyAmount` | Int (cents) | organizer-decision / money-fact (sweeps disagree) | What this member agreed to pay each week in THIS cycle. The divisor for weeks credited and the multiplicand for gross and fee. Chosen per cycle, not per person forever (§2.5). | `prisma/schema.prisma:186` | FIVE production writers: `app/actions/participations.ts:138`, `app/actions/edits.ts:534` (direct edit), and `edits.ts:811`, `:986`, `:1086` (reconcileWeeklyAmount writing it back from the sum of the member's `LuckyNumber.amount` rows when a number is edited/added/deleted — each also calls `rebuildParticipationPayments`). Plus `scripts/import-cycle.mts:169`, `scripts/repro-participation-shorten.mts:145`. |
| `startWeek` | Int | calendar-fact | The first cycle week this member is expected to pay — the left edge of their window. Default 1. With `weeksCommitted` it defines the window every derived figure asks "is this week inside". | `prisma/schema.prisma:187` | `app/actions/participations.ts:139`, `app/actions/edits.ts:535`, `scripts/import-cycle.mts:170`, `scripts/repro-participation-shorten.mts:146` |
| `weeksCommitted` | Int | organizer-decision | How many weeks this member signed up for. Fixes both their finish week and their fee. §2.30/D-41: fee gross = weeklyAmount × weeksCommitted, never weeks paid. Capped to the cycle end by default, overridable deliberately (§2.22). | `prisma/schema.prisma:188` | `app/actions/participations.ts:140`, `app/actions/edits.ts:536`, `scripts/import-cycle.mts:171`, `scripts/repro-participation-shorten.mts:147`. `edits.ts:526-530` calls `ensureWeeksThrough` before the write; `edits.ts:545` prunes orphan override weeks after it. |
| `status` | ParticipationStatus | organizer-decision / derived-looking (sweeps disagree) | ACTIVE / CLOSED — whether this member is still contributing in this cycle; the flag every wheel-pool, messaging and portal filter reads. Schema comment `prisma/schema.prisma:323-325` calls it "the denormalised current state … kept in step with the open break, never a second source of truth" — the authoritative fact is the open `ParticipationBreak` row. Recorded, not judged: it runs alongside `closedAtWeek`/`closedAt` and the three can legitimately disagree — `lib/participation-close.ts:144` documents historical rows with status CLOSED and `closedAtWeek` null, and `:168-169` falls back through `closedAtWeek ?? lastWeekWithMoney ?? startWeek-1`. | `prisma/schema.prisma:189` | `app/actions/participation-close.ts:329`, `app/actions/participation-close.ts:485`, `app/actions/participation-removal.ts:239` (writes CLOSED with `closedAtWeek` left NULL, i.e. without an accompanying break row). |
| `closedAtWeek` | Int? | organizer-decision / derived-looking (sweeps disagree) | The last week they are expected to pay — where their window was truncated when they stopped (inclusive). Schema comment 205-209: this one fact removes them from expected, behind, outstanding and the lucky-number pool at once (§2.18, §2.27). Same denormalisation as `status`: the break row's `fromWeek − 1` is the same number. | `prisma/schema.prisma:210` | `app/actions/participation-close.ts:330`, `app/actions/participation-close.ts:486`, `app/actions/participation-removal.ts:239`. `participation-close.ts:317` writes `fromWeek = closingAtWeek + 1`; reactivate re-derives `closedAtWeek` from the break at `participation-close.ts:459`. |
| `closedAt` | DateTime? | organizer-decision | When the organizer closed this participation. The timestamp of the decision; `closedAtWeek` is the money-bearing half. | `prisma/schema.prisma:215` | **WRITER NOT RECORDED** |
| `carryIntent` | String? | organizer-decision | What the organizer decided about this person's carried balance when adding them to this cycle: `leave`, `deduct` or `settle-now`. Schema comment 216-224: an INTENTION only — it decides whether the deduction offer arrives pre-ticked. Applying it always needs fresh confirmation (D-23 never auto-deducts). | `prisma/schema.prisma:225` | `app/actions/ledger.ts:340`, `app/actions/carry-deduction.ts:242` (clears it to null once the deduction is applied). |
| `carryIntentAt` | DateTime? | organizer-decision | When that carry decision was made. | `prisma/schema.prisma:226` | `app/actions/ledger.ts:341`, `app/actions/carry-deduction.ts:242` |
| `carryIntentAmount` | Int? (cents) | **derived-looking** | The carried balance at the moment the carry decision was taken. DRIFT RISK BY ITS OWN ADMISSION — schema comment 227-228: "The balance at the moment of the choice. The live balance may differ, and the LIVE one is what may be offered. Kept for the record only." The live balance is derived from LedgerEntry rows (`schema:498-500` "The running total is derived, never stored"), recomputed by `ledgerBalance` (`lib/ledger.ts:23`). RECORDED, NOT JUDGED. | `prisma/schema.prisma:229` | `app/actions/ledger.ts:342`, `app/actions/carry-deduction.ts:242` |

## ParticipationBreak

| Column | Type | Kind | Meaning | Schema | Written by |
|---|---|---|---|---|---|
| `fromWeek` | Int | calendar-fact / organizer-decision (sweeps disagree) | First week NOT counted — the week their expectation stops during a break; their window ends at `fromWeek − 1`. Schema comment 241-259: a HOLE in a window, not a truncation; restoring those weeks would invent arrears for weeks nobody was ever asked about. | `prisma/schema.prisma:264` | `app/actions/participation-close.ts:317`, `app/actions/participation-close.ts:453`, `prisma/migrations/20260811020000_participation_breaks/migration.sql:38-49` — the migration BACKFILLS it from `COALESCE(closedAtWeek, MAX(weekNumber where amountPaid>0), startWeek-1) + 1` for every CLOSED participation, i.e. a money-derived value written into a stored column. |
| `toWeek` | Int? | calendar-fact / organizer-decision (sweeps disagree) | Last week not counted. Null while the member is still stopped. Schema comment 252-256: closing the break is what "they are contributing again" means, which makes reactivation forward-only by construction. | `prisma/schema.prisma:266` | `app/actions/participation-close.ts:318`, `:454`, `:480`, `prisma/migrations/20260811020000_participation_breaks/migration.sql:50` |
| `endedAt` | DateTime? | organizer-decision / calendar-fact (sweeps disagree) | When the break was closed / the member resumed. Its null-ness parallels `toWeek`'s; the timestamp itself is its own fact. `startedAt` (`schema:271`) is a plain creation timestamp and is not money-bearing. | `prisma/schema.prisma:272` | `app/actions/participation-close.ts:480` |

## LuckyNumber

| Column | Type | Kind | Meaning | Schema | Written by |
|---|---|---|---|---|---|
| `cycleId` | String | **derived-looking** | NOT MONEY; listed because the schema documents it as a denormalisation. Comment 278-281: "cycleId is denormalized from participation.cycleId — it exists so the database itself can enforce that a lucky number is unique within a cycle. Every code path that creates lucky numbers must set it to the participation's cycle." | `prisma/schema.prisma:285` | **WRITER NOT RECORDED** |
| `number` | Int | organizer-decision | The member's wheel number — the unit that wins draws and receives payouts. Unique per cycle (`@@unique([cycleId, number])`, `schema:293`). Payouts and fees are per lucky number, never once on the pot (§2.30). | `prisma/schema.prisma:286` | `app/actions/participations.ts:166`, `app/actions/edits.ts:862`, `app/actions/edits.ts:979`, `lib/number-conflict.ts:106`, `:115`, `:150`, `:154`, `:158`, `scripts/import-cycle.mts:189`. `number-conflict.ts` writes it five times across two helpers: `renumberHolder` (106 park, 115 destination) and `swapNumbers` (150 park, 154 holder takes, 158 mover takes) — each a multi-step park-and-move to keep the unique index satisfied. |
| `amount` | Int (cents) | derived-looking / money-fact (sweeps disagree) | The share of the member's weekly contribution carried by this one number. Its payout gross is this × weeks committed. Recomputable: `splitIntoLuckyNumbers(weeklyAmount, unitAmount)` (`lib/money.ts:55`) is a deterministic split whose outputs sum to `Participation.weeklyAmount` — stated at `lib/participation-removal.ts:90` and `app/admin/(protected)/people/[id]/participation-editor.tsx:1011`. Ground truth §4.2 money finding 5 concerns an edit to this column moving the payout. RECORDED, NOT JUDGED. | `prisma/schema.prisma:287` | `app/actions/participations.ts:167`, `app/actions/edits.ts:862`, `app/actions/edits.ts:980`, `scripts/import-cycle.mts:190`. The sum of a participation's amounts is reconciled against `Participation.weeklyAmount` by `reconcileWeeklyAmount` at `edits.ts:799, :967, :1064` — the same quantity expressed in two places. |

## Payment (one member, one week)

| Column | Type | Kind | Meaning | Schema | Written by |
|---|---|---|---|---|---|
| `amountPaid` | Int (cents) | **derived-looking** | How much money is credited against this member's one week. A WEEK AGGREGATE, not a receipt: `lib/rebuild.ts:8-11` calls it a "week aggregate" rebuilt by replaying PaymentEvents through the allocation engine; `:53` zeroes every row and `:64` increments it per allocation, so it equals the sum of its PaymentAllocation rows. `app/actions/payments.ts:243-245` calls it explicitly "a STORED aggregate cache of this week's allocations". The receipt is the stored fact (`schema:326-329`; `lib/contribution.ts:14-16` "never a stored column, so it can never drift"). RECORDED, NOT JUDGED. | `prisma/schema.prisma:301` | THIRTEEN write sites across three independent mechanisms. Incremental: `app/actions/payments.ts:259`, `:264`. Full replay: `lib/rebuild.ts:53` (zeroes every row), `:64`, `:71`. Settlement inc/dec: `lib/draw-settlement.ts:140`, `:147`, `:202`, `:232`. Row created at 0 as a side effect of a non-money edit: `app/actions/edits.ts:1370` (deferral), `:1514` (late mark), `:1598` (note). Plus `scripts/import-cycle.mts:236`. |
| `isDeferred` | Boolean | organizer-decision | The organizer excused the chase for this week. The money is still owed. One of the two decisions §2.14 permits to be stored. §2.29: deferral outranks the manual late mark across all five effects. | `prisma/schema.prisma:302` | `app/actions/edits.ts:1278` (updatePaymentRow, participation editor), `:1371` and `:1377-1379` (setWeekDeferral, from the grid), `:1515` (setWeekLate writes `isDeferred:false` on its create branch), `scripts/import-cycle.mts:237`. Both deferral paths call `rebuildParticipationPayments`; `updatePaymentRow` only when the value changed (`edits.ts:1285`). |
| `markedLateAt` | DateTime? | organizer-decision | WHEN the organizer decided by hand that this week is late, before its calendar window closed. D-40/§2.29, the named carve-out from §2.14. Schema comment 303-313: "a boolean would say the decision exists without saying when it was made, and this is a financial record." | `prisma/schema.prisma:314` | `app/actions/edits.ts:1516` (setWeekLate create), `:1519` (update), `:1378` (cleared when the week is deferred), `lib/rebuild.ts:148` (cleared on any week money fully covers, `rebuild.ts:142-149`). `app/actions/payments.ts` `recordPayment` does NOT call `rebuildParticipationPayments` — recorded, not judged. |
| `markedLateNote` | String? | organizer-decision | The organizer's optional reason for the manual late mark. | `prisma/schema.prisma:315` | `app/actions/edits.ts:1517`, `:1519`, `:1378`, `lib/rebuild.ts:148` |
| `method` | PaymentMethod? | derived-looking / money-fact (sweeps disagree) | How the money that filled this week arrived (ZELLE / CASH / OTHER). A COPY: set from `event.method` when the week row is first created (`lib/rebuild.ts:72`) and thereafter preserved rather than recomputed (`rebuild.ts:17-18` "week-row receipt metadata are preserved; only amounts and allocations are recomputed"). The underlying fact is `PaymentEvent.method` (`schema:334`). RECORDED, NOT JUDGED. | `prisma/schema.prisma:316` | `app/actions/payments.ts:260`, `:266` (only when this is the first money on the row — `firstMoneyOnRow`, `payments.ts:248`), `app/actions/edits.ts:1279`, `lib/rebuild.ts:72`, `scripts/import-cycle.mts:238` |
| `paidAt` | DateTime? | derived-looking / money-fact (sweeps disagree) | When this week was paid. A COPY of `PaymentEvent.receivedAt` at week-row creation (`lib/rebuild.ts:73`), preserved on later rebuilds. RECORDED, NOT JUDGED. | `prisma/schema.prisma:317` | `app/actions/payments.ts:261`, `:266`, `app/actions/edits.ts:1280`, `lib/rebuild.ts:73`, `lib/draw-settlement.ts:148` (uses the draw's `drawnAt`, not a receipt date), `scripts/import-cycle.mts:239` |

## PaymentEvent (the receipt) and PaymentAllocation

| Column | Type | Kind | Meaning | Schema | Written by |
|---|---|---|---|---|---|
| `PaymentEvent.amount` | Int (cents) | **money-fact** | ONE RECEIPT of money actually received from one person. The primary stored money fact of the platform. Schema comment 326-329 "One RECEIPT of money from one person (2.14: the stored fact)"; `lib/contribution.ts:53-58` makes summing these THE definition of total contributed. | `prisma/schema.prisma:333` | `app/actions/payments.ts:212`, `app/actions/edits.ts:511` (resizes a WIN-WEEK SETTLEMENT receipt when the weekly amount changes and credits the difference back to the payout, `edits.ts:513-517`; `edits.ts:510` deletes it when it resizes to zero), `app/actions/edits.ts:1181`, `lib/draw-settlement.ts:128`, `scripts/import-cycle.mts:250`. Receipts are deleted at `edits.ts:1228`, `draw-settlement.ts:205` (unsettleDraw) and `:235` (unsettlePayout). |
| `PaymentEvent.method` | PaymentMethod? | money-fact | How this receipt arrived (ZELLE / CASH / OTHER). | `prisma/schema.prisma:334` | `app/actions/payments.ts:213`, `app/actions/edits.ts:1182`, `lib/draw-settlement.ts:129` (writes null deliberately — settlement money never physically moved), `scripts/import-cycle.mts:251` |
| `PaymentEvent.receivedAt` | DateTime | money-fact | The day the money was actually received — the ordering key for replaying allocation. Replay order is `[receivedAt asc, createdAt asc]` (`lib/rebuild.ts:32`), so this date determines which week each receipt lands on. | `prisma/schema.prisma:335` | `app/actions/payments.ts:214`, `app/actions/edits.ts:1183`, `lib/draw-settlement.ts:130`, `scripts/import-cycle.mts:252` |
| `PaymentEvent.pinnedWeekId` | String? | organizer-decision | Marks this receipt as a payout settlement that must land on ONE named week, bypassing oldest-first allocation. Schema comment 339-347: "pinnedWeekId != null IS the definition of 'this is a settlement receipt'"; unreachable from client input. Honoured at `lib/rebuild.ts:84-102`; read as `SETTLEMENT_EVENT_WHERE` (`lib/draw-settlement.ts:42`). | `prisma/schema.prisma:348` | Single writer: `lib/draw-settlement.ts:133` |
| `PaymentEvent.settlementPayoutId` | String? | money-fact | Which payout funded this settlement receipt — the winner's own week paid out of their pot rather than in cash. This link is what makes the settlement reversible; `schema:513-524` cites it as the model `LedgerEntry.payoutId` was added to copy. | `prisma/schema.prisma:349` | `lib/draw-settlement.ts:134`, `prisma/migrations/20260806010000_settlement_payout_link/migration.sql:24-28` (back-fills it by parsing the idempotencyKey `draw-settle:{drawId}:{payoutId}`, restricted to rows that already carry a `pinnedWeekId`). |
| `PaymentAllocation.amount` | Int (cents) | **derived-looking** | How many cents of one receipt landed on one week's payment row — the event-to-week audit trail. The materialised output of the allocation engine rather than an independently recorded fact: `lib/rebuild.ts:52` deletes every allocation for the participation and `:78-80` recreates them on each rebuild. Sum per event = `PaymentEvent.amount`; sum per payment = `Payment.amountPaid`. RECORDED, NOT JUDGED. | `prisma/schema.prisma:364` | `app/actions/payments.ts:271`, `lib/rebuild.ts:79`, `lib/draw-settlement.ts:154`, `scripts/import-cycle.mts:258` |

## Wheel: Slot, SlotMember, WinnerPlan, WinnerPlanNumber, Draw

| Column | Type | Kind | Meaning | Schema | Written by |
|---|---|---|---|---|---|
| `Slot.position` | Int | organizer-decision | The slot's place in the cycle's wheel arrangement — the ordering the draw runs against. Unique per cycle (`@@unique([cycleId, position])`, `schema:378`). | `prisma/schema.prisma:374` | **WRITER NOT RECORDED** |
| `SlotMember.luckyNumberId` | String | organizer-decision | Which lucky number sits in which slot — i.e. who actually receives money when that slot wins. The pairing the reshuffle rearranges and that §2.3 requires be protected for committed numbers. | `prisma/schema.prisma:385` | **WRITER NOT RECORDED** |
| `WinnerPlan.weekId` | String? | organizer-decision | The week the organizer intends these numbers to win — planning ahead, per §2.3. Schema comment 392-393: "The plan is intent, not state." `onDelete: SetNull` (`schema:402`). | `prisma/schema.prisma:397` | **WRITER NOT RECORDED** |
| `WinnerPlan.mode` | WinnerPlanMode | organizer-decision | ALONE / TOGETHER / OPEN_PARTNER — whether the designated numbers win in the same week or separately. OPEN_PARTNER documented at `schema:634` as "This number wins; the shuffle may attach one random partner (2.3)." | `prisma/schema.prisma:398` | **WRITER NOT RECORDED** |
| `WinnerPlan.status` | WinnerPlanStatus | **derived-looking** | PLANNED / FULFILLED / CANCELLED. FULFILLED mirrors "a Draw exists for this week". `lib/draw-cascade.ts:194-204` describes plans left FULFILLED with zero numbers. RECORDED, NOT JUDGED. | `prisma/schema.prisma:399` | `app/actions/wheel.ts:715` (set at draw time), `lib/draw-cascade.ts:212` (restored to PLANNED when the draw is unwound) |
| `WinnerPlanNumber.luckyNumberId` | String | organizer-decision | Which number is committed to this plan — the intent that reshuffle must not re-pair (§2.3). | `prisma/schema.prisma:410` | **WRITER NOT RECORDED** |
| `Draw.weekId` | String | calendar-fact | The week in which a slot won. One winning slot per week (`@@unique([weekId])`, `schema:433`). Schema comment 417-419: dropping either uniqueness constraint allows a real defect. | `prisma/schema.prisma:422` | `app/actions/wheel.ts:681`, `app/actions/manual-payout.ts:448`, `app/actions/week-winners.ts:486`, `app/actions/edits.ts:1788` (moveDraw — unsettles the old week at `edits.ts:1785` and re-settles the new one at `:1790`, moving money between Payment rows), `scripts/import-cycle.mts:278`. Draws deleted at `wheel.ts:850`, `manual-payout.ts:305`, `lib/draw-cascade.ts:144`. |
| `Draw.slotId` | String | organizer-decision | Which slot won — i.e. which lucky numbers become payouts. A slot wins at most once per cycle (`@@unique([slotId])`, `schema:434`); "everyone receives exactly once" is enforced by that uniqueness. | `prisma/schema.prisma:423` | `app/actions/wheel.ts:681`, `app/actions/manual-payout.ts:448`, `app/actions/week-winners.ts:487`, `app/actions/edits.ts:1859` (changeDrawSlot — refuses outright when any payout hangs off the draw, `edits.ts:1850-1855`), `scripts/import-cycle.mts:278` |
| `Draw.drawnAt` | DateTime | calendar-fact | When the draw actually happened. Used as the settlement payment's `paidAt` (`lib/draw-settlement.ts:148`) and its `receivedAt` (`:130`). | `prisma/schema.prisma:424` | Only `scripts/import-cycle.mts:278` sets it explicitly; every production path takes `@default(now())`. |
| `Draw.assignedManually` | Boolean | organizer-decision | The organizer assigned this payout directly (an emergency, an agreement) rather than the wheel producing it. Schema comment 426-428: both routes are legitimate and behave identically; this only makes the difference visible in the record (§2.2). | `prisma/schema.prisma:429` | `app/actions/manual-payout.ts:448`, `app/actions/week-winners.ts:488` |

## Payout

| Column | Type | Kind | Meaning | Schema | Written by |
|---|---|---|---|---|---|
| `luckyNumberId` | String | money-fact | Which lucky number this payout belongs to. Payouts are per number, never one per pot. §2.30: two numbers means two payouts and two fees; the arithmetic agrees with one combined payout but the record does not, and the record is what the archive keeps. | `prisma/schema.prisma:443` | **WRITER NOT RECORDED** |
| `drawId` | String? | calendar-fact | The draw this payout came from — the only path from a payout to the week it belongs to. Nullable with `onDelete: SetNull` (`schema:456`), so a payout can outlive its draw and then has no week link of its own. | `prisma/schema.prisma:444` | **WRITER NOT RECORDED** |
| `grossAmount` | Int (cents) | derived-looking / money-fact (sweeps disagree) | The gross pot for this number before the fee, as actually charged. §2.30 defines gross = weeklyAmount × weeksCommitted, so it is recomputable from the commitment; schema comment 438-440 stores it deliberately as historical truth "which may predate rule changes; expected values remain derivable". | `prisma/schema.prisma:445` | `app/actions/wheel.ts:695`, `app/actions/week-winners.ts:240`, `app/actions/manual-payout.ts:472` (all three via `calculatePayout` at `wheel.ts:685`, `week-winners.ts:231`, `manual-payout.ts:462`), `app/actions/edits.ts:1979` (takes a figure the ORGANIZER TYPED), `scripts/import-cycle.mts:302` (`computedGrossCents` from the old app's export). |
| `feeAmount` | Int (cents) | derived-looking / money-fact (sweeps disagree) — **stored by deliberate decision** | The management fee actually withheld from this payout. §2.30/D-41: "Once a payout exists, the fee it charged is stored on that payout and is read in preference to the projection. That is the design, not a lapse: a later change to the cycle's fee percent must never silently rewrite a payout that already happened." §2.14's derived table lists "Fee (once drawn)" as stored. The projection it shadows is feePercent × gross (`lib/fee-preview.ts`). | `prisma/schema.prisma:446` | `app/actions/wheel.ts:696`, `app/actions/week-winners.ts:241`, `app/actions/manual-payout.ts:473`, `app/actions/edits.ts:1980` (hand-typed), `scripts/import-cycle.mts:303` |
| `netAmount` | Int (cents) | derived-looking / money-fact (sweeps disagree) | What actually crosses the table. Nominally gross − fee, but schema comment 452-454 says it is also DECREMENTED after the fact by the winner's own-week contribution at draw settlement, and again by a confirmed carried-balance deduction. RECORDED, NOT JUDGED. | `prisma/schema.prisma:447` | TEN write sites — the most-written money column. Creators: `app/actions/wheel.ts:697`, `app/actions/week-winners.ts:242`, `app/actions/manual-payout.ts:474`. Hand-typed edit: `app/actions/edits.ts:1981` (refused when a settlement exists, `edits.ts:1959-1974`). Settlement decrement `lib/draw-settlement.ts:158` and increment `:195`. Carry deduction `app/actions/carry-deduction.ts:206`. Resize credit `app/actions/edits.ts:515`. Reset-to-gross-minus-fee on move `app/actions/week-winners.ts:511`. Import `scripts/import-cycle.mts:304`. Payout rows deleted at `edits.ts:2099`, `week-winners.ts:339`, `wheel.ts:849`, `manual-payout.ts:304`, `participation-removal.ts:254`. |
| `status` | PayoutStatus | organizer-decision | PENDING / COLLECTED — whether the money has actually left the organizer's hands. Load-bearing for the cash position: only COLLECTED counts as paid out (`lib/dashboard.ts:35, :60`; `lib/cycle-position.ts:243, :311`; `lib/cycle-close.ts:214, :235` "A pending payout is money the group is STILL HOLDING"). Ground truth §4.2 money finding 2 concerns an archive counting pending payouts as paid out. | `prisma/schema.prisma:448` | All three creators hardcode PENDING (`wheel.ts:698`, `week-winners.ts:243`, `manual-payout.ts:475`); the ONLY transition to COLLECTED is `updatePayout` (`app/actions/edits.ts:1982`), called from `collections-view.tsx:893` and `waiting-view.tsx:311`. Plus `scripts/import-cycle.mts:305`. |
| `method` | PaymentMethod? | money-fact | How the payout was handed over. | `prisma/schema.prisma:449` | `app/actions/edits.ts:1983`, `scripts/import-cycle.mts:306` |
| `paidAt` | DateTime? | money-fact | When the payout was actually handed over. Set to `draw.drawnAt` on settlement (`lib/draw-settlement.ts:148`). Runs alongside `status`; the two are separate columns. | `prisma/schema.prisma:450` | `app/actions/edits.ts:1984`, `scripts/import-cycle.mts:307` |

## LedgerEntry (the carried balance, person-scoped)

| Column | Type | Kind | Meaning | Schema | Written by |
|---|---|---|---|---|---|
| `type` | LedgerEntryType | money-fact | DEBT (a balance arose), PAYMENT (money actually received against it) or FORGIVEN (the organizer wrote it off). FORGIVEN is an organizer decision recorded as its own fact: `schema:648-653` "It clears the balance exactly like a payment, but it is a different fact and the history must never blur the two — nobody paid this." | `prisma/schema.prisma:504` | NINE creation sites across six files: `app/actions/cycle-close.ts:351` (automatic close), `app/actions/participation-close.ts:347` (early close), `app/actions/carry-deduction.ts:214` (deduction from a payout), `app/actions/ledger.ts:67` (manual payment), `app/actions/ledger.ts:155` (write-off), and four terms-settlement branches in `updateParticipation`: `app/actions/edits.ts:425` (DEBT), `:433` (PAYMENT returned), `:445` (DEBT nothing-returned), `:463` (PAYMENT credit). |
| `amount` | Int (cents) | money-fact | The size of one debt, payment or write-off. The running balance is derived from these rows, never stored (`schema:498-500`). A DEBT entry's amount originates as a computed shortfall at close (`lib/cycle-close.ts:150-163`, `amount: m.outstanding`) but becomes an irreducible stored fact because the ledger outlives the cycle it came from (§2.18) — after cycle deletion nothing can recompute it. No carried-balance total exists anywhere on `Person`. | `prisma/schema.prisma:505` | `app/actions/cycle-close.ts:351`, `app/actions/participation-close.ts:348`, `app/actions/carry-deduction.ts:215`, `app/actions/ledger.ts:68`, `app/actions/ledger.ts:156`, `app/actions/edits.ts:426`, `:434`, `:446`, `:464` (stores `-gap`, a negated value, as a positive PAYMENT amount). Entries are DELETED — the only mutation of a ledger row anywhere — at `lib/carry-reversal.ts:52`, called from `edits.ts:638`, `edits.ts:2094`, `week-winners.ts:465`, `wheel.ts:846`, `participation-removal.ts:249`. Fixture/verification writers: `scripts/lib/production-fixture.mts:274`, `scripts/verify-carry-deduction.mts:61-68` and `:186-194`, `scripts/verify-carry-intent-expiry.mts:88` and `:120`, `scripts/verify-participation-close.mts:222-229`. |
| `description` | String | **derived-looking** | The origin story of the entry in prose — e.g. "Cycle 1 2026 closed — paid 12 of 20 weeks (last payment week 12), $2,000 unpaid". It embeds a COPY of money and standing that also live elsewhere: `lib/cycle-close.ts:159-162` interpolates `formatMoney(m.outstanding)` — the same figure as the `amount` column — plus weeksPaid, weeksCommitted and lastPaymentWeek. §2.18 requires the story be kept, so the prose is the point. RECORDED, NOT JUDGED. | `prisma/schema.prisma:506` | Written at the same nine creation sites as `type`. Text built at `lib/cycle-close.ts:159-162`, `app/actions/participation-close.ts:350-352`, `app/actions/ledger.ts:69` (bakes in "X owed before"), `app/actions/ledger.ts:157-160`, `app/actions/carry-deduction.ts:211-223`; same shape reproduced at `scripts/verify-participation-close.mts:227`, `scripts/verify-carry-deduction.mts:191`, `scripts/lib/production-fixture.mts:274-282`. |
| `method` | PaymentMethod? | money-fact | How a settlement payment arrived. Null for DEBT and FORGIVEN because nothing moved (schema comment 508 states the rule). | `prisma/schema.prisma:509` | Single writer: `app/actions/ledger.ts:70`. `app/actions/carry-deduction.ts:211` creates a PAYMENT entry without a method. |
| `occurredAt` | DateTime | money-fact | The day the ledger event actually happened. Schema comment 510: "The day it HAPPENED, which is not always the day it was typed in" — deliberately distinct from `createdAt` (`schema:512`). | `prisma/schema.prisma:511` | `app/actions/ledger.ts:71` (only when the organizer supplied a date), `app/actions/carry-deduction.ts:217`. The other seven creation sites take `@default(now())`. |
| `payoutId` | String? | money-fact | The payout a carry deduction came out of — the link that makes the deduction reversible. Schema comment 513-524: "A deduction is ONE fact in TWO rows: the payout is smaller AND the person ledger says they paid"; five paths destroy or reset a payout and each previously left an orphan PAYMENT entry with the balance still reading settled. Mirrors `PaymentEvent.settlementPayoutId`. `onDelete: SetNull` (`schema:527`). | `prisma/schema.prisma:525` | Single writer: `app/actions/carry-deduction.ts:221`; read by `lib/carry-reversal.ts:45` to find and delete the entry when the payout is destroyed or reset. |

## Settings, agreements, messages, archive, cash reading

| Column | Type | Kind | Meaning | Schema | Written by |
|---|---|---|---|---|---|
| `Setting.value` | String | organizer-decision | JSON-encoded platform configuration, keyed by `Setting.key`; typed and defaulted at `lib/settings.ts` / `lib/setting-defaults.ts` rather than in the schema. Of the 13 registered keys (`lib/setting-defaults.ts:91-105`) only `closingWaitDays` is money/standing-bearing: the number of days after the final week before closing is offered, and closing is what writes every shortfall onto the carried ledger (`lib/setting-defaults.ts:67-75` — "closing the moment the last week passes turns payments in transit into permanent debts"). `presentationMode` (`:20-23`) filters money OUT of what the server sends but changes no stored figure. No fee, unit amount or weekly amount lives here. | `prisma/schema.prisma:537` | **WRITER NOT RECORDED** |
| `AgreementVersion.body` | String | organizer-decision | The clause template every member signs, with `{placeholders}` — including §4, the fee clause, which states the fee is fixed by what was committed and does not shrink on stopping early. Holds placeholders, not figures (`schema:550-553`; substituted template text at `lib/agreement.ts:67`). An edit MINTS A NEW ROW rather than overwriting (`schema:544-548`). §2.30 records one divergence between §4's wording and the code's behaviour. | `prisma/schema.prisma:559` | **WRITER NOT RECORDED** |
| `AgreementSignature.documentHash` | String | **derived-looking** | SHA-256 (hex) of the exact agreement text this member was shown. Literally recomputable from `documentText`, and deliberately so — `schema:583-589` calls it "the load-bearing field", proving the figures that were theirs on the day "which the version alone cannot, because the figures are derived". RECORDED, NOT JUDGED. | `prisma/schema.prisma:590` | `app/actions/agreement.ts:360`; recomputed and compared against the client's copy at `agreement.ts:337` before the write. |
| `AgreementSignature.documentText` | String | **derived-looking** | The rendered agreement verbatim — containing that member's own weekly amount, weeks committed, total contribution and fee as of signing day. A frozen copy of figures otherwise derived at read time (`lib/agreement.ts:67, :107`). Deliberate: `schema:591` "The hash proves it; this IS it." RECORDED, NOT JUDGED. | `prisma/schema.prisma:592` | `app/actions/agreement.ts:361` (rendered at `agreement.ts:334` from live terms). Guarded by a Postgres BEFORE UPDATE trigger (`prisma/migrations/20260812040000_agreement_rls_and_cascade/migration.sql:32-33`). |
| `MessageLog.body` | String | **derived-looking** | The exact rendered message that left — which for statements contains the member's money figures (amount owed, weeks behind, payments left) as of send time. A frozen render of derived standing (§2.21 "Everything in it is derived at send time … Nothing stored, nothing stale"). Deliberate: `schema:117-118` "the EXACT rendered body … the row is append-only — the log is the organizer's proof of what was said." `MessageTemplate.body` (`schema:107`) by contrast carries `{placeholders}` and never numbers (`schema:100-101`). RECORDED, NOT JUDGED. | `prisma/schema.prisma:129` | **WRITER NOT RECORDED** |
| `CycleArchive.closedAt` | DateTime | **derived-looking** | When the archived cycle was closed. A copy of `Cycle.closedAt` (`schema:153`) held with no relation on purpose — `schema:483-486` "cycleId is a PLAIN STRING — deliberately no relation — so deleting the cycle can never cascade into (or be blocked by) its archive." Once the cycle row is deleted it is no longer recomputable, which is the point. RECORDED, NOT JUDGED. | `prisma/schema.prisma:491` | `app/actions/cycle-close.ts:369` |
| `CycleArchive.data` | String (JSON) | **derived-looking** | The JSON snapshot of the whole closed cycle: who paid what, who was paid out, how much, when. The single largest stored copy of money in the schema — the shape includes per-payout number/who/net/status/paidAt (`lib/cycle-close.ts:199`) and collected-only totals (`:214`). Built by `buildArchiveData` from `memberFinals` (`app/actions/cycle-close.ts:338, :356-364`). Every figure is derivable from the live cycle right up until the cycle is wiped (§2.9 clean delete), after which the archive is the only record. RECORDED, NOT JUDGED. | `prisma/schema.prisma:493` | `app/actions/cycle-close.ts:370` |
| `CashReading.totalAmount` | Int (cents) | **derived-looking** / money-fact (sweeps disagree) | What the organizer actually holds at a moment in time. The one stored fact of the cash-position feature. Flagged only because of its own comment (`schema:707`): "The whole figure — the sum of the parts below when both are given." When bank and cash are both supplied it duplicates their sum; when they are null it is the sole record and is not recomputable. `schema:690-699` is emphatic that everything it is compared against is derived at read time. RECORDED, NOT JUDGED. | `prisma/schema.prisma:708` | Single writer: `app/actions/cycle-position.ts:431`; rows deleted at `cycle-position.ts:470`. Refuses when bank + cash disagree with the total (`cycle-position.ts:409-417`). |
| `CashReading.bankAmount` | Int? (cents) | money-fact | The bank half of a cash reading when the organizer separates it out (optional split, `schema:709`). | `prisma/schema.prisma:710` | `app/actions/cycle-position.ts:432` |
| `CashReading.cashAmount` | Int? (cents) | money-fact | The physical-cash half of a reading when the organizer separates it out. | `prisma/schema.prisma:711` | `app/actions/cycle-position.ts:433` |
| `CashReading.readAt` | DateTime | calendar-fact | The day the reading was TAKEN, which is not always the day it was typed (`schema:712`); `:697-699` "A RECORD, NOT A SETTING." Distinct from `createdAt` (`schema:715`). | `prisma/schema.prisma:713` | `app/actions/cycle-position.ts:434` |

### Columns that store something derivable (§2.14 watch list)

Twenty columns hold a value that some other part of the system can recompute. Listed
here without judgement; several are deliberate and say so in the schema.

| Column | Why it is on the list |
|---|---|
| `Participation.status` (`schema:189`) | Schema comment `323-325` calls it "the denormalised current state … kept in step with the open break, never a second source of truth". The authoritative fact is the open `ParticipationBreak` row. `app/actions/participation-removal.ts:239` writes CLOSED with `closedAtWeek` NULL and no break row. |
| `Participation.closedAtWeek` (`schema:210`) | Same denormalisation: the open break's `fromWeek − 1` is the same number (`app/actions/participation-close.ts:317`, re-derived at `:459`). |
| `Participation.carryIntentAmount` (`schema:229`) | Drift risk by its own admission — schema comment 227-228 says the live balance may differ and the LIVE one is what is offered; kept for the record only. Live figure recomputed by `ledgerBalance` (`lib/ledger.ts:23`). |
| `LuckyNumber.cycleId` (`schema:285`) | Documented denormalisation from `participation.cycleId`, existing so the DB can enforce per-cycle uniqueness (comment 278-281). Not money. |
| `LuckyNumber.amount` (`schema:287`) | Deterministically recomputable by `splitIntoLuckyNumbers` (`lib/money.ts:55`); the sum is reconciled back onto `Participation.weeklyAmount` by `reconcileWeeklyAmount` (`app/actions/edits.ts:799, :967, :1064`). |
| `Payment.amountPaid` (`schema:301`) | A stored aggregate cache of that week's allocations (`app/actions/payments.ts:243-245`); zeroed and rebuilt wholesale by `lib/rebuild.ts:53, :64`. |
| `Payment.method` (`schema:316`) | A copy of `PaymentEvent.method`, set once at row creation and thereafter preserved (`lib/rebuild.ts:17-18, :72`). |
| `Payment.paidAt` (`schema:317`) | A copy of `PaymentEvent.receivedAt` at row creation (`lib/rebuild.ts:73`); `lib/draw-settlement.ts:148` writes `draw.drawnAt` instead. |
| `PaymentAllocation.amount` (`schema:364`) | Wholly recomputable — `lib/rebuild.ts:52` deletes every allocation for the participation and re-derives them from the receipts. The stored audit trail of a computation. |
| `WinnerPlan.status` (`schema:399`) | Mirrors "a Draw exists for this week": set at `app/actions/wheel.ts:715`, restored at `lib/draw-cascade.ts:212`. `lib/draw-cascade.ts:194-204` describes plans left FULFILLED with zero numbers. |
| `Payout.grossAmount` (`schema:445`) | §2.30 defines gross = weeklyAmount × weeksCommitted; stored deliberately as historical truth (comment 438-440). |
| **`Payout.feeAmount`** (`schema:446`) | **Stored by deliberate decision.** §2.30/D-41: once a payout exists, the fee it charged is stored on it and read in preference to the projection, so a later change to the cycle's fee percent can never silently rewrite a payout that already happened. §2.14's derived table lists "Fee (once drawn)" as stored. This is the design, not a lapse. |
| `Payout.netAmount` (`schema:447`) | Nominally gross − fee, but mutated afterwards by the winner-week settlement (`lib/draw-settlement.ts:156`), the reversal (`:195`), a carry deduction (`app/actions/carry-deduction.ts:206`), a resize credit (`app/actions/edits.ts:515`) and a move reset (`app/actions/week-winners.ts:511`). Reconstructible from gross, fee and the linked settlement events. |
| `LedgerEntry.description` (`schema:506`) | Embeds a copy of the same money the `amount` column holds plus weeksPaid / weeksCommitted / lastPaymentWeek (`lib/cycle-close.ts:159-162`). §2.18 requires the story be kept. |
| `AgreementSignature.documentHash` (`schema:590`) | Recomputable from `documentText` — deliberately, as the load-bearing proof field (`schema:583-589`). |
| `AgreementSignature.documentText` (`schema:592`) | A frozen render of figures otherwise derived at read time (`lib/agreement.ts:67, :107`). Deliberate: `schema:591`. |
| `MessageLog.body` (`schema:129`) | A frozen render of derived standing at send time (§2.21). Deliberate and append-only (`schema:117-118`). |
| `CycleArchive.closedAt` (`schema:491`) | A copy of `Cycle.closedAt` held with no relation on purpose (`schema:483-486`). |
| `CycleArchive.data` (`schema:493`) | The largest stored copy of computed money in the schema; every figure derivable until the cycle is deleted (§2.9). |
| `CashReading.totalAmount` (`schema:708`) | Duplicates `bankAmount + cashAmount` when both are given (`schema:707`); the sole record when they are null. |

---

# Part B — The Derivation Catalog

Every money or standing quantity found, grouped by subsystem. Entries from eight
subsystem sweeps have been **deduplicated by quantity**; where two sweeps found the same
thing under different names, the `Merged from` line says so and the implementation and
surface lists are the union of both.

All paths are repo-relative to `c:/Users/firao/Desktop/equb-platform` (some sweeps
reported absolute paths; they have been normalised).

Reading the fields:

- **Canonical** — the implementation the sweeps treated as the reference. It is not a
  claim of correctness.
- **Other implementations** — every other place the same arithmetic is written, including
  inline copies in components, SQL re-implementations in migrations, and scripts. These
  are what Pass 2 will reconcile.
- **Surfaces** — where the figure reaches a human. These are what Pass 3 will check.

---

## B1 — Payments, receipts and allocation

### Amount due for one week

- **Formula — SUPERSEDED, see "Flagged for Pass 2":** the participation's CURRENT weekly amount, read fresh on every load. A
  cycle-wide skipped week is due nothing at all; a personally deferred week is still due
  in full. A week outside the member's start..finish window is not theirs and is not
  loaded. The week row itself stores no due amount, so a rate change retroactively
  restates every week's cost.
- **Inputs:** `Participation.weeklyAmount`, `Participation.startWeek`,
  `Participation.weeksCommitted`, `Week.isSkipped`, `Week.weekNumber`, finish week (derived)
- **Canonical:** `app/actions/payments.ts:56`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/payments.ts:58`, `app/actions/payments-view.ts:55`, `app/actions/payments-view.ts:69`, `app/actions/payments-view.ts:261`, `app/actions/member.ts:246`, `app/actions/member.ts:247`, `app/actions/cycle-close.ts:76`, `app/actions/waiting.ts:175`, `app/actions/cycle-position.ts:184`, `app/actions/participation-close.ts:86`, `app/actions/participation-close.ts:118`, `app/actions/messages.ts:281`, `lib/standing.ts:203`, `lib/messaging-engine.ts:127`, `lib/rebuild.ts:89`, `lib/rebuild.ts:109`, `lib/draw-settlement.ts:108`, `lib/dashboard.ts:254`, `lib/dashboard.ts:255`, `lib/dashboard.ts:374`, `lib/dashboard.ts:576`, `lib/week-winners.ts:154`, `lib/week-winners.ts:161`, `lib/money.ts:113`, `lib/lucky-numbers.ts:128`, `app/admin/(protected)/collections/page.tsx:118`, `app/admin/(protected)/people/[id]/participation-editor.tsx:429`, `app/admin/(protected)/people/[id]/participation-editor.tsx:448`, `app/admin/(protected)/payments/patterns-view.tsx:52`, `app/admin/(protected)/payments/payments-grid.tsx:86`, `app/admin/(protected)/payments/payments-members.tsx:94`, `app/admin/(protected)/people/[id]/member-payments.tsx:297`, `app/admin/(protected)/people/[id]/page.tsx:591`, `app/admin/(protected)/people/[id]/page.tsx:607`, `components/admin/week-action-panel.tsx:167`, `app/me/page.tsx:215`, `scripts/audit-position-figures.mts:124`, `scripts/deferral-impact.mts:74`, `scripts/elapsed-rule-impact.mts:87`, `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:60`
- **Surfaces:** `components/admin/week-action-panel.tsx:393`, `app/admin/(protected)/people/[id]/member-payments.tsx:409`, `app/admin/(protected)/payments/payments-members.tsx:44`, `app/admin/(protected)/payments/payments-grid.tsx:284`, `components/member/week-stamp-list.tsx:257`, `components/member/week-stamp-list.tsx:258`, `components/member/week-stamp-list.tsx:264`, `components/admin/payment-entry.tsx:326`
- **Units:** cents (Int). No conversion happens in any of these paths.
- **Merged from:** "Amount due for one week" (payments sweep) + "What this week costs me (per-week amount due)" (member-portal sweep).
- **Note:** this is the highest fan-out node in the whole map — see Part C.

### Remainder still owed on one week (per-week remainder / tickable)

- **Formula:** what the week costs minus what has landed on it, never below zero. A
  skipped week returns zero. The week is selectable while that remainder is above zero.
  This is what a half-paid week still needs, and what a tick on that square is worth.
- **Inputs:** `Participation.weeklyAmount` (as amountDue), `Payment.amountPaid`, `Week.isSkipped`
- **Canonical:** `lib/week-picking.ts:43` (`remainingOn`), with `lib/week-picking.ts:49` (`isPickable`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/week-selection.ts:21` (`isSelectable`, the same test written separately), `lib/week-selection.ts:57` (`weeksInRange`), `lib/week-selection.ts:63` (`oldestN`), `lib/allocation.ts:91` (the engine's own `owed = amountDue − amountAlreadyPaid`), `lib/allocation.ts:94`, `lib/payments-view.ts:64`, `lib/payments-view.ts:130`, `lib/settlement.ts:43` (`planWinnerWeekSettlement` shortfall), `lib/settlement.ts:48`, `lib/settlement.ts:72` (`allocatePinned` owed), `lib/week-picking.ts:50`, `lib/week-picking.ts:104`, `lib/week-picking.ts:153`, `lib/week-picking.ts:163`, `lib/week-winners.ts:165`, `lib/dashboard.ts:257`, `lib/standing.ts:123`, `app/actions/member.ts:293`, `app/actions/messages.ts:278`, `components/admin/week-action-panel.tsx:81`, `app/admin/(protected)/people/[id]/member-payments.tsx:377`, `app/admin/(protected)/people/[id]/member-payments.tsx:378`, `app/admin/(protected)/payments/payments-members.tsx:36`, `app/admin/(protected)/payments/payments-members.tsx:218`, `components/member/week-stamp-list.tsx:252`
- **Surfaces:** `components/admin/payment-entry.tsx:326` ("Week N — $X still owed"), `components/admin/week-action-panel.tsx:393`, `app/admin/(protected)/payments/payments-members.tsx:277`, `app/admin/(protected)/payments/payments-members.tsx:218`, `app/admin/(protected)/people/[id]/member-payments.tsx:404`, `app/admin/(protected)/people/[id]/member-payments.tsx:412`
- **Units:** cents throughout.
- **Merged from:** "Remainder still owed on one week" + "Is this week still owed / tickable".

### Allocation of a payment, oldest-first (where the money lands)

- **Formula:** walk the member's window in ascending week order. Skip cycle-wide skipped
  weeks entirely. On each week that still owes something, apply the smaller of what it
  owes and what is left of the money; carry the rest forward. Deferred weeks receive
  money like any other. Whatever cannot be placed comes back as unallocated.
- **Inputs:** amount received (input), week amountDue (derived), `Payment.amountPaid`, `Week.isSkipped`, `Week.weekNumber`
- **Canonical:** `lib/allocation.ts:65`, waterfall at `lib/allocation.ts:88-101`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/week-picking.ts:93` (mirrored, not called), `lib/standing.ts:132`, `lib/standing.ts:244`, `lib/rebuild.ts:105`, `lib/rebuild.ts:121`, `lib/settlement.ts:63`, `app/actions/payments.ts:112`, `app/actions/payments.ts:234`, `lib/allocation.ts:94`, `scripts/repro-participation-shorten.mts:150`
- **Surfaces:** `components/admin/payment-entry.tsx:457`, `components/admin/payment-entry.tsx:342`, `lib/payments-view.ts:22`, `app/actions/payments.ts:287`
- **Units:** cents; the engine throws on any non-integer or negative cents input (`lib/allocation.ts:41`) and throws on out-of-order weeks (`lib/allocation.ts:75`).

### Preview coverage for a typed amount (full weeks, partial week, fits-nowhere)

- **Formula:** a second, client-side walk of the same oldest-first rule: weeks fully
  covered by the amount, then the one week the leftover part-pays and by how much, then
  anything that fits nowhere. Explicitly documented as a preview of the engine's rule,
  not the authority (doc comment `lib/week-picking.ts:85-92`).
- **Inputs:** amount typed (input), week amountDue (derived), `Payment.amountPaid`, `Week.isSkipped`
- **Canonical:** `lib/week-picking.ts:93`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/allocation.ts:65` (the authority it mirrors), `app/actions/payments.ts:112`, `lib/week-picking.ts:102`, `lib/week-picking.ts:104`, `lib/week-picking.ts:122`, `lib/payments-view.ts:22`
- **Surfaces:** `components/admin/payment-entry.tsx:97`, `components/admin/payment-entry.tsx:323`, `components/admin/payment-entry.tsx:457`, `lib/week-picking.ts:228`
- **Units:** cents. The amount arrives as a dollars string and is converted at `components/admin/payment-entry.tsx:96` via `lib/format.ts:25`.

### Amount a ticked set of weeks is worth (selection total)

- **Formula:** sum of what each ticked, still-pickable week STILL NEEDS — not what each
  week costs — so ticking a half-paid week contributes only its shortfall.
- **Inputs:** selected week numbers (UI state), week amountDue (derived), `Payment.amountPaid`, `Week.isSkipped`
- **Canonical:** `lib/week-picking.ts:63` (`amountForWeeks`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/payments-view.ts:57`, `lib/week-picking.ts:69`, `lib/week-picking.ts:149`, `lib/week-picking.ts:163`, `components/admin/payment-entry.tsx:81`, `components/admin/payment-entry.tsx:123`
- **Surfaces:** `components/admin/payment-entry.tsx:219`, `components/admin/payment-entry.tsx:271`, `components/admin/payment-entry.tsx:443`, `app/admin/(protected)/people/[id]/member-payments.tsx:481`, `app/admin/(protected)/people/[id]/member-payments.tsx:513`
- **Units:** cents; converted to a dollars string for the amount box at `components/admin/payment-entry.tsx:82` and `:123` via `String(cents / 100)`.

### Quick-amount chips (one week / four weeks / all owed)

- **Formula:** take the oldest N still-owing weeks and sum their remainders; "all owed"
  sums every still-owing week. Chips that come out to the same money as another are dropped.
- **Inputs:** week amountDue (derived), `Payment.amountPaid`, `Week.isSkipped`
- **Canonical:** `lib/week-picking.ts:145`, dedupe at `lib/week-picking.ts:168`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/week-picking.ts:146`, `lib/week-picking.ts:153`, `lib/week-picking.ts:163`, `lib/week-selection.ts:63`
- **Surfaces:** `components/admin/payment-entry.tsx:99`, `components/admin/payment-entry.tsx:443`
- **Units:** cents.

### Bulk catch-up amount for chosen weeks

- **Formula:** sum of each chosen week's shortfall, skipping only cycle-wide skipped
  weeks. Deferred weeks are included because they are still owed. Clamped per week —
  unlike `amountOutstanding`, which nets across weeks.
- **Inputs:** chosen week numbers (UI state), week amountDue (derived), `Payment.amountPaid`, `Payment.isDeferred`, `Week.isSkipped`
- **Canonical:** `lib/payments-view.ts:57`, per-week term at `lib/payments-view.ts:64`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/week-picking.ts:43`, `lib/week-picking.ts:63`, `lib/week-picking.ts:69`, `lib/week-picking.ts:104`, `lib/week-picking.ts:153`, `lib/week-picking.ts:163`, `lib/allocation.ts:91`, `lib/allocation.ts:98`, `lib/settlement.ts:43`, `lib/settlement.ts:72`, `lib/week-selection.ts:21`, `lib/derived.ts:286` (the netted, non-per-week version of the same idea), `components/admin/week-action-panel.tsx:81`, `app/admin/(protected)/payments/payments-members.tsx:36`, `app/admin/(protected)/payments/payments-members.tsx:218`, `app/admin/(protected)/people/[id]/member-payments.tsx:377`, `app/admin/(protected)/people/[id]/member-payments.tsx:378`, `app/actions/payments-view.ts:253-267` (`getCatchUpWeeks` builds the rows this is summed from, with its own start..finish window filter)
- **Surfaces:** `app/admin/(protected)/people/[id]/member-payments.tsx:97`, `:481`, `:513`; `components/admin/payment-entry.tsx` (tick-to-compute amount, fed from `app/actions/payments-view.ts:235`)
- **Units:** cents; throws `RangeError` if either amount is not an integer (`lib/payments-view.ts:61`).
- **Merged from:** three sweeps recorded this under "Bulk catch-up amount for chosen weeks", "Bulk catch-up amount for selected weeks" and "Amount a bulk catch-up over selected weeks is worth".

### Money that fits nowhere (unallocated / commit refusal)

- **Formula:** whatever is left after every available week in the member's window is
  full. On commit the whole payment is refused rather than partially written; the
  refusal quotes what WOULD have fitted and what would not.
- **Inputs:** amount received (input), week amountDue (derived), `Payment.amountPaid`, `Week.isSkipped`
- **Canonical:** `lib/allocation.ts:106`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/week-picking.ts:118`, `lib/standing.ts:244`, `lib/settlement.ts:54`, `lib/settlement.ts:74`, `lib/rebuild.ts:94`, `lib/rebuild.ts:114`, `app/actions/payments.ts:294`, `components/admin/payment-entry.tsx:220`
- **Surfaces:** `components/admin/payment-entry.tsx:220`, `components/admin/payment-entry.tsx:496`, `lib/week-picking.ts:257`, `lib/standing.ts:250`
- **Units:** cents.

### Amount recorded on a week's row (stored per-week paid)

- **Formula:** an aggregate cache of every allocation that landed on that week: created
  at the applied amount, or incremented by it. Maintained inside the recording
  transaction and rebuilt from scratch by the replay.
- **Inputs:** allocation applied per week (derived), `Payment.amountPaid`, `PaymentEvent.amount`
- **Canonical:** `app/actions/payments.ts:249`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/payments.ts:259`, `app/actions/payments.ts:264`, `lib/rebuild.ts:53`, `lib/rebuild.ts:55`, `lib/rebuild.ts:64`, `lib/rebuild.ts:71`, `lib/draw-settlement.ts:137`, `lib/draw-settlement.ts:140`, `lib/draw-settlement.ts:147`, `lib/draw-settlement.ts:199`, `lib/draw-settlement.ts:202`, `lib/draw-settlement.ts:229`, `lib/draw-settlement.ts:232`, `app/actions/edits.ts:1370`, `app/actions/edits.ts:1514`, `app/actions/edits.ts:1598`, `scripts/lib/production-fixture.mts:171`, `scripts/verify-cycle-position.mts:96`, `scripts/verify-orphan-weeks.mts:116`
- **Surfaces:** `app/admin/(protected)/payments/payments-grid.tsx:284`, `app/admin/(protected)/people/[id]/member-payments.tsx:406`, `app/admin/(protected)/payments/payments-members.tsx:44`
- **Units:** cents (`Payment.amountPaid`, Int, default 0).

### Amount of one receipt applied to one week (allocation audit row)

- **Formula:** the per-week slice of a receipt, written as its own row joining the
  receipt to the week payment row. Shown as "$X of a $Y receipt" when the receipt was split.
- **Inputs:** `PaymentAllocation.amount`, `PaymentEvent.amount`, `Payment.id`
- **Canonical:** `app/actions/payments.ts:270`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/payments.ts:271`, `lib/rebuild.ts:52`, `lib/rebuild.ts:78`, `lib/draw-settlement.ts:153`, `lib/draw-settlement.ts:154`, `lib/draw-settlement.ts:200`, `lib/draw-settlement.ts:230`
- **Surfaces:** `app/actions/payments-view.ts:216`, `components/admin/week-action-panel.tsx:517`, `components/admin/week-action-panel.tsx:540`
- **Units:** cents.

### Pinned settlement coverage (the winner's own week)

- **Formula:** for each week, the payout-settlement cents pinned to it, capped at that
  week's due; a skipped week takes none and that money returns to the fungible pool.
  Applied before any oldest-first re-allocation.
- **Inputs:** `PaymentEvent.amount` where `pinnedWeekId` is not null, `PaymentEvent.pinnedWeekId`, `Participation.weeklyAmount`, `Week.isSkipped`
- **Canonical:** `lib/standing.ts:118`, cap inline at `lib/standing.ts:122-127`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/settlement.ts:63` (`allocatePinned`, the same rule as its own function), `lib/rebuild.ts:88`, `lib/rebuild.ts:84-96`, `lib/standing.ts:223`, `app/actions/cycle-close.ts:84`, `app/actions/cycle-close.ts:97`, `app/actions/cycle-position.ts:192`, `app/actions/cycle-position.ts:193-196`, `app/actions/member.ts:255`, `app/actions/member.ts:256-262`, `app/actions/participation-close.ts:126`, `app/actions/participation-close.ts:127-131`, `app/actions/payments-view.ts:40-43`, `app/actions/payments-view.ts:77`, `app/actions/payments.ts:391`, `app/actions/payments.ts:392-396`, `app/actions/waiting.ts:183`, `app/admin/(protected)/collections/page.tsx:126`, `lib/messaging-engine.ts:92-96`, `lib/messaging-engine.ts:135`, `lib/draw-settlement.ts:42`, `scripts/audit-position-figures.mts:133-136`, `scripts/deferral-impact.mts:41-44`, `scripts/elapsed-rule-impact.mts:40-43`
- **Surfaces:** `app/actions/member.ts:377`, `app/admin/(protected)/people/[id]/page.tsx:603`
- **Units:** cents.

### Coverage of a week at the CURRENT rate (what the status ladder compares against)

- **Formula:** pinned payout settlements land on their own week first, capped at that
  week's due (a skipped week takes none). The rest of the member's whole money total is
  then treated as one fungible pot and re-allocated oldest-first over the window at
  today's weekly amount, skipping skipped weeks. What lands on a week is that week's
  coverage — deliberately different from the stored receipt on that row after a rate change.
- **Inputs:** total paid (derived), pinned settlement coverage (derived), `Participation.weeklyAmount`, `Week.isSkipped`, `Week.weekNumber`
- **Canonical:** `lib/standing.ts:144` (with the pinned pass at `lib/standing.ts:118`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/standing.ts:146`, `lib/rebuild.ts:23` (replays the same allocation to WRITE `Payment.amountPaid` back to the database), `lib/week-picking.ts:93` (labelled preview of the same walk), `lib/allocation.ts:65` (the engine both delegate to), `lib/settlement.ts:65`, `lib/dashboard.ts:577`, `lib/payments-view.ts:222`, `app/actions/payments.ts:52-64` (builds the AllocationWeek rows for the live preview, deliberately keeping `isDeferred` OUTSIDE the allocation input), `app/admin/(protected)/people/[id]/page.tsx:606`, `app/admin/(protected)/payments/patterns-view.tsx:53`, `scripts/deferral-impact.mts:293-295`
- **Surfaces:** `app/actions/member.ts:377` (the member portal shows `coveredAtCurrentRate` as their per-week amountPaid), `app/actions/member.ts:292`, `components/member/week-stamp-list.tsx:249`, `components/member/week-stamp-list.tsx:254`, `components/member/week-stamp-list.tsx:261`, `app/me/page.tsx:214`
- **Units:** cents.
- **Merged from:** three sweeps ("Coverage of a week at the CURRENT rate", "Money covered on a week at the current rate", "What this week is covered by").
- **Note:** `lib/standing.ts:204` emits `amountPaid` = the STORED receipt while `:205` emits `coveredAtCurrentRate` = the re-allocated coverage. Different surfaces read different ones — the payments grid shows `cell.storedPaid` (`lib/payments-view.ts:222`), the member portal shows the covered figure.

### Replayed placement of every receipt (rebuild after an edit)

- **Formula:** delete every allocation row and zero every week amount, then replay the
  member's receipts in received order through the same oldest-first engine — except
  pinned settlement receipts, which go only onto the week they settled. Any receipt that
  no longer fits aborts the whole transaction. Finally, a late mark on a week now fully
  covered is cleared.
- **Inputs:** `PaymentEvent.amount`, `PaymentEvent.receivedAt`, `PaymentEvent.pinnedWeekId`, `Participation.weeklyAmount`, `Week.isSkipped`, `Payment.markedLateAt`
- **Canonical:** `lib/rebuild.ts:23`
- **Other implementations / call sites — SUPERSEDED, see "Flagged for Pass 2":** `lib/allocation.ts:65`, `app/actions/payments.ts:234`, `lib/rebuild.ts:83`, `lib/rebuild.ts:101`, `lib/rebuild.ts:121`, `lib/rebuild.ts:142`, `app/actions/edits.ts:541`, `:813`, `:990`, `:1088`, `:1187`, `:1229`, `:1286`, `:1381`, `:1723`, `scripts/repro-participation-shorten.mts:150`
- **Surfaces:** `app/actions/edits.ts:1137`, `:1206`, `:1251`, `:1313`, `components/admin/week-action-panel.tsx:557`
- **Units:** cents.

### Amount received, as typed by the organizer (the dollars/cents boundary)

- **Formula:** a dollars string is validated against a strict money pattern before
  separators are stripped, then converted with integer arithmetic: whole dollars times
  one hundred plus the cent part. Rejected input yields nothing rather than a guess. The
  reverse direction divides cents by one hundred to prefill the box.
- **Inputs:** typed dollars string (UI input), selection total (derived)
- **Canonical:** `lib/format.ts:25` (`parseDollarsToCents`); display side `lib/format.ts:5` (`formatMoney`), `lib/format.ts:8`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `components/admin/payment-entry.tsx:82`, `components/admin/payment-entry.tsx:123`, `app/admin/(protected)/people/[id]/member-payments.tsx:220`, `lib/member-history.ts:106`, `lib/member-history.ts:109`, `lib/lucky-numbers.ts:136`, `lib/participation-removal.ts:242`, `lib/participation-removal.ts:243`, `app/actions/agreement.ts:246`, `app/admin/(protected)/people/[id]/participation-editor.tsx:247`, `:1272`, `:1413`, `app/admin/(protected)/people/[id]/carried-balance.tsx:179`, `:283`, `app/admin/(protected)/collections/collections-view.tsx:573`, `:574`, `:575`, `:918`, `app/admin/(protected)/cycle/edit/cycle-edit-form.tsx:49`, `app/admin/(protected)/cycles/new/new-cycle-form.tsx:399`, `components/admin/carry-deduction-offer.tsx:65`, `:172`, `components/charts/cash-position-chart.tsx:37`, `components/charts/collected-vs-expected-chart.tsx:32`, `scripts/import-cycle.mts:64`, `:346`, `scripts/audit-empty-draws.mts:102`, `scripts/lib/production-fixture.mts:228`
- **Surfaces:** `components/admin/payment-entry.tsx:406`, `components/admin/payment-entry.tsx:490`, `app/admin/(protected)/people/[id]/member-payments.tsx:210`
- **Units:** THE units boundary — dollars strings outside, cents integers inside. The
  reverse prefill at `payment-entry.tsx:82` and `:123` uses `String(cents / 100)`, a float
  division producing the dollars string. Display formatting (`lib/format.ts:5`) is
  duplicated locally at `lib/member-history.ts:106`, `lib/lucky-numbers.ts:136` and
  `lib/participation-removal.ts:243`.

### Total paid by a member (participation total / total contributed / paid in)

- **Formula:** **TWO DIFFERENT BASES ARE IN USE.** (a) the sum of every payment EVENT
  (receipt) on the participation — the definition `lib/contribution.ts` calls total
  contributed; (b) the sum of every week row's stored `amountPaid` — what
  `computeStanding` is fed as `totalPaid` and what the grid reports as
  `totalContributed`. After a settlement or an edit the two are not the same number.
- **Inputs:** `PaymentEvent.amount` (basis a), `Payment.amountPaid` (basis b)
- **Canonical:** `lib/contribution.ts:58` (`totalContributed`, receipts basis); `lib/contribution.ts:60`
- **Other implementations (receipts basis) — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/member.ts:156`, `app/actions/member.ts:344`, `app/actions/people.ts:95`, `app/actions/people.ts:136`, `app/actions/people.ts:137`, `app/actions/participation-removal.ts:132`, `app/admin/(protected)/people/[id]/page.tsx:157`, `app/admin/(protected)/people/[id]/page.tsx:159`, `app/admin/(protected)/people/[id]/participation-editor.tsx:553`
- **Other implementations (week-rows basis) — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/payments.ts:390`, `app/actions/payments-view.ts:76`, `app/actions/payments-view.ts:118`, `app/actions/member.ts:254`, `app/actions/cycle-close.ts:83`, `app/actions/cycle-close.ts:178`, `app/actions/cycle-close.ts:260`, `app/actions/waiting.ts:180`, `app/actions/waiting.ts:182`, `app/actions/cycle-position.ts:191`, `app/actions/cycle-position.ts:245`, `app/actions/participation-close.ts:125`, `app/actions/dashboard.ts:214`, `app/actions/people.ts:91`, `app/actions/people.ts:93`, `app/admin/(protected)/collections/page.tsx:125`, `lib/messaging-engine.ts:134`, `lib/dashboard.ts:53`, `lib/dashboard.ts:293`, `lib/dashboard.ts:300`, `lib/dashboard.ts:562`, `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:167`, `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:79`, `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:45`, `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:46`, `scripts/audit-position-figures.mts:131`, `:194`, `:242`, `:248`, `:254`, `:270`, `scripts/deferral-impact.mts:86`, `scripts/elapsed-rule-impact.mts:94`, `scripts/verify-cycle-close-money.mts:93`, `:123`, `:206`, `scripts/verify-member-privileges.mts:94`, `scripts/verify-participation-close.mts:404`, `scripts/verify-cycle-position.mts:145`, `scripts/diagnose-paid-ahead.mts:96`
- **Surfaces:** `app/admin/(protected)/payments/payments-members.tsx:251`, `app/actions/payments-view.ts:118`, `app/me/page.tsx:103`, `app/admin/(protected)/people/[id]/page.tsx:348`, `components/member/savings-arc.tsx:100`, `components/member/savings-arc.tsx:109`, `components/member/saved-card.tsx:38`, `components/member/past-cycle-card.tsx:48`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:99`, `app/admin/(protected)/people/people-directory.tsx:239`
- **Units:** cents in every implementation; `lib/contribution.ts:46` throws on non-integer or negative cents.
- **Merged from:** four sweeps ("Total paid by a member", "Total contributed / paid in by a member", "Received by member", "My total paid in").
- **Note:** `app/actions/people.ts` holds BOTH bases in one file — `:93` groups `Payment.amountPaid` for the agreement gate, `:137` sums `PaymentEvent.amount` for the directory's contributed column, with an in-file comment naming the divergence. The `/me` headline sums `PaymentEvent.amount` unfiltered at `app/actions/member.ts:344` despite the comment at `app/actions/member.ts:118-120` saying pinned settlement events are filtered out.

### Next week due for a member

- **Formula:** among the member's weeks that are not deferred and whose covered amount is
  below their due, take the first at or after the later of the current cycle week and
  their start week; if there is none, fall back to the oldest such week; if none at all,
  "All paid up".
- **Inputs:** coveredAtCurrentRate (derived), `Participation.weeklyAmount`, `Payment.isDeferred`, current cycle week (derived), `Participation.startWeek`, `Week.date`
- **Canonical:** `app/actions/member.ts:292`, with `app/actions/member.ts:295`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/messages.ts:277`, `app/actions/messages.ts:278` (the same "first uncovered non-deferred week" filter, for the payment-confirmation preview), `app/me/schedule/page.tsx:39` (picks the member's current/next week by CALENDAR position only, ignoring coverage and deferral), `lib/week-picking.ts:146` (`quickAmounts`' owing list), `lib/week-selection.ts:63` (`oldestN`)
- **Surfaces:** `app/me/page.tsx:270` (MemberPayoutCard nextDue), `components/member/member-payout-card.tsx:99`, `components/member/member-payout-card.tsx:102`
- **Units:** returns a week number and a date; the comparison behind it is in cents. Its
  week-number half (`app/actions/member.ts:352`) is carried to the component
  (`components/member/member-payout-card.tsx:28`) and never rendered.

---

## B2 — Standing, status and lateness

### Whether a week counts as due now (the arithmetic gate for behind and outstanding)

- **Formula:** if the organizer marked the week late by hand AND the week is not
  deferred, it counts as due immediately. Otherwise it counts as due only when its own
  window has closed. Deferral outranks the mark, but an elapsed deferred week still
  counts as due.
- **Inputs:** `Week.date`, today, `Payment.markedLateAt`, `Payment.isDeferred`, `PAYMENT_WINDOW_DAYS`
- **Canonical:** `lib/derived.ts:95` (mark test at `lib/derived.ts:113`, delegate at `:114`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/standing.ts:164-173` (the production application), `lib/dashboard.ts:543` (memberAttention builds its own `dueWeeks` SET from a week-number range plus marked weeks; range `:544-550`, marked-and-deferred skip `:555`, marked-in-window add `:556-558`), `lib/derived.ts:189-196` (paymentStatus expresses the same mark-vs-deferral ordering a second time as ladder order), `lib/derived.ts:255` (manualLateAdvice checks `isDeferred` first — the same precedence a third time in one file), `app/admin/(protected)/cycle/position/week-dates.ts:111` (the money half) and `:113` (`if (row?.markedLate) continue` — the mark half only), `app/actions/payments-view.ts:208-213`, `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:54` (the SQL view's due set: window rows where `current_date >= date + 5`; `markedLateAt` never consulted), `scripts/verify-member-privileges.mts:89` (due set from the date comparison only), `scripts/audit-position-figures.mts:229` (a by-hand gate on week NUMBER against elapsedThroughWeek, no mark, no deferral), `scripts/elapsed-rule-impact.mts:73`, `lib/week-date-authority.test.ts:220` (a regex holding a literal copy of the two lines)
- **Surfaces:** indirect only — it decides weeksBehind and amountOutstanding, rendered at `app/admin/(protected)/people/[id]/page.tsx:361` and `:376`, and at `app/admin/(protected)/page.tsx:283`; also `components/admin/week-action-panel.tsx:260`
- **Units:** boolean per week; whole DAYS via `weekHasElapsed`. `markedLateAt` is stored as a timestamp (`prisma/schema.prisma:314`), not a flag.
- **Merged from:** four sweeps recorded this quantity.

### Weeks elapsed in a member's own window

- **Formula:** count the member's own window week-rows for which the week counts as due now.
- **Inputs:** `Week.date`, `Week.weekNumber`, `Participation.startWeek`, `Participation.weeksCommitted`, `Payment.markedLateAt`, `Payment.isDeferred`, today
- **Canonical:** `lib/standing.ts:164`, exposed as `Standing.weeksElapsedInWindow` at `lib/standing.ts:192`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/dashboard.ts:561` (`elapsedCount = dueWeeks.size`, built from a week-number range plus marked weeks rather than from each row's own date), `lib/commitment.ts:154` (the cycle-wide scalar; no marked-late, no deferral), `lib/cycle-position.ts:186`, `lib/cycle-position.ts:187`, `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:53`, `:54`, `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:87` (different excused filter at `:88-95` — it excused personal deferrals as well as skips), `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:159` (the ORIGINAL view counted it with no calendar scan at all: `least(cw.week_no - pt."startWeek" + 1, pt."weeksCommitted")`, off the projected week number), `scripts/verify-member-privileges.mts:73`, `:89`, `:96`, `scripts/verify-member-privileges.mts:68-80`, `scripts/elapsed-rule-impact.mts:73-74`, `scripts/elapsed-rule-impact.mts:228`, `app/actions/dashboard.ts:158`, `:166`, `:186`, `app/actions/cycle-position.ts:143`, `app/admin/(protected)/cycle/position/week-dates-data.ts:116`
- **Surfaces:** `app/admin/(protected)/cycle/position/page.tsx:131`, `app/admin/(protected)/cycle/position/page.tsx:461`, `app/me/page.tsx` (weeks behind), `app/me/group/page.tsx:33`, `app/admin/(protected)/page.tsx` (attention list)
- **Units:** WEEKS (a count of rows).
- **Note:** the SQL view and the TypeScript path use different window predicates — SQL uses a plain `start..start+committed` range and ignores `ParticipationBreak`; `lib/standing.ts` is fed a window the caller already filtered. Three successive migrations define this count three different ways.

### Weeks credited / weeks paid / weeks covered

- **Formula:** total money paid divided by the CURRENT weekly amount, floored. No
  per-week attribution — money is fungible, so a rate change re-values every past
  payment. Some implementations additionally cap the result at `weeksCommitted`.
- **Inputs:** total paid (derived — see the two bases above), `Participation.weeklyAmount`, `Participation.weeksCommitted`
- **Canonical:** `lib/derived.ts:122` (uncapped; the quotient at `lib/derived.ts:127`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/contribution.ts:91` and `lib/contribution.ts:93` (`weeksCovered` — same quotient, capped at `weeksCommitted`, computed off receipts not week rows), `lib/standing.ts:177`, `lib/dashboard.ts:563`, `app/actions/member.ts:207-210` (stopped-member branch, inline, with a `Math.max(1, weeklyAmount)` divisor guard the shared function does not have), `app/actions/member.ts:349` (a SECOND cap applied on the portal path on top of `contribution.weeksCovered`'s cap in the same response), `app/actions/cycle-close.ts:106` (capped figure frozen into the archive), `app/actions/waiting.ts:213`, `app/actions/payments-view.ts:115`, `lib/messages.ts:218`, `lib/messaging-engine.ts:178` (passes it UNCAPPED into StandingFacts, which `lib/messages.ts:218` then caps), `app/admin/(protected)/people/page.tsx:64` (`Math.floor(contributedThisCycle / weekly)` with NO cap), `lib/member-history.ts:182` (read back out of the STORED archive snapshot rather than derived), `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:33` and `:33-36`, `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:67`, `:69`, `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:157`, `scripts/verify-member-privileges.mts:67`, `:95`, `:97`, `scripts/elapsed-rule-impact.mts:213`, `components/member/member-personal-summary.tsx:39`, `:40`, `app/admin/(protected)/people/people-directory.tsx:259`, `app/admin/(protected)/waiting/waiting-view.tsx:472`
- **Surfaces:** `app/admin/(protected)/payments/payments-grid.tsx:352`, `:357`, `app/admin/(protected)/payments/payments-members.tsx:256`, `app/admin/(protected)/people/[id]/page.tsx:349`, `app/me/page.tsx:97`, `:259`, `:267`, `components/member/member-group-list.tsx:124`, `:137`, `components/member/member-personal-summary.tsx:152`, `components/member/member-payout-card.tsx:94`, `components/member/savings-arc.tsx:103`, `components/member/past-cycle-card.tsx:51`, `app/admin/(protected)/waiting/waiting-view.tsx:507`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:96`, `app/admin/(protected)/cycle/close/close-flow.tsx:228`, `app/admin/(protected)/people/people-directory.tsx:239`, `lib/messages.ts:300` (`{weeksPaid}` placeholder), `lib/cycle-close.ts:160`, `lib/cycle-close.ts:175-185`
- **Units:** inputs are CENTS, output is WEEKS. The SQL version divides through numeric and casts to int (`migration.sql:33-36`).
- **Merged from:** six sweeps ("Weeks credited", "Weeks covered capped", "Weeks paid and weeks behind as the database computes them", "Weeks paid / credited (awaiting-their-turn row)", "My weeks paid / weeks credited", "Weeks credited / weeks behind").
- **Note:** three cap behaviours (`lib/derived.ts` uncapped; `lib/contribution.ts` and the SQL view capped; five callers apply the cap themselves) and two source columns (`Payment.amountPaid` vs `PaymentEvent.amount`).

### Weeks behind

- **Formula:** weeks of their window that count as due now, minus the skipped ones among
  those, minus weeks credited; never below zero. Deferred weeks are NOT subtracted — the
  money is still owed.
- **Inputs:** weeks elapsed in the member's window (derived), weeks credited (derived), count of elapsed weeks with `Week.isSkipped`
- **Canonical:** `lib/derived.ts:138`, subtraction at `lib/derived.ts:146`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/standing.ts:178` (the composition every admin and portal surface uses), `lib/standing.ts:176` (`skippedElapsed`), `lib/dashboard.ts:566` (memberAttention — same helper, fed its own dueWeeks count and its own skipped count from stored rows only, `lib/dashboard.ts:565`), `lib/messaging-engine.ts:179`, `lib/messages.ts:311`, `app/actions/member.ts:350`, `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:37`, `:38` (a full SQL re-implementation that never sees `markedLateAt`), `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:70`, `:75`, `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:158`, `:162`, `scripts/verify-member-privileges.mts:68-69`, `scripts/verify-member-privileges.mts:96` (its `excused` at `:90-93` counts personal deferrals as excused, unlike `lib/derived.ts`), `scripts/elapsed-rule-impact.mts:215-220`, `scripts/elapsed-rule-impact.mts:132`, `scripts/elapsed-rule-impact.mts:219`, `scripts/deferral-impact.mts:154-155`
- **Surfaces:** `app/admin/(protected)/people/[id]/page.tsx:376`, `app/admin/(protected)/page.tsx:283`, `components/member/member-group-list.tsx:128`, `:183`, `:186`, `app/me/page.tsx:260`, `lib/messages.ts:311` (`{weeksBehind}`), `lib/whatsapp-templates.ts:190`, `lib/presentation.ts:188` (survives presentation redaction — the count is not hidden), `lib/messaging-engine.ts:179`
- **Units:** WEEKS (integer count).
- **Merged from:** five sweeps.
- **Note:** `/me` reads the TypeScript figure via `computeStanding` (`app/actions/member.ts:350`) while `/me/group` reads `weeks_behind` from the SQL view (`app/actions/member.ts:448` viewer, `:457` peers) — two derivations behind one portal.

### Amount outstanding (owed right now)

- **Formula:** over the member's weeks that COUNT AS DUE NOW: sum what each non-skipped
  week costs, subtract everything covered on those weeks, floor at zero. NETTED across
  weeks rather than clamped per week, so surplus on one week offsets debt on another.
  Deferred weeks count as owed; skipped weeks owe nothing.
- **Inputs:** weeks counting as due (derived), week amountDue (derived), coverage at current rate (derived), `Week.isSkipped`, `Payment.isDeferred`, `Payment.markedLateAt`, `Week.date`, `PaymentEvent.amount` + `pinnedWeekId`
- **Canonical:** `lib/derived.ts:286`, accumulation at `lib/derived.ts:299`, `:302`; assembled by `lib/standing.ts:179`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/dashboard.ts:571`, `lib/dashboard.ts:581` (memberAttention builds its own elapsedWindow array and passes NO `isSkipped` field to `amountOutstanding` — `lib/dashboard.ts:575`), `lib/payments-view.ts:57` (bulkCatchUpAmount — per-week clamped, not netted), `lib/cycle-close.ts:240` (the cycle-level aggregate STORED into the archive JSON at `:250`), `lib/member-history.ts:186` (reads that stored `outstanding` back; never re-derived), `lib/participation-close.ts:331` (`balanceToRecord: Math.max(0, outstandingToDate)` — a second flooring before it is written to the ledger), `lib/messaging-engine.ts:114`, `lib/messaging-engine.ts:180`, `lib/members-view.ts:31`, `lib/payments-view.ts:251`, `app/actions/cycle-position.ts:205`, `app/actions/cycle-position.ts:259` (re-derived over a stopped member's shortened window), `app/actions/cycle-position.ts:171`, `:203`, `:206`, `app/actions/cycle-close.ts:63`, `:107`, `:294`, `app/actions/participation-close.ts:85`, `:110`, `:146`, `:147`, `app/actions/payments-view.ts:49`, `:56`, `:116`, `app/actions/payments.ts:356`, `:375`, `app/actions/member.ts:234`, `app/actions/member.ts:347`, `app/actions/member-messaging.ts:179`, `app/actions/waiting.ts:162`, `app/admin/(protected)/collections/page.tsx:105`, `:128`, `app/admin/(protected)/cash/page.tsx:63`, `scripts/audit-position-figures.mts:110`, `:111`, `:142`, `:146`, `:187`, `scripts/deferral-impact.mts:55`, `:60`, `:156`, `scripts/elapsed-rule-impact.mts:63`, `:76`, `:134`, `scripts/verify-participation-close.mts:141`, `scripts/verify-member-privileges.mts:88-96`
- **Surfaces:** `app/admin/(protected)/people/[id]/page.tsx:361`, `:490`, `:585`, `app/admin/(protected)/people/[id]/member-payments.tsx:182`, `:185`, `app/admin/(protected)/payments/payments-members.tsx:261`, `app/admin/(protected)/payments/payments-grid.tsx:353`, `:361`, `app/admin/(protected)/page.tsx:283`, `app/admin/(protected)/cycle/position/page.tsx:206`, `:236`, `app/admin/(protected)/collections/collections-view.tsx:878`, `:911`, `app/admin/(protected)/collections/page.tsx:128`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:113`, `app/admin/(protected)/cycle/close/close-flow.tsx:231`, `:232`, `lib/messages.ts:312` (`{amountOwed}`), `lib/whatsapp-templates.ts:251`, `lib/contribution.ts:36` (`overdue`, passed straight through to the member portal), `components/member/saved-card.tsx:94`, `components/member/savings-arc.tsx:77`, `:112`, `app/me/page.tsx:251`, `components/member/past-cycle-card.tsx:87`
- **Units:** CENTS throughout; `lib/derived.ts:32-39` throws on non-integer or negative cents. Zeroed by presentation redaction at `lib/presentation.ts:119` and `:189`. `lib/cycle-close.ts:240` is the one place the figure is STORED rather than derived.
- **Merged from:** five sweeps ("Amount outstanding", "Outstanding for a member", "Overdue", "Who the outstanding money is with", "Member's outstanding shown beside a pending payout").
- **Note:** eleven call sites each BUILD THEIR OWN `windowWeeks` array before calling `computeStanding`; the window each caller chooses is the whole difference between them. `app/actions/participation-close.ts:85` truncates the window at the closing week; `app/actions/cycle-position.ts:178` bounds it by a caller-supplied `throughWeek`; the rest use the full window.

### Payment status of one week (PAID / PARTIAL / LATE / UNPAID / DEFERRED / SKIPPED)

- **Formula:** an ordered ladder, first match wins — cycle-wide skipped wins first; then
  money covering the full due reads PAID (money beats a deferral and beats a late mark);
  then DEFERRED; then the organizer's own mark reads LATE; then window-closed reads LATE;
  then PARTIAL if some money landed; else UNPAID.
- **Inputs:** coverage at current rate (derived), week amountDue (derived), `Payment.isDeferred`, `Week.isSkipped`, `Payment.markedLateAt`, `Week.date`, today, `PAYMENT_WINDOW_DAYS`
- **Canonical:** `lib/derived.ts:169`, ladder at `lib/derived.ts:189-197` (window test re-inlined at `:194-195` rather than calling `weekHasElapsed`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/standing.ts:209` (computeStanding's own call, fed `coveredAtCurrentRate` rather than the stored receipt), `lib/dashboard.ts:372` (`weekMemberStatus`, fed the STORED `amountPaid` rather than coverage), `lib/dashboard.ts:377`, `lib/dashboard.ts:381` (emits the mark again beside the status as a display note, so one row carries it twice), `lib/chart.ts:186` and `lib/chart.ts:193-194` (`consistencyState` — a parallel five-state derivation straight from raw amounts: deferred / paid / partial / not-due / overdue; no skipped and no marked-late input, ordered differently), `lib/derived.ts:189`, `lib/derived.ts:190`, `lib/payments-view.ts:130`, `lib/payments-view.ts:225`, `lib/members-view.ts:64` ("unpaid this week" = neither PAID nor DEFERRED), `lib/members-view.ts:68` ("partial" = any week whose status is PARTIAL), `app/actions/member.ts:366-372` (remaps UNPAID to PENDING for the member portal — a second member-facing vocabulary), `app/admin/(protected)/people/[id]/page.tsx:605` (a second direct call as a fallback when a week is missing from the standing; passes no `markedLate` argument), `components/member/week-stamp-list.tsx:183` (collapses six statuses to two: notPaid = LATE | DEFERRED | PARTIAL), `components/member/week-stamp-list.tsx:252`, `:260` (re-derives paid/partial presentation from amountPaid vs amountDue rather than from the status beside it), `components/member/equb-calendar.tsx:161` (its own status-to-wording ladder), `app/admin/(protected)/people/[id]/member-payments.tsx:377`, `:404`, `:412`, `app/admin/(protected)/payments/patterns-view.tsx:52-55` (runs the ladder BACKWARDS — `isSkipped` and `isDeferred` re-derived from `cell.status`), `app/admin/(protected)/payments/payments-grid.tsx:88` and `app/admin/(protected)/payments/payments-members.tsx:96` (same backwards derivation for `isDeferred`), `app/admin/(protected)/this-week/page.tsx:64` (groups members by raw status string), `lib/dashboard.ts:257`, `scripts/import-cycle.mts:215-226` (the ladder INVERTED at import: a status word is turned back into `amountPaid` and `isDeferred`), `scripts/deferral-impact.mts:158`, `scripts/elapsed-rule-impact.mts:136`
- **Surfaces:** `app/admin/(protected)/payments/payments-grid.tsx:280`, `:284`, `app/admin/(protected)/payments/payments-members.tsx:37`, `app/admin/(protected)/people/[id]/member-payments.tsx:32`, `:398`, `app/admin/(protected)/this-week/page.tsx:64`, `:156`, `:204`, `components/member/week-stamp-list.tsx:183`, `:250`, `:279`, `components/member/equb-calendar.tsx:161`, `:177`, `:180`, `components/charts/consistency-strip.tsx:131`, `components/admin/week-action-panel.tsx:390`, `app/me/page.tsx:210`
- **Units:** not money — a status string; every branch is decided by cents compared against cents, and the window is 5 days (`lib/derived.ts:13`).
- **Merged from:** four sweeps.

### The shared status vocabulary (wording, meaning, glyph, tone)

- **Formula:** a static lookup table keyed by the six status values; an unknown string
  falls back to a neutral label echoing the raw string.
- **Inputs:** status (derived)
- **Canonical:** `lib/status-labels.ts:36`, fallback at `lib/status-labels.ts:92`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `components/member/equb-calendar.tsx:161` (member calendar's own wording), `components/member/equb-calendar.tsx:25` (STATUS_CELL), `:34` (STATUS_DOT), `:43` (LEGEND), `components/member/week-stamp-list.tsx:24` (STATUS_LABEL — a third wording table), `:33` (STATUS_NOTE — its own DEFERRED/SKIPPED meaning lines, parallel to `lib/status-labels.ts:88` and `:89`), `:39` (BADGE_CLS — its own tone/colour table), `app/admin/(protected)/this-week/page.tsx:34` (overrides the UNPAID title to "Have not paid yet", own sub-line at `:180`), `components/charts/consistency-strip.tsx:59` (LEGEND) and `:64` (its own labels for the five consistency states), `app/admin/(protected)/payments/payments-grid.tsx:22` (aliases STATUS_LABELS as MARKERS), `app/admin/(protected)/payments/payments-members.tsx:31` (aliases it as STATUS_STYLE)
- **Surfaces:** `app/admin/(protected)/payments/payments-grid.tsx:280`, `app/admin/(protected)/payments/payments-members.tsx:37`, `app/admin/(protected)/people/[id]/member-payments.tsx:32`, `app/admin/(protected)/this-week/page.tsx:171`, `components/admin/week-action-panel.tsx:390`
- **Units:** none — strings and CSS classes.

### Marked late (the organizer's own stored decision)

- **Formula:** a stored timestamp on the member's week row, with an optional note.
  Everywhere it is read it is collapsed to a boolean by testing "markedLateAt is not null".
- **Inputs:** `Payment.markedLateAt`, `Payment.markedLateNote`
- **Canonical:** the stored column `prisma/schema.prisma:314`; written by `app/actions/edits.ts:1506`
- **Other implementations / readers — SUPERSEDED, see "Flagged for Pass 2":** cleared by `app/actions/edits.ts:1377` (deferring a week) and `lib/rebuild.ts:142` (money clearing the mark on any week whose replayed coverage reaches the weekly amount). The `!= null` collapse is repeated at `app/actions/payments-view.ts:72`, `:202`, `:264`; `app/actions/member.ts:250`; `app/actions/dashboard.ts:135`; `app/actions/cycle-position.ts:151`, `:187`; `app/actions/cycle-close.ts:79`; `app/actions/participation-close.ts:121`; `app/actions/waiting.ts:178`; `app/actions/payments.ts:387`; `app/admin/(protected)/collections/page.tsx:121`; `app/admin/(protected)/cycle/position/week-dates-data.ts:106`; `lib/messaging-engine.ts:130`; `lib/rebuild.ts:47`; and in scripts at `scripts/audit-position-figures.mts:99`, `:127`; `scripts/verify-cycle-position.mts:69`, `:112`; `scripts/verify-participation-close.mts:102`; `scripts/elapsed-rule-impact.mts:90`. In SQL at `prisma/migrations/20260812020000_manual_late_mark/migration.sql:22`. Also `lib/dashboard.ts:377` (fed into paymentStatus) and `:381` (emitted again as a display note), `app/admin/(protected)/cycle/position/week-dates.ts:113`, `app/actions/edits.ts:1530-1533` (audit before/after payload records raw timestamps), `components/admin/week-action-panel.tsx:245` (`const next = !detail.markedLate` — the client's toggle), `scripts/deferral-impact.mts:81` (deliberately forces it false on both sides).
- **Surfaces:** `app/admin/(protected)/this-week/page.tsx:204` ("you marked this" pill), `components/admin/week-action-panel.tsx:394` ("Marked late by you"), `components/admin/week-action-panel.tsx:420` (Mark late / Remove late mark button)
- **Units:** a TIMESTAMP, not a flag and not money. §2.29 records it as a deliberate carve-out from the derive-everything rule.

### Whether the manual late mark may be applied to this week (and what to say)

- **Formula:** four cases, deferral tested first — deferred → refuse ("remove the
  deferral first"); window already closed → refuse, there is nothing to mark; week has
  not started yet → allow with a warning; week started and window still open → allow
  silently. Separately, a week already paid in full is refused at the write.
- **Inputs:** `Week.date`, today, `Payment.isDeferred`, `Payment.amountPaid`, `Participation.weeklyAmount`, `PAYMENT_WINDOW_DAYS`
- **Canonical:** `lib/derived.ts:238`, day arithmetic inlined at `lib/derived.ts:252`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/edits.ts:1486` (server-side call before the write), `app/actions/payments-view.ts:208` (the same call on the read path, so control and action share one clock), `app/actions/edits.ts:1499` (the money-beats-the-mark refusal `amountPaid >= weeklyAmount`, written separately), `lib/rebuild.ts:143` (the same money-beats-the-mark test a third time, as the automatic clearing rule), `components/admin/week-action-panel.tsx:405` (client re-decides whether to render the control), `:417` (re-decides disabled from `lateAdvice.kind === "deferred"`), `:389` (a separate `weekIsSkipped` gate not part of the four cases)
- **Surfaces:** `components/admin/week-action-panel.tsx:405`, `:417`, `:453`, `lib/derived.ts:213` (`DEFERRED_BEATS_MARK` — the one sentence)
- **Units:** whole DAYS for the window test; CENTS for the already-paid refusal.

### Deferred (the organizer's other stored decision)

- **Formula:** a boolean on the member's week row. Its meaning: the money is still owed
  and still counts toward behind and outstanding; only the chasing stops, and the week
  never reads LATE.
- **Inputs:** `Payment.isDeferred`
- **Canonical:** the stored column `prisma/schema.prisma:302`; written by `app/actions/edits.ts:1365`
- **Other implementations / readers — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/edits.ts:1278` (updatePaymentRow also flips it, from the participation editor); `app/admin/(protected)/payments/payments-grid.tsx:88`, `app/admin/(protected)/payments/patterns-view.tsx:55`, `app/admin/(protected)/payments/payments-members.tsx:96` (client screens re-derive `isDeferred` from the CELL STATUS rather than from the stored column); `lib/dashboard.ts:253` (`if (payment?.isDeferred) continue` — weekReceipts DROPS a deferred member from what the week expected, the opposite treatment from `lib/payments-view.ts:225`); `lib/payments-view.ts:130` (files a deferred member under "paid"); `lib/week-picking.ts:39` and `lib/week-selection.ts:9` (deferred is explicitly still tickable); `lib/settlement.ts:33` (a deferred week settles normally from a payout); `lib/standing.ts:117` (a deferred week's pinned settlement lands normally); `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql` and `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql` (the `member_progress` view's `excused` counts a personal deferral as excused — the OLD meaning, still in SQL); `scripts/verify-member-privileges.mts:75` (SQL) and `:92` (TypeScript) replay that old rule; `scripts/deferral-impact.mts:78` and `:83` (`isSkipped: personallyDeferred || week.isSkipped` — reproduces the pre-ruling meaning); `app/admin/(protected)/cycle/position/week-dates.ts:53` and `:77`.
- **Surfaces:** `components/admin/week-action-panel.tsx:395`, `:441`, `app/admin/(protected)/this-week/page.tsx:199`, `app/admin/(protected)/people/[id]/participation-editor.tsx:1611`, `:1640`, `lib/status-labels.ts:88` (DEFERRED_PHRASE)
- **Units:** boolean.
- **Note:** `participation-editor.tsx:1640` words it as "excused, never owed", which is the SKIPPED meaning in `lib/status-labels.ts:80` — recorded here, not judged.

### Skipped (cycle-wide week nobody owed)

- **Formula:** a boolean on the week row itself, applying to every member. It removes the
  week from the amount due, from the behind-count, and from what the week expected to collect.
- **Inputs:** `Week.isSkipped`
- **Canonical:** `prisma/schema.prisma:171`
- **Other implementations / readers — SUPERSEDED, see "Flagged for Pass 2":** `lib/standing.ts:176` (`skippedElapsed`), `lib/standing.ts:122`, `lib/dashboard.ts:565` (counted from stored payment rows carrying `week.isSkipped`, so a member with no row for a skipped week is not counted), `lib/dashboard.ts:252`, `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:57` (counted from the weeks table), `lib/payments-view.ts:225` (excludes a week when `week.isSkipped` OR the cell status is SKIPPED), `lib/derived.ts:189`, `lib/derived.ts:299`, `lib/allocation.ts:90`, `lib/week-picking.ts:44`, `lib/week-selection.ts:21`, `lib/settlement.ts:29`, `lib/settlement.ts:72`, `lib/draw-settlement.ts:107`, `app/admin/(protected)/cycle/position/week-dates.ts:97`, `app/admin/(protected)/payments/patterns-view.tsx:54` (re-derived from the cell status rather than the week row), `app/actions/cycle-close.ts:257`, `scripts/audit-position-figures.mts:229`, `scripts/elapsed-rule-impact.mts:229`, `scripts/verify-member-privileges.mts:74` (SQL: skipped OR personally deferred counted together as excused)
- **Surfaces:** `app/admin/(protected)/this-week/page.tsx:173`, `components/admin/week-action-panel.tsx:390`, `lib/status-labels.ts:89` (SKIPPED_PHRASE)
- **Units:** boolean.

### Is there anything to chase this member about (the chasing gate)

- **Formula:** true when at least one of the member's derived week statuses is LATE.
  Reads only the derived status, never the stored mark, so a deferred week can never make
  a chase sendable.
- **Inputs:** per-week status (derived)
- **Canonical:** `lib/messages.ts:174`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/messages.ts:223` (`lateWeeks`, for the `{lateWeeks}` placeholder), `lib/messages.ts:576` (`sendDecision` — the actual BLOCK, a different site from the applicability panel at `:723`), `lib/messages.ts:732` (BEHIND_NOTICE gated on `weeksBehind > 0`; refusal sentence at `:741`), `lib/messages.ts:753` (LATE_NOTICE gated on `amountOutstanding > 0` instead of on a LATE week), `app/actions/messages.ts:435` (prepareBatch re-filters `standing.weeks` for `status === "LATE"`), `app/actions/messages.ts:438` (BEHIND_NOTICE gated on `facts.weeksBehind > 0`), `app/actions/member.ts:300` (`lateCount`, the same filter for the member portal), `components/member/week-stamp-list.tsx:183` (the member-facing "not paid" set — LATE + DEFERRED + PARTIAL, a wider set), `lib/members-view.ts:64`, `scripts/deferral-impact.mts:158-159`, `scripts/elapsed-rule-impact.mts:136`
- **Surfaces:** `lib/messages.ts:333` (`{lateWeeks}` in a sent message), `app/me/page.tsx:260` (lateCount on the member's own summary), `components/member/member-personal-summary.tsx:164`, `:170`, the message-centre applicability panel via `lib/messages.ts:723`
- **Units:** a count of WEEKS; the `{lateWeeks}` placeholder renders week NUMBERS as a compact list (`lib/messages.ts:181`).
- **Merged from:** "Is there anything to chase this member about" + "My late count".

### Consistency state per week, and longest overdue run

- **Formula:** state is a mapping from the already-derived status — PAID→paid,
  PARTIAL→partial, DEFERRED→deferred, LATE→overdue, UNPAID and SKIPPED both→not-due. Run
  is the longest streak of consecutive "overdue" states in the member's strip.
- **Inputs:** per-week status (derived); or, on the alternative entry point, raw amountDue / amountPaid / isDeferred / windowClosed
- **Canonical:** `lib/chart.ts:230` (`consistencyFromStatus`), `lib/chart.ts:201` (`longestOverdueRun`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/chart.ts:186` (`consistencyState` — the same five states derived independently from raw amounts, with no skipped and no mark), `lib/chart.ts:189` (takes `windowClosed` as an input its callers must decide themselves), `components/charts/consistency-strip.tsx:131` (recomputes `longestOverdueRun` per member at render time), `:132` (its own count of overdue weeks per member — a second per-member lateness tally beside weeksBehind), `app/admin/(protected)/payments/payments-screen.tsx:184`, `app/admin/(protected)/payments/patterns-view.tsx:52-55` (feeds raw amounts AND status-derived flags into the same view — both entry points on one screen)
- **Surfaces:** `app/admin/(protected)/payments/payments-screen.tsx:184`, `components/charts/consistency-strip.tsx:131`
- **Units:** CENTS on the `consistencyState` path only; the canonical mapping path carries no amounts.

### Last payment week

- **Formula:** the last window week whose STORED row carries money greater than zero.
- **Inputs:** `Payment.amountPaid`, `Week.weekNumber`
- **Canonical:** `lib/standing.ts:199` (with `lib/standing.ts:188`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/dashboard.ts:112`, `:117`, `app/actions/cycle-position.ts:125`, `:130`, `app/admin/(protected)/cycle/position/week-dates-data.ts:79`, `:84`, `lib/participation-close.ts:169`, `app/actions/participation-removal.ts:133`, `scripts/audit-position-figures.mts:76`, `:81`
- **Surfaces:** `app/admin/(protected)/people/[id]/page.tsx:382`, `lib/messaging-engine.ts:182`, `lib/cycle-close.ts:161`, `lib/cycle-close.ts:183`
- **Units:** a week number; decided by a cents comparison.
- **Verification correction:** it is the LAST ELEMENT of `windowWeeks.filter(w => w.storedPaid > 0)`, not a maximum. It equals the highest week number only if the caller passes `windowWeeks` in ascending order, and `computeStanding` does not assert that ordering (`allocatePayment` asserts it separately at `lib/allocation.ts:75`).

### Surplus beyond the member's whole window (allocation remainder)

- **Formula:** what is left over after the member's entire money total has been
  re-allocated across every week of their window at the current rate.
- **Inputs:** total paid (derived), week amountDue (derived), pinned settlement coverage (derived), `Week.isSkipped`
- **Canonical:** `lib/standing.ts:198` (`surplus: effective.unallocated`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/allocation.ts:106`, `lib/week-picking.ts:118`, `lib/contribution.ts:90` (a DIFFERENT surplus — see below)
- **Surfaces:** **SOURCE NOT FOUND** — `computeStanding` returns `surplus` and it is carried in the `getMemberStanding` payload (`app/actions/payments.ts:423`), but no component was found rendering it.
- **Units:** cents.
- **Note:** two unrelated quantities carry the name "surplus" — this one, and
  `lib/contribution.ts:90` (money paid beyond the whole commitment). Only the latter
  reaches a member surface.

### Paid in / commitment total / still to save / surplus / progress (the savings figures)

- **Formula:** paid in is the sum of the receipts. Commitment total is weekly amount
  times weeks committed. Still to save is commitment minus paid in, floored at zero, and
  is explicitly NOT a debt. Surplus is paid in beyond the commitment, floored at zero.
  Progress is paid in over commitment, capped at 1. Overdue is NOT recomputed here — it
  is handed in from the standing engine.
- **Inputs:** `PaymentEvent.amount`, `Participation.weeklyAmount`, `Participation.weeksCommitted`, amount outstanding (derived, passed in)
- **Canonical:** `lib/contribution.ts:74`; commitmentTotal `:88`, stillToSave `:89`, surplus `:90`, weeksCovered `:91-94`, overdue passthrough `:100`, progress `:103`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/money.ts:73` and `lib/money.ts:78` (`calculateGross`, the canonical weekly × weeks product several inlined copies bypass), `lib/final-position.ts:135`, `:136`, `lib/dashboard.ts:481`, `lib/dashboard.ts:492`, `lib/participation-removal.ts:100`, `lib/projection.ts:125`, `lib/participation-close.ts:324`, `lib/participation-close.ts:485`, `lib/messages.ts:219`, `lib/settlement.ts:112`, `lib/settlement.ts:113`, `lib/week-winners.ts:141`, `app/actions/agreement.ts:127`, `app/actions/dashboard.ts:291`, `app/actions/cycle-position.ts:251`, `app/actions/member.ts:207-210`, `components/member/member-personal-summary.tsx:39`, `:40`, `components/member/savings-arc.tsx:48`, `:49`, `components/member/member-group-list.tsx:85`, `app/admin/(protected)/people/people-directory.tsx:259`, `app/admin/(protected)/waiting/waiting-view.tsx:472`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:278`, `lib/chart.ts:307`, `scripts/verify-number-amounts.mts:66`, `scripts/audit-position-figures.mts:182`, `:320`, `scripts/verify-participation-close.mts:148`, `:398`, `:411`
- **Surfaces:** `app/me/page.tsx:250`, `components/member/saved-card.tsx:39`, `:51`, `:62`, `:67`, `:96`, `components/member/savings-arc.tsx:100`, `:109`, `:111`, `app/admin/(protected)/people/[id]/page.tsx:348`, `:353`, `lib/contribution.ts:113` (savingSummary sentence), `app/agreement/agreement-signer.tsx:99`, `components/member/signed-agreements.tsx:68`
- **Units:** cents, except `progress` which is a 0..1 float (`lib/contribution.ts:103`).
- **Merged from:** four sweeps ("Paid in / still to save / commitment total / progress", "Still to save and surplus beyond the commitment", "My commitment total", "Savings progress fraction").

### On track / behind flag, and how many are current

- **Formula:** a member is "current" when their weeks-behind count is exactly zero;
  otherwise the pill shows the count. The group figure is the count of rows in the
  `member_progress` view for the active cycle whose `weeks_behind` is zero, over the
  total row count.
- **Inputs:** weeks behind (derived — from the SQL view on the member group page)
- **Canonical:** `components/member/member-group-list.tsx:82`; group count `app/actions/member.ts:460` (with `:459`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `components/member/member-group-list.tsx:166` (the same test per peer row), `app/admin/(protected)/people/[id]/page.tsx:377`, `lib/messages.ts:732` (the same test inverted), `app/actions/messages.ts:438`, `lib/dashboard.ts:567` (`if (behind === 0) continue`), `lib/dashboard.ts:582` (`if (owed === 0) continue` — so the admin count is behind-AND-owing, not behind alone), `app/actions/cycle-close.ts:295` and `lib/cycle-close.ts:256` (`membersShort` = members with outstanding > 0 — the money-side equivalent), `lib/cycle-position.ts:218` (`owedBy` filtered to amount > 0)
- **Surfaces:** `components/member/member-group-list.tsx:102`, `:128`, `:186`, `app/admin/(protected)/people/[id]/page.tsx:377`, `app/me/group/page.tsx:35`
- **Units:** WEEKS compared to zero; a count of people for the group figure, computed in SQL against `current_date`, not the app clock.
- **Merged from:** "On track / behind flag" + "Members current (group page count)" + "How many of us are current this week".

### Which members count as behind on the payments members list

- **Formula:** a row matches the "behind" filter when its outstanding amount is above
  zero. The "unpaid-week" filter matches when this week's cell status is neither PAID nor DEFERRED.
- **Inputs:** amount outstanding (derived), per-week status (derived)
- **Canonical:** `lib/members-view.ts:60` (behind), `lib/members-view.ts:63` (unpaid-week)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/members-view.ts:68` (the "partial" filter), `lib/members-view.ts:88` (`sortWorstFirst` — orders by outstanding, then weeksCredited ascending), `lib/members-view.ts:91`, `lib/members-view.ts:116` (`sortMostSaved`), `lib/payments-view.ts:130`, `app/admin/(protected)/payments/payments-members.tsx:260`, `app/admin/(protected)/payments/payments-grid.tsx:361`, `app/admin/(protected)/people/[id]/member-payments.tsx:182`, `app/admin/(protected)/people/[id]/page.tsx:363`, `:367`, `:490`, `components/member/saved-card.tsx:86`, `components/member/savings-arc.tsx:77`, `:112`, `lib/cycle-position.ts:218`, `lib/cycle-position.ts:227`, `lib/dashboard.ts:582`, `lib/cycle-close.ts:154`, `lib/cycle-close.ts:256`
- **Surfaces:** `app/admin/(protected)/payments/payments-members.tsx`, `app/admin/(protected)/payments/payments-screen.tsx`
- **Units:** CENTS for outstanding; the status comparison carries no units.

### Members needing attention (the behind list)

- **Formula:** for each participation with no open break, build the set of weeks that
  count as due now (their start week through the cycle's last elapsed week, capped at
  their finish week, plus any week marked late that is not deferred). Weeks credited
  comes from their total paid over their weekly amount. Behind = due-week count minus
  skipped minus credited. Owed = netted shortfall over those due weeks, weeks with no
  stored row still owing their full weekly amount. Drop anyone at zero behind or zero owed.
- **Inputs:** `Payment.amountPaid`, `Payment.isDeferred`, `Payment.markedLateAt`, `Week.isSkipped`, `Participation.startWeek`, `Participation.weeksCommitted`, `Participation.weeklyAmount`, `ParticipationBreak.fromWeek`/`toWeek`, elapsedThroughWeek (derived)
- **Canonical:** `lib/dashboard.ts:510`; dueWeeks `:543-559`, elapsedCount `:561`, credited `:563`, skipped `:565`, behind `:566`, week objects `:575-579`, owed `:581`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/standing.ts:96` (`computeStanding` — the same two figures per member, but from each week row's own stored date rather than from a week-number range), `app/actions/cycle-position.ts:199`, `:203`, `:206` (`owedBy`, built from `computeStanding` over the member's WHOLE window rather than the elapsed one), `app/actions/dashboard.ts:181`, `app/actions/dashboard.ts:182` (feeding memberAttention its own third recomputation of elapsedThroughWeek at `:186`), `lib/dashboard.ts:441` (`standingIssues` — a deliberately SEPARATE list keyed on `totalPaid === 0` and the unsigned agreement rather than on being behind; its commitment at `:481`/`:492`), `scripts/audit-position-figures.mts:350` (runs it against live rows) and `:360` (asserts its length equals the position page's `owedBy` length), `scripts/verify-participation-close.mts:119`, `:385`
- **Surfaces:** `app/admin/(protected)/page.tsx:283` ("N behind · $X owed"), `app/actions/dashboard.ts:181`, `lib/presentation.ts:188` (weeksBehind kept, amountOwed zeroed in presentation mode)
- **Units:** amountOwed in CENTS, weeksBehind in WEEKS.
- **Verification note:** `lib/dashboard.ts:575-579` constructs its week objects with only `{ amountDue, amountAlreadyPaid, isDeferred }` — no `isSkipped` field — so `amountOutstanding`'s skipped exclusion cannot fire on this path. Recorded, not judged.
- **Merged from:** "Amount owed by a member on the attention list" + "Members needing attention".

### Weeks paid and weeks behind as the database computes them (`member_progress` view)

- **Formula:** weeks paid — the sum of the member's stored week amounts divided by their
  weekly amount, floored and capped at weeks committed. Weeks behind — weeks of their
  window whose stored date plus 5 days has passed, minus the skipped ones, minus that
  same quotient, floored at zero.
- **Inputs:** `Payment.amountPaid`, `Participation.weeklyAmount`, `Participation.weeksCommitted`, `Participation.startWeek`, `Week.date`, `Week.isSkipped`
- **Canonical:** `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:33` (weeks_paid) and `:37` (weeks_behind)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/derived.ts:122`, `lib/derived.ts:138`, `lib/contribution.ts:91`, `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:67`, `:70`, `:100`, `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:157`, `:158`, `scripts/verify-member-privileges.mts:67`, `:69`, `:79`, `:95`, `:96`, `scripts/elapsed-rule-impact.mts:213`, `:219`, `:234`
- **Surfaces:** `app/actions/member.ts:416`, `app/actions/member.ts:440-457` (viewer at `:448`, peers at `:457`), `components/member/member-group-list.tsx:124`, `:183`, `app/me/group/page.tsx`
- **Units:** cents divided as numeric then cast to int weeks; the 5-day window is a SQL literal rather than the shared `PAYMENT_WINDOW_DAYS` constant.
- **Note:** it is a PARALLEL ROOT — it reads the stored columns straight out of Postgres
  and re-implements weeks_paid and weeks_behind without touching any TypeScript node in
  this map, and it never sees `markedLateAt`. Two superseded copies of the same view are
  still in the migrations tree; the oldest derives its elapsed count from a week number
  projected off `cycle.startDate` (`20260804230000/migration.sql:149`) rather than each
  week's own date.

---

## B3 — The calendar and the week clock

### Has this week's payment window closed (elapsed)

- **Formula:** take the UTC calendar day of the week's OWN stored date and the UTC
  calendar day of today; the window has closed once the difference in whole days is at
  least the window length (5 days, so days 0–4 open and late from day 5). Never counted
  off the cycle's start date.
- **Inputs:** `Week.date`, today, `PAYMENT_WINDOW_DAYS` (`lib/derived.ts:13`, the named constant 5)
- **Canonical:** `lib/derived.ts:68`, arithmetic at `lib/derived.ts:68-79`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/derived.ts:194` (paymentStatus recomputes the same day difference inline), `lib/derived.ts:252` (manualLateAdvice recomputes it inline — a third copy in one file), `lib/derived.ts:77`, `app/actions/dashboard.ts:224` (`utcDay(today) >= utcDay(week.date) + PAYMENT_WINDOW_DAYS * MS_PER_DAY`, written out by hand), `app/actions/dashboard.ts:233-239` (lastOpenDay and daysLeft — the same boundary twice more), `app/admin/(protected)/cycle/position/week-dates.ts:129-135` (`weekWindowClosesOn`, with MS_PER_DAY redefined locally at `:119`), `app/admin/(protected)/cycle/position/week-dates.ts:151` (`weekClock` — delegates for "closed", own ISO-day compare for open vs ahead at `:161`/`:165`), `app/admin/(protected)/cycle/position/week-dates.ts:159`, `:299`, `:300`, `:305`, `app/admin/(protected)/cycle/position/week-dates-data.ts:116`, `lib/chart.ts:186`, `lib/chart.ts:189` (takes `windowClosed` as an input its callers decide themselves), `lib/cycle-lock.ts:61` (`closeTiming` — the same utcDay difference against the cycle's FINAL week date, against a separate `closingWaitDays` whose default is also 5: `lib/cycle-lock.ts:21`, `lib/setting-defaults.ts:103`, pinned equal to `PAYMENT_WINDOW_DAYS` by `lib/settings.test.ts:32`), `lib/dashboard.ts:156` and `lib/dashboard.ts:286` (a DIFFERENT route: `w.weekNumber <= elapsedThroughWeek`, a week-number comparison rather than a date comparison), `lib/cycle-position.ts:186`, `lib/standing.ts:164`, `lib/commitment.ts:154`, `lib/commitment.ts:162`, `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:60`, `:62` (`current_date >= (w.date::date + 5)` — window length hardcoded as 5 in SQL), `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:75`, `:100`, `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:149`, `:162`, `scripts/elapsed-rule-impact.mts:59-60`, `scripts/elapsed-rule-impact.mts:234` (SQL replay with the constant interpolated), `scripts/verify-member-privileges.mts:79` (SQL with a bare literal 5), `scripts/verify-member-privileges.mts:89` (TypeScript with a bare literal 5; MS_PER_DAY and utcDay redefined locally at `:61-62`), `scripts/diagnose-paid-ahead.mts:68` (closing instant by millisecond arithmetic, not UTC-day arithmetic), `scripts/diagnose-paid-ahead.mts:70`
- **Surfaces:** `app/admin/(protected)/cycle/position/week-date-panel.tsx:98`, `:120`, `app/admin/(protected)/this-week/page.tsx:180`, `app/admin/(protected)/page.tsx:55`, `:378`, `app/admin/(protected)/cycle/position/page.tsx:437`, `components/charts/collected-vs-expected-chart.tsx:200-220`, `:331`, `components/charts/cash-position-chart.tsx:185`, `:374`, `app/admin/(protected)/cycle/position/week-dates.ts:170`
- **Units:** whole DAYS on UTC day boundaries. `MS_PER_DAY = 86,400,000` is redeclared in `lib/derived.ts:6`, `lib/dashboard.ts:21`, `lib/commitment.ts:25`, `app/actions/dashboard.ts:29`, `app/actions/payments-view.ts:20`, `app/admin/(protected)/cycle/position/week-dates.ts:119`, `lib/money.ts:9`, `lib/cycle-lock.ts:23`, `scripts/elapsed-rule-impact.mts:28`, `scripts/verify-member-privileges.mts:61`. The 5 is a named constant in TypeScript and a bare literal in the SQL views and in two scripts.
- **Merged from:** three sweeps.

### Days left in the current week's payment window

- **Formula:** the week's own stored date plus the window length, minus today, in whole
  UTC days; the last open day is the week's date plus the window length minus one.
- **Inputs:** `Week.date` (current cycle week), today, `PAYMENT_WINDOW_DAYS`
- **Canonical:** `app/actions/dashboard.ts:231`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/dashboard.ts:234` (`lastOpenDay` — the same arithmetic with `windowDays-1`, computed separately on the next line), `lib/cycle-lock.ts:73` (`daysRemaining = waitDays − elapsed`) and `:74` (`availableOn = week date + waitDays`), `lib/waiting.ts:72` (`daysBetween` — whole floored days by millisecond division), `lib/dashboard.ts:467` (standingIssues' own days helper — utcDay difference floored at zero, for `daysWaiting`)
- **Surfaces:** `app/admin/(protected)/page.tsx:55`, `app/admin/(protected)/page.tsx:132`, `lib/presentation.ts:30`, `lib/presentation.ts:205`
- **Units:** whole DAYS. Not clamped at zero at the source — the sign is checked at the surface (`app/admin/(protected)/page.tsx:55`).

### Elapsed through week (the cycle-wide money boundary)

- **Formula:** the highest week number among the rows given whose own stored date has
  passed its payment window. Zero when nothing has elapsed.
- **Inputs:** `Week.weekNumber`, `Week.date`, today, `PAYMENT_WINDOW_DAYS`
- **Canonical:** `lib/commitment.ts:154` (calls `weekHasElapsed` at `lib/commitment.ts:162`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/cycle-position.ts:187` (recomputed from the series as the max elapsed week number rather than taken from the caller), `lib/cycle-position.ts:186`, `lib/dashboard.ts:156` and `lib/dashboard.ts:286` (applied per week as a stamped flag), `app/actions/dashboard.ts:158`, `:166`, `:186` (three separate recomputations inside one request), `app/actions/cycle-position.ts:143`, `app/admin/(protected)/cycle/position/week-dates-data.ts:116`, `scripts/verify-cycle-position.mts:60`, `scripts/verify-participation-close.mts:65`, `scripts/audit-position-figures.mts:63`, `scripts/diagnose-paid-ahead.mts:46`, `scripts/elapsed-rule-impact.mts:73-74` (recomputed inline per member), `scripts/elapsed-rule-impact.mts:105`, `:106` (a second inline form taking the LAST row rather than the max week number)
- **Surfaces:** `app/admin/(protected)/cycle/position/page.tsx:131`, `:461`, `lib/cycle-position.ts:461` (collectionSentence "Through week N…"), `components/charts/cash-position-chart.tsx:203`, `components/charts/collected-vs-expected-chart.tsx:66`
- **Units:** week number, integer, 0 = none.
- **Note:** explicitly NOT the same as the current week — the gap between them is the 5
  open days, and `lib/cycle-position.ts:96-110` records that conflating the two
  mis-reported $12,925 as paid ahead on the live cycle.

### Elapsed flag stamped on each week of the series

- **Formula:** `weekNumber` is at or below `elapsedThroughWeek`.
- **Inputs:** `Week.weekNumber`, elapsed through week (derived)
- **Canonical:** `lib/dashboard.ts:286`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/dashboard.ts:156` (cashSeries stamps the identical rule onto its own points), `scripts/verify-cycle-position.mts:144` (re-derives the boundary as `p.weekNumber <= elapsed` over flat payment rows rather than reading the flag), `scripts/audit-position-figures.mts:227`, `:240`, `scripts/diagnose-paid-ahead.mts:92`, `components/charts/collected-vs-expected-chart.tsx:66` and `:72` (the flag re-counted twice inside one component)
- **Surfaces:** `components/charts/collected-vs-expected-chart.tsx:66`, `:161`, `:188`, `:239`, `components/charts/cash-position-chart.tsx:80`, `:235`, `:281`
- **Units:** boolean per week.

### Current week of the cycle — projected off the start date

- **Formula:** whole UTC calendar days from the cycle's start date to today, divided by
  7, plus 1. Zero if the cycle has not started. Keeps counting past the planned length
  when reality runs long.
- **Inputs:** `Cycle.startDate`, today (system clock)
- **Canonical:** `lib/money.ts:162` (arithmetic at `lib/money.ts:165-167`)
- **Other implementations / call sites — SUPERSEDED, see "Flagged for Pass 2":** `lib/commitment.ts:191` (used as the fallback inside `currentWeekFromRows`), `app/actions/dashboard.ts:88`, `app/actions/member.ts:232`, `:440`, `:502`, `app/actions/payments-view.ts:105`, `app/actions/payments.ts:374`, `app/actions/cycle-close.ts:57`, `lib/messaging-engine.ts:110`, `app/admin/(protected)/collections/page.tsx:97`, `:98`, `app/admin/(protected)/cycle/page.tsx:33`, `app/admin/(protected)/cycle/page.tsx:39` (`effectiveWeek = Math.max(1, week)`, a clamped variant used to pick who is in-window for the weekly pot at `:43-44`), `app/admin/(protected)/cycle/add/page.tsx:87`, `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:149` (a SQL implementation: `greatest(0, floor((current_date - c."startDate"::date) / 7.0) + 1)::int AS week_no` — uses `current_date` in the server timezone, not UTC days), `scripts/verify-member-privileges.mts:60`, `scripts/portal-test-fixture.mts:51` (clamped the same way as the cycle page), `scripts/elapsed-rule-impact.mts:52`, `scripts/deferral-impact.mts:53`
- **Surfaces:** `app/admin/(protected)/cycle/page.tsx:57`, `:60`, `app/admin/(protected)/page.tsx:49`, `:126`, `app/admin/(protected)/this-week/page.tsx:79`, `:82`, `app/admin/(protected)/payments/payments-screen.tsx:101`, `app/admin/(protected)/payments/payments-members.tsx:277`, `app/me/group/page.tsx:33`, `app/me/collections/page.tsx:24`, `components/admin/week-picker.tsx:58`
- **Units:** weeks, integer; 0 means "not started". `lib/week-date-authority.test.ts:167-178` keeps an explicit DISPLAY_ONLY allow-list of every caller and asserts no money derivation calls it (the enumeration of the split is at `lib/week-date-authority.test.ts:165-199`).

### Current week of the cycle — read off the stored week rows

- **Formula:** the highest week number whose own stored date is on or before today. Past
  the last stored row, continue the seven-day rhythm from that row. If no stored row has
  arrived yet, fall back to the start-date projection.
- **Inputs:** `Week.weekNumber`, `Week.date`, `Cycle.startDate`, today
- **Canonical:** `lib/commitment.ts:176`; fallback at `lib/commitment.ts:191`; past-the-last-row arithmetic at `lib/commitment.ts:194-197`
- **Other implementations / call sites — SUPERSEDED, see "Flagged for Pass 2":** `lib/money.ts:162` (the projected route — same quantity, different answer for the days between a week arriving and its window closing), `app/actions/cycle-position.ts:103`, `app/actions/waiting.ts:75`, `app/actions/wheel.ts:110`, `app/actions/participation-close.ts:89`, `:203`, `:441`, `lib/cycle-position.ts:188` (falls back to `elapsedThrough` when no currentWeek is supplied), `lib/standing.ts:105` (accepts `cycleWeek` but documents it display-only — no money derives from it, confirmed at `lib/standing.ts:100-105`), `app/admin/(protected)/cycle/position/week-dates.ts:161` (its own ISO-day "has this week arrived" test), `scripts/audit-position-figures.mts:63-64`, `scripts/diagnose-paid-ahead.mts:46-47`, `scripts/verify-cycle-position.mts:60`, `scripts/verify-participation-close.mts:65`, `scripts/elapsed-rule-impact.mts:74` (`rulingCycleWeek` — a synthesised cycleWeek equal to the highest elapsed week number)
- **Surfaces:** `app/admin/(protected)/cycle/position/page.tsx:102`, `:182`, `app/admin/(protected)/waiting/waiting-view.tsx:508`, `app/admin/wheel/setup/wheel-setup.tsx:471`
- **Units:** weeks, integer. Deliberately has no payment-window grace — it answers "where are we", not "what is overdue" (comment `lib/commitment.ts:168-175`).
- **Note:** FOUR derivations of "current week" exist under one name — this one, the
  projected one, the SQL `week_no` (`20260804230000/migration.sql:149`), and
  `collectionPosition`'s elapsed-boundary fallback (`lib/cycle-position.ts:188`).

### Selected week (which week a screen is showing)

- **Formula:** the week asked for by the caller or URL if a week row actually exists for
  it; otherwise the current week.
- **Inputs:** `Week.weekNumber`, current week (derived), URL `?week`
- **Canonical:** `app/actions/dashboard.ts:92` (existence check at `app/actions/dashboard.ts:93-94`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/payments-view.ts:91` (`resolveTargetWeek` — requested, else cycle week, else the LAST week when the clock has run past the cycle; three-branch body at `lib/payments-view.ts:100-104`), `lib/week-focus.ts:25` (`focusedWeek` — a third parse/range rule, range-checked against grid row count, returns null rather than falling back), `app/admin/(protected)/this-week/page.tsx:50-52` (a fourth parse: `Number.parseInt` + `Number.isSafeInteger` decides whether `?week` is forwarded at all), `app/admin/(protected)/payments/page.tsx:35` (`focusedWeek` bounded by `grid.rows.length` rather than by the stored week rows), `app/me/schedule/page.tsx:39` (the member portal's own "which week are we on")
- **Surfaces:** `app/admin/(protected)/this-week/page.tsx:49-52`, `:79`, `:94-101`, `components/admin/week-picker.tsx:54`, `app/admin/(protected)/payments/page.tsx:35`, `app/admin/(protected)/payments/payments-screen.tsx:130`
- **Units:** week number, integer.
- **Note:** `lib/payments-view.ts:91` has NO production caller — `app/actions/payments-view.ts:87-91` records that the week board it served was removed. Recorded, not judged.

### The date of a week number

- **Formula:** the STORED week row's date always wins. Only when no row exists for that
  number is the date projected as cycle start plus (week number − 1) × 7 days.
- **Inputs:** `Week.weekNumber`, `Week.date`, `Cycle.startDate`
- **Canonical:** `lib/commitment.ts:90` (preference at `lib/commitment.ts:96-102`, with a `source: "stored" | "computed"` discriminator at `lib/commitment.ts:71`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/money.ts:150` (`dateOfWeek` — the raw projection; `lib/week-date-authority.test.ts:50` forbids `app/` and `components/` from calling it, with `app/actions/cycles.ts` as the only allowed exception), `lib/money.ts:133` (`generateWeekDates`, creation-time projection, used at `app/actions/cycles.ts:135`), `lib/commitment.ts:117` (`nextWeekDates` — write-side projection anchored on the LAST STORED row) with the rhythm line at `lib/commitment.ts:140`, `lib/commitment.ts:59` (`storedWeekDates`, the lookup builder), `app/actions/cycle-close.ts:204`/`:206` (inline `startDate + (plannedWeeks − 1) × 7 × 86_400_000` fallback), `lib/messaging-engine.ts:145-147` (a second stored-date lookup built by hand), `app/actions/member.ts:173-174` (a third lookup, stored-only, no projection), `lib/member-week-dates.ts:171-175` (`resolveOwnWeeks` pairs cycle weeks to stored dates and THROWS rather than project when a date is missing), `app/actions/dashboard.ts:352`, `:356`. Fixture/test copies that recompute the projection: `lib/contribution.test.ts:10`, `lib/messages.test.ts:29`, `lib/standing.test.ts:7`, `:335`, `lib/members-view.test.ts:14`, `lib/manual-late.test.ts:188`, `lib/member-week-dates.test.ts:13`, `lib/messaging-engine.test.ts:70`, `lib/placeholder-kinds.test.ts:22`, `:190`, `lib/required-extras.test.ts:25`, `lib/week-date-authority.test.ts:102`, `lib/money.test.ts:184`, `app/admin/(protected)/cycle/position/week-dates.test.ts:44`, `app/admin/(protected)/cycle/position/week-date-panel.test.tsx:44`, `scripts/lib/production-fixture.mts:99`, `scripts/verify-draw-cascade.mts:67`, `scripts/verify-week-winners.mts:62`, `scripts/verify-cycle-lock.mts:73`, `scripts/verify-removal-cascades.mts:62`, `scripts/verify-number-conflict.mts:74`
- **Surfaces:** `components/admin/week-picker.tsx:57`, `app/admin/(protected)/cycle/position/week-date-panel.tsx:98`, `app/me/schedule/page.tsx:66`, `app/admin/(protected)/cycle/position/page.tsx:437`
- **Units:** dates, stored as UTC midnight and rendered UTC (`lib/money.ts:5-7`). The fixture copies all use the raw projection with no stored-row precedence.

### Finish week (a member's own last week, inclusive)

- **Formula:** start week plus weeks committed, minus one.
- **Inputs:** `Participation.startWeek`, `Participation.weeksCommitted`
- **Canonical:** `lib/money.ts:113` (line `lib/money.ts:116`)
- **Other implementations — inlined `startWeek + weeksCommitted − 1` — SUPERSEDED, see "Flagged for Pass 2":** `lib/week-winners.ts:161`, `lib/week-winners.ts:208`, `app/admin/(protected)/people/[id]/participation-editor.tsx:429`, `:448`, `scripts/portal-test-fixture.mts:92`; the inverse `startWeek = finishWeek − weeksCommitted + 1` at `lib/messages.ts:237`; the window LENGTH re-derived at the surface as `finishWeek − startWeek + 1` at `app/admin/(protected)/payments/payments-grid.tsx:352`, `:353`, `:357` and `app/admin/(protected)/payments/payments-members.tsx:256`.
- **Other call sites of `calculateFinishWeek`:** `lib/standing.ts:113`, `lib/participation-close.ts:122`, `:134`, `:197`, `:477`, `lib/participation-window.ts:46`, `:47`, `:70`, `:122`, `lib/wheel.ts:48`, `:85`, `lib/rebuild.ts:35`, `lib/draw-settlement.ts:103`, `lib/dashboard.ts:532`, `lib/participation-rules.ts:118`, `lib/commitment.ts:238`, `app/actions/cycle-position.ts:202`, `app/actions/waiting.ts:160`, `app/actions/member.ts:233`, `app/actions/payments.ts:50`, `app/actions/payments-view.ts:55`, `:253`, `app/actions/cycle-close.ts:61`, `app/actions/edits.ts:529`, `:2201`, `app/actions/participations.ts:199`, `:287`, `:347`, `app/actions/participation-close.ts:83`, `:228`, `app/actions/agreement.ts:71`, `lib/messaging-engine.ts:111`, `app/admin/(protected)/collections/page.tsx:104`, `app/admin/(protected)/cycle/page.tsx:44`, `app/admin/(protected)/people/[id]/participation-editor.tsx:284`, `:382`, `app/admin/(protected)/people/[id]/page.tsx:1148`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:415`, `:418`, `scripts/verify-member-privileges.mts:87`, `scripts/elapsed-rule-impact.mts:64`, `scripts/deferral-impact.mts:59`, `:253`, `scripts/audit-position-figures.mts:146`, `:219`, `scripts/repro-participation-shorten.mts:70`, `:141`
- **SQL half-open forms:** `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:59`, `:61`, `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:99`, `scripts/verify-member-privileges.mts:78`, `scripts/elapsed-rule-impact.mts:233`
- **Surfaces:** `app/admin/(protected)/people/[id]/page.tsx:372`, `:1144`, `app/admin/(protected)/cycle/page.tsx:183`, `app/admin/(protected)/waiting/waiting-view.tsx:507`, `app/admin/wheel/setup/wheel-setup.tsx:471`, `app/admin/(protected)/payments/payments-grid.tsx:275`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:415`, `lib/messages.ts:314` (`{finishWeek}`)
- **Units:** weeks, integer, inclusive of the finish week. The SQL copies use the HALF-OPEN form (`weekNumber < startWeek + weeksCommitted`) rather than the inclusive `<= finishWeek` the TypeScript uses.

### Is a given week inside a member's window

- **Formula:** the week is at or after their start week, at or before their committed
  finish week, and not inside any stretch they were away for.
- **Inputs:** `Participation.startWeek`, `Participation.weeksCommitted`, `ParticipationBreak.fromWeek`, `ParticipationBreak.toWeek`, `Week.weekNumber`
- **Canonical:** `lib/participation-close.ts:120` (`inWindow`), break half `lib/participation-close.ts:93`/`:96`
- **Other implementations (break-aware) — SUPERSEDED, see "Flagged for Pass 2":** `lib/dashboard.ts:245` (imported as `inMemberWindow`), `lib/dashboard.ts:362`, `app/admin/(protected)/cycle/position/week-dates.ts:108`
- **Other implementations (break-UNAWARE) — SUPERSEDED, see "Flagged for Pass 2":** `lib/wheel.ts:48`, `lib/wheel.ts:49`, `lib/week-winners.ts:162`, `:163`, `:209`, `lib/participation-window.ts:47`, `:123`, `lib/payments-view.ts:217`, `:218`, `lib/draw-settlement.ts:104`, `lib/rebuild.ts:39`, `lib/messages.ts:281` (over a start week re-derived backwards at `lib/messages.ts:237`), `app/actions/member.ts:241`, `app/actions/payments-view.ts:63`, `:255`, `app/actions/payments.ts:53`, `app/actions/cycle-position.ts:178`, `app/actions/cycle-close.ts:70`, `app/actions/waiting.ts:169`, `lib/messaging-engine.ts:121`, `app/admin/(protected)/cycle/page.tsx:43`, `app/admin/(protected)/collections/page.tsx:104`, `:112`, `scripts/audit-position-figures.mts:118`, `:219`, `:220-221` (inBreak half rebuilt inline), `scripts/verify-member-privileges.mts:88`, `scripts/elapsed-rule-impact.mts:66`, `scripts/deferral-impact.mts:67`, `:256`, `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:60-61`, `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:98-99`, `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:177` (`w."weekNumber" <= cw.week_no` only — no start-week floor at all in the deferral count)
- **Surfaces:** `app/admin/(protected)/payments/payments-grid.tsx:275`, `app/me/page.tsx` (their weeks list), `app/admin/(protected)/cycle/position/page.tsx`
- **Units:** boolean per (member, week). A break is a HOLE, not a truncation (comment `lib/participation-close.ts:110-118`).

### Effective finish week (where a stopped member's window actually ends)

- **Formula:** their committed finish week, or the week before the first OPEN
  participation break if one has started — whichever is earlier.
- **Inputs:** `Participation.startWeek`, `Participation.weeksCommitted`, `ParticipationBreak.fromWeek`, `ParticipationBreak.toWeek`
- **Canonical:** `lib/participation-close.ts:133`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/participation-close.ts:161` (`legacyBreak` — for a CLOSED participation with no recorded stopping week, the window is read as ending after their LAST WEEK WITH MONEY, or before their start week if they never paid; floor at `lib/participation-close.ts:169`), `lib/participation-close.ts:179` (`windowBreaks` — picks stored breaks over the legacy derivation), `app/actions/dashboard.ts:105` (`breaksOf`) and `:275`, `app/actions/cycle-position.ts:118` (a second copy of the closure) and `:239`, `app/actions/member.ts:168`, `app/admin/(protected)/cycle/position/week-dates-data.ts:78` (a third copy) and `:80`, `app/actions/participation-close.ts:453` (`fromWeek: (p.closedAtWeek ?? p.startWeek − 1) + 1`, rebuilt inline) and `:459` (`closedAtWeek = open.fromWeek − 1`), `prisma/migrations/20260811020000_participation_breaks/migration.sql:42-49` (the same thing in SQL as the backfill), `scripts/audit-position-figures.mts:75` (a fourth copy of `breaksOf`) with calls at `:171`, `:310`, `:332`, `scripts/verify-participation-close.mts:78` (a fifth copy) and `:80`
- **Surfaces:** `app/admin/(protected)/page.tsx:331`, `app/admin/(protected)/cycle/position/page.tsx:261`, `:271`, `app/me/page.tsx` (stopped record via `app/actions/member.ts:168`)
- **Units:** weeks, integer.

### Own start date, and own finish date (§2.22)

- **Formula:** resolve the date of their start week / finish week — the stored week row's
  day, or a projection off the cycle start when the cycle has no row that far out.
- **Inputs:** `Participation.startWeek`, `Participation.weeksCommitted`, `Week.date`, `Cycle.startDate`
- **Canonical:** start date `lib/commitment.ts:90` (at startWeek); finish date `lib/commitment.ts:221` (`finishPreview`, with its own `resolveWeekDate` call at `lib/commitment.ts:239`), shared sentence `lib/commitment.ts:287` (`finishLine`)
- **Other implementations (start) — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/member.ts:332`, `app/actions/member.ts:205` (the stopped-member branch resolves it from loaded week rows directly at `app/actions/member.ts:173`, no projection fallback), `lib/messaging-engine.ts:168`, `app/actions/agreement.ts:70`, `app/actions/agreement.ts:88`, `lib/member-week-dates.ts:175`, `lib/messages.ts:288`, `lib/messages.ts:322`
- **Other implementations (finish) — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/member.ts:316`, `app/actions/member.ts:322` (`resolveWeekDate` called directly at `calculateFinishWeek`, not through `finishPreview`), `lib/messaging-engine.ts:157`, `app/actions/agreement.ts:93`, `app/admin/(protected)/people/[id]/page.tsx:1147`, `app/admin/(protected)/people/[id]/page.tsx:258`, `app/admin/(protected)/people/[id]/participation-editor.tsx:323` (over a stored map built at `:320`), `app/admin/(protected)/cycle/add/add-member-wizard.tsx:255` (over a stored map built at `:233`) and `:417` (the SAME date resolved a second way in the same component)
- **Surfaces:** `app/me/page.tsx:82`, `app/me/page.tsx:229`, `app/me/schedule/page.tsx:59`, `:62`, `lib/member-window.ts:50` (`memberWindowSentence`), `lib/member-window.ts:61`, `:63`, `components/member/member-personal-summary.tsx:178`, `app/admin/(protected)/people/[id]/page.tsx:258`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:850`, `:882`, `app/admin/(protected)/people/[id]/participation-editor.tsx:323`, `lib/messages.ts:315` (`{finishDate}`, falls back to printing the finish WEEK number when no date resolves), `lib/messages.ts:322` (`{startDate}`)
- **Units:** dates, UTC. `lib/member-window.ts:63` drops a missing date rather than printing a placeholder.
- **Merged from:** "Own finish date" + "Own start date" + "My start date" + "My finish date".
- **Note:** for a STOPPED member the equivalent figure is not their finish date but the
  CYCLE's finish (`app/actions/member.ts:189-194`, resolved from `Cycle.plannedWeeks`),
  surfaced inside the sentence at `app/me/page.tsx:135` — a deliberately different fact
  for the same reader.

### Start week (a member's first cycle week)

- **Formula:** stored on the participation, defaulting to 1. The add wizard proposes
  `max(1, current week)`. It can never be earlier than week 1 (D-20).
- **Inputs:** `Participation.startWeek`, current week (derived)
- **Canonical:** `prisma/schema.prisma:187`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/admin/(protected)/cycle/add/add-member-wizard.tsx:99` (`defaultStartWeek = max(1, currentWeek)`), `:146` (the live value), `lib/messages.ts:237` (re-derived backwards from `finishWeek − weeksCommitted + 1`), `lib/participation-rules.ts:25` (validation: never below 1, never above MAX_WEEKS), `lib/participation-close.ts:169` (`startWeek − 1` as the never-paid floor), `app/actions/participation-close.ts:453` (same floor inline), `prisma/migrations/20260811020000_participation_breaks/migration.sql:48` (same floor in SQL), `scripts/portal-test-fixture.mts:51-52` (its own proposal, clamped to the planned end where the wizard is not)
- **Surfaces:** `app/admin/(protected)/people/[id]/participation-editor.tsx:705`, `app/admin/(protected)/people/[id]/page.tsx:372`, `:693`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:769`, `app/admin/(protected)/waiting/waiting-view.tsx:507`
- **Units:** week number, integer, minimum 1.

### Weeks committed (a member's commitment length)

- **Formula:** stored on the participation. The default offered is every remaining week
  from their start through the cycle's planned end, never below 1; the cap without an
  explicit override is the same figure unclamped, so a start week past the planned end
  has a cap of 0.
- **Inputs:** `Participation.weeksCommitted`, `Cycle.plannedWeeks`, `Participation.startWeek`
- **Canonical:** `prisma/schema.prisma:188`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/commitment.ts:47` (`weeksToFinishWithGroup` — the default, clamped to at least 1, start week clamped to plannedWeeks), `lib/commitment.ts:311` and `:321` (`commitmentCap`, deliberately unclamped), `lib/money.ts:126` and `lib/money.ts:129` (`remainingWeeksInCycle`), `lib/participation-rules.ts:41` and `:46` (server-side enforcement), `lib/standing.ts:193` (`missingWeekRows: Math.max(0, weeksCommitted − windowWeeks.length)`), `app/actions/member.ts:211`, `:338`, `:410`, `:449`, `lib/messages.ts:301`, `:321`, `lib/messaging-engine.ts:152`, `app/actions/agreement.ts:121`, `lib/agreement.ts:110`, `app/admin/(protected)/people/page.tsx:63`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:102`, `:140`, `:147`, `app/admin/(protected)/people/[id]/participation-editor.tsx:300`, `:307`, `:425` (client-side pre-check duplicating the cap refusal), the INVERSE `finishWeek − startWeek + 1` at `app/admin/(protected)/payments/payments-members.tsx:256` and `app/admin/(protected)/payments/payments-grid.tsx:352`, `:353`, `:357`, `scripts/portal-test-fixture.mts:53` (inlined, bypassing `remainingWeeksInCycle`), `scripts/repro-participation-shorten.mts:71`
- **Surfaces:** `app/admin/(protected)/cycle/add/add-member-wizard.tsx:769`, `:878`, `app/admin/(protected)/people/[id]/participation-editor.tsx:504`, `:703`, `app/me/page.tsx:97`, `components/member/savings-arc.tsx:103`, `components/member/member-group-list.tsx:125`, `components/member/member-payout-card.tsx:95`, `components/member/member-personal-summary.tsx:152`, `components/member/past-cycle-card.tsx:51`, `app/admin/(protected)/people/people-directory.tsx:239`, `app/admin/(protected)/cycle/close/close-flow.tsx:228`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:96`, `lib/member-window.ts:58`, `lib/messages.ts:301` (`{weeksTotal}`), `lib/messages.ts:321` (`{weeksCommitted}`, pluralised)
- **Units:** weeks, integer, 1..MAX_WEEKS (1000, `lib/money.ts:16`). Drives the fee gross (§2.30).
- **Merged from:** "Weeks committed" + "How many weeks I am paying for".
- **Note:** on `/me/group` the viewer's denominator comes from a separate Prisma read (`app/actions/member.ts:410`) rather than from the `member_progress` view, and peers get no denominator at all (`components/member/member-group-list.tsx:183`).

### A member's own week number (their week 1 is their start week)

- **Formula:** cycle week number minus their start week, plus one; null outside their window.
- **Inputs:** `Week.weekNumber`, `Participation.startWeek`, `Participation.weeksCommitted`
- **Canonical:** `lib/member-window.ts:25` (line `lib/member-window.ts:32`, window clamp at `:33`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/member-week-dates.ts:34` and `:38` (same arithmetic; throws on non-integers and does NOT clamp to the window), `lib/member-week-dates.ts:175` (`resolveOwnWeeks`), `lib/messages.ts:266` (over a start week itself re-derived backwards at `lib/messages.ts:237`), `app/me/schedule/page.tsx:33` and `app/me/page.tsx:208` (both fall back to the CYCLE week number when ownWeek is null)
- **Surfaces:** `app/actions/member.ts:358`, `components/member/equb-calendar.tsx:180`, `components/member/week-stamp-list.tsx:240`, `lib/member-window.ts:69` (`ownWeekLabel` — "week 3 of your 10"), `lib/messages.ts:266`, `lib/member-week-dates.ts:60` (`memberWeekLabel` — "2 (Aug 23)")
- **Units:** weeks, integer, 1-based from their own start. Paired with the STORED week date only — `lib/member-week-dates.ts:171` throws rather than project a date.
- **Note:** the two null-fallbacks (`app/me/schedule/page.tsx:33`, `app/me/page.tsx:208`) are the one path by which the organizer's week coordinate can reach a member surface.

### Weeks remaining in the cycle (from today)

- **Formula:** planned weeks minus the current week, never below zero.
- **Inputs:** `Cycle.plannedWeeks`, current week (derived, projected route)
- **Canonical:** `app/actions/dashboard.ts:253`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/money.ts:126`/`:129` (`remainingWeeksInCycle` — the same subtraction keyed on a start week rather than today, and inclusive so it differs by +1), `app/admin/(protected)/cycle/page.tsx:68` (`min(currentWeek, plannedWeeks) / plannedWeeks`), `lib/commitment.ts:47`, `lib/commitment.ts:252` (`weeksPastPlannedEnd = finishWeek − plannedWeeks`), `lib/commitment.ts:321`, `lib/participation-rules.ts:46`, `lib/presentation.ts:54` (carried through redaction unchanged), `scripts/portal-test-fixture.mts:53`
- **Surfaces:** `app/admin/(protected)/page.tsx:49`, `:51`, `:126`, `:128`, `app/admin/(protected)/cycle/page.tsx:68`
- **Units:** weeks, integer, floored at 0.

### Weeks left in a member's window / at risk (§2.27)

- **Formula:** their finish week minus the current week. Zero means the final week;
  negative means the window has already closed. "At risk" is four or fewer weeks left and
  never drawn.
- **Inputs:** `Participation.startWeek`, `Participation.weeksCommitted`, current week (derived), `SlotMember.luckyNumberId` (drawn-ness)
- **Canonical:** `lib/wheel.ts:86` and `app/actions/waiting.ts:202` (computed independently for the waiting list)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/waiting.ts:76-77` (`isAtRisk`), `lib/waiting.ts:113-115` (folded into a sort key), `lib/wheel.ts:87` (`if (weeksLeft > input.weeksAhead) continue` — the warning threshold), `app/actions/dashboard.ts:372`
- **Surfaces:** `app/admin/(protected)/page.tsx:73`, `:238`, `:239`, `app/admin/wheel/setup/wheel-setup.tsx:472`, `app/admin/(protected)/waiting/waiting-view.tsx:150`, `:501`, `:508`, `components/admin/waiting-summary.tsx:126`, `lib/waiting.ts:187` (`runwayLabel`)
- **Units:** weeks, signed integer. Two thresholds: `AT_RISK_WEEKS = 4` (`lib/waiting.ts:67`) drives the Waiting screen; `weeksAhead = 3` (`app/actions/dashboard.ts:387`, passed at `app/actions/dashboard.ts:372`) drives the dashboard warnings.
- **Note:** the two consumers read the current week from different sources —
  `lib/wheel.ts` is fed `currentWeekFromRows` via `app/actions/wheel.ts:110`, while the
  dashboard feeds it `currentWeekNumber` from `app/actions/dashboard.ts:88`. This is a
  DIFFERENT quantity from `{weeksLeft}` in messages (below).

### Payments left / weeks still to pay (the count owed, not calendar weeks)

- **Formula:** weeks committed minus weeks paid (weeks paid being weeks credited capped
  at weeks committed), never below zero.
- **Inputs:** `Participation.weeksCommitted`, weeks credited (derived)
- **Canonical:** `lib/messages.ts:219` (weeks-paid half at `lib/messages.ts:218`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/messages.ts:302` (`{weeksLeft}`), `lib/messages.ts:310` (`paymentsLeft` — the same value under a second token name), `lib/waiting.ts:51`, `app/actions/waiting.ts:213`, `app/actions/cycle-close.ts:106`, `app/actions/member.ts:207-210`, `app/actions/member.ts:349`, `app/admin/(protected)/people/page.tsx:64` (no cap at weeksCommitted), `components/member/member-personal-summary.tsx:40` (rebuilt CLIENT-SIDE as `remainingWeeks = Math.max(0, totalWeeks − paidCount)`), `lib/member-history.ts:182` (read out of the archive snapshot rather than derived), `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:33-36`, `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:66-69`, `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:157`, `scripts/verify-member-privileges.mts:95-97`
- **Surfaces:** `lib/messages.ts:302`, `lib/messages.ts:310` (WINNER_ANNOUNCEMENT `{{5}}`), `app/me/page.tsx:97`, `components/member/member-personal-summary.tsx:118`, `:161`, `components/member/past-cycle-card.tsx:51`, `app/admin/(protected)/waiting/waiting-view.tsx:507`, `app/admin/(protected)/cycle/close/close-flow.tsx:228`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:96`, `app/admin/(protected)/people/people-directory.tsx:239`
- **Units:** weeks/payments, integer.
- **Note:** §2.28 and D-38 record that this is deliberately NOT calendar weeks remaining;
  `lib/messages.ts:305` says the two split the moment a member is behind or ahead.

### Cycle length (planned weeks) and the cycle's own finish

- **Formula:** the cycle's planned weeks is stored. A cycle has no start week — week 1 IS
  its start date — so its finish week is always its planned length, and its finish date is
  the stored row for that week.
- **Inputs:** `Cycle.plannedWeeks`, `Cycle.startDate`, `Week.date`
- **Canonical:** `lib/commitment.ts:263` (`cycleFinishPreview`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycles.ts:100` (`calculateFinishWeek(1, active.plannedWeeks)` + `resolveWeekDate`, for the new-cycle overlap rule), `app/actions/cycles.ts:106` and `:109-110` (a DIFFERENT rule in the same file: the real end is the LATER of the planned finish date and the last stored row), `app/actions/cycle-close.ts:203` (last stored week row) with the inline projection fallback at `:204`/`:206`, `lib/date-bounds.ts:91` (`newCycleStartBounds`), `app/actions/member.ts:189`, `app/actions/agreement.ts:72`, `app/actions/agreement.ts:98`, `app/admin/(protected)/cycles/new/page.tsx:36`, `:44-51`, `:53-58` (the later-of-two rule rebuilt on the page), `app/admin/(protected)/cycle/edit/cycle-edit-form.tsx:88` (over a stored map built at `:85`) and `:96`, `app/admin/(protected)/cycles/new/new-cycle-form.tsx:72` (with `stored: null` — the pure projection while typing), `lib/member-history.ts:167-171` (an ARCHIVED cycle's finish read as the last week row's date in the snapshot, falling back to closedAt)
- **Surfaces:** `app/admin/(protected)/cycles/new/new-cycle-form.tsx:272`, `app/admin/(protected)/cycle/edit/cycle-edit-form.tsx:222`, `app/admin/(protected)/cycles/page.tsx:122`, `app/admin/(protected)/cycles/draft-cycles.tsx:145`, `app/admin/(protected)/cycle/page.tsx:60`, `app/admin/(protected)/cycle/position/page.tsx:102`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:47`
- **Units:** weeks, integer, 1..1000 (validated `app/actions/cycles.ts:55` and `app/actions/edits.ts:2164`).
- **Note:** the finish DATE has two shapes in the repo — "the stored row for the planned week" and "the later of that and the last row that exists".

### Actual cycle length (how many week rows really exist)

- **Formula:** the cycle genuinely runs to the later of its planned length and the deepest
  member finish week; week rows exist through that, and rows past it that carry no money,
  deferral, draw, plan or note are pruned.
- **Inputs:** `Cycle.plannedWeeks`, `Participation.startWeek`, `Participation.weeksCommitted`, `Week.weekNumber`
- **Canonical:** `lib/participation-rules.ts:103`; `deepestFinish` `:117`; `keepThrough = Math.max(plannedWeeks, deepestFinish)` `:123`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/participation-rules.ts:60` (`ensureWeeksThrough` — creates the override rows), `app/actions/edits.ts:2200` (updateCycle recomputes deepestFinish to refuse a shrink) with the refusal at `:2209`/`:2211`, `app/actions/edits.ts:2226` (grow path), `app/actions/edits.ts:526`, `app/actions/participations.ts:284`, `:344`, `app/actions/cycles.ts:277` (weekCount for the draft list), `app/admin/(protected)/cycle/edit/cycle-edit-form.tsx:129` (`plannedWeeks − cycle.plannedWeeks`), `scripts/repro-participation-shorten.mts:141`, `scripts/verify-orphan-weeks.mts:59`, `:104`, `:157`
- **Surfaces:** `app/admin/(protected)/cycle/edit/cycle-edit-form.tsx:127`, `:135`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:839`, `app/admin/(protected)/cycle/page.tsx:68` ("Elapsed / planned")
- **Units:** weeks, integer. §2.7 tracks planned and actual separately; the live cycle is 20 planned with 23 generated.

### Cycle close timing (how long since the final week, against the wait)

- **Formula:** whole UTC days from the cycle's final week's stored date to today,
  compared against the configured closing wait in days. Below the wait, the close is
  refused and the available-on day is the final week date plus the wait.
- **Inputs:** `Week.date` (last row), `Cycle.plannedWeeks`, `Cycle.startDate`, `Setting.closingWaitDays`, today
- **Canonical:** `lib/cycle-lock.ts:45`; day arithmetic `lib/cycle-lock.ts:61` (MS_PER_DAY and utcDay redefined locally at `:23-24`); `daysRemaining` and `availableOn` at `lib/cycle-lock.ts:72-73`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-close.ts:201` (`cycleCloseTiming`), `app/actions/cycle-close.ts:203` (final week = last stored row), `:206` (projection fallback), `:207` (the closeTiming call), `lib/setting-defaults.ts:103` (`closingWaitDays` defaults to `CLOSING_WAIT_DAYS_DEFAULT`; `lib/settings.test.ts:31-32` pins it equal to `PAYMENT_WINDOW_DAYS`)
- **Surfaces:** `app/admin/(protected)/cycle/close/close-flow.tsx`
- **Units:** days. Default wait is 5 days, the same span as `PAYMENT_WINDOW_DAYS` (`docs/DOMAIN_RULES.md:570`), but a separate constant.

### Bounds on a week's own date (weeks must run in order)

- **Formula:** a week's date must fall strictly after the previous week's date and
  strictly before the next week's. The first and last weeks are bounded on one side only.
- **Inputs:** `Week.weekNumber`, `Week.date`
- **Canonical:** `lib/date-bounds.ts:152`; the ±1-day step at `lib/date-bounds.ts:158-159`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/admin/(protected)/cycle/position/week-dates.ts:181` (`boundsForWeek` — finds the two neighbours by sorting rows in memory), `app/actions/edits.ts:1692-1700` (the neighbour lookup done with two ordered queries inside the transaction instead), `app/actions/edits.ts:1702`, `:1703`, `:1706`, `app/admin/(protected)/cycle/position/week-dates.ts:212` and `:223` (`outOfSequenceWeeks` — lexicographic compare on YYYY-MM-DD), `app/admin/(protected)/cycle/position/week-date-panel.tsx:254`, `:266`, `:61`, `app/admin/(protected)/cycle/position/page.tsx:80`, `components/ui/date-picker.tsx:132` (applied per rendered calendar day, own day step at `:46`)
- **Surfaces:** `app/admin/(protected)/cycle/position/week-date-panel.tsx`, `app/admin/(protected)/cycle/position/page.tsx:437`
- **Units:** dates as YYYY-MM-DD strings, compared lexicographically (`lib/date-bounds.ts:54`).
- **Note:** `lib/date-bounds.ts:42` (`todayIsoDay`) reads LOCAL calendar fields while `lib/date-bounds.ts:35` (`toIsoDay`) reads UTC fields — recorded, not judged.

### Bounds on a new cycle's start date

- **Formula:** not in the past, and not before the active cycle's final week date.
  Whichever bound bites harder wins.
- **Inputs:** `Week.date` (active cycle's final week), `Cycle.plannedWeeks`, today
- **Canonical:** `lib/date-bounds.ts:91`; harder-bound-wins line at `lib/date-bounds.ts:113`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycles.ts:92` (re-checked server-side inside the create transaction), `app/actions/cycles.ts:100`, `:106`, `:109-110`, `:121`, `:122-123`, `app/admin/(protected)/cycles/new/page.tsx:69` (the page computes the same bounds for the picker, off its own final-week derivation at `:43-58`), `app/admin/(protected)/cycles/new/new-cycle-form.tsx:118` (a third check, client-side, before submit)
- **Surfaces:** `app/admin/(protected)/cycles/new/new-cycle-form.tsx`, `app/admin/(protected)/cycles/new/page.tsx:36`
- **Units:** dates, YYYY-MM-DD / UTC midnight.

### What moving a week's date does (elapsed before/after, and whose standing moves)

- **Formula:** compare whether the week had elapsed under its old date with whether it
  will have elapsed under the new date, on the same window length and the same clock;
  then count the members in window for that week who have not covered it and have not
  been marked late by hand.
- **Inputs:** `Week.date` (before and after), `Week.weekNumber`, `Payment.amountPaid`, `Payment.markedLateAt`, `Participation.weeklyAmount`, `Participation.startWeek`, `Participation.weeksCommitted`, `ParticipationBreak.fromWeek`/`toWeek`, today, `PAYMENT_WINDOW_DAYS`
- **Canonical:** `app/admin/(protected)/cycle/position/week-dates.ts:286`; elapsed compare `:300` and `:305`; window-close dates `:310-311`; affected population `week-dates.ts:91` with filters at `:108`, `:111`, `:113`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/dashboard.ts:220` (`weekReceipts` membersShort — a deliberately DIFFERENT population: it drops deferred members and keeps marked-late ones; rules at `lib/dashboard.ts:252-257`), `app/admin/(protected)/cycle/position/week-dates-data.ts:128-138` (the affected count computed for EVERY week), `app/admin/(protected)/cycle/position/week-dates-data.ts:130`, `:151-153` (`membersShort` computed a second way, from the receiptsByWeek series), `app/admin/(protected)/cycle/position/week-dates.ts:312`, `:314`, `app/admin/(protected)/cycle/position/week-date-panel.tsx:90` (`weekClock` per row recomputed for the table beside the panel) and `:91`
- **Surfaces:** `app/admin/(protected)/cycle/position/week-date-panel.tsx:90`, `:98`, `:120`, `:134`, `:189-199`, `:289`, `app/admin/(protected)/cycle/position/week-dates.ts:337`, `:342`, `:347`, `:368`
- **Units:** counts of members and dates; whole DAYS for the window test.
- **Merged from:** three sweeps ("Whose standing a week's DATE actually decides", "What moving a week's date would do to lateness", "Members whose standing this week's date decides").
- **Note:** §6.4 records that this count treats a marked-late member as settled without asking whether a deferral superseded the mark (D-40 gap 2). No independent re-implementation of the affected-population count was found anywhere else in the repo.

---

## B4 — Payouts, fees and settlements

### Payout gross, one lucky number

- **Formula:** the lucky number's own weekly amount multiplied by its owner's weeks
  committed. A number is a SLICE of the member's weekly contribution, so a member holding
  two numbers has two grosses, not one doubled one. Weeks COMMITTED, never weeks paid.
- **Inputs:** `LuckyNumber.amount`, `Participation.weeksCommitted`
- **Canonical:** `lib/wheel.ts:538`, primitive `lib/money.ts:73` with the multiplication at `lib/money.ts:78`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/week-winners.ts:141` (`candidatePayout`), `lib/settlement.ts:112`, `:113`, `lib/projection.ts:105`, `:106`, `:125`, `lib/fee-preview.ts:88`, `lib/winner-extras.ts:55`, `lib/contribution.ts:88` (commitmentTotal, inlined), `lib/dashboard.ts:481` and `:492` (commitment inlined twice in one function), `lib/final-position.ts:135` (inlined), `lib/participation-removal.ts:100` (inlined for feeAttributable), `app/actions/agreement.ts:127` (totalContribution inlined), `app/actions/member.ts:268`, `app/actions/messages.ts:79`, `app/actions/messages.ts:296`, `app/actions/waiting.ts:188`, `app/actions/week-winners.ts:231`, `app/actions/wheel.ts:685`, `app/actions/manual-payout.ts:154`, `:462`, `app/admin/(protected)/people/[id]/page.tsx:319`, `:714`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:278` (inlined TOTAL-first: member weekly × weeks, not per lucky number), `scripts/lib/production-fixture.mts:227` (gross inlined, with a per-member weeks override), `scripts/verify-number-amounts.mts:54`, `:66`, `scripts/verify-draw-cascade.mts:93`, `scripts/verify-week-winners.mts:106`, `:146`, `scripts/verify-removal-cascades.mts:110`, `scripts/verify-payout-invariants.mts:113`, `:118`, `lib/fee-preview.test.ts:102`, `lib/manual-payout.test.ts:232`, `:248`, `:258`, `lib/participation-removal.test.ts:94`
- **Surfaces:** `app/admin/(protected)/collections/collections-view.tsx:669`, `app/admin/(protected)/people/[id]/page.tsx:727`, `components/admin/payout-equation.tsx:56`, `app/admin/(protected)/people/[id]/assign-payout.tsx:341`, `:367`, `components/admin/fee-calculator.tsx:70`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:889`, `app/admin/(protected)/waiting/waiting-view.tsx:370`, `:527`, `lib/agreement.ts:70` (`{payoutGross}` in the signed document)
- **Units:** integer cents; `lib/wheel.ts:539` throws if gross overflows a safe integer. Displayed via `formatMoney`; the Collections edit form converts to dollars at `collections-view.tsx:573` and back via `parseDollarsToCents`.

### Fee, projected (one lucky number)

- **Formula:** the cycle's fee percent applied to that number's gross, converted to
  integer basis points (percent × 100) and rounded to the nearest cent, half up. Never a
  hardcoded 2%; always read off the cycle.
- **Inputs:** `Cycle.feePercent`, payout gross (derived)
- **Canonical:** `lib/money.ts:90`; basis points at `lib/money.ts:95`, rounding at `lib/money.ts:96`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/wheel.ts:542`, `lib/week-winners.ts:142`, `lib/settlement.ts:114`, `lib/settlement.ts:118-119` (a SECOND fee arithmetic: `netPerWeek = weekly × (10000 − basisPoints) / 10000`, floating point), `lib/projection.ts:110`, `:115`, `:126`, `:132`, `lib/participation-removal.ts:101`, `lib/fee-preview.ts:88`, `lib/fee-preview.ts:103`, `lib/final-position.ts:69`, `lib/winner-extras.ts:55`, `app/actions/agreement.ts:129`, `app/actions/member.ts:268`, `app/actions/messages.ts:79`, `:296`, `app/actions/waiting.ts:188`, `app/actions/week-winners.ts:231`, `app/actions/wheel.ts:685`, `app/actions/manual-payout.ts:154`, `:462`, `app/actions/cycle-position.ts:274`, `app/admin/(protected)/people/[id]/page.tsx:319`, `:714`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:279` (fee on the member TOTAL gross, not summed per number), `scripts/lib/production-fixture.mts:228` (`Math.round((gross * FEE_PERCENT) / 100)` — percent arithmetic in floating point, not basis points), `scripts/verify-number-amounts.mts:54`, `scripts/verify-draw-cascade.mts:93`, `scripts/verify-week-winners.mts:106`, `:146`, `scripts/verify-removal-cascades.mts:110`, `scripts/verify-payout-invariants.mts:113`, `:118`, `lib/fee-preview.test.ts:130`
- **Surfaces:** `components/admin/payout-equation.tsx:58`, `app/admin/(protected)/people/[id]/page.tsx:730`, `app/admin/(protected)/collections/collections-view.tsx:669`, `components/admin/fee-calculator.tsx:70`, `app/admin/(protected)/people/[id]/assign-payout.tsx:341`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:48`, `app/admin/(protected)/cycle/position/page.tsx:373`, `app/admin/(protected)/waiting/waiting-view.tsx:370`, `lib/agreement.ts:73`, `app/admin/(protected)/cycle/edit/cycle-edit-form.tsx:243`, `:246`, `app/admin/(protected)/cycles/new/new-cycle-form.tsx:327`, `:331`
- **Units:** fee percent is a Float percentage (`prisma/schema.prisma:150`, default 2.0), not a fraction; money in cents. Rounding happens PER PAYOUT, which is why `lib/fee-preview.ts` sums per number instead of computing on a member total. `components/admin/week-winner-editor.tsx:92` initialises `feePercent` to a literal 2 before the server value arrives at `:121`.

### Payout net, projected (one lucky number)

- **Formula:** gross minus fee. Refuses to produce a value when the fee exceeds the gross.
- **Inputs:** payout gross (derived), fee projected (derived)
- **Canonical:** `lib/money.ts:100`; subtraction at `lib/money.ts:106`, refusal at `lib/money.ts:103`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/wheel.ts:543`, `lib/week-winners.ts:143`, `lib/settlement.ts:115`, `lib/projection.ts:127`, `lib/fee-preview.ts:88`, `lib/fee-preview.ts:104`, `lib/winner-extras.ts:55`, `app/actions/member.ts:268`, `app/actions/messages.ts:79`, `:296`, `app/actions/waiting.ts:188`, `app/actions/week-winners.ts:231`, `app/actions/wheel.ts:685`, `app/actions/manual-payout.ts:154`, `:462`, `app/admin/(protected)/people/[id]/page.tsx:319`, `:714`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:280`, `scripts/lib/production-fixture.mts:232` (`net = gross − fee − settlement`, inlined in one expression), `scripts/verify-number-amounts.mts:54`, `scripts/verify-draw-cascade.mts:93`, `scripts/verify-week-winners.mts:106`, `:146`, `scripts/verify-removal-cascades.mts:110`, `scripts/verify-payout-invariants.mts:113`, `:118`, `lib/manual-payout.test.ts:232`, `:248`
- **Surfaces:** `components/admin/payout-equation.tsx:60`, `app/admin/(protected)/people/[id]/page.tsx:733`, `components/member/member-payout-card.tsx:30`, `:42`, `app/me/page.tsx:237`, `components/member/saved-card.tsx:76`, `:79`, `app/admin/(protected)/people/[id]/assign-payout.tsx:342`, `components/admin/fee-calculator.tsx:70`, `app/admin/(protected)/waiting/waiting-view.tsx:527`, `lib/agreement.ts:70`
- **Units:** cents.

### Fee once drawn (stored on the payout)

- **Formula:** whatever the fee arithmetic produced at the moment the payout row was
  written, then frozen as historical fact. Read in preference to the projection wherever a
  payout row exists.
- **Inputs:** `Payout.feeAmount`
- **Canonical:** `app/actions/wheel.ts:696`
- **Other implementations / readers — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/week-winners.ts:241`, `app/actions/manual-payout.ts:473`, `app/actions/edits.ts:1980` (updatePayout writes an organizer-typed figure), `scripts/import-cycle.mts:303`, `app/actions/waiting.ts:119`, `app/actions/week-winners.ts:132`, `:323`, `:441`, `app/actions/edits.ts:2004` (audit before), `:2012` (audit after), `:2119` (delete audit), `app/admin/(protected)/collections/page.tsx:160`, `app/admin/(protected)/collections/collections-view.tsx:288`, `:574` (dollars round-trip), `:629`, `app/admin/(protected)/people/[id]/page.tsx:326` (recorded fee preferred over projection when summing), `app/admin/(protected)/waiting/waiting-view.tsx:309`, `scripts/lib/production-fixture.mts:241`, `scripts/verify-draw-cascade.mts:103`, `scripts/verify-week-winners.mts:116`, `:156`, `scripts/verify-removal-cascades.mts:120`, `scripts/verify-carry-deduction.mts:98`, `scripts/verify-cycle-lock.mts:115`
- **Surfaces:** `app/admin/(protected)/people/[id]/page.tsx:326`, `:730`, `app/admin/(protected)/collections/collections-view.tsx:574`, `:669`, `app/admin/(protected)/cycle/position/page.tsx:373`, `app/admin/(protected)/waiting/waiting-view.tsx:370`
- **Units:** cents, Postgres Int4 (`prisma/schema.prisma:446`). `MAX_MONEY_CENTS = 2,147,483,647` (`lib/money.ts:13`) is enforced on the edit path at `app/actions/edits.ts:1913`.

### Payout net, live (`Payout.netAmount` — what crosses the table)

- **Formula:** stored gross minus stored fee, then DECREMENTED by the winner's own-week
  settlement, and decremented again by any confirmed carried-balance deduction. It is not
  gross-minus-fee once a settlement or a carry deduction has landed on it.
- **Inputs:** `Payout.grossAmount`, `Payout.feeAmount`, `PaymentEvent.amount`, `LedgerEntry.amount`
- **Canonical:** `app/actions/wheel.ts:697`
- **Other implementations / writers — SUPERSEDED, see "Flagged for Pass 2":** `lib/draw-settlement.ts:156` and `:158` (decrement by the settlement), `lib/draw-settlement.ts:193`/`:195` (increment back on unsettle), `app/actions/carry-deduction.ts:206`, `app/actions/week-winners.ts:508`, `:511` (`movePayoutToWeek` RESETS it inline to `grossAmount − feeAmount`), `app/actions/edits.ts:515` (increment by the resize credit), `app/actions/edits.ts:1981` (organizer types it directly), `app/actions/week-winners.ts:242`, `app/actions/manual-payout.ts:474`, `scripts/import-cycle.mts:304`
- **Other implementations / readers — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/member.ts:283` (`payout?.netAmount ?? projected.net`), `app/actions/waiting.ts:120`, `app/actions/week-winners.ts:133`, `:324`, `:442`, `app/actions/edits.ts:2005`, `:2013`, `:2120`, `app/actions/participation-removal.ts:141`, `lib/winner-extras.ts:63`, `lib/waiting.ts:91` (`amountOf`, the sort key), `app/admin/(protected)/people/[id]/page.tsx:327`, `app/admin/(protected)/collections/collections-view.tsx:917` (client re-derives a net after subtracting the member's outstanding), `app/me/page.tsx:237`, `components/member/member-payout-card.tsx:30`, `scripts/lib/production-fixture.mts:232`, `:242`, `scripts/verify-draw-cascade.mts:151`, `scripts/verify-week-winners.mts:203`, `scripts/verify-carry-deduction.mts:184`, `scripts/verify-payout-invariants.mts:170`, `:175`
- **Surfaces:** `app/admin/(protected)/collections/collections-view.tsx:397`, `:684`, `components/admin/waiting-summary.tsx:80`, `:133`, `app/admin/(protected)/waiting/waiting-view.tsx:329`, `:367`, `:524`, `app/admin/(protected)/people/[id]/page.tsx:733`, `app/me/page.tsx:237`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:105`, `app/admin/(protected)/cash/page.tsx:207`, `:410`, `app/admin/(protected)/page.tsx:360`
- **Units:** cents. The profile note at `app/admin/(protected)/people/[id]/page.tsx:755` states that net already has the win-week contribution deducted.
- **Note:** this column has both high fan-in (four write paths beyond creation) and high fan-out (see Part C).

### Member's whole projected payout (gross / fee / net across all their numbers)

- **Formula:** split the weekly amount into lucky-number amounts at the cycle's unit,
  compute gross, fee and net for EACH number through the shared per-number arithmetic,
  then sum the per-number lines. Never computed from the member total directly, because
  the fee rounds per payout.
- **Inputs:** `Participation.weeklyAmount`, `Participation.weeksCommitted`, `Cycle.unitAmount`, `Cycle.feePercent`, gross/fee/net (derived)
- **Canonical:** `lib/fee-preview.ts:58`; the three sums at `lib/fee-preview.ts:100`, `:102`, `:103`, `:104`, `:106`; per-number call at `lib/fee-preview.ts:88`, `:93`, `:119`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/admin/(protected)/people/[id]/page.tsx:315` (sums per number but prefers the RECORDED payout where one exists), `app/actions/waiting.ts:186`, `app/admin/(protected)/people/[id]/assign-payout.tsx:155`, `lib/manual-payout.ts:214`, `:220`, `:221`, `:222`, `lib/projection.ts:124`, `app/actions/member.ts:267` (portal maps per number; the sum is taken downstream), `app/me/page.tsx:237` (the portal's sum), `components/member/member-payout-card.tsx:30` (the same sum in the card), `app/actions/agreement.ts:76`, `components/admin/fee-calculator.tsx:42`, `lib/final-position.ts:69`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:278` (computes the totals WITHOUT splitting into numbers), `lib/fee-preview.test.ts:101`
- **Surfaces:** `components/admin/fee-calculator.tsx:70`, `:73`, `components/admin/payout-equation.tsx:56`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:889`, `components/member/member-payout-card.tsx:42`, `components/member/saved-card.tsx:76`
- **Units:** cents. Returns null rather than a number when the inputs cannot describe a contribution (half-typed form).

### Fee withheld when returning an undrawn member's money

- **Formula:** the fee on their WHOLE commitment, taken from the same per-lucky-number
  preview. Stopping early does not reduce it. Zero only when the inputs cannot describe a
  commitment at all.
- **Inputs:** `Participation.weeklyAmount`, `Participation.weeksCommitted`, `Cycle.unitAmount`, `Cycle.feePercent`
- **Canonical:** `lib/final-position.ts:61`, calling `feePreview` at `lib/final-position.ts:69`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-position.ts:274` (called directly inside the inlined owedBack expression), `lib/final-position.ts:125`, `lib/participation-removal.ts:87` (the same "fee this member owes" idea computed TOTAL-FIRST — see next entry), `scripts/audit-position-figures.mts:191` (owedBack computed as paid-in with NO fee subtracted at all), `scripts/verify-participation-close.mts:401`/`:402-404` (owedBack again as paid-in with no fee subtracted)
- **Surfaces:** `lib/final-position.ts:180`, `:214`, `app/actions/member.ts:220`, `app/admin/(protected)/people/[id]/page.tsx:193`, `lib/cycle-position.ts:222` (`owedBackToStopped`, the sum), `app/me/page.tsx:135`, `components/admin/close-participation.tsx:274`, `components/admin/fee-calculator.tsx:42`
- **Units:** cents.
- **Note:** the module comment at `lib/final-position.ts:45-50` states that this module exists to prevent exactly the total-first drift that `lib/participation-removal.ts:87` performs.

### Fee attributable to a member being removed from a cycle

- **Formula:** the cycle's fee percent applied to the member's whole weekly amount times
  weeks committed. Computed on the member total, NOT summed per lucky number.
- **Inputs:** `Participation.weeklyAmount`, `Participation.weeksCommitted`, `Cycle.feePercent`
- **Canonical:** `lib/participation-removal.ts:87`; inlined gross `:100`, `calculateFee` call clamped at 0 `:101`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/final-position.ts:61` (the per-number route to the same idea), `lib/participation-removal.test.ts:94`
- **Surfaces:** `lib/participation-removal.ts:142`, `components/admin/remove-from-cycle.tsx`, `components/admin/remove-from-cycle.tsx:104`, `:202`, `app/actions/participation-removal.ts:141`, `:329`, `:349`
- **Units:** cents. This module formats with its own local dollar formatter (`lib/participation-removal.ts:242`, `:243`), not `lib/format.ts`.

### Structural cycle fee projection (weekly pot, weekly fee, cycle total, total fees)

- **Formula:** weekly pot is planned weeks times the unit amount, or an organizer
  override. Cycle total is that pot times planned weeks. Weekly fee is the percent of the
  weekly pot; total fees is the percent of the whole cycle total — deliberately NOT the
  weekly fee multiplied by weeks, because each rounds to the cent.
- **Inputs:** `Cycle.plannedWeeks`, `Cycle.unitAmount`, `Cycle.feePercent`
- **Canonical:** `lib/projection.ts:86`; weeklyPot `:105`, cycleTotal `:106`, weeklyFee `:110`, totalFees `:115`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/projection.ts:120` (`cycleProjection` — the roster-based answer: weekly pot as the sum of members' weeklies at `:129`, weeklyFee `:132`, total fees as the sum of per-member fees `:134`, per-member gross `:125`), `app/admin/(protected)/cycles/new/new-cycle-form.tsx:390` and `:399` (weeks × unitAmount recomputed inline for the override hint and placeholder), `app/admin/(protected)/cycles/new/new-cycle-form.tsx:83`, `app/admin/(protected)/cycle/edit/cycle-edit-form.tsx:78`
- **Surfaces:** `app/admin/(protected)/cycles/new/new-cycle-form.tsx:318`, `:330`, `:367`, `:370`, `:373`, `app/admin/(protected)/cycle/edit/cycle-edit-form.tsx:241`, `:246`
- **Units:** cents.

### Winner's own-week contribution settled FROM the payout

- **Formula:** what the winner still owes on the week they won (their weekly amount less
  anything already recorded on that week), waterfalled across their payouts from that draw
  in order, each taking the smaller of the remaining and that payout's net. A skipped week
  or a week outside their window settles nothing; a DEFERRED week is still owed and
  settles normally. Anything the payouts cannot absorb is refused outright rather than
  partially written. The receipt is PINNED to that week so any replay lands there.
- **Inputs:** `Participation.weeklyAmount`, `Participation.startWeek`, `Participation.weeksCommitted`, `Week.isSkipped`, `Payment.amountPaid`, `Payout.netAmount`, `PaymentEvent.pinnedWeekId`, `PaymentEvent.settlementPayoutId`
- **Canonical:** `lib/settlement.ts:35`; shortfall `lib/settlement.ts:43`; per-payout cap `lib/settlement.ts:48`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/settlement.ts:63`/`:65`/`:72` (`allocatePinned` — the replay-time version of the same owed arithmetic), `lib/settlement.ts:211`, `lib/settlement.ts:216`, `lib/draw-settlement.ts:103-114` (the WRITE path's own amountDue derivation: window test `:103-104`, skipped-only excuse `:107`, then `planWinnerWeekSettlement`), `lib/draw-settlement.ts:108`, `:110`, `lib/draw-settlement.ts:187-207` (`unsettleDraw` re-sums event.amount per draw), `lib/draw-settlement.ts:224`, `:227-238` (`unsettlePayout`), `lib/week-winners.ts:154-167` (`settlementFor` — a SECOND full implementation with its own window test and its own skipped-only excuse), `lib/week-winners.ts:161`, `:165`, `:168`, `:284`, `:380`, `:381-387`, `:389`, `lib/standing.ts:118`, `lib/standing.ts:123`, `lib/rebuild.ts:84-101`, `lib/manual-payout.ts:106`, `:148`, `:149`, `lib/undo-draw.ts:51-52`, `lib/participation-removal.ts:128`, `app/actions/cycle-close.ts:96`, `:97`, `app/actions/edits.ts:352`, `:353`, `:355`, `:504`, `app/actions/waiting.ts:91-105` (settledByPayout map), `:99`, `:101`, `:121`, `app/actions/manual-payout.ts:105-118`, `:113`, `:135`, `:228-238`, `:236`, `:238`, `:256`, `:519`, `app/actions/participation-removal.ts:165`, `:224`, `:226`, `app/actions/wheel.ts:815-824`, `:820`, `:821`, `:836`, `app/actions/cycle-position.ts:193-196`, `app/actions/participation-close.ts:127-131`, `app/actions/member.ts:256-262`, `app/actions/payments.ts:392-396`, `app/actions/payments-view.ts:40-43`, `lib/messaging-engine.ts:92-96`, `app/admin/(protected)/collections/page.tsx:74-90`, `:82`, `:85`, `:162`, `:193`, `app/admin/(protected)/cycle/draws/page.tsx:54-62`, `:59`, `:120`, `app/admin/(protected)/people/[id]/page.tsx:314-330` (carries `settled` as a BOOLEAN rather than the amount; rendered at `:638`), `components/admin/week-winner-editor.tsx:190` (client feeds `moving.settlement` in as weeklyAmount to re-derive the destination settlement), `scripts/lib/production-fixture.mts:231`, `scripts/audit-position-figures.mts:133-136`, `scripts/deferral-impact.mts:41-44`, `scripts/elapsed-rule-impact.mts:40-43`, `scripts/verify-payout-invariants.mts:163`
- **Surfaces:** `app/actions/waiting.ts:121`, `app/admin/(protected)/waiting/waiting-view.tsx:371-372`, `components/admin/week-action-panel.tsx:517`, `app/actions/cycle-close.ts:134`, `app/admin/(protected)/collections/collections-view.tsx:397`, `:670-671`, `:782-785`, `components/admin/week-winner-editor.tsx:154`, `app/admin/(protected)/people/[id]/assign-payout.tsx:204`, `app/actions/wheel.ts:724`, `app/actions/manual-payout.ts:487`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:106-111`, `app/admin/(protected)/people/[id]/page.tsx:638`, `lib/waiting.ts:33`
- **Units:** cents. Stored twice as ONE movement: a `PaymentEvent` row plus a matching decrement of `Payout.netAmount` (`lib/draw-settlement.ts:125` and `:156`).
- **Merged from:** four sweeps.

### Week total net, before and after a winner edit

- **Formula:** the sum of the net of every payout on that week. "After" adds the
  candidate's net reduced by their own-week settlement (add), subtracts the leaving
  payout's net (remove), or swaps the old settlement for the destination week's (move).
- **Inputs:** `Payout.netAmount`, payout net projected (derived), winner's own-week settlement (derived)
- **Canonical:** `lib/week-winners.ts:130`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/week-winners.ts:284` (`netAfterSettlement = payout.net − settlement`), `:289`, `:326`, `:383` (`grossNet = payout.net + payout.settlement`), `:389` (`movedNet = grossNet − newSettlement`), `:393`, `:394`, `lib/undo-draw.ts:46`, `lib/manual-payout.ts:104` (inlined reduce), `app/admin/(protected)/collections/page.tsx:225` (inlined reduce), `app/admin/(protected)/collections/collections-view.tsx:397` (inlined reduce), `app/actions/manual-payout.ts:315`, `:518`, `app/actions/cycle-close.ts:122` (`awardedNet` — every payout net per member, no status filter), `app/admin/(protected)/cycle/draws/page.tsx:118`, `scripts/verify-cycle-close-money.mts:113`
- **Surfaces:** `components/admin/week-winner-editor.tsx:154`, `:215`, `:294`, `app/admin/(protected)/collections/collections-view.tsx:324`
- **Units:** cents.

### Change in money committed to payouts (cash-position delta of a winner edit)

- **Formula:** positive when the group now owes more. Adding a winner adds their net after
  settlement; removing subtracts the payout's net; moving is the moved net minus the old
  net. Cash RECEIVED is untouched by these edits — only obligations move.
- **Inputs:** payout net projected (derived), `Payout.netAmount`, winner's own-week settlement (derived)
- **Canonical:** `lib/week-winners.ts:304`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/week-winners.ts:341`, `lib/week-winners.ts:419`, `lib/week-winners.ts:284`, `lib/participation-removal.ts:162` (removal from the cycle: `paidOut − receiptTotal`, the same question with different arithmetic), `lib/participation-removal.ts:111`, `lib/participation-removal.ts:186`, `lib/participation-removal.ts:206` (the keep-money-records branch declares the delta 0)
- **Surfaces:** `lib/week-winners.ts:463`, `components/admin/week-winner-editor.tsx:154`, `components/admin/remove-from-cycle.tsx:104`, `:106`, `:202`, `:204`, `app/actions/participation-removal.ts:329`, `:349`
- **Units:** cents, signed. A preview figure only — it describes how `currentlyHeld` (`lib/dashboard.ts:66`) would move and is never stored.
- **Merged from:** "Change in money committed to payouts" + "Cash position delta from removing a participation".

### Terms-change settlement gap after a payout

- **Formula:** already received is the sum of the member's current payout nets PLUS every
  win-week contribution settled out of them. New entitlement net is the new weekly times
  the new weeks, less the fee at the new figure. The gap is already-received minus
  new-entitlement-net; positive means they hold too much. What is actually chargeable is
  that gap minus whatever earlier settlements for this cycle the ledger already recognises.
- **Inputs:** `Payout.netAmount`, `PaymentEvent.amount`, `Participation.weeklyAmount` (old and new), `Participation.weeksCommitted` (old and new), `Cycle.feePercent`, `LedgerEntry.type`/`amount`/`notes`
- **Canonical:** `lib/settlement.ts:104`; gross/fee/net `:112-115`; gap `lib/settlement.ts:128`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/settlement.ts:164` (`settledSoFarFromLedger` — the idempotency half), `lib/settlement.ts:182`, `:183`, `lib/settlement.ts:118-120` (`balancingWeeksExact` recomputes the net-per-week from basis points independently of `calculateFee`/`calculateNet` three lines above), `app/actions/edits.ts:352-355` (alreadyReceived assembled inline: settlement events `:352`, payout nets `:354`), `app/actions/edits.ts:376` (actionable gap = `terms.gap − priorSettled`), `app/actions/edits.ts:400-407` (the returned-amount branch re-derives `remainder = gap − returned`), `app/actions/edits.ts:425`, `:445`, `app/actions/edits.ts:477-482` (the audit line restates every term), `lib/settlement.test.ts:229-260` (a test harness that re-assembles the whole chain independently)
- **Surfaces:** `app/admin/(protected)/people/[id]/participation-editor.tsx:846`, `app/actions/edits.ts:380-396`, `:427`, `:447`, `:465`, `:476-482`
- **Units:** cents, signed (positive = they hold too much). `balancingWeeksExact` (`lib/settlement.ts:120`, `:129`) is a fractional WEEK count computed in floating point, not money.

### Prior settlement already recognised on the ledger (`priorSettled`)

- **Formula:** walk the person's ledger entries; add the amount when the note carries this
  cycle's debt tag AND the row is a DEBT, subtract it when the note carries the credit tag
  AND the row is a PAYMENT. Returned entries count as zero — cash pays a recognised debt,
  it does not un-recognise it. Untagged entries are ignored entirely.
- **Inputs:** `LedgerEntry.type`, `LedgerEntry.amount`, `LedgerEntry.notes`, `Cycle.id`
- **Canonical:** `lib/settlement.ts:164`; tag format `lib/settlement.ts:146`; the two tests `lib/settlement.ts:172-185`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/edits.ts:372-375` (the only caller), `app/actions/edits.ts:428`, `:437`, `:448`, `:466` (the four write sites that stamp the tags this function later reads — the kind chosen per branch is what decides recognition, and it is decided in the action rather than in `lib/settlement.ts`), `lib/settlement.test.ts:238`
- **Surfaces:** `app/actions/edits.ts:394`, `app/actions/edits.ts:479-481`
- **Units:** cents, SIGNED — negative when recognised credits outweigh recognised debts.

### Resized win-week settlement and the credit back to the payout

- **Formula:** the settled week now costs exactly the new weekly amount, so the receipt is
  resized to it. The credit is the old receipt amount minus the new one and moves onto the
  payout: positive credits the payout back, negative takes more out of it. Refused when a
  growing week would push the payout's net below zero. `resized + credit` always equals
  the original receipt amount.
- **Inputs:** `PaymentEvent.amount`, `Participation.weeklyAmount` (new), `Payout.netAmount`
- **Canonical:** `lib/settlement.ts:211`; resized `:216`, credit `:217`, refusal guard `:218-224`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/edits.ts:503-517` (the only caller: receipt at `:510`, payout at `:513`/`:515`), `lib/week-winners.ts:381-387` (the move path performs the equivalent restore-then-retake without going through this function), `lib/settlement.test.ts:257`, `:429-440` (a two-step down-then-up sequence tracking payoutNet by hand outside the module), `:468-472` (a property loop re-asserting the invariant)
- **Surfaces:** `app/actions/edits.ts:518`, `:518-522`, `lib/settlement-receipt.ts:62` (the refusal shown when the organizer tries to edit the receipt amount directly)
- **Units:** cents; credit is SIGNED.

### Undo-draw consequences (total net removed, collected net un-recorded, settlements reopened)

- **Formula:** total net is the sum of the net of every payout the undo removes. Collected
  net is that sum restricted to payouts already handed over — the money whose only record
  is being destroyed. Reopened settlements are listed per lucky number with the amount that
  becomes owed again. Any collected payout makes it high-stakes and forces a typed
  confirmation.
- **Inputs:** `Payout.netAmount`, `Payout.status`, `PaymentEvent.amount`, `LuckyNumber.number`
- **Canonical:** `lib/undo-draw.ts:37`; totalNet `:46`, collectedNet `:48`, unsettled list `:50`, settlement amounts `:51-52`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/wheel.ts:828` (recomputed inside the transaction from freshly read rows), `app/actions/wheel.ts:815`, `lib/manual-payout.ts:104` (`weekChoice` — the same "what disappears" figures for the replace path) and `:148`, `app/actions/manual-payout.ts:238`, `:245`, `app/actions/manual-payout.ts:315` (the removed-payout total computed inline while replacing a draw, written into the audit line at `:505`), `app/admin/(protected)/cycle/draws/page.tsx:118` (a THIRD caller, with its own settlementByPayout map at `:59`), `app/admin/(protected)/collections/page.tsx:225`, `:231`, `app/admin/(protected)/collections/collections-view.tsx:397`
- **Surfaces:** `app/admin/(protected)/collections/collections-view.tsx:232`, `:397`, `:402`, `app/admin/(protected)/people/[id]/assign-payout.tsx:72`, `:199`, `app/actions/wheel.ts:866`, `app/admin/(protected)/cycle/draws/page.tsx:118`
- **Units:** cents.
- **Merged from:** "Undo-draw consequences" + "Undo-draw money at stake".

### Delete-payout consequences (net destroyed, week reopened)

- **Formula:** the payout's net, its status, and the single week whose contribution was
  settled from it and now becomes owed again. The draw stands and the number stays drawn,
  unless it was the week's last payout, in which case the empty draw goes with it and the
  numbers return to the pool.
- **Inputs:** `Payout.netAmount`, `Payout.status`, `PaymentEvent.amount`, `Week.weekNumber`
- **Canonical:** `lib/undo-draw.ts:94`; netAmount passthrough `:102`, reopensWeek `:105`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/edits.ts:2090` (`unsettlePayout` returns the reversed amount the audit entry quotes), `app/actions/edits.ts:2084`, `:2118`, `app/admin/(protected)/collections/collections-view.tsx:798`, `:801`
- **Surfaces:** `app/admin/(protected)/collections/collections-view.tsx:778`, `app/actions/edits.ts:2108`
- **Units:** cents.

### Manual payout preview totals (gross, fee, net across the chosen numbers)

- **Formula:** one line per chosen lucky number through the identical per-number
  arithmetic a spun draw uses, then the three columns summed.
- **Inputs:** `LuckyNumber.amount`, `Participation.weeksCommitted`, `Cycle.feePercent`
- **Canonical:** `lib/manual-payout.ts:208`; totals at `lib/manual-payout.ts:220`, `:221`, `:222`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/manual-payout.ts:154` (per-number figures given to the picker), `app/actions/manual-payout.ts:462` (the write path recomputes each number through `calculatePayout`), `app/actions/manual-payout.ts:518`, `app/admin/(protected)/people/[id]/assign-payout.tsx:154`, `:155` (client sums them again), `lib/manual-payout.test.ts:232`, `:248`
- **Surfaces:** `app/admin/(protected)/people/[id]/assign-payout.tsx:340`, `:341`, `:367`, `:382`, `app/actions/manual-payout.ts:499`
- **Units:** cents.

### Amount handed over (marking a payout collected)

- **Formula:** the payout's current net, sent back unchanged with a status of COLLECTED
  plus a method and a date. Nothing recomputes it at collection time; whatever net stands
  after any settlement and any carry deduction is the figure recorded as handed over.
- **Inputs:** `Payout.netAmount`, `Payout.grossAmount`, `Payout.feeAmount`, `Payout.status`, `Payout.method`, `Payout.paidAt`
- **Canonical:** `app/actions/edits.ts:1976`; gross/fee/net written back unchanged at `:1979`, `:1980`, `:1981`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/admin/(protected)/collections/collections-view.tsx:888` (Collections mark-collected, passes notes through), `:890`, `:891`, `:892`, `app/admin/(protected)/waiting/waiting-view.tsx:306` (Waiting mark-collected, sends no notes), `:308`, `:309`, `:310`, `scripts/verify-payout-invariants.mts:192` (sets status COLLECTED directly on the row)
- **Surfaces:** `app/admin/(protected)/collections/collections-view.tsx:865`, `:898`, `app/admin/(protected)/waiting/waiting-view.tsx:329`
- **Units:** cents. The Collections edit panel round-trips through dollars: divide by 100 at `collections-view.tsx:573`, parse back at `:628`.

### Owed now vs eventually owed (the waiting list)

- **Formula:** owed now is the sum of the live net of every PENDING payout. Eventual is
  the sum, across members holding any undrawn number, of what those numbers would pay out
  today, with gross, fee and net summed per number.
- **Inputs:** `Payout.netAmount`, `Payout.status`, `LuckyNumber.amount`, `Participation.weeksCommitted`, `Cycle.feePercent`, `SlotMember.luckyNumberId` (drawn-ness)
- **Canonical:** `lib/waiting.ts:140`; owedNow reduce `lib/waiting.ts:148`; eventualTotal reduce `lib/waiting.ts:151`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/waiting.ts:186`, `:194`, `:195`, `:196`, `:210`, `:211`, `:212`, `lib/waiting.ts:91` (`amountOf`, the sort key), `lib/fee-preview.ts:106`, `lib/projection.ts:135`, `app/admin/(protected)/collections/page.tsx:232`, `components/member/member-payout-card.tsx:30`, `app/me/page.tsx:237`
- **Surfaces:** `components/admin/waiting-summary.tsx:46`, `:80`, `:102`, `:133`, `app/admin/(protected)/waiting/waiting-view.tsx:127`, `:141`, `:207`, `:248`, `:367`, `:438`, `:524`, `:527`, `app/admin/(protected)/collections/page.tsx:255`, `:256`
- **Units:** cents.
- **Note:** "Owed now" and "Committed to winners" (`lib/dashboard.ts:62`) are the same set of rows under two names; see the synonym list in Part C.

### Days waiting for a pending payout / longest wait

- **Formula:** whole days between the draw and today, floored, never negative. The
  headline is the largest across all awaiting-payment rows; null when nobody is waiting.
- **Inputs:** `Draw.drawnAt`, today
- **Canonical:** `lib/waiting.ts:70` (`daysBetween` at `lib/waiting.ts:72`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/waiting.ts:150`, `app/actions/waiting.ts:123`, `lib/dashboard.ts:467` (`standingIssues` implements the identical floored-days-never-negative helper locally on UTC days for `daysWaiting`, instead of importing `daysBetween`)
- **Surfaces:** `app/admin/(protected)/waiting/waiting-view.tsx:132`, `:356`, `:360`, `components/admin/waiting-summary.tsx:52`, `:77`
- **Units:** whole days (not money). A row is called stale at 14 days, a threshold hardcoded in the component at `app/admin/(protected)/waiting/waiting-view.tsx:301`.

### Winner announcement payout amount (`{payoutAmount}`)

- **Formula:** the recorded payout's net when a payout row exists, otherwise the projected
  net for that lucky number. One number per member per draw — the first of their numbers
  in the slot, never a sum.
- **Inputs:** `Payout.netAmount`, `LuckyNumber.amount`, `Participation.weeksCommitted`, `Cycle.feePercent`
- **Canonical:** `lib/winner-extras.ts:63`; projection half `lib/winner-extras.ts:55`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/messages.ts:90` (the batch path, same expression written separately), `app/actions/messages.ts:79` (the projection half of the batch path), `app/actions/messages.ts:296` (preview fallback: projected net when the member has no recorded draw), `app/actions/messages.ts:304`
- **Surfaces:** `lib/messages.ts:334`, `lib/messages.ts:407`, `lib/whatsapp-templates.ts:216`, `:217`, `app/actions/member-messaging.ts:359`, `app/admin/(protected)/messages/`
- **Units:** cents, rendered through `formatMoney`. A missing extra renders as NO_VALUE (a dash) rather than a number — `lib/messages.ts:334`.

### Agreement figures the member signs

- **Formula:** total contribution is weekly times weeks committed, computed inline. Gross,
  fee and net come from the same per-lucky-number preview the fee calculator and the
  profile use, so the signed document cannot quote a figure differing from the organizer's
  screens. Fee percent is printed with trailing zeros dropped.
- **Inputs:** `Participation.weeklyAmount`, `Participation.weeksCommitted`, `Cycle.unitAmount`, `Cycle.feePercent`, member projected gross/fee/net (derived), `AgreementSignature.documentText`
- **Canonical:** `app/actions/agreement.ts:114`; feePreview call `app/actions/agreement.ts:76`; totalContribution inlined `:127`; payoutGross `:128`, feeAmount `:129`, payoutNet `:130`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/agreement.ts:101` (`agreementValues`, the formatting layer), `lib/agreement.ts:107`, `:110`, `:114`, `:115`, `:116`, `:117`, `lib/agreement.ts:138` (a zeroed fallback set), `lib/agreement.ts:153`, `lib/fee-preview.ts:58`, `lib/fee-preview.ts:102-104`, `:119`, `lib/wheel.ts:533`, `components/admin/fee-calculator.tsx:42`
- **Surfaces:** `lib/agreement.ts:67`, `:70`, `:73`, `app/agreement/agreement-signer.tsx:99`, `components/member/signed-agreements.tsx:68`
- **Units:** cents internally; every figure is rendered through `formatMoney` before it enters the document text that gets hashed (`lib/agreement.ts:107`), then FROZEN as a string in the signature row — so those figures never re-derive and can legitimately differ from today's live portal if the rate changed after signing.

---

## B5 — Per-week money (the subsystem the trigger bug sits in)

### Expected for a week

- **Formula:** for one week, add each participation's own weekly amount, counting only
  participations whose window covers that week — week number at or after their start week,
  at or before `start + committed − 1`, and not inside a break stretch. A participation
  whose payment row for that week is marked deferred is skipped entirely. If the week
  itself is marked skipped, nothing is expected from anyone.
- **Inputs:** `Participation.weeklyAmount`, `Participation.startWeek`, `Participation.weeksCommitted`, `Participation.status`, `Participation.closedAtWeek`, `ParticipationBreak.fromWeek`/`toWeek`, `Payment.isDeferred`, `Week.isSkipped`, `Week.weekNumber`
- **Canonical:** `lib/dashboard.ts:255` (inside `weekReceipts`, `lib/dashboard.ts:220`); guards at `lib/dashboard.ts:252-253`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/dashboard.ts:270`, `lib/payments-view.ts:225` (`buildPaymentGrid` row.expected — counts DEFERRED weeks IN, excluding only cells whose derived status is SKIPPED; the opposite of `weekReceipts`), `lib/payments-view.ts:214`, `:222`, `lib/dashboard.ts:128`, `lib/dashboard.ts:250`, `lib/participation-close.ts:120` (`inWindow` — the window predicate the expectation stands on), `app/admin/(protected)/cycle/position/week-dates.ts:108` (runs the same in-window + weeklyAmount test over the same rows, counting instead of summing), `app/admin/(protected)/cycle/position/week-dates-data.ts:104`, `app/admin/(protected)/cash/page.tsx:62` (sums expected across EVERY series week with no elapsed filter while the card labels it "expected by now"), `app/admin/(protected)/cycle/page.tsx:40` (computes the current week's expected pot inline from in-window ACTIVE participations, no deferral filter), `app/actions/dashboard.ts:291`, `app/actions/cycle-position.ts:251`, `lib/projection.ts:129` (a weekly pot with no window filter at all), `scripts/audit-position-figures.mts:227`, `:234`, `:242`, `scripts/verify-participation-close.mts:117`, `:118`. Whole-commitment forms of the same weeklyAmount × weeks product: `lib/money.ts:78`, `lib/contribution.ts:88`, `lib/final-position.ts:135`, `lib/dashboard.ts:481`, `:492`, `app/actions/agreement.ts:127`, `lib/participation-removal.ts:100`, `scripts/verify-number-amounts.mts:66`
- **Surfaces:** `app/admin/(protected)/this-week/page.tsx:109` ("Expected" stat card), `app/admin/(protected)/page.tsx:208`, `app/admin/(protected)/cash/page.tsx:277`, `:281`, `components/charts/collected-vs-expected-chart.tsx:61`, `:149`, `:256`, `:326`, `app/admin/(protected)/payments/payments-grid.tsx:332` (fed by the payments-view implementation), `app/admin/(protected)/cycle/page.tsx:85`
- **Units:** cents, integer. `weekReceipts` asserts non-negative safe integers (`lib/dashboard.ts:254`). Converted to dollars only at render by `formatMoney` (`lib/format.ts:5`) or by StatCard's cents prop (`components/ui/stat-card.tsx:60`).
- **Note (recorded, not judged):** three populations answer to the word "expected" —
  `lib/dashboard.ts:255` drops deferred members; `lib/payments-view.ts:225` keeps them;
  `app/admin/(protected)/cash/page.tsx:62` uses every week rather than the elapsed ones.

### Received for a week

- **Formula:** for one week, add `Payment.amountPaid` across EVERY payment row stored on
  that week. No window test and no deferral test is applied to the received side — money
  on a row for a member outside their window, or on a deferred member's row, still counts.
  It is money allocated to that week's payment row, not all cash that arrived during the
  calendar week.
- **Inputs:** `Payment.amountPaid`, `Payment.weekId`, `Week.weekNumber`
- **Canonical:** `lib/dashboard.ts:250` (accumulates BEFORE the window/skip/deferral guards at `:252-253`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/payments-view.ts:222`/`:223` (`buildPaymentGrid` row.received — sums only cells inside the member's start..finish range, so out-of-window money is NOT counted), `lib/dashboard.ts:128` (cashSeries `receivedBy` — same rows, same week attribution, separate accumulator), `app/actions/cycle-close.ts:178` (per-week received re-summed from each participation's payment row, frozen into the archive) and `app/actions/cycle-close.ts:179` (attribution by `weekId` rather than `weekNumber`), `lib/cycle-close.ts:234`, `app/actions/people.ts:92-95` (Prisma `groupBy _sum.amountPaid` — the same column summed in SQL, per participation), `scripts/audit-position-figures.mts:240`, `scripts/verify-participation-close.mts:118`, `scripts/verify-cycle-close-money.mts:92`, `:138`, `scripts/verify-cycle-position.mts:145`, `scripts/diagnose-paid-ahead.mts:96` (a local `sum` helper applied at `:98`, `:102`, `:106`)
- **Surfaces:** `app/admin/(protected)/this-week/page.tsx:114` ("Received" stat card), `app/admin/(protected)/page.tsx:210`, `app/admin/(protected)/cash/page.tsx:278`, `components/charts/collected-vs-expected-chart.tsx:160`, `:256`, `:325`, `components/charts/cash-position-chart.tsx:300`, `:370`, `app/admin/(protected)/payments/payments-grid.tsx:332`
- **Units:** cents, integer; `assertCents` at `lib/dashboard.ts:249`.
- **Note (recorded, not judged):** three populations answer to the word "received" —
  `lib/dashboard.ts:250` counts every row on the week including out-of-window and deferred;
  `lib/payments-view.ts:222` counts in-window cells only; `app/actions/cycle-close.ts:178`
  attributes by `weekId` rather than `weekNumber`.

### Short for a week (per-week shortfall)

- **Formula:** expected for the week minus received for the week, floored at zero. Netted
  across the whole week — one member's surplus on that week offsets another member's gap,
  and the received side includes money from rows the expected side excluded (deferred
  members, out-of-window rows).
- **Inputs:** expected for a week (derived), received for a week (derived)
- **Canonical:** `lib/dashboard.ts:264`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/admin/(protected)/this-week/page.tsx:121` (inlined `Math.max(0, totals.expected − totals.received)` rather than reading `totals.shortfall`; own wording branch at `:123-130`), `app/admin/(protected)/cash/page.tsx:266` (inlined `gap` per table row, no elapsed filter and no skipped filter), `app/actions/dashboard.ts:221`, `lib/cycle-position.ts:209`, `:217`, `components/charts/collected-vs-expected-chart.tsx:75`, `lib/cycle-position.test.ts:22`, `components/charts/collected-vs-expected-chart.test.tsx:17`, `components/charts/standards.test.tsx:37` (a fixture that sets shortfall by its own week-number rule rather than from expected − received)
- **Surfaces:** `app/admin/(protected)/this-week/page.tsx:118-133`, `:121` ("Short" stat card — **the screen in the reported bug**), `app/admin/(protected)/page.tsx:199` (pill tone), `:212` ("· short $X"), `app/admin/(protected)/cash/page.tsx:292` (By-week "Short" column), `components/charts/collected-vs-expected-chart.tsx:188`, `:327`
- **Units:** cents, integer. Never negative by construction.

### Weeks that closed with money overdue (closed-week shortfall list)

- **Formula:** every series week whose own stored date plus 5 days has passed, which is
  not skipped, and whose shortfall is above zero; reported as week number plus shortfall.
- **Inputs:** per-week shortfall (derived), `Week.date`, `Week.isSkipped`, today, `PAYMENT_WINDOW_DAYS`
- **Canonical:** `app/actions/dashboard.ts:221` (re-derives the window-closed test inline at `:224` rather than reading the `elapsed` flag already stamped by `lib/dashboard.ts:270`/`:286`), guards at `:221-227`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/dashboard.ts:264`, `components/charts/collected-vs-expected-chart.tsx:188` (the red dot: `w.elapsed && w.expected > 0 && w.received < w.expected` — same idea from the stamped flag), `components/charts/collected-vs-expected-chart.tsx:72-75` (the aggregate form of the same test in the same component), `app/admin/(protected)/cash/page.tsx:266`, `lib/chart.ts:201` (`longestOverdueRun` — the per-member version of the same closed-and-unpaid run)
- **Surfaces:** `app/admin/(protected)/page.tsx:367-386` ("Week N closed with money overdue · $X overdue"), `:378`, `:380`
- **Units:** cents for the shortfall; week numbers alongside.

### Members expected for a week

- **Formula:** count of participations whose window covers the week and whose payment row
  for that week is not deferred; zero for a skipped week. Same filter as the money
  expectation, counted instead of summed.
- **Inputs:** `Participation.startWeek`, `Participation.weeksCommitted`, `ParticipationBreak.fromWeek`/`toWeek`, `Payment.isDeferred`, `Week.isSkipped`
- **Canonical:** `lib/dashboard.ts:256`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/admin/(protected)/cycle/position/week-dates-data.ts:150` (passes the value straight through onto `WeekDateRow.membersExpected`), `lib/presentation.ts:204` (passed through unredacted onto the week board payload)
- **Surfaces:** `app/admin/(protected)/this-week/page.tsx:115` ("N of M members paid"), `app/admin/(protected)/page.tsx:200`, `:213`, `components/charts/collected-vs-expected-chart.tsx:256`, `:329`, `app/admin/(protected)/cycle/position/week-date-panel.tsx:134`
- **Units:** a count of people, not money.

### Members paid for a week

- **Formula:** of the members expected for that week, the count whose stored `amountPaid`
  on that week is at or above their own weekly amount. Partial payers are not counted;
  deferred and out-of-window members were already excluded.
- **Inputs:** `Payment.amountPaid`, `Participation.weeklyAmount`, members expected (derived)
- **Canonical:** `lib/dashboard.ts:257`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/presentation.ts:203` (passed through unredacted), `app/admin/(protected)/cycle/position/week-dates.ts:111` (the same `>= weeklyAmount` covered-test, used to EXCLUDE rather than count), `lib/payments-view.ts:130` (`splitWeekRoster` — `amountPaidThisWeek >= amountDue` decides paid vs owing, with deferred forced into paid), `lib/week-selection.ts:21` (the same comparison as a boolean), `app/admin/(protected)/people/[id]/member-payments.tsx:377`, `lib/rebuild.ts:143`, `app/actions/edits.ts:1499`, `lib/derived.ts:190`, `lib/chart.ts:194`
- **Surfaces:** `app/admin/(protected)/this-week/page.tsx:115`, `app/admin/(protected)/page.tsx:200`, `components/charts/collected-vs-expected-chart.tsx:256`, `:329`
- **Units:** a count of people.
- **Note:** the bare comparison `amountPaid >= weeklyAmount` appears under SEVEN names across the repo — see the synonym list in Part C.

### Members short for a week

- **Formula:** members expected for the week minus members paid for the week, floored at zero.
- **Inputs:** members expected (derived), members paid (derived)
- **Canonical:** `app/admin/(protected)/cycle/position/week-dates-data.ts:152` (with `:151-153`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/admin/(protected)/page.tsx:213` (inlined for the "N have not paid" clause) and `:214` (the SAME subtraction written a second time on the very next line to print the number), `app/admin/(protected)/cycle/position/week-dates.test.ts:261`, `:303`, `:331`
- **Surfaces:** `app/admin/(protected)/cycle/position/week-date-panel.tsx:134` ("N of M"), `app/admin/(protected)/cycle/position/week-dates.ts:337`, `:342`, `:347`, `app/admin/(protected)/page.tsx:214`
- **Units:** a count of people.

### Who has paid / not paid for one week (the this-week grouping)

- **Formula:** for each member whose window covers the week, ask the one status ladder
  with that member's paid amount, their weekly amount, their deferral, their mark, the
  week's skipped flag and the week's own stored date. The mark rides along separately as a
  note on the row.
- **Inputs:** `Payment.amountPaid`, `Participation.weeklyAmount`, `Payment.isDeferred`, `Payment.markedLateAt`, `Week.isSkipped`, `Week.date`, today, the member's window incl. breaks
- **Canonical:** `lib/dashboard.ts:341` (`weekMemberStatus`, one engine per its own comment at `lib/dashboard.ts:317-340`), status call at `lib/dashboard.ts:372`, mark note at `:381`
- **Other implementations of the underlying "has this member covered this week" test — SUPERSEDED, see "Flagged for Pass 2":** `lib/payments-view.ts:123`/`:130` (`splitWeekRoster` — a second owing/paid split: a member is "paid" if deferred OR `amountPaidThisWeek >= amountDue`, with no date and no mark), `lib/dashboard.ts:257` (a third: `(payment?.amountPaid ?? 0) >= participation.weeklyAmount`, no deferral and no date), `app/admin/(protected)/cycle/position/week-dates.ts:111` (a fourth), `lib/rebuild.ts:143` (a fifth, deciding whether to clear the late mark), `app/actions/edits.ts:1499` (a sixth, refusing a late mark on a covered week), `lib/chart.ts:194` (a seventh: `amountPaid >= amountDue && amountDue > 0` → "paid"), `lib/derived.ts:190` (the ladder's own PAID branch), `app/admin/(protected)/this-week/page.tsx:64` (the screen re-groups the rows by raw status string rather than receiving groups), `lib/members-view.ts:64`
- **Surfaces:** `app/admin/(protected)/this-week/page.tsx:64`, `:156`, `:204`, `:206`
- **Units:** cents for the amounts shown at `app/admin/(protected)/this-week/page.tsx:206`.

### Grid row received / expected (payments grid footer column)

- **Formula:** per week row of the grid, received adds the stored paid amount of every
  cell inside a member's start..finish range; expected adds each such cell's amountDue
  unless the week is skipped or the cell's derived status is SKIPPED. Deferred cells ARE
  counted into expected here.
- **Inputs:** `Participation.weeklyAmount`, `Participation.startWeek`, `Participation.weeksCommitted`, `Payment.amountPaid`, `Week.isSkipped`, per-member status (derived)
- **Canonical:** `lib/payments-view.ts:211`; received `:222`/`:223`, expected `:225`; the grid's own window test at `lib/payments-view.ts:217-221` (a copy of `inWindow` that knows nothing about `ParticipationBreak`, and treats a missing row as after-finish)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/dashboard.ts:220` (the other per-week expected/received, with different deferral and window handling), `app/actions/cycle-close.ts:178` (a third "sum this week's money", over participations rather than grid cells, keyed by `weekId`), `lib/members-view.ts:23-39` (`buildMemberRows` transposes the same rows member-major, carrying outstanding and totalContributed through untouched), `lib/payments-view.ts:251`
- **Surfaces:** `app/admin/(protected)/payments/payments-grid.tsx:204` (column header), `:332` (values)
- **Units:** cents, integer. Zeroed wholesale in presentation mode (`lib/presentation.ts:126-127`).

### Per-week figures in presentation mode

- **Formula:** `redactDashboard` rebuilds the dashboard payload as an allowlist that omits
  series, thisWeek, selectedWeekTotals, selectedWeekMembers, position, attention and
  closedShortfalls entirely — so every per-week money aggregate is ABSENT rather than
  zeroed. The week board redactor instead ZEROES expected and receivedTotal while passing
  membersPaid and membersExpected through unchanged.
- **Inputs:** expected / received for a week, members paid / expected, `Setting.presentationMode`
- **Canonical:** `lib/presentation.ts:49`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/presentation.ts:178` (`redactWeekBoard` — zeroes money at `:202-203`, keeps counts at `:203-204`), `lib/presentation.ts:106` (`redactGrid` — zeroes grid row received/expected at `:126-127`, outstanding/totalContributed at `:119-120`), `lib/presentation.ts:349` (`redactCycleDetail` — zeroes `unitAmount` at `:356`, `feePercent` at `:357`, `weeklyAmount` at `:374`), `lib/presentation.ts:257` (`redactWheelState`), `lib/presentation.ts:313` (`redactProposedSlots`, `total: 0` at `:317`), `lib/presentation.ts:30`, `:54`, `:119`, `:188`, `:189`, `:205`. A DIFFERENT mechanism for the same rule — refuse rather than redact — at `app/actions/cycle-position.ts:61` and `:389` (whole action withheld with `PRESENTATION_HIDDEN`), `app/admin/(protected)/cycle/position/week-dates-data.ts:38-40`, `app/actions/payments-view.ts:151` (redacts) vs `:171` and `:240` (refuse) — three different presentation decisions in one file — and hand-applied gates at `app/actions/cycle-close.ts:223`, `:319`, `:411`, `:458`, `app/actions/participation-close.ts:195`, `app/actions/ledger.ts:37`, `:118`, `:195`, `app/actions/manual-payout.ts:42`, `:198`, `app/actions/carry-deduction.ts:106`, `:162`
- **Surfaces:** `app/admin/(protected)/this-week/page.tsx:62` (whole page replaced by a hidden notice), `app/admin/(protected)/cash/page.tsx:60`, `app/admin/(protected)/page.tsx:41-104`
- **Units:** money fields are cents when present, hard zeros or absent when redacted.

---

## B6 — Cycle position, cash and close

### Total received to date (whole-cycle cash in)

- **Formula:** add up every payment row's amount paid, across every participation in the
  active cycle. No status, week, window or deferral filter.
- **Inputs:** `Payment.amountPaid`
- **Canonical:** `lib/dashboard.ts:46` (with `lib/dashboard.ts:53`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-close.ts:260` (sums each member's `standing.totalPaid` rather than the raw rows), `app/actions/cycle-close.ts:178`, `lib/cycle-close.ts:234` (sums per-WEEK received — the archive's figure), `lib/payments-view.ts:222`, `lib/dashboard.ts:293` (`receivedByMember`, the per-member split with its own accumulator), `app/actions/people.ts:93`, `scripts/import-cycle.mts:244` (checked against a hardcoded expectation at `:322-333`), `scripts/audit-position-figures.mts:270`, `:285`, `scripts/verify-cycle-close-money.mts:92`, `:138`, `scripts/verify-participation-close.mts:118`, `scripts/verify-cycle-position.mts:145`, `scripts/elapsed-rule-impact.mts:223`, `scripts/verify-member-privileges.mts:71`, `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:46`, `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:79`, `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:167`
- **Surfaces:** `app/admin/(protected)/page.tsx:144` ("Received to date"), `app/admin/(protected)/cash/page.tsx:72`, `:92`, `app/admin/(protected)/cycle/position/page.tsx:336`, `app/admin/(protected)/cycle/close/close-flow.tsx:151`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:54`, `app/admin/(protected)/cycles/page.tsx:178`, `app/admin/(protected)/cash/page.tsx:63` (consumed as the subtrahend of the cycle-wide "Short")
- **Units:** cents. `lib/dashboard.ts:24`/`:52` `assertCents` refuses non-integer or negative.
- **Merged from:** "Total received (whole cycle cash in)" + "Total received to date".

### Total paid out to date (money that actually left)

- **Formula:** add up the net amount of every payout whose status is COLLECTED. Payouts
  still pending are excluded — nothing has left the hand yet.
- **Inputs:** `Payout.netAmount`, `Payout.status`
- **Canonical:** `lib/dashboard.ts:60` (with `lib/dashboard.ts:55`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/admin/(protected)/collections/page.tsx:231`, `app/actions/cycle-close.ts:114` (`receivedNet` per member), `:119`, `:261`, `:265`, `:266`, `lib/cycle-close.ts:238` (`paidOutNet`), `app/actions/cycle-position.ts:231-236` (`paidOutTo` map), `:235`, `app/actions/dashboard.ts:280-285`, `app/actions/dashboard.ts:317`, `app/actions/participation-close.ts:137-140` (`alreadyPaidOut`), `app/actions/member.ts:157-160`, `app/admin/(protected)/people/[id]/page.tsx:164-167`, `lib/undo-draw.ts:48`, `lib/participation-removal.ts:121-126`, `lib/cycle-position.ts:326-329`, `scripts/import-cycle.mts:312`, `scripts/verify-cycle-close-money.mts:90`, `:108`, `:110`, `scripts/verify-cycle-position.mts:191-193`, `scripts/audit-position-figures.mts:161-169`, `:167`, `:286`
- **Surfaces:** `app/admin/(protected)/page.tsx:151`, `app/admin/(protected)/cash/page.tsx:72`, `:99`, `:409`, `app/admin/(protected)/cycle/position/page.tsx:338`, `app/admin/(protected)/cycle/close/close-flow.tsx:152`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:55`, `:105`, `app/admin/(protected)/collections/page.tsx:250`, `app/me/page.tsx:112`, `components/admin/close-participation.tsx:383-385`, `app/admin/(protected)/cycle/position/page.tsx:270`
- **Units:** cents.
- **Note:** `Payout.netAmount` is itself mutated at write time by four paths (see B4), so this sum's inputs are mutable. `app/actions/cycle-close.ts:122` also keeps `awardedNet` (ALL statuses) and `:126` `pendingNet` (non-COLLECTED) as separate figures.
- **Merged from:** "Total paid out to date" + "Net actually handed over to a member" + part of "Collected total vs pending total".

### Committed to winners / owed now / pending (drawn but not handed out)

- **Formula:** add up the net amount of every payout whose status is PENDING (some sites
  select it as `status !== "COLLECTED"` instead).
- **Inputs:** `Payout.netAmount`, `Payout.status`
- **Canonical:** `lib/dashboard.ts:62`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/waiting.ts:148` (the same set of rows under the name "owed now"), `app/admin/(protected)/collections/page.tsx:232`, `app/actions/cycle-close.ts:126`, `app/actions/cycle-close.ts:131` (selects `status !== "COLLECTED"`), `:249`, `:253`, `lib/cycle-close.ts:239`, `lib/dashboard.ts:63` (`pendingPayoutCount`, counting `status !== "COLLECTED"`), `lib/dashboard.ts:140`, `lib/cycle-position.ts:325`, `app/admin/(protected)/collections/collections-view.tsx:399`, `scripts/verify-cycle-close-money.mts:91`, `:117`, `:119`, `scripts/audit-position-figures.mts:290`
- **Surfaces:** `app/admin/(protected)/cash/page.tsx:157`, `:171`, `app/admin/(protected)/page.tsx:172`, `app/admin/(protected)/cycle/position/page.tsx:355`, `app/admin/(protected)/collections/page.tsx:257`, `app/admin/(protected)/waiting/waiting-view.tsx:127`, `components/admin/waiting-summary.tsx:46`, `components/charts/cash-position-chart.tsx:372`
- **Units:** cents.
- **Merged from:** "Committed to winners" + "Owed now (drawn payouts still pending)".

### Cash held / currently held / what you should be holding

- **Formula:** total received minus total paid out. Payouts drawn but not yet handed over
  are NOT subtracted — the cash is still in hand.
- **Inputs:** total received (derived), total paid out (derived)
- **Canonical:** `lib/dashboard.ts:66`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/cycle-position.ts:308` and `lib/cycle-position.ts:323` (`shouldBeHolding = collected − handedOut`, the same subtraction under a different name), `app/actions/cycle-close.ts:293` (`stillHeld: received − paidOut`), `lib/cycle-close.ts:254`, `lib/dashboard.ts:149` (`cashSeries` running `held` — the per-week form), `app/actions/cycle-position.ts:299`, `:300`, `scripts/import-cycle.mts:316` (`held = collectedCents − paidOutCents`, computed inside the import transaction which rolls back on mismatch), `scripts/audit-position-figures.mts:294`, `:200`, `:204`, `scripts/verify-cycle-close-money.mts:157`, `:162` (the OLD stillHeld arithmetic kept for comparison), `scripts/verify-cycle-position.mts:161`, `:165`, `:201`, `lib/cycle-position.test.ts:174`
- **Surfaces:** `app/admin/(protected)/page.tsx:159`, `app/admin/(protected)/cash/page.tsx:74`, `:85`, `app/admin/(protected)/cycle/position/page.tsx:342`, `app/admin/(protected)/cycle/close/close-flow.tsx:155`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:56`, `components/charts/cash-position-chart.tsx:112` ("held after week N"), `app/admin/(protected)/cycle/position/cash-reading-panel.tsx:265`
- **Units:** cents. Can go negative — the chart clamps the drawn area to zero and says so in words at `components/charts/cash-position-chart.tsx:384`. Not clamped at the source.

### Uncommitted / not promised to anyone

- **Formula:** cash held minus the amount committed to winners.
- **Inputs:** cash held (derived), committed to winners (derived)
- **Canonical:** `lib/dashboard.ts:72`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/cycle-position.ts:389`/`:390` (`coverage` — the same human question built on the COUNTED cash reading rather than the books, and also subtracting paid-early money and money owed back to stopped members)
- **Surfaces:** `app/admin/(protected)/cash/page.tsx:163`, `:218`, `app/admin/(protected)/page.tsx:177`
- **Units:** cents. May go negative and is not clamped.

### Gone out in total, and payout progress

- **Formula:** collected payout nets plus pending payout nets. Progress counts collected
  and pending payouts against the fixed denominator of every lucky number in the cycle;
  still-to-come is the denominator minus the drawn ones, floored at zero.
- **Inputs:** `Payout.netAmount`, `Payout.status`, LuckyNumber count
- **Canonical:** `app/admin/(protected)/collections/page.tsx:269` (gone out in total); `app/admin/(protected)/collections/page.tsx:229` (progress counts)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-close.ts:122` (`awardedNet` — the archive's version, per member), `lib/undo-draw.ts:46`, `app/admin/(protected)/collections/page.tsx:225` (for the move picker), `lib/manual-payout.ts:104`, `app/actions/manual-payout.ts:315`, `:518`, `app/actions/edits.ts:354`, `:680`, `lib/participation-removal.ts:111`, `:186`, `app/admin/(protected)/collections/collections-view.tsx:397`, `components/charts/payout-progress-bar.tsx:33`, `:37`, `lib/dashboard.ts:63`, `app/actions/dashboard.ts:258` (`paidOutCount`), `scripts/verify-cycle-close-money.mts:114`
- **Surfaces:** `app/admin/(protected)/collections/page.tsx:267`, `:275`, `components/charts/payout-progress-bar.tsx:54`, `:135`, `app/admin/(protected)/page.tsx:168`
- **Units:** cents plus counts. The payout-progress denominator is LUCKY NUMBERS, not members (`app/admin/(protected)/collections/page.tsx:50`).

### Cash position per week (received, paid out, pending out, running held)

- **Formula:** per week — received is money on that week's payment rows; paid out is the
  net of COLLECTED payouts whose draw is on that week; pending out is the same for
  non-collected payouts and is NOT subtracted; held is the running total of received minus
  paid out through that week. A payout with no draw week is folded into the first week.
- **Inputs:** `Payment.amountPaid`, `Week.weekNumber`, `Payout.netAmount`, `Payout.status`, `Draw.weekId`, elapsed through week (derived)
- **Canonical:** `lib/dashboard.ts:114`; running held `lib/dashboard.ts:149`; received `:128`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-close.ts:140-191` (`archiveWeeks` — the same by-week attribution built for the archive: received per week at `:178`, payouts bucketed by their draw's week at `:155-168`, with a payout that has no draw filed under **week 0** rather than week 1), `lib/cycle-close.ts:234` and `:254` (the archive totals rolled up from those rows), `lib/payments-view.ts:214`, `lib/dashboard.ts:220`, `app/admin/(protected)/cash/page.tsx:266` (the By-week table computes its own per-week gap from the series rather than from cashSeries), `scripts/verify-cycle-close-money.mts:138`
- **Surfaces:** `components/charts/cash-position-chart.tsx:112`, `:300`, `:367`, `:370`, `:374`, `app/admin/(protected)/cash/page.tsx:106`
- **Units:** cents; `assertCents` at `lib/dashboard.ts:127` and `:134`. The chart axis converts to dollars and abbreviates at `components/charts/cash-position-chart.tsx:36-40`. Money is attributed by the week it is FOR, never by the day it arrived (`lib/dashboard.ts:105-109`).

### Should have come in, whole cycle (`shouldHaveCollected`)

- **Formula:** add the per-week expected across every week in the series flagged elapsed.
  Weeks that are current-but-open, and future weeks, are excluded.
- **Inputs:** expected for a week (derived), elapsed flag (derived)
- **Canonical:** `lib/cycle-position.ts:194` (re-reduced from the elapsed slice at `lib/cycle-position.ts:303`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `components/charts/collected-vs-expected-chart.tsx:73` (`closedExpected` — same sum, recomputed in the chart for its headline), `app/admin/(protected)/cash/page.tsx:62` (`expectedTotal` — sums expected over EVERY series week with NO elapsed filter, while the card labels it "Expected by now"), `scripts/audit-position-figures.mts:227`, `:234`, `scripts/verify-participation-close.mts:117` (also the unfiltered whole-series sum, and the figure its close assertions at `:174` and `:185-189` are made against)
- **Surfaces:** `app/admin/(protected)/cycle/position/page.tsx:108`, `:130` ("Should have come in"), `lib/cycle-position.ts:461` (collection sentence), `app/admin/(protected)/cash/page.tsx:240` ("Expected by now" — the unfiltered variant)
- **Units:** cents, integer.

### Actually collected for elapsed weeks

- **Formula:** add the per-week received across every series week flagged elapsed.
- **Inputs:** received for a week (derived), elapsed flag (derived)
- **Canonical:** `lib/cycle-position.ts:195` (re-reduced at `lib/cycle-position.ts:304`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `components/charts/collected-vs-expected-chart.tsx:74` (`closedReceived`), `scripts/audit-position-figures.mts:240-243` (filters flat payments by `weekNumber <= elapsed` instead of by the flag), `scripts/verify-cycle-position.mts:144-145` (`collectedFromRows`, asserted equal to `position.collected` at `:148`), `scripts/verify-participation-close.mts:118` (sums received over EVERY series week, no elapsed filter)
- **Surfaces:** `app/admin/(protected)/cycle/position/page.tsx:108`, `:135`, `:136`, `lib/cycle-position.ts:462`
- **Units:** cents, integer.

### Outstanding / shortfall, whole cycle, and will-not-arrive

- **Formula:** `gap = shouldHaveCollected − collected`, floored at zero. `willNotArrive` is
  the sum of stopped members' recorded balances, capped at that gap. `shortfall = gap −
  min(willNotArrive, gap)` — the stopped members' share is sorted OUT of the shortfall
  rather than deducted, so `shouldHaveCollected − collected` still equals `shortfall +
  willNotArrive`.
- **Inputs:** shouldHaveCollected (derived), collected (derived), stopped member's recorded balance (derived)
- **Canonical:** `lib/cycle-position.ts:217`; gap `lib/cycle-position.ts:209`; willNotArrive `lib/cycle-position.ts:208` and re-capped independently at `:220`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `components/charts/collected-vs-expected-chart.tsx:75` (`behind` — closedExpected − closedReceived, floored at zero, with NO stopped-member subtraction), `app/admin/(protected)/cash/page.tsx:63` (`shortfall` — whole-series expectedTotal minus ALL cash ever received), `app/admin/(protected)/this-week/page.tsx:121` (the same subtraction for the one week on screen), `app/admin/(protected)/cash/page.tsx:266`, `lib/dashboard.ts:264`, `app/actions/cycle-close.ts:294` (`totalOutstanding` — a DIFFERENT whole-cycle outstanding: the SUM OF PER-MEMBER standing outstanding, not the expected-minus-received gap), `lib/cycle-close.ts:240` (the same per-member sum, frozen into the archive), `scripts/audit-position-figures.mts:278-282` (re-derives the gap and checks it reconciles to shortfall + willNotArrive), `scripts/verify-cycle-position.mts:145`, `scripts/deferral-impact.mts:214-215`, `:222`, `scripts/elapsed-rule-impact.mts:134-135`
- **Surfaces:** `app/admin/(protected)/cycle/position/page.tsx:141` ("Outstanding"), `:223`, `:238`, `:296`, `lib/cycle-position.ts:464-479` (collection sentence, rendered via `app/actions/cycle-position.ts:348`), `components/charts/collected-vs-expected-chart.tsx:101-104`, `app/admin/(protected)/cash/page.tsx:242`, `:243-245`
- **Units:** cents, integer. Never negative.
- **Merged from:** three sweeps ("Should-have-collected vs collected", "Outstanding / shortfall for elapsed weeks", "Money that will not arrive and the group collection shortfall").

### Who the outstanding money is with (`owedBy`, per member)

- **Formula:** for each ACTIVE participation, run the standing engine over their whole
  window and take `amountOutstanding`. Only members with a positive figure are listed,
  largest first.
- **Inputs:** as for *Amount outstanding* (B2)
- **Canonical:** `app/actions/cycle-position.ts:205` (via `computeStanding`, `lib/standing.ts:179` → `lib/derived.ts:286`); the drop filter at `lib/cycle-position.ts:218`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/dashboard.ts:581` (memberAttention rebuilds the due-week set and calls `amountOutstanding` itself, without the pinned-settlement handling), `app/actions/cycle-position.ts:259` (`balanceRecorded` — the same engine re-run over a stopped member's SHORTENED window, in the same function), `app/actions/cycle-close.ts:63`/`:107`, `app/actions/participation-close.ts:85`/`:146`, `app/admin/(protected)/collections/page.tsx:105`/`:128`, `app/actions/payments-view.ts:56`/`:116`, `app/actions/payments.ts:375`, `lib/messaging-engine.ts:114`/`:180`, `app/actions/waiting.ts:162`, `app/actions/member.ts:234`/`:347`, `lib/final-position.ts:136` (a NON-engine outstanding: `unpaid = committed − paidIn`, no due-week filter), `lib/contribution.ts:89` (the same subtraction under a different name and meaning), `scripts/audit-position-figures.mts:142`, `:146`, `scripts/deferral-impact.mts:60`, `scripts/elapsed-rule-impact.mts:76`
- **Surfaces:** `app/admin/(protected)/cycle/position/page.tsx:220-241`, `:236`, `app/admin/(protected)/page.tsx:283` (from `memberAttention`, the other implementation)
- **Units:** cents, integer.

### Paid ahead (money on weeks that have not happened) and the paid-ahead boundary

- **Formula:** weeks strictly AFTER the current week — the highest week whose date has
  ARRIVED — are ahead. Weeks whose window has closed are elapsed. The weeks in between
  (arrived, window still open) are this week's own money. Group total is the sum of
  received across ahead weeks; per member it is the sum of their stored amounts on those
  weeks, with a count of how many such weeks.
- **Inputs:** received for a week (derived), `Payment.amountPaid`, `Week.weekNumber`, current week from rows (derived), elapsed through week (derived)
- **Canonical:** `lib/cycle-position.ts:226`; buckets at `lib/cycle-position.ts:186`, `:189-190`, `:192`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-position.ts:215` (per member), `:222`, `lib/cycle-position.ts:188` (falls back to the elapsed boundary — the old, wrong split — when no currentWeek is supplied), `lib/cycle-position.ts:192`, `lib/cycle-position.ts:324`, `scripts/audit-position-figures.mts:152`, `:156`, `:254`, `scripts/verify-cycle-position.mts:127`, `scripts/diagnose-paid-ahead.mts:46`, `:57` (the gap `currentWeek − elapsed`), `:69`, `:92-94` (the SAME sum computed against BOTH boundaries side by side), `:96`, `:113-125`, `lib/standing.ts:198` (a different but adjacent "money beyond what is owed"), `lib/contribution.ts:90` (a third "paid beyond" figure, off receipts)
- **Surfaces:** `app/admin/(protected)/cycle/position/page.tsx:108`, `:172`, `:173`, `:182`, `:194-209`, `:206`, `:350`, `:400`, `lib/cycle-position.ts:489`, `:490`, `:491`, `app/admin/(protected)/cash/page.tsx`
- **Units:** cents for the amount; the "weeks ahead" companion is a count of weeks.
- **Note:** `lib/cycle-position.ts:92-110` records that using the elapsed boundary here
  reported $12,925 across 13 members as paid ahead when only $3,550 from 3 members was.

### Expected this week / collected this week (the open week)

- **Formula:** add expected and received across series weeks that are NOT elapsed but
  whose number is at or below the current week — weeks that have arrived and whose window
  is still open.
- **Inputs:** expected / received for a week (derived), elapsed flag (derived), current week (derived)
- **Canonical:** `lib/cycle-position.ts:231` (expected), `lib/cycle-position.ts:232` (collected)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/dashboard.ts:259` (`thisWeek` — the single series row for the current week), `app/actions/dashboard.ts:345` (`selectedWeekTotals` — the same single-row pick for the week chosen in the URL; `/admin/this-week`'s "Expected" card reads this, not the cycle-position figure), `app/admin/(protected)/cycle/page.tsx:40` (its own pot-this-week expectation from participation rows, off `currentWeekNumber`), `scripts/audit-position-figures.mts:246`, `scripts/diagnose-paid-ahead.mts:94`, `:102`
- **Surfaces:** `app/admin/(protected)/cycle/position/page.tsx:108`, `:183`, `:184`, `lib/cycle-position.ts:486`, `:487`, `app/admin/(protected)/page.tsx:208`, `:210`
- **Units:** cents, integer.

### Weeks (and money) leaving the expectation when a participation closes (`amountLeaving`)

- **Formula:** committed finish week minus the closing week, never below zero, multiplied
  by their weekly amount.
- **Inputs:** `Participation.startWeek`, `Participation.weeksCommitted`, `Participation.closedAtWeek`, `Participation.weeklyAmount`, `ParticipationBreak.fromWeek`, effective finish week (derived)
- **Canonical:** `lib/participation-close.ts:192` (week count; the subtraction itself at `lib/participation-close.ts:198`), multiplied at `lib/participation-close.ts:324`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/participation-close.ts:309` (`closePlan`), `app/actions/cycle-position.ts:246-251`, `app/actions/dashboard.ts:286`, `:287`, `app/actions/participation-close.ts:375`, `scripts/audit-position-figures.mts:177-182`, `:315-320` (a SECOND inlined copy in the same file), `scripts/verify-participation-close.mts:143-149`, `:393-398`, `:407-411` (a third copy inside the shortfallToCover ternary)
- **Surfaces:** `components/admin/close-participation.tsx:225`, `lib/participation-close.ts:397-399`, `app/admin/(protected)/cycle/position/page.tsx:286`, `lib/cycle-position.ts:477`, `app/admin/(protected)/page.tsx:334-336`
- **Units:** weeks (count) × cents = cents. The multiplication happens BOTH inside `closePlan` and at the call sites.
- **Merged from:** three sweeps.

### Shortfall the organizer must cover himself (`shortfallToCover` / `toCover`)

- **Formula:** per member, `amountLeaving` if they had ALREADY been handed a payout
  (status COLLECTED), otherwise zero — a pending payout has not left his hands, so there
  is nothing to cover. Group total is the sum across stopped members.
- **Inputs:** amountLeaving (derived), `Payout.netAmount` where status COLLECTED, `Participation.status`
- **Canonical:** `lib/participation-close.ts:336`; group total `lib/cycle-position.ts:221`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-position.ts:264` (inlined ternary), `app/actions/dashboard.ts:300` (the same ternary again), `app/actions/participation-close.ts:380`, `lib/participation-close.ts:364-374` (`stoppedSentence` re-tests `alreadyPaidOut > 0 && amountLeaving > 0` to choose its wording), `scripts/audit-position-figures.mts:190`, `:328-345` (a SECOND copy in the same file), `scripts/verify-participation-close.mts:213-216`, `:405`
- **Surfaces:** `app/admin/(protected)/page.tsx:334-336`, `app/admin/(protected)/cycle/position/page.tsx:275`, `:308`, `components/admin/close-participation.tsx:226`, `:385`, `lib/participation-close.ts:418-422`, `lib/cycle-position.ts:476-477`
- **Units:** cents.

### Shortfall recorded when a member closes mid-cycle (`balanceToRecord`)

- **Formula:** their outstanding across weeks up to and including the closing week,
  floored at zero, computed with the post-close window so breaks and holes are honoured
  and weeks they were previously away are never billed. Written as a DEBT ledger entry on
  the PERSON; skipped entirely when zero.
- **Inputs:** amount outstanding (derived), `ParticipationBreak.fromWeek`/`toWeek`, `Participation.startWeek`, `Participation.weeksCommitted`, closingAtWeek (organizer input)
- **Canonical:** `lib/participation-close.ts:309`, `balanceToRecord` at `lib/participation-close.ts:331`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/participation-close.ts:149` (supplies `outstandingToDate` from `computeStanding` over the `inWindow`-filtered window, `app/actions/participation-close.ts:102-124`, with a synthetic break appended at `:107`), `app/actions/participation-close.ts:376`, `app/actions/cycle-position.ts:259` (re-derives the same figure live via `standingFor(p, closedAtWeek)`, deliberately not read back from the ledger entry), `app/actions/dashboard.ts:273-302` (the dashboard's stopped list omits this figure entirely and reports only amountLeaving and shortfallToCover), `scripts/audit-position-figures.mts:187`, `scripts/verify-participation-close.mts:202-216` (closePlan driven directly with a hardcoded `outstandingToDate` of 150_000 at `:209`), `:226-228`, `:392` (sets balanceRecorded to 0 outright)
- **Surfaces:** `components/admin/close-participation.tsx` (consequence line from `lib/participation-close.ts:404-408`), `app/admin/(protected)/cycle/position/page.tsx:297`, `app/actions/participation-close.ts:350-352` (ledger entry description), `lib/participation-close.ts:378` (`stoppedSentence` — defined but has no non-test caller)
- **Units:** cents.

### Weeks returning when a stopped participation is reactivated

- **Formula:** resume from the later of the requested week, the week after they stopped,
  and their own start week. Weeks returning is committed finish week minus that resume
  week plus one, never below zero; the weeks they were away stay closed. Their finish week
  is NOT pushed out by the pause (comment `lib/participation-close.ts:463`).
- **Inputs:** `Participation.startWeek`, `Participation.weeksCommitted`, `Participation.closedAtWeek`, `Participation.weeklyAmount`
- **Canonical:** `lib/participation-close.ts:466`; resume point `:479`; weeksReturning `:480`; amountReturning `:485`; weeksStayingClosed `:486`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/participation-close.ts:466` (requested week defaulted to the current week, from rows at `:441`), `app/actions/participation-close.ts:480` (the break closed at `plan.fromWeek − 1`), `:512-513`, `scripts/verify-participation-close.mts:442-446`, `:461`
- **Surfaces:** `lib/participation-close.ts:491` (`reactivateConsequences`), `lib/participation-close.ts:496`, `components/admin/close-participation.tsx`
- **Units:** weeks, integer; `amountReturning` is cents — the mirror of `amountLeaving`.

### Stopped member's hole (already paid out, amount leaving, shortfall to cover, owed back)

- **Formula:** already paid out is the net of their COLLECTED payouts. Amount leaving is
  the weeks that stop being expected times their weekly. Shortfall to cover is that amount
  leaving, but only when they had already been paid out. Owed back is what he holds that
  is theirs (paid in less the fee on return) and is zero whenever they were paid out — the
  two never both apply.
- **Inputs:** `Payout.netAmount`, `Payout.status`, `Participation.weeklyAmount`, `Participation.startWeek`, `Participation.weeksCommitted`, `ParticipationBreak.fromWeek`/`toWeek`, `Payment.amountPaid`, fee withheld on return (derived)
- **Canonical:** `lib/participation-close.ts:309`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-position.ts:237` (`stoppedBy`, recomputed inline rather than via `closePlan`), `:246`, `:264`, `app/actions/dashboard.ts:273` (a third inline copy of alreadyPaidOut / amountLeaving / shortfallToCover), `:279`, `:286`, `:300`, `app/actions/participation-close.ts:137`, `lib/participation-close.ts:324`, `:336`, `:485`, `lib/cycle-position.ts:221`, `:222`, `scripts/audit-position-figures.mts:176`, `:177`, `:190`, `:315`, `:329`, `scripts/verify-participation-close.mts:393`, `:399`, `:405`
- **Surfaces:** `app/admin/(protected)/cycle/position/page.tsx:272`, `:286`, `:306`, `lib/cycle-position.ts:476`, `lib/participation-close.ts:352`, `:418`, `:496`, `app/admin/(protected)/page.tsx:334`, `components/admin/close-participation.tsx:217`, `:383`
- **Units:** cents.

### What the group owes a stopped, never-drawn member (`owedBack` / `owedBackToStopped`)

- **Formula:** per member, zero if they were already paid out; otherwise everything they
  paid in minus the fee on their commitment, floored at zero. Group total is the sum
  across stopped members. Reported as money the organizer HOLDS that is not his;
  subtracted in the coverage question but never from the cash position itself.
- **Inputs:** `Payment.amountPaid` (or `PaymentEvent.amount` on other paths), `Payout.netAmount` where status COLLECTED, `Participation.weeklyAmount`, `Participation.weeksCommitted`, `Cycle.unitAmount`, `Cycle.feePercent`, fee withheld on return (derived)
- **Canonical:** `app/actions/cycle-position.ts:268` (with the fee call at `:274`, and `:268-280`); group total `lib/cycle-position.ts:222`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/final-position.ts:109` and `lib/final-position.ts:126`/`:129` (the same quantity as the owed-to-them amount, computed from RECEIPTS rather than week rows), `app/actions/member.ts:176`, `app/admin/(protected)/people/[id]/page.tsx:156`, `lib/cycle-position.ts:318`, `lib/cycle-position.ts:389` (folded into `holdingForOthers`), `app/actions/dashboard.ts:273-302` (the dashboard's stopped list omits `owedBack` entirely), `scripts/audit-position-figures.mts:191-194` (computes it as the RAW sum of `Payment.amountPaid` with NO fee subtracted), `scripts/verify-participation-close.mts:401-404` (a third arithmetic under the same field name: week rows, no fee, no floor)
- **Surfaces:** `app/admin/(protected)/people/[id]/page.tsx:192`, `app/admin/(protected)/cycle/position/cash-reading-panel.tsx:262`, `app/me/page.tsx:100`, `lib/cycle-position.ts:389`, `:421`, `:433`, `:445` (inside the coverage sentence, rendered at `app/admin/(protected)/cycle/position/page.tsx:401`)
- **Units:** cents. Not rendered as a standalone figure anywhere — it appears only inside the verdict sentence.

### Fee estimate, kept out of the cash position

- **Formula:** fee already earned is the sum of the STORED fee on COLLECTED payouts; fee
  still to come is the sum of the stored fee on PENDING payouts; total is the two added.
  Reported separately and never subtracted from what he holds, because it is a projection.
- **Inputs:** `Payout.feeAmount`, `Payout.status`
- **Canonical:** `lib/cycle-position.ts:331`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-position.ts:311`, `:312`, `:314` (onHandedOut reduce), `:315`, `:317` (onDrawn reduce), `:330-337`, `lib/participation-removal.ts:87` (a fee attributable to one member from weeklyAmount × weeksCommitted × feePercent — a different route to a fee figure), `app/admin/(protected)/people/[id]/page.tsx:326` (sums stored feeAmount where a payout exists and the PROJECTED fee where it does not — a mixed-source fee total), `lib/fee-preview.ts:105`, `lib/projection.ts:115` (charges the fee on the whole-cycle gross rather than summing per-payout fees), `lib/projection.ts:132`, `scripts/audit-position-figures.mts:210`, `:211`, `:212`, `:303` (asserts `shouldBeHolding` does NOT subtract `fee.soFar`), `scripts/verify-cycle-position.mts:171`, `:172`, `:173`, `:211`
- **Surfaces:** `app/admin/(protected)/cycle/position/page.tsx:373`, `:376`, `:379`, `app/admin/(protected)/people/[id]/page.tsx:637`, `app/admin/(protected)/cycle/edit/cycle-edit-form.tsx:243`
- **Units:** cents; read from the STORED `Payout.feeAmount`, not re-projected. Deliberately excluded from the cash position and from the coverage verdict (`lib/cycle-position.ts:386`).

### Cash reading / counted cash (what he actually holds)

- **Formula:** a figure the organizer types in: the total he is holding across bank and
  cash on hand, on a stated date. When both halves are given they must add to the total or
  the save is refused.
- **Inputs:** `CashReading.totalAmount`, `CashReading.bankAmount`, `CashReading.cashAmount`, `CashReading.readAt`
- **Canonical:** `app/actions/cycle-position.ts:379`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/admin/(protected)/cycle/position/cash-reading-panel.tsx:103-107` (client parses DOLLARS into cents and computes the derived total client-side at `:106`), `app/actions/cycle-position.ts:409` (re-validated server-side)
- **Surfaces:** `app/admin/(protected)/cycle/position/cash-reading-panel.tsx:265`, `:298`, `:370`, `:375`
- **Units:** STORED in cents (`prisma/schema.prisma:708`) — the only stored money fact in the cash subsystem; everything else there is derived. Bound checked against `MAX_MONEY_CENTS` at `app/actions/cycle-position.ts:392`.

### Difference vs the books, coverage, and the verdict

- **Formula:** difference is the counted cash reading minus what the books say should be
  held. Coverage is the reading minus everything he is holding for other people: money
  paid early for weeks that have not happened, payouts drawn but not handed over, and
  money owed back to stopped members never drawn. The fee is deliberately absent from
  both. Verdict is SHORT whenever coverage is below zero; otherwise EXACT when the counted
  cash equals the books, SURPLUS when above, COVERED when below.
- **Inputs:** `CashReading.totalAmount`, cash on hand (derived), paid ahead (derived), committed pending (derived), owed back to stopped (derived)
- **Canonical:** `lib/cycle-position.ts:375` (verdict); difference `lib/cycle-position.ts:382`; `holdingForOthers` `lib/cycle-position.ts:389`; coverage `lib/cycle-position.ts:390`; `shortBy` `lib/cycle-position.ts:400`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/admin/(protected)/cycle/position/page.tsx:78` (recomputes `shouldBeHolding < paidEarly + drawnNotHandedOut` inline — from the books rather than the reading, and without the owed-to-stopped term) and `:79`, `app/actions/cycle-position.ts:367` (`differenceVsExpectedToday` per historical reading — every past reading is compared against TODAY's `shouldBeHolding`, stated explicitly at `cash-reading-panel.tsx:454`), `lib/dashboard.ts:72` (`uncommitted` — the same human question from the books), `scripts/verify-cycle-position.mts:225`, `:229`, `:234`
- **Surfaces:** `app/admin/(protected)/cycle/position/cash-reading-panel.tsx:222`, `:262`, `:389`, `app/admin/(protected)/cycle/position/page.tsx:79`, `:342`, `:400`, `lib/cycle-position.ts:406`
- **Units:** signed cents inside the sentence, formatted by the injected `formatMoney`.
- **Merged from:** "Coverage and verdict against the organizer's cash reading" + "Difference vs the books" + "Coverage / what is yours to use" + "Verdict kind".

### Outstanding carried to the person's ledger at cycle close (the closing DEBT entry)

- **Formula:** one DEBT entry per member whose outstanding is greater than zero, for
  exactly that outstanding amount, with the origin written out (cycle name, weeks paid of
  committed, last payment week, amount unpaid). Fully-paid members get nothing.
- **Inputs:** amount outstanding (derived), weeks credited (derived), `Participation.weeksCommitted`, last payment week (derived), `Cycle.name`, `LedgerEntry.type`, `LedgerEntry.amount`
- **Canonical:** `lib/cycle-close.ts:150`; filter `lib/cycle-close.ts:154`/`:155`; text `lib/cycle-close.ts:159-163`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-close.ts:348-353` (the write loop), `app/actions/participation-close.ts:344-354` (the same shape for a single member closing mid-cycle, with its own description wording), `app/actions/cycle-close.ts:385-389` (the audit summary re-sums the entries just written), `lib/ledger.ts:23` (the balance those entries then feed), `scripts/verify-participation-close.mts:222-229` (a third hand-written DEBT entry of the same shape), `scripts/lib/production-fixture.mts:274-282` (a fixture entry with its own wording)
- **Surfaces:** `app/admin/(protected)/cycle/close/close-flow.tsx:317-320`, `app/actions/cycle-close.ts:384-389`, `app/admin/(protected)/balances/page.tsx:142`, `app/me/history/page.tsx:82`, `app/admin/(protected)/people/[id]/member-payments.tsx:208`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:113`, `components/member/past-cycle-card.tsx:16`, `app/me/page.tsx:172`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:567`
- **Units:** cents.

### Total outstanding at close, and how many members are short

- **Formula:** `totalOutstanding` = the sum of every member's outstanding at the moment of
  closing; `membersShort` = the count of members whose outstanding is greater than zero.
- **Inputs:** amount outstanding (derived)
- **Canonical:** `app/actions/cycle-close.ts:294` (total), `app/actions/cycle-close.ts:295` (count)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/cycle-close.ts:240` and `lib/cycle-close.ts:256` (the archive recomputes both inside `buildArchiveData`), `lib/cycle-close.ts:155` (`finalBalanceEntries` filters the same members a third time), `app/actions/cycle-close.ts:385` (the audit summary re-sums the written debt entries), `app/admin/(protected)/cycles/[id]/archive/export-button.tsx:73`, `scripts/verify-cycle-close-money.mts:105`
- **Surfaces:** `app/admin/(protected)/cycle/close/close-flow.tsx:197`, `:317-320`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:57-63`
- **Units:** cents for the amount; `membersShort` is a count.

### Closing statement text for a member

- **Formula:** if outstanding is zero and weeks paid reach the commitment — "you completed
  all N weeks, balance zero". If outstanding is zero but short of the commitment — "you
  paid N of M, balance zero". Otherwise — "you paid N of M, last payment week K,
  outstanding X".
- **Inputs:** weeks paid (derived), `Participation.weeksCommitted`, amount outstanding (derived), last payment week (derived)
- **Canonical:** `lib/cycle-close.ts:169` (with `lib/cycle-close.ts:175-185`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/whatsapp-templates.ts:251` (CYCLE_CLOSING_STATEMENT states the same thing from the weeksPaid / weeksTotal / totalPaid / amountOwed placeholders, `lib/messages.ts:312`), `lib/member-history.ts:85`/`:90`/`:92` (`closingLine` — the member-portal wording, taken from the archive row), `app/actions/cycle-close.ts:106` (weeksPaid at close = weeksCredited capped at weeksCommitted, feeding both this sentence and the archive row), `lib/messages.ts:219`, `lib/messages.ts:329`
- **Surfaces:** `app/admin/(protected)/cycles/[id]/archive/page.tsx:120`, `components/member/past-cycle-card.tsx:77`, `lib/messages.ts:753` and the messaging preview surfaces
- **Units:** cents rendered via `formatMoney`; weeks are counts.

### Archive totals at close (received, paid out net, pending net, still held, outstanding)

- **Formula:** received is the sum of every archived week's received; paidOutNet is the
  sum of members' COLLECTED payout nets only; pendingNet is the sum of their
  not-yet-collected nets; stillHeld is received minus paidOutNet; outstanding is the sum
  of members' derived shortfalls at close. Frozen at close and rendered verbatim afterwards.
- **Inputs:** `Payment.amountPaid` per week, `Payout.netAmount`, `Payout.status`, outstanding per member (derived)
- **Canonical:** `lib/cycle-close.ts:225`; received `:234`, paidOutNet `:238`, pendingNet `:239`, outstanding `:240`, stillHeld `:254`, membersShort `:256`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-close.ts:260`, `:261`, `:293` (the pre-close review computes the same three figures a third way — received from Σ `standing.totalPaid` rather than Σ week received), `app/actions/cycle-close.ts:114-133` (per-member receivedNet / awardedNet / pendingNet — three separate status filters over the same payout rows), `app/actions/cycle-close.ts:97`, `:266`, `app/admin/(protected)/cycles/[id]/archive/export-button.tsx:69-73` (the four totals restated as CSV lines), `scripts/verify-cycle-close-money.mts:90`, `:91`, `:92-95`, `:106-119`, `:113`, `:136-141`, `:156-160`, `:157`, `:162`
- **Surfaces:** `app/admin/(protected)/cycles/[id]/archive/page.tsx:54`, `:55`, `:56`, `:57`, `:105`, `app/admin/(protected)/cycles/page.tsx:178`, `app/admin/(protected)/cycles/[id]/archive/export-button.tsx:69`, `:70`, `:71`, `:72`, `app/admin/(protected)/cycle/close/close-flow.tsx:151`, `lib/member-history.ts:90`, `:96`
- **Units:** cents. A STORED derived snapshot by design (§2.9) — the archive is never recomputed after close.
- **Merged from:** three sweeps.

### Archived per-member figures, and how a member reads them back

- **Formula:** at close, each member's weeks credited (capped at weeks committed), amount
  outstanding, total paid and settled-from-payout are computed once through the standing
  engine and written into the archive snapshot. The member's history page and the archive
  page render that stored blob verbatim rather than re-deriving.
- **Inputs:** weeks credited (derived), amount outstanding (derived), total paid (derived), `Payout.netAmount`, `PaymentEvent.amount` where pinned; then `CycleArchive.data`
- **Canonical (write):** `app/actions/cycle-close.ts:106`; also `:97`, `:99`, `:107`, `:114`, `:122`, `:126`, `:135`
- **Canonical (read):** `lib/member-history.ts:123` (`mine`), `lib/member-history.ts:176`; wording `lib/member-history.ts:85`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/cycle-close.ts:169`, `lib/cycle-close.ts:160`, `:175`, `lib/member-history.ts:175`, `:181`, `:182`, `:183-189`, `lib/member-history.ts:131-147` (a snapshot that will not parse, or has no row for this person, renders zeroes suppressed behind an `unreadable` flag), `lib/member-history.ts:138-142` (the fallback shape sets totalPaid and outstanding to 0 rather than deriving anything), `app/actions/member-history.ts:72`, `app/admin/(protected)/cycles/[id]/archive/page.tsx:96`, `:113-117`, `app/admin/(protected)/cycles/[id]/archive/export-button.tsx:33`, `:39`, `app/admin/(protected)/cycle/close/close-flow.tsx:228`, `components/member/past-cycle-card.tsx:16` (`const settled = cycle.outstanding === 0`), `scripts/verify-cycle-close-money.mts:102`, `:105`, `:123`, `:137`, `:157`
- **Surfaces:** `app/admin/(protected)/cycles/[id]/archive/page.tsx:96`, `:114`, `components/member/past-cycle-card.tsx:48`, `:51`, `:60`, `:77`, `:87`, `app/me/page.tsx:185`, `app/me/history/page.tsx`, `app/admin/(protected)/cycle/close/close-flow.tsx:228`
- **Units:** cents (weeks as counts). `lib/member-history.ts:106` carries its own local cents-to-dollars formatter so the module stays client-importable.
- **Merged from:** "Archived weeks paid / outstanding / total paid" + "Member's closing balance as read from the frozen archive" + "A finished cycle's figures".

### Final position of a stopped member (owed-to-them / they-owe / settled)

- **Formula:** drawn or not is the deciding fact. Never drawn: fee = the fee on their
  WHOLE commitment (unreduced by stopping), amount owed to them = paid-in minus fee
  floored at zero; zero produces "settled" rather than "owed $0". Drawn: committed =
  weekly × weeks committed, and they owe committed minus paid-in; zero or less is settled.
- **Inputs:** paid in (receipts), `Payout.netAmount` where status COLLECTED, `Participation.weeklyAmount`, `Participation.weeksCommitted`, `Cycle.unitAmount`, `Cycle.feePercent`, fee on return (derived)
- **Canonical:** `lib/final-position.ts:109`; drawn test `lib/final-position.ts:121`; owed `:126`; committed `:135`; unpaid `:136`; wording `:159`, `:204`, `:244`, `:251`, `:253`, `:180`, `:213`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/cycle-position.ts:268-280` (an inlined re-implementation of the owed-to-them branch only), `lib/final-position.ts:260` (`owedToStoppedMember` — the same result as a signed number; no non-test caller), `app/actions/member.ts:175-183` (paidIn from `PaymentEvent.amount` at `:156`, received from COLLECTED nets at `:157-160`), `app/admin/(protected)/people/[id]/page.tsx:156-173` (paidIn from a Prisma `paymentEvent.aggregate _sum` at `:158-163`, received at `:164-167`), `app/actions/member.ts:207` (weeksPaid inline from money), `scripts/audit-position-figures.mts:191`, `scripts/verify-participation-close.mts:402-404` (a THIRD inlined owed-back branch from week rows with NO fee subtraction and no floor), `lib/contribution.ts:88-89` (the same commitmentTotal / unpaid pair duplicated)
- **Surfaces:** `app/me/page.tsx:103`, `:112`, `:122`, `:135`, `components/admin/close-participation.tsx:270`, `:274`, `app/admin/(protected)/people/[id]/page.tsx:192-195` (built here, passed to the editor at `:807` and `:947`)
- **Units:** cents.
- **Verification refinement:** `drawn` is decided at `lib/final-position.ts:121` by
  `input.received > 0`, and every caller feeds `received` from COLLECTED payout nets only
  — so a member holding a PENDING payout evaluates as never-drawn on this path.
- **Note:** the call sites feed DIFFERENT paid-in bases — `app/admin/(protected)/people/[id]/page.tsx:157` and `app/actions/member.ts:156` sum `PaymentEvent.amount`; `app/actions/cycle-position.ts:245` and `scripts/verify-participation-close.mts:404` sum `Payment.amountPaid`.

### Refusals that fence where balance money may land

- **Formula:** no arithmetic — these decide WHERE money is allowed to go. A CLOSED cycle
  refuses week-level money because closing already wrote every shortfall to the carried
  ledger; a CLOSED participation inside a live cycle refuses too; both point the organizer
  at the ledger balance on the person's page instead (§2.19).
- **Inputs:** `Cycle.status`, `Cycle.name`, `Participation.status`
- **Canonical:** `lib/cycle-close.ts:62` (`frozenCycleRefusal`), `lib/cycle-close.ts:91` (`closedParticipationRefusal`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/cycle-guard.ts:40-46` (`refuseIfCycleClosed`) and `lib/cycle-guard.ts:62-71` (`refuseIfParticipationClosed`), `lib/participation-close.ts:226` (`closeRefusal` restates the closed-cycle sentence for the preview), `app/actions/participation-close.ts:299`, `:437`, `app/actions/ledger.ts:336`, `app/actions/carry-deduction.ts:169`, `app/actions/carry-deduction.ts:184-192` (refuses a deduction from an already-COLLECTED payout), `app/actions/manual-payout.ts:79`, `:216`, `app/actions/edits.ts:278`, `:628`, `:772`, `:917`, `scripts/verify-cycle-lock.mts:163`, `scripts/verify-participation-close.mts:345`
- **Surfaces:** `app/admin/(protected)/settings/cycle/cycle-rules-form.tsx:48`, `app/admin/(protected)/cycle/close/page.tsx:41`, `components/admin/close-participation.tsx`
- **Units:** none — these are the gates that make the ledger the single target for money after a close.

---

## B7 — Carried balances, the ledger and carry deductions

### Carried balance for a person (ledger balance)

- **Formula:** sum of every DEBT ledger entry minus the sum of every non-DEBT entry
  (PAYMENT and FORGIVEN both reduce it), floored at zero. An overpayment counts as settled
  in full, never as credit owed back. Never stored — derived on every read.
- **Inputs:** `LedgerEntry.type`, `LedgerEntry.amount`
- **Canonical:** `lib/ledger.ts:23`, reduce at `lib/ledger.ts:24-28`/`:25`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/ledger.ts:210-233` (a SECOND implementation using two Prisma `groupBy` aggregates — DEBT sum minus not-DEBT sum, `Math.max(0, …)` at `:229` — rather than calling `ledgerBalance`), `lib/ledger.ts:73`, `lib/ledger.ts:76`/`:80` (the running balance inside `ledgerStory`, re-clamped per entry), `lib/carry-balance.ts:88` (re-floors and truncates the balance it is handed), `lib/carry-balance.ts:179` (`balanceAfter`, with NO floor), `app/actions/ledger.ts:55`, `:79`, `:81`, `:141`, `:170`, `:173`, `:260`, `app/actions/carry-deduction.ts:115`, `:175`, `app/actions/member-history.ts:114`, `:120`, `app/actions/people.ts:130`, `app/admin/(protected)/people/[id]/page.tsx:267`, `:270`, `app/admin/(protected)/people/[id]/carried-balance.tsx:217`, `:302`, `:374`, `app/admin/(protected)/people/[id]/member-payments.tsx:231`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:265`, `scripts/verify-carry-deduction.mts:128`, `:203`, `scripts/verify-carry-intent-expiry.mts:35`, `:76`, `:116`, `scripts/verify-participation-close.mts:219`, `:231`, `:236`
- **Surfaces:** `app/admin/(protected)/balances/page.tsx:79-87`, `:90`, `:152`, `app/admin/(protected)/people/[id]/carried-balance.tsx:133`, `:374`, `app/admin/(protected)/people/[id]/page.tsx:267`, `app/admin/(protected)/people/[id]/member-payments.tsx:208`, `app/admin/(protected)/cycle/add/add-member-wizard.tsx:265`, `:566`, `app/me/history/page.tsx:63`, `app/me/page.tsx:153`, `:172`, `components/admin/carry-deduction-offer.tsx:143`
- **Units:** cents. `lib/ledger.ts:101` emits a refusal string containing the RAW cents number; `app/actions/ledger.ts:147` substitutes a `formatMoney` version before the organizer sees it. UI converts with `balance/100` (`carried-balance.tsx:179`, `:283`; `carry-deduction-offer.tsx:66`, `:172`) and back with `parseDollarsToCents`.
- **Merged from:** three sweeps ("Carried ledger balance", "Carried balance for a person", "My carried balance").

### Total carried across everyone

- **Formula:** sum of every person's carried balance that is greater than zero — every
  person, not just the page on screen.
- **Inputs:** carried balance for a person (derived)
- **Canonical:** `app/actions/ledger.ts:235` (per-person balances at `:229`, `:234`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** none found — `app/admin/(protected)/balances/page.tsx:80` renders the value it returns without re-summing.
- **Surfaces:** `app/admin/(protected)/balances/page.tsx:79-87`
- **Units:** cents.

### Total ever raised / repaid / written off on a person's ledger

- **Formula:** raised = sum of DEBT entries; repaid = sum of PAYMENT entries; forgiven =
  sum of FORGIVEN entries. Kept apart on purpose: money received and a decision the
  organizer made are different facts even though both reduce the balance.
- **Inputs:** `LedgerEntry.type`, `LedgerEntry.amount`
- **Canonical:** `lib/ledger.ts:42` (raised), `lib/ledger.ts:32` (repaid), `lib/ledger.ts:37` (forgiven), bundled by `lib/ledger.ts:68`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/ledger.ts:260-268` (`listCarriedBalances` builds a second `ledgerStory` per row and lifts the three off it), `app/admin/(protected)/people/[id]/page.tsx:270` (a third `ledgerStory` for the person page), `app/admin/(protected)/balances/page.tsx:96` (the written-off total across listed rows re-summed in the page from `row.forgiven`), `app/actions/people.ts:133` (DEBT-only sum for the origins list)
- **Surfaces:** `app/admin/(protected)/people/[id]/carried-balance.tsx:137-138`, `app/admin/(protected)/balances/page.tsx:94-99`, `:136`, `:155-156`
- **Units:** cents.

### Balance after each ledger entry (the running total, the story)

- **Formula:** walk the entries in the order the caller supplies (`occurredAt` then
  `createdAt`); add DEBT amounts, subtract everything else; the displayed running total is
  floored at zero at each step. No sorting happens inside — order is the caller's stored fact.
- **Inputs:** `LedgerEntry.type`, `LedgerEntry.amount`, `LedgerEntry.occurredAt`, `LedgerEntry.createdAt`
- **Canonical:** `lib/ledger.ts:68`, running total at `lib/ledger.ts:76`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/member-history.ts:117-124` (a second `ledgerStory` over the same entries, amounts re-signed at `:120` — DEBT positive, everything else negative — and reversed to newest-first), `app/actions/ledger.ts:260` (a third), `app/admin/(protected)/people/[id]/page.tsx:270` (a fourth), `app/actions/ledger.ts:250` and `app/admin/(protected)/people/[id]/page.tsx:89` (the ordering the story depends on is stated separately at each query site, never in one place)
- **Surfaces:** `app/admin/(protected)/people/[id]/carried-balance.tsx:374`, `:378`, `app/me/history/page.tsx:76-101`, `:99-100`
- **Units:** cents. `runningTotal` (`lib/ledger.ts:76`) is carried to the member history page and never rendered.

### Ledger entry amount (the stored money fact)

- **Formula:** written, not derived. Six production write shapes: the cycle-close shortfall
  (DEBT), the mid-cycle participation-close shortfall (DEBT), a payment against the balance
  (PAYMENT), a write-off (FORGIVEN), a carry deduction out of a payout (PAYMENT, linked to
  the payout), and the terms-change settlement (DEBT/PAYMENT pairs). One delete path.
- **Inputs:** `LedgerEntry.amount`, `type`, `description`, `notes`, `occurredAt`, `payoutId`, `method`
- **Canonical:** `prisma/schema.prisma:501` (model), `:505` (column)
- **Write sites:** `app/actions/cycle-close.ts:350`, `app/actions/participation-close.ts:344`, `app/actions/ledger.ts:64`, `app/actions/ledger.ts:152`, `app/actions/carry-deduction.ts:211`, `app/actions/edits.ts:422`, `:431`, `:442`, `:460`; fixtures/verification `scripts/lib/production-fixture.mts:274`, `scripts/verify-carry-deduction.mts:61-68`, `:186-194`, `scripts/verify-carry-intent-expiry.mts:88`, `:120`, `scripts/verify-participation-close.mts:222-229`
- **Delete sites:** `lib/carry-reversal.ts:52` (the only production delete); plus `scripts/verify-participation-close.mts:548`, `scripts/verify-removal-cascades.mts:43`, `scripts/verify-number-conflict.mts:47`, `scripts/verify-cycle-lock.mts:47`, `scripts/portal-test-fixture.mts:32`, `scripts/lib/production-fixture.mts:68`, `scripts/verify-carry-deduction.mts:47`, `:238`
- **Surfaces:** `app/admin/(protected)/people/[id]/carried-balance.tsx:375`, `app/admin/(protected)/balances/page.tsx:142`, `app/me/history/page.tsx:82`, `:100`
- **Units:** cents (Int). `MAX_MONEY_CENTS` is applied on the PAYMENT path only (`app/actions/ledger.ts:44`); `forgiveBalance` and the close paths are bounded by the balance or by the derived shortfall instead.

### Written off / forgiven amount

- **Formula:** an organizer-typed amount, refused unless there is a balance, the amount is
  a positive safe integer, and it does not exceed the balance. Recorded as its own FORGIVEN
  entry so the history shows nobody paid it; it reduces the balance exactly like a payment.
- **Inputs:** carried balance (derived), `LedgerEntry.amount` (typed), `LedgerEntry.notes` (reason)
- **Canonical:** `lib/ledger.ts:92` (`forgivenessRefusal`) with `app/actions/ledger.ts:101` (`forgiveBalance`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/ledger.ts:147` (re-words the over-amount refusal with `formatMoney` rather than reusing the pure one), `app/actions/ledger.ts:157-160` (a second amount-vs-balance comparison, `input.amount >= owed`, picking between two descriptions — separate from the refusal's `>` test), `app/actions/ledger.ts:170` (the remaining-after figure recomputed inline for the audit summary), `app/admin/(protected)/balances/page.tsx:96`
- **Surfaces:** `app/admin/(protected)/people/[id]/carried-balance.tsx:307-315`, `:332-333`, `app/admin/(protected)/balances/page.tsx:94-99`, `:136`
- **Units:** cents; typed in dollars and converted by `parseDollarsToCents` in the client. Requires the person's name typed (`lib/typed-confirmation.ts`) and a reason of at least 3 characters.

### Payment recorded against a carried balance, and what is left

- **Formula:** an organizer-typed amount recorded as a PAYMENT entry on the PERSON (never
  on a week). Remaining = balance before minus the amount, floored at zero. Refused if the
  person carries no balance.
- **Inputs:** carried balance (derived), `LedgerEntry.amount` (typed), `LedgerEntry.method`, `LedgerEntry.occurredAt`
- **Canonical:** `app/actions/ledger.ts:25`; remaining at `app/actions/ledger.ts:81`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/ledger.ts:79` (the same remainder computed a THIRD time inline for the audit summary), `app/actions/ledger.ts:69` (balance-before baked into the entry description), `app/admin/(protected)/people/[id]/carried-balance.tsx:217` (client-side left preview), `app/admin/(protected)/people/[id]/member-payments.tsx:231` (a second client-side preview), `app/actions/carry-deduction.ts:211-223` (the OTHER way a PAYMENT lands on a carried balance — out of a payout, linked by `payoutId`, with its own description wording), `scripts/verify-carry-deduction.mts:186-194`
- **Surfaces:** `app/admin/(protected)/people/[id]/carried-balance.tsx:233-234`, `:254-256`, `app/admin/(protected)/people/[id]/member-payments.tsx:203-231`
- **Units:** cents; bounded by `MAX_MONEY_CENTS` (`app/actions/ledger.ts:44`). NOT capped at the balance here (unlike forgiveness) — an overpayment simply clamps the balance to zero via `ledgerBalance`.

### Carry-deduction offer (balance, most deductible, suggested, net if applied)

- **Formula:** balance is the live ledger balance, truncated and floored at zero.
  maxDeductible is the smaller of the balance and the payout's net, so a deduction can
  never overdraw a payout. Suggested equals maxDeductible. netIfApplied is the payout net
  minus maxDeductible. Nothing is offered when the balance is zero or the payout has
  nothing left. A recorded `deduct` intention only decides whether the box arrives pre-ticked.
- **Inputs:** carried balance (derived), `Payout.netAmount`, `Participation.carryIntent`, `carryIntentAt`, `carryIntentAmount`
- **Canonical:** `lib/carry-balance.ts:80`; balance floor `:88`; maxDeductible `:104`; netIfApplied `:114`; origin sentence `:119`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `components/admin/carry-deduction-offer.tsx:177` ("They receive" recomputed inline as `balance + netIfApplied − cents`), `:179`/`:180` ("balance left" recomputed inline), `:65` (suggested converted to dollars), `app/admin/(protected)/collections/collections-view.tsx:917`/`:918` (a SEPARATE inline offer in the payout edit panel — same min-then-subtract shape but taken against the member's WEEK outstanding rather than the ledger balance, and it writes the net through `updatePayout` rather than through `applyCarryDeduction`) and `:922` (the button label recomputes `min(outstanding, current net)`), `app/admin/(protected)/people/[id]/member-payments.tsx:231`, `app/actions/carry-deduction.ts:115` (balance fed in), `:126` (payoutNet fed in), `:127-135` (intention rebuilt), `lib/carry-balance.ts:37` (`CarryIntention.amountAtChoice` — read into the offer at `app/actions/carry-deduction.ts:131` but never used arithmetically), `scripts/verify-carry-deduction.mts:131-140`, `scripts/verify-carry-intent-expiry.mts:73`, `:136`, `:154`
- **Surfaces:** `components/admin/carry-deduction-offer.tsx:143`, `:176-179`, `:186`, `:192`, `:194`, `app/admin/(protected)/collections/collections-view.tsx:909-924`, `:911`
- **Units:** cents; dollars conversion at `carry-deduction-offer.tsx:66`, `:172`, parse back at `:73`, `:125`.

### Applied carry deduction (deducted, payout net after, balance after)

- **Formula:** deducted is exactly the confirmed amount; netAfter is the payout net minus
  it; balanceAfter is the ledger balance minus it. Refused without an explicit organizer
  confirmation, or if the amount is not a positive whole amount, exceeds the balance, or
  exceeds the payout net. Writes both halves: `Payout.netAmount` is decremented AND a
  PAYMENT ledger entry linked to the payout is created; the carry intention is cleared.
- **Inputs:** carried balance (derived), `Payout.netAmount`, `Payout.status`, `confirmedByOrganizer`, amount (organizer input)
- **Canonical:** `lib/carry-balance.ts:166`; refusals `lib/carry-balance.ts:130`, guards `:142`, `:145`; netAfter `:178`; balanceAfter `:179`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/carry-deduction.ts:196-223` (the write path: payout at `:204`/`:206`, ledger PAYMENT at `:211`/`:214`/`:215`/`:221`), `app/actions/carry-deduction.ts:184-192` (a refusal on an already-COLLECTED payout that lives in the action, not in `lib/carry-balance.ts`'s refusal list), `app/actions/carry-deduction.ts:250-253`, `:258-267` (the before/after net and balance restated in the audit summary), `app/admin/(protected)/collections/collections-view.tsx:917-923` (a net reduction against outstanding that never passes through `applyCarryDeduction` — no `confirmedByOrganizer` field), `scripts/verify-carry-deduction.mts:155-166`, `:174-197`, `:177`, `:184`
- **Surfaces:** `components/admin/carry-deduction-offer.tsx:94`, `:94-97`, `app/actions/carry-deduction.ts:250-253`
- **Units:** cents. `balanceAfter` is NOT floored at zero in `lib/carry-balance.ts:179` — the refusals are what keep it non-negative.

### Carry deduction reversal (amount owed again)

- **Formula:** the sum of the ledger PAYMENT entries linked to that payout, all of which
  are deleted, reported as owed again. The payout's own net is deliberately not touched
  here because every caller is already rewriting it.
- **Inputs:** `LedgerEntry.amount`, `LedgerEntry.payoutId`, `LedgerEntry.type`
- **Canonical:** `lib/carry-reversal.ts:39`; restored total `lib/carry-reversal.ts:53`; delete `:52`; lookup `:45`
- **Other implementations / callers — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/wheel.ts:844-848` (sums restored across a draw's payouts, then calls `carryReversalClause` with a SYNTHESISED entry count at `app/actions/wheel.ts:872`), `app/actions/wheel.ts:846`, `app/actions/week-winners.ts:334-338` (remove-winner path, real clause appended at `:365`), `app/actions/week-winners.ts:465-469` (move path reverses a SECOND time because the move resets `netAmount` to gross − fee at `:512`; the result is captured but no clause is appended), `app/actions/manual-payout.ts:297-302`, `app/actions/edits.ts:638` (restored total discarded), `app/actions/edits.ts:2094-2098`, `app/actions/participation-removal.ts:249` (restored total discarded)
- **Surfaces:** `lib/carry-reversal.ts:58-63`, `lib/carry-reversal.ts:69`, `app/actions/wheel.ts:872`, `app/actions/week-winners.ts:365`, `app/actions/edits.ts:2094`, `app/actions/manual-payout.ts:297`
- **Units:** cents.

### Carry intention amount recorded when adding a member to a cycle

- **Formula:** a snapshot of the person's carried balance at the moment the organizer
  chose leave / deduct / settle-now. Stored, never used in arithmetic — it only pre-ticks
  the later offer and feeds the audit sentence. Cleared when a deduction is applied.
- **Inputs:** carried balance (derived), `Participation.carryIntent`, `carryIntentAt`, `carryIntentAmount`
- **Canonical:** `app/actions/ledger.ts:305`; write at `app/actions/ledger.ts:338-343`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/carry-deduction.ts:240-243` (clears it), `lib/carry-balance.ts:37`, `scripts/verify-carry-deduction.mts:109-119`, `scripts/verify-carry-intent-expiry.mts:62-66`, `:99`, `:105-108`, `:136-141` (rebuilds a CarryIntention with `amountAtChoice` hardcoded to 0, showing the snapshot is not used arithmetically)
- **Surfaces:** `app/actions/ledger.ts:350-351`, `components/admin/carry-deduction-offer.tsx:147-149`
- **Units:** cents; a STORED derived value by design — a snapshot that can drift from the live balance, which is why the offer always re-reads the live one.

### Carried balance shown on the person directory and the add-to-cycle wizard

- **Formula:** the same ledger balance, computed per person as the directory list is
  built, plus the DEBT descriptions as the where-it-came-from line.
- **Inputs:** `LedgerEntry.type`, `LedgerEntry.amount`, `LedgerEntry.description`, carried balance (derived)
- **Canonical:** `app/actions/people.ts:130` (balance) and `app/actions/people.ts:132-134` (`carriedFrom`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/admin/(protected)/cycle/add/page.tsx:105` (passes the balance into the wizard) and `:106` (carriedFrom), `app/admin/(protected)/cycle/add/add-member-wizard.tsx:265` (the wizard re-derives what it shows as `mode === "existing" ? (selectedPerson?.carriedBalance ?? 0) : 0`), `app/actions/ledger.ts:270-272` (the same DEBT-descriptions filter written a second time as `origins` for the balances list), `app/actions/edits.ts:211` (`personRemovalBlockers` is called with `carriedBalance` hardcoded to 0), `app/admin/(protected)/people/[id]/person-edit-form.tsx:68` (the same field hardcoded to 0), `lib/person-record.ts:100` (`PersonRemovalFacts.carriedBalance` is declared but no function in `lib/person-record.ts` reads it), `app/actions/edits.ts:210` and `lib/person-record.ts:133` (`ledgerEntryCount` is what actually gates removal, standing in for the balance that is hardcoded to 0)
- **Surfaces:** `app/admin/(protected)/cycle/add/add-member-wizard.tsx:265`, `:567-569`
- **Units:** cents.

---

## B8 — The member portal

Most member-facing figures are the same derivations already catalogued above; this section
records only what is specific to the portal, plus the surfaces where the member reads a
figure a different engine produced.

### My weekly amount

- **Formula:** read straight from the participation. Not derived.
- **Inputs:** `Participation.weeklyAmount`
- **Canonical:** `app/actions/member.ts:339`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `app/actions/member.ts:211`, `lib/messages.ts:328`, `lib/messaging-engine.ts:151`, `app/actions/agreement.ts:120`, `lib/agreement.ts:107`, `app/admin/(protected)/people/page.tsx:62`
- **Surfaces:** `components/member/saved-card.tsx:47`, `app/agreement/agreement-signer.tsx:99`, `components/member/signed-agreements.tsx:68`
- **Units:** cents, stored. The stopped-member payload returns `weeklyAmount` (`app/actions/member.ts:211`) but `app/me/page.tsx` renders no figure from it.

### My lucky number's weekly amount ("#7 $500/wk")

- **Formula:** read straight from the lucky number row — the slice of the weekly amount
  that number carries after the unit split.
- **Inputs:** `LuckyNumber.amount`
- **Canonical:** `app/actions/member.ts:278`
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/money.ts:55` (`splitIntoLuckyNumbers`, which produced it at creation time), `lib/fee-preview.ts:93`, `app/admin/(protected)/people/[id]/participation-editor.tsx:1024`, `scripts/verify-payout-invariants.mts:64`
- **Surfaces:** `components/member/member-payout-card.tsx:60`
- **Units:** cents, stored.

### Percent of my weeks paid (the "You" ring), and weeks remaining

- **Formula:** weeks credited divided by weeks committed, times 100, rounded and capped at
  100; weeks remaining is weeks committed minus weeks credited, floored at zero. Both are
  inlined in the component — no lib function owns them.
- **Inputs:** weeks credited (derived), `Participation.weeksCommitted`
- **Canonical:** `components/member/member-personal-summary.tsx:39` (percent), `components/member/member-personal-summary.tsx:40` (weeks remaining)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `components/member/member-personal-summary.tsx:59` (a second copy of the same arithmetic inside the count-up animation), `:141`, `components/member/member-group-list.tsx:84`/`:85`, `app/admin/(protected)/people/people-directory.tsx:259`, `app/admin/(protected)/waiting/waiting-view.tsx:472`, `:516`, `lib/contribution.ts:103` (the MONEY-based progress fraction), `lib/messages.ts:219`, `:302`, `:310`, `app/actions/waiting.ts:202`
- **Surfaces:** `components/member/member-personal-summary.tsx:118`, `:150`, `:152`, `:161`, `components/member/member-group-list.tsx:141`
- **Units:** percent (weeks-based) and weeks.
- **Note:** THREE separate "how far along am I" percentages exist on member surfaces —
  money-based (`lib/contribution.ts:103`, rendered by `components/member/savings-arc.tsx:48`,
  `:52`, `:109`), weeks-based at `member-personal-summary.tsx:39`, and weeks-based again at
  `member-group-list.tsx:84`. The first two render on the SAME page (`/me`).

### Money I paid in before I stopped, and what I received

- **Formula:** paid in is the sum of the stopped participation's payment events; received
  is the sum of net amounts on payouts whose status is COLLECTED.
- **Inputs:** `PaymentEvent.amount`, `Payout.netAmount`, `Payout.status`
- **Canonical:** `app/actions/member.ts:156` (paid in), `app/actions/member.ts:157` (received; also `:160`)
- **Other implementations — SUPERSEDED, see "Flagged for Pass 2":** `lib/contribution.ts:58`, `app/actions/cycle-close.ts:114`, `:266`, `app/actions/participation-close.ts:138`, `:140`, `app/actions/cycle-position.ts:234`, `:245`, `app/admin/(protected)/people/[id]/page.tsx:157`, `:166`, `scripts/verify-cycle-close-money.mts:110`
- **Surfaces:** `app/me/page.tsx:103`, `:112`, `:135`
- **Units:** cents. Inlined in the action — the stopped branch does not call `contribution()` or `computeStanding()` at all, so paid-in here is a fourth reduce over `PaymentEvent.amount`. PENDING payouts are excluded from "received", matching the archive rule at `app/actions/cycle-close.ts:110-121`.

### The current cycle week, computed for the member and never shown

- **Formula:** the projected current week (`lib/money.ts:162`).
- **Inputs:** `Cycle.startDate`, today
- **Canonical:** `lib/money.ts:162`; portal call sites `app/actions/member.ts:232`, `:440`, `:502`
- **Surfaces:** `app/me/schedule/page.tsx:39` (used only to choose which month the calendar opens on)
- **Units:** a week number.
- **Note (recorded, not judged):** it reaches three member payloads
  (`participation.cycleWeek`, group `currentWeek`, collections `currentWeek`) and no member
  surface prints it — `components/member/member-collections-list.tsx:36` destructures it
  without rendering it. It still influences money-adjacent output through `nextDue`'s
  starting point (`app/actions/member.ts:296`). `computeStanding` accepts it but derives no
  money from it (`lib/standing.ts:100-105`).

### Which engine a member actually reads (cross-reference)

Recorded here because it matters to Pass 3, not judged:

- `/me` per-week amount paid shows **coveredAtCurrentRate** (`app/actions/member.ts:377`),
  not the stored receipt on the row (`lib/standing.ts:204` carries both).
- `/me` weeks behind comes from **computeStanding** (`app/actions/member.ts:350`), but no
  `/me` surface was found rendering it; `/me/group` weeks behind and weeks paid come from
  the **SQL `member_progress` view** (`app/actions/member.ts:448`, `:457`).
- `/me` "Paid in" sums **PaymentEvent.amount** (`app/actions/member.ts:344`); the savings
  ring on the same page uses `lib/contribution.ts:93` (receipts, capped); the archive card
  on `/me/history` uses the **frozen snapshot** (`lib/member-history.ts:176`).
- Member week statuses are the shared ladder with UNPAID remapped to PENDING
  (`app/actions/member.ts:366-372`); the admin sees UNPAID for the same underlying fact.

---

# Part C — The Dependency Shape

## C1 — The dependency list

Each node is a derived quantity or a stored column that behaves as one. `depends on` is
what it reads; `read by` is what reads it. An empty `depends on` marks a root value.

**Calendar and window**

- **weekHasElapsed** (`lib/derived.ts:68`) — depends on: nothing (root). Read by: weekCountsAsDue (`lib/derived.ts:95`), elapsedThroughWeek (`lib/commitment.ts:154`), paymentStatus (`lib/derived.ts:169`), manualLateAdvice (`lib/derived.ts:238`), weekClock (`week-dates.ts:151`), weekWindowClosesOn (`week-dates.ts:129`), closeTiming (`lib/cycle-lock.ts:45`), closedShortfalls (`app/actions/dashboard.ts:221`), daysLeftInWindow/lastOpenDay (`app/actions/dashboard.ts:231`, `:234`), describeWeekDateChange (`week-dates.ts:286`), member_progress SQL view (`20260806020000/migration.sql:33`, `:37`).
- **weekCountsAsDue** (`lib/derived.ts:95`) — depends on: weekHasElapsed, markedLate collapse (`prisma/schema.prisma:314`), isDeferred (`prisma/schema.prisma:302`). Read by: weeksElapsedInWindow (`lib/standing.ts:164`), weeksBehind (`lib/derived.ts:138`), amountOutstanding (`lib/derived.ts:286`), memberAttention (`lib/dashboard.ts:510`).
- **elapsedThroughWeek** (`lib/commitment.ts:154`) — depends on: weekHasElapsed. Read by: the per-week elapsed flag (`lib/dashboard.ts:286`, `:156`), cashSeries (`lib/dashboard.ts:114`), memberAttention (`lib/dashboard.ts:510`), gap/shortfall/willNotArrive (`lib/cycle-position.ts:209`, `:217`, `:208`), paidAhead (`lib/cycle-position.ts:226`), expectedThisWeek/collectedThisWeek (`lib/cycle-position.ts:231`, `:232`), closedShortfalls (`app/actions/dashboard.ts:221`), membersAffectedByWeekDate (`week-dates.ts:91`).
- **elapsed flag per series week** (`lib/dashboard.ts:286`, `:156`) — depends on: elapsedThroughWeek. Read by: shouldHaveCollected (`lib/cycle-position.ts:194`), collected for elapsed weeks (`:195`), expectedThisWeek/collectedThisWeek (`:231`, `:232`), paidAhead (`:226`), gap/shortfall/willNotArrive (`:209`, `:217`, `:208`), cashSeries (`lib/dashboard.ts:114`).
- **currentWeekNumber — projected** (`lib/money.ts:162`) — depends on: nothing (root). Read by: currentWeekFromRows (`lib/commitment.ts:176`), weeksRemainingInCycle (`app/actions/dashboard.ts:253`), weeksLeftInMemberWindow (`lib/wheel.ts:86`, `app/actions/waiting.ts:202`), selectedWeek (`app/actions/dashboard.ts:93`), nextDue (`app/actions/member.ts:292`), memberFinals (`app/actions/cycle-close.ts:63–135`), grid row received/expected (`lib/payments-view.ts:211`).
- **currentWeekFromRows** (`lib/commitment.ts:176`) — depends on: currentWeekNumber. Read by: paidAhead (`lib/cycle-position.ts:226`), expectedThisWeek/collectedThisWeek (`:231`, `:232`), weeksLeftInMemberWindow, weeksReturning (`lib/participation-close.ts:466`), closePlan (`lib/participation-close.ts:309`).
- **dateOfWeek / generateWeekDates** (`lib/money.ts:150`, `:133`) — root. Read by: resolveWeekDate (`lib/commitment.ts:90`).
- **resolveWeekDate** (`lib/commitment.ts:90`) — depends on: dateOfWeek/generateWeekDates. Read by: finishPreview (`lib/commitment.ts:221`), own start date, cycleFinishPreview (`lib/commitment.ts:263`), closeTiming (`lib/cycle-lock.ts:45`), newCycleStartBounds (`lib/date-bounds.ts:91`), agreement figures (`app/actions/agreement.ts:114`).
- **nextWeekDates** (`lib/commitment.ts:117`) — root. Read by: actual cycle length / keepThrough (`lib/participation-rules.ts:103`).
- **daysLeftInWindow / lastOpenDay** (`app/actions/dashboard.ts:231`, `:234`) — depends on: weekHasElapsed. Read by: presentation redaction (`lib/presentation.ts:49`, `:106`, `:178`).
- **weekWindowClosesOn** (`week-dates.ts:129`) — depends on: weekHasElapsed. Read by: weekClock (`week-dates.ts:151`), describeWeekDateChange (`week-dates.ts:286`).
- **weekClock** (`week-dates.ts:151`) — depends on: weekHasElapsed, weekWindowClosesOn. Read by: describeWeekDateChange.
- **closeTiming** (`lib/cycle-lock.ts:45`) — depends on: resolveWeekDate, cycleFinishPreview. Read by: nothing further recorded.
- **weekDateBounds** (`lib/date-bounds.ts:152`) — root. Read by: outOfSequenceWeeks (`week-dates.ts:212`).
- **newCycleStartBounds** (`lib/date-bounds.ts:91`) — depends on: cycleFinishPreview. Read by: nothing further recorded.
- **describeWeekDateChange** (`week-dates.ts:286`) — depends on: weekHasElapsed, weekWindowClosesOn, membersAffectedByWeekDate (`week-dates.ts:91`), membersShort (`week-dates-data.ts:152`).
- **outOfSequenceWeeks** (`week-dates.ts:212`) — depends on: weekDateBounds.
- **selectedWeek** (`app/actions/dashboard.ts:93`) — depends on: currentWeekNumber. Read by: weekMemberStatus / this-week grouping (`lib/dashboard.ts:341`).
- **daysWaiting / longest wait** (`lib/waiting.ts:70`) — root. Read by: owedNow/eventualTotal (`lib/waiting.ts:148`, `:151`).

**Windows and commitments**

- **calculateFinishWeek** (`lib/money.ts:113`) — root. Read by: inWindow (`lib/participation-close.ts:120`), effectiveFinishWeek (`:133`), weeksLeavingExpectation (`:192`), weeksReturning (`:466`), weeksLeftInMemberWindow (`lib/wheel.ts:86`, `app/actions/waiting.ts:202`), weeksElapsedInWindow (`lib/standing.ts:164`), memberAttention (`lib/dashboard.ts:510`), finishPreview (`lib/commitment.ts:221`), actual cycle length (`lib/participation-rules.ts:103`), rebuildParticipationPayments (`lib/rebuild.ts:23`), planWinnerWeekSettlement (`lib/settlement.ts:35`), grid row received/expected (`lib/payments-view.ts:211`).
- **inBreak** (`lib/participation-close.ts:93`) — root. Read by: inWindow, effectiveFinishWeek.
- **inWindow / inMemberWindow** (`lib/participation-close.ts:120`) — depends on: calculateFinishWeek, inBreak. Read by: week expected (`lib/dashboard.ts:255`), membersExpected (`:256`), membersAffectedByWeekDate (`week-dates.ts:91`), weekMemberStatus (`lib/dashboard.ts:341`), weeksElapsedInWindow (`lib/standing.ts:164`), closePlan (`lib/participation-close.ts:309`).
- **legacyBreak** (`lib/participation-close.ts:161`) — depends on: lastPaymentWeek (`lib/standing.ts:199`). Read by: effectiveFinishWeek.
- **effectiveFinishWeek** (`lib/participation-close.ts:133`) — depends on: calculateFinishWeek, inBreak, legacyBreak. Read by: weeksLeavingExpectation, balanceRecorded (`app/actions/cycle-position.ts:259`), closePlan, amountLeaving (`lib/participation-close.ts:324`).
- **remainingWeeksInCycle** (`lib/money.ts:126`) — root. Read by: weeksToFinishWithGroup (`lib/commitment.ts:47`), commitmentCap (`lib/commitment.ts:311`, `lib/participation-rules.ts:41`).
- **weeksToFinishWithGroup** (`lib/commitment.ts:47`) — depends on: remainingWeeksInCycle.
- **commitmentCap** (`lib/commitment.ts:311`, `lib/participation-rules.ts:41`) — depends on: remainingWeeksInCycle.
- **weeksRemainingInCycle from today** (`app/actions/dashboard.ts:253`) — depends on: currentWeekNumber. Read by: presentation redaction.
- **weeksLeftInMemberWindow** (`lib/wheel.ts:86`, `app/actions/waiting.ts:202`) — depends on: calculateFinishWeek, currentWeekFromRows, currentWeekNumber. Read by: atRisk (`lib/waiting.ts:76`).
- **atRisk** (`lib/waiting.ts:76`) — depends on: weeksLeftInMemberWindow.
- **ownWeekNumber** (`lib/member-window.ts:25`) — root.
- **finishPreview / own finish date** (`lib/commitment.ts:221`) — depends on: calculateFinishWeek, resolveWeekDate. Read by: agreement figures.
- **own start date** (`lib/commitment.ts:90` at startWeek) — depends on: resolveWeekDate. Read by: agreement figures.
- **cycleFinishPreview / cycle length** (`lib/commitment.ts:263`) — depends on: resolveWeekDate, calculateFinishWeek. Read by: newCycleStartBounds, closeTiming, archive read-back (`lib/member-history.ts:123`).
- **actual cycle length / keepThrough** (`lib/participation-rules.ts:103`) — depends on: calculateFinishWeek, nextWeekDates.
- **weeksElapsedInWindow** (`lib/standing.ts:164`) — depends on: weekCountsAsDue, inWindow, calculateFinishWeek. Read by: weeksBehind, amountOutstanding.
- **weeksLeavingExpectation** (`lib/participation-close.ts:192`) — depends on: calculateFinishWeek, effectiveFinishWeek. Read by: amountLeaving.
- **weeksReturning on reactivation** (`lib/participation-close.ts:466`) — depends on: calculateFinishWeek, currentWeekFromRows.

**Payments and allocation**

- **amountDue for one week** (`Participation.weeklyAmount`; `app/actions/payments.ts:56`) — root (a stored column read fresh). Read by: remainingOn/isPickable (`lib/week-picking.ts:43`, `:49`), allocatePayment (`lib/allocation.ts:65`), bulkCatchUpAmount (`lib/payments-view.ts:57`), allocatePinned (`lib/settlement.ts:63`), planWinnerWeekSettlement (`lib/settlement.ts:35`), pinned settlement coverage (`lib/standing.ts:118`), coveredAtCurrentRate (`lib/standing.ts:144`), amountOutstanding (`lib/derived.ts:286`), paymentStatus (`lib/derived.ts:169`), week expected (`lib/dashboard.ts:255`), membersPaid (`lib/dashboard.ts:257`), grid row received/expected (`lib/payments-view.ts:211`), membersAffectedByWeekDate (`week-dates.ts:91`), splitWeekRoster (`lib/payments-view.ts:123`), weeksCredited (`lib/derived.ts:122`), weeksCovered capped (`lib/contribution.ts:91`), commitmentTotal/calculateGross (`lib/money.ts:73`), amountLeaving (`lib/participation-close.ts:324`), resizeWinnerWeekSettlement (`lib/settlement.ts:211`), rebuildParticipationPayments (`lib/rebuild.ts:23`), memberAttention (`lib/dashboard.ts:510`).
- **remainingOn / isPickable** (`lib/week-picking.ts:43`, `:49`) — depends on: amountDue, `Payment.amountPaid`, isSkipped. Read by: amountForWeeks (`lib/week-picking.ts:63`), coverageForAmount (`:93`), quickAmounts (`:145`).
- **allocatePayment — oldest-first** (`lib/allocation.ts:65`) — depends on: amountDue, `Payment.amountPaid`, isSkipped. Read by: coveredAtCurrentRate, surplus (`lib/standing.ts:198`), unallocated (`lib/allocation.ts:106`), `Payment.amountPaid` (`app/actions/payments.ts:249`), `PaymentAllocation.amount` (`app/actions/payments.ts:270`), rebuildParticipationPayments.
- **unallocated / fits nowhere** (`lib/allocation.ts:106`) — depends on: allocatePayment. Read by: surplus, rebuildParticipationPayments.
- **coverageForAmount** (`lib/week-picking.ts:93`) — depends on: remainingOn, parseDollarsToCents/formatMoney.
- **amountForWeeks — selection total** (`lib/week-picking.ts:63`) — depends on: remainingOn. Read by: parseDollarsToCents/formatMoney.
- **quickAmounts chips** (`lib/week-picking.ts:145`) — depends on: remainingOn.
- **bulkCatchUpAmount** (`lib/payments-view.ts:57`) — depends on: amountDue, `Payment.amountPaid`, isSkipped.
- **parseDollarsToCents / formatMoney** (`lib/format.ts:25`, `:5`) — root. Read by: coverageForAmount, cash reading (`app/actions/cycle-position.ts:379`), carryOffer (`lib/carry-balance.ts:80`), agreement figures, archive read-back.
- **allocatePinned** (`lib/settlement.ts:63`) — depends on: amountDue, isSkipped. Read by: rebuildParticipationPayments, pinned settlement coverage.
- **planWinnerWeekSettlement** (`lib/settlement.ts:35`) — depends on: amountDue, `Payment.amountPaid`, `Payout.netAmount`, calculateFinishWeek, isSkipped. Read by: `Payout.netAmount`, pinned settlement coverage, week total net (`lib/week-winners.ts:130`), cashPositionDelta (`lib/week-winners.ts:304`), undoDrawConsequences (`lib/undo-draw.ts:37`), deletePayoutConsequences (`lib/undo-draw.ts:94`), computeTermsSettlement (`lib/settlement.ts:104`), memberFinals.
- **pinned settlement coverage** (`lib/standing.ts:118`) — depends on: planWinnerWeekSettlement, allocatePinned, amountDue, isSkipped. Read by: coveredAtCurrentRate.
- **coveredAtCurrentRate** (`lib/standing.ts:144`) — depends on: pinned settlement coverage, allocatePayment, totalPaid (week-rows basis), amountDue. Read by: paymentStatus (`lib/standing.ts:209`), amountOutstanding (`lib/standing.ts:179`), nextDue (`app/actions/member.ts:292`), surplus (`lib/standing.ts:198`).
- **`Payment.amountPaid` — stored per-week paid** (`app/actions/payments.ts:249`) — depends on: allocatePayment, rebuildParticipationPayments, planWinnerWeekSettlement. Read by: remainingOn, allocatePayment, bulkCatchUpAmount, week received (`lib/dashboard.ts:250`), membersPaid, totalPaid (week-rows basis), lastPaymentWeek, grid row received/expected, cashPosition (`lib/dashboard.ts:46`), cashSeries, membersAffectedByWeekDate, planWinnerWeekSettlement, member_progress SQL view.
- **`PaymentAllocation.amount`** (`app/actions/payments.ts:270`) — depends on: allocatePayment. Read by: rebuildParticipationPayments.
- **rebuildParticipationPayments** (`lib/rebuild.ts:23`) — depends on: allocatePayment, allocatePinned, amountDue, calculateFinishWeek, unallocated. Read by: `Payment.amountPaid`, markedLate collapse, `PaymentAllocation.amount`.
- **totalPaid — receipts basis** (`lib/contribution.ts:58`) — root. Read by: contribution (`lib/contribution.ts:74`), weeksCovered capped (`:91`), finalPosition (`lib/final-position.ts:109`), standingIssues (`lib/dashboard.ts:441`).
- **totalPaid — week-rows basis** (Σ `Payment.amountPaid`) — depends on: `Payment.amountPaid`. Read by: coveredAtCurrentRate, weeksCredited, memberFinals, memberAttention, owedBack/owedBackToStopped, grid row received/expected, standingIssues.

**Standing and status**

- **weeksCredited** (`lib/derived.ts:122`) — depends on: totalPaid (week-rows basis), amountDue. Read by: weeksBehind, memberFinals, memberAttention, closingStatementText (`lib/cycle-close.ts:169`), finalBalanceEntries (`lib/cycle-close.ts:150`), savings progress % weeks basis (`components/member/member-personal-summary.tsx:39`), owedNow/eventualTotal (`lib/waiting.ts:148`, `:151`), grid row received/expected.
- **weeksCovered — capped** (`lib/contribution.ts:91`) — depends on: totalPaid (receipts basis), amountDue. Read by: contribution, savings progress % weeks basis.
- **weeksBehind** (`lib/derived.ts:138`) — depends on: weeksElapsedInWindow, weeksCredited, isSkipped, weekCountsAsDue. Read by: memberAttention, membersCurrent count (`app/actions/member.ts:460`), hasChaseableWeeks/lateCount (`lib/messages.ts:174`), presentation redaction.
- **amountOutstanding** (`lib/derived.ts:286`) — depends on: weeksElapsedInWindow, weekCountsAsDue, amountDue, coveredAtCurrentRate, isSkipped. Read by: contribution, owedBy (`app/actions/cycle-position.ts:205`), balanceRecorded (`:259`), memberFinals, closePlan, buildArchiveData totals (`lib/cycle-close.ts:225`), totalOutstanding/membersShort (`app/actions/cycle-close.ts:294`, `:295`), finalBalanceEntries, members-view filters and sorts (`lib/members-view.ts:60`, `:63`, `:88`), carryOffer (`lib/carry-balance.ts:80`), grid row received/expected, closingStatementText.
- **paymentStatus** (`lib/derived.ts:169`) — depends on: coveredAtCurrentRate, amountDue, weekHasElapsed, isDeferred, isSkipped, markedLate collapse. Read by: status vocabulary (`lib/status-labels.ts:36`), hasChaseableWeeks/lateCount, consistencyState/longestOverdueRun (`lib/chart.ts:186`, `:201`, `:230`), members-view filters and sorts, weekMemberStatus (`lib/dashboard.ts:341`), grid row received/expected, splitWeekRoster (`lib/payments-view.ts:123`).
- **surplus — allocation remainder** (`lib/standing.ts:198`) — depends on: allocatePayment, unallocated, coveredAtCurrentRate. Read by: nothing found (see Gaps).
- **lastPaymentWeek** (`lib/standing.ts:199`) — depends on: `Payment.amountPaid`. Read by: legacyBreak, closingStatementText, finalBalanceEntries.
- **manualLateAdvice** (`lib/derived.ts:238`) — depends on: weekHasElapsed, isDeferred, amountDue. Read by: markedLate collapse.
- **markedLate — stored flag collapse** (`prisma/schema.prisma:314`) — depends on: manualLateAdvice, rebuildParticipationPayments, coveredAtCurrentRate. Read by: weekCountsAsDue, paymentStatus, memberAttention, membersAffectedByWeekDate, weekMemberStatus.
- **isDeferred — stored flag** (`prisma/schema.prisma:302`) — root. Read by: weekCountsAsDue, paymentStatus, manualLateAdvice, week expected, membersExpected, splitWeekRoster, nextDue, bulkCatchUpAmount.
- **isSkipped — stored flag** (`prisma/schema.prisma:171`) — root. Read by: remainingOn, allocatePayment, allocatePinned, pinned settlement coverage, amountOutstanding, paymentStatus, week expected, weeksBehind, grid row received/expected, bulkCatchUpAmount, closedShortfalls, planWinnerWeekSettlement.
- **memberAttention — amountOwed / weeksBehind** (`lib/dashboard.ts:510`) — depends on: elapsedThroughWeek, calculateFinishWeek, weeksCredited, weeksBehind, amountOutstanding, totalPaid (week-rows), markedLate, isDeferred, inBreak. Read by: presentation redaction.
- **contribution — paidIn/stillToSave/surplus/progress** (`lib/contribution.ts:74`) — depends on: totalPaid (receipts), commitmentTotal/calculateGross, amountOutstanding, weeksCovered capped. Read by: savings progress % weeks basis.
- **commitmentTotal / calculateGross** (`lib/money.ts:73`) — root. Read by: contribution, fee projected (`lib/money.ts:90`), payout net projected (`lib/money.ts:100`), payout gross per lucky number (`lib/wheel.ts:538`), finalPosition, feeAttributable (`lib/participation-removal.ts:87`), computeTermsSettlement, standingIssues, agreement figures.
- **hasChaseableWeeks / lateCount** (`lib/messages.ts:174`) — depends on: paymentStatus, weeksBehind, amountOutstanding.
- **consistencyState / longestOverdueRun** (`lib/chart.ts:186`, `:201`, `:230`) — depends on: paymentStatus, amountDue, `Payment.amountPaid`, weekHasElapsed.
- **status vocabulary** (`lib/status-labels.ts:36`) — depends on: paymentStatus.
- **nextDue week** (`app/actions/member.ts:292`) — depends on: coveredAtCurrentRate, amountDue, isDeferred, currentWeekNumber.
- **members-view filters and sorts** (`lib/members-view.ts:60`, `:63`, `:88`) — depends on: amountOutstanding, paymentStatus, totalPaid (week-rows), weeksCredited.
- **splitWeekRoster** (`lib/payments-view.ts:123`) — depends on: amountDue, `Payment.amountPaid`, isDeferred, paymentStatus.
- **savings progress % — weeks basis** (`components/member/member-personal-summary.tsx:39`) — depends on: weeksCredited, weeksCovered capped, contribution.
- **standingIssues** (`lib/dashboard.ts:441`) — depends on: totalPaid (both bases), commitmentTotal/calculateGross.
- **member_progress SQL view** (`20260806020000/migration.sql:33`, `:37`) — depends on: `Payment.amountPaid` (only). Read by: membersCurrent count (`app/actions/member.ts:460`).
- **membersCurrent count** (`app/actions/member.ts:460`) — depends on: member_progress SQL view, weeksBehind.

**Per-week money**

- **week expected** (`lib/dashboard.ts:255`) — depends on: inWindow, amountDue, isDeferred, isSkipped. Read by: week shortfall (`lib/dashboard.ts:264`), shouldHaveCollected, expectedThisWeek/collectedThisWeek, closedShortfalls, presentation redaction.
- **week received** (`lib/dashboard.ts:250`) — depends on: `Payment.amountPaid`. Read by: week shortfall, collected for elapsed weeks, paidAhead, expectedThisWeek/collectedThisWeek, buildArchiveData totals, closedShortfalls, presentation redaction.
- **week shortfall** (`lib/dashboard.ts:264`) — depends on: week expected, week received. Read by: closedShortfalls.
- **membersExpected** (`lib/dashboard.ts:256`) — depends on: inWindow, isDeferred, isSkipped. Read by: membersPaid, membersShort (`week-dates-data.ts:152`), presentation redaction.
- **membersPaid** (`lib/dashboard.ts:257`) — depends on: membersExpected, `Payment.amountPaid`, amountDue. Read by: membersShort, presentation redaction.
- **membersShort** (`week-dates-data.ts:152`) — depends on: membersExpected, membersPaid. Read by: describeWeekDateChange.
- **membersAffectedByWeekDate** (`week-dates.ts:91`) — depends on: inWindow, `Payment.amountPaid`, amountDue, markedLate, isSkipped. Read by: describeWeekDateChange.
- **grid row received / expected** (`lib/payments-view.ts:211`) — depends on: paymentStatus, amountDue, `Payment.amountPaid`, calculateFinishWeek, isSkipped, amountOutstanding, weeksCredited, totalPaid (week-rows). Read by: members-view filters and sorts, presentation redaction.
- **closedShortfalls** (`app/actions/dashboard.ts:221`) — depends on: week shortfall, weekHasElapsed, isSkipped.
- **weekMemberStatus / this-week grouping** (`lib/dashboard.ts:341`) — depends on: paymentStatus, inWindow, markedLate, selectedWeek.

**Cycle position and cash**

- **shouldHaveCollected** (`lib/cycle-position.ts:194`) — depends on: week expected, elapsed flag. Read by: gap/shortfall/willNotArrive.
- **collected for elapsed weeks** (`lib/cycle-position.ts:195`) — depends on: week received, elapsed flag. Read by: gap/shortfall/willNotArrive.
- **gap / shortfall / willNotArrive** (`lib/cycle-position.ts:209`, `:217`, `:208`) — depends on: shouldHaveCollected, collected for elapsed weeks, balanceRecorded.
- **paidAhead** (`lib/cycle-position.ts:226`) — depends on: week received, currentWeekFromRows, elapsed flag. Read by: cashOnHand/shouldBeHolding, coverage/positionVerdict.
- **expectedThisWeek / collectedThisWeek** (`lib/cycle-position.ts:231`, `:232`) — depends on: week expected, week received, elapsed flag, currentWeekFromRows.
- **owedBy per member** (`app/actions/cycle-position.ts:205`) — depends on: amountOutstanding. Read by: gap/shortfall/willNotArrive.
- **balanceRecorded for a stopped member** (`app/actions/cycle-position.ts:259`) — depends on: amountOutstanding, effectiveFinishWeek. Read by: gap/shortfall/willNotArrive.
- **amountLeaving** (`lib/participation-close.ts:324`) — depends on: weeksLeavingExpectation, amountDue, effectiveFinishWeek. Read by: shortfallToCover/toCover, closePlan.
- **shortfallToCover / toCover** (`lib/participation-close.ts:336`, `lib/cycle-position.ts:221`) — depends on: amountLeaving, collected vs pending payout totals, `Payout.netAmount`. Read by: closePlan.
- **owedBack / owedBackToStopped** (`app/actions/cycle-position.ts:268`, `lib/cycle-position.ts:222`) — depends on: totalPaid (week-rows), feeOnReturn, `Payout.netAmount`. Read by: cashOnHand/shouldBeHolding, coverage/positionVerdict.
- **cashPosition** (`lib/dashboard.ts:46`) — depends on: `Payment.amountPaid`, `Payout.netAmount`, collected vs pending payout totals. Read by: cashSeries, payout progress counts.
- **cashSeries** (`lib/dashboard.ts:114`) — depends on: `Payment.amountPaid`, `Payout.netAmount`, elapsedThroughWeek, cashPosition.
- **cashOnHand / shouldBeHolding** (`lib/cycle-position.ts:308`, `:323`) — depends on: cashPosition, collected vs pending payout totals, paidAhead, owedBack/owedBackToStopped. Read by: difference vs the books, coverage/positionVerdict.
- **feeEstimate** (`lib/cycle-position.ts:331`) — depends on: `Payout.feeAmount` (stored).
- **cash reading** (`app/actions/cycle-position.ts:379`) — depends on: parseDollarsToCents/formatMoney. Read by: difference vs the books, coverage/positionVerdict.
- **difference vs the books** (`lib/cycle-position.ts:382`) — depends on: cash reading, cashOnHand/shouldBeHolding. Read by: coverage/positionVerdict.
- **coverage / positionVerdict** (`lib/cycle-position.ts:390`, `:375`) — depends on: cash reading, difference vs the books, paidAhead, collected vs pending payout totals, owedBack/owedBackToStopped, cashOnHand/shouldBeHolding.

**Payouts, fees, settlements**

- **payout gross per lucky number** (`lib/wheel.ts:538` / `lib/money.ts:73`) — depends on: commitmentTotal/calculateGross. Read by: fee projected, payout net projected, feePreview (`lib/fee-preview.ts:58`), manual payout preview totals (`lib/manual-payout.ts:208`), owedNow/eventualTotal.
- **fee projected** (`lib/money.ts:90`) — depends on: payout gross, commitmentTotal/calculateGross. Read by: payout net projected, feePreview, `Payout.feeAmount` stored, feeAttributable, structural cycle fee projection (`lib/projection.ts:86`, `:120`), computeTermsSettlement, manual payout preview totals.
- **payout net projected** (`lib/money.ts:100`) — depends on: payout gross, fee projected. Read by: feePreview, `Payout.netAmount`, week total net (`lib/week-winners.ts:130`), cashPositionDelta, owedNow/eventualTotal, winner announcement payoutAmount (`lib/winner-extras.ts:63`), manual payout preview totals, computeTermsSettlement.
- **feePreview — member gross/fee/net** (`lib/fee-preview.ts:58`) — depends on: payout gross, fee projected, payout net projected. Read by: feeOnReturn (`lib/final-position.ts:61`), agreement figures, owedNow/eventualTotal.
- **`Payout.feeAmount` — stored** (`app/actions/wheel.ts:696`) — depends on: fee projected. Read by: feeEstimate, `Payout.netAmount`, amount handed over (`app/actions/edits.ts:1976`).
- **`Payout.netAmount` — live** (`app/actions/wheel.ts:697`) — depends on: payout net projected, `Payout.feeAmount`, planWinnerWeekSettlement, applyCarryDeduction, resizeWinnerWeekSettlement. Read by: collected vs pending payout totals (`lib/dashboard.ts:60`, `:62`), cashPosition, cashSeries, cashOnHand/shouldBeHolding, owedNow/eventualTotal, carryOffer, undoDrawConsequences, deletePayoutConsequences, week total net, cashPositionDelta, finalPosition, memberFinals, computeTermsSettlement, planWinnerWeekSettlement, amount handed over, winner announcement payoutAmount, shortfallToCover/toCover, owedBack/owedBackToStopped, participation-removal cashPositionDelta (`lib/participation-removal.ts:162`).
- **week total net before/after a winner edit** (`lib/week-winners.ts:130`) — depends on: `Payout.netAmount`, payout net projected, planWinnerWeekSettlement. Read by: cashPositionDelta.
- **cashPositionDelta of a winner edit** (`lib/week-winners.ts:304`) — depends on: week total net, payout net projected, `Payout.netAmount`, planWinnerWeekSettlement.
- **collected vs pending payout totals** (`lib/dashboard.ts:60`, `:62`) — depends on: `Payout.netAmount`. Read by: cashPosition, cashOnHand/shouldBeHolding, coverage/positionVerdict, buildArchiveData totals, payout progress counts, shortfallToCover/toCover, finalPosition.
- **owedNow / eventualTotal — waiting** (`lib/waiting.ts:148`, `:151`) — depends on: `Payout.netAmount`, feePreview, payout net projected, daysWaiting, weeksCredited.
- **undoDrawConsequences** (`lib/undo-draw.ts:37`) — depends on: `Payout.netAmount`, planWinnerWeekSettlement. Read by: reverseCarryDeduction.
- **deletePayoutConsequences** (`lib/undo-draw.ts:94`) — depends on: `Payout.netAmount`, planWinnerWeekSettlement. Read by: reverseCarryDeduction.
- **manual payout preview totals** (`lib/manual-payout.ts:208`) — depends on: payout gross, fee projected, payout net projected.
- **feeAttributable on removal** (`lib/participation-removal.ts:87`) — depends on: commitmentTotal/calculateGross, fee projected. Read by: participation-removal cashPositionDelta.
- **feeOnReturn** (`lib/final-position.ts:61`) — depends on: feePreview. Read by: finalPosition, owedBack/owedBackToStopped.
- **finalPosition** (`lib/final-position.ts:109`) — depends on: totalPaid (receipts), collected vs pending payout totals, `Payout.netAmount`, commitmentTotal/calculateGross, feeOnReturn.
- **structural cycle fee projection** (`lib/projection.ts:86`, `:120`) — depends on: fee projected, commitmentTotal/calculateGross.
- **winner announcement payoutAmount** (`lib/winner-extras.ts:63`) — depends on: `Payout.netAmount`, payout net projected.
- **agreement figures** (`app/actions/agreement.ts:114`) — depends on: feePreview, commitmentTotal/calculateGross, finishPreview, own start date, parseDollarsToCents/formatMoney.
- **computeTermsSettlement** (`lib/settlement.ts:104`) — depends on: commitmentTotal/calculateGross, fee projected, payout net projected, `Payout.netAmount`, planWinnerWeekSettlement, settledSoFarFromLedger. Read by: ledgerBalance, settledSoFarFromLedger, resizeWinnerWeekSettlement.
- **settledSoFarFromLedger** (`lib/settlement.ts:164`) — depends on: computeTermsSettlement. Read by: computeTermsSettlement.
- **resizeWinnerWeekSettlement** (`lib/settlement.ts:211`) — depends on: amountDue, `Payout.netAmount`, planWinnerWeekSettlement. Read by: `Payout.netAmount`, computeTermsSettlement.
- **amount handed over** (`app/actions/edits.ts:1976`) — depends on: `Payout.netAmount`, `Payout.feeAmount`. Read by: collected vs pending payout totals.
- **payout progress counts** (`app/admin/(protected)/collections/page.tsx:229`) — depends on: collected vs pending payout totals, cashPosition.
- **participation-removal cashPositionDelta** (`lib/participation-removal.ts:162`) — depends on: `Payout.netAmount`, totalPaid (receipts), feeAttributable.

**Ledger and carry**

- **ledgerBalance** (`lib/ledger.ts:23`) — depends on: finalBalanceEntries, closePlan, computeTermsSettlement, applyCarryDeduction, reverseCarryDeduction. Read by: carryOffer, applyCarryDeduction, total carried across everyone (`app/actions/ledger.ts:235`), ledgerStory balanceAfter (`lib/ledger.ts:68`), forgiveness refusal (`lib/ledger.ts:92`), ledger payment and remaining (`app/actions/ledger.ts:25`, `:81`), carry intention amount (`app/actions/ledger.ts:305`), archive read-back (`lib/member-history.ts:123`).
- **totalRaised / totalRepaid / totalForgiven** (`lib/ledger.ts:42`, `:32`, `:37`) — root. Read by: ledgerStory balanceAfter.
- **ledgerStory balanceAfter** (`lib/ledger.ts:68`) — depends on: ledgerBalance, totalRaised/Repaid/Forgiven. Read by: total carried across everyone.
- **total carried across everyone** (`app/actions/ledger.ts:235`) — depends on: ledgerBalance, ledgerStory balanceAfter.
- **carryOffer** (`lib/carry-balance.ts:80`) — depends on: ledgerBalance, `Payout.netAmount`, carry intention amount, amountOutstanding, parseDollarsToCents/formatMoney. Read by: applyCarryDeduction.
- **applyCarryDeduction** (`lib/carry-balance.ts:166`) — depends on: carryOffer, ledgerBalance, `Payout.netAmount`. Read by: `Payout.netAmount`, ledgerBalance, reverseCarryDeduction.
- **reverseCarryDeduction** (`lib/carry-reversal.ts:39`) — depends on: applyCarryDeduction, undoDrawConsequences, deletePayoutConsequences. Read by: ledgerBalance.
- **carry intention amount** (`app/actions/ledger.ts:305`) — depends on: ledgerBalance. Read by: carryOffer.
- **forgiveness refusal / written-off amount** (`lib/ledger.ts:92`) — depends on: ledgerBalance.
- **ledger payment and remaining** (`app/actions/ledger.ts:25`, `:81`) — depends on: ledgerBalance.

**Close and archive**

- **memberFinals** (`app/actions/cycle-close.ts:63–135`) — depends on: amountOutstanding, weeksCredited, totalPaid (week-rows), collected vs pending payout totals, `Payout.netAmount`, planWinnerWeekSettlement, lastPaymentWeek, currentWeekNumber. Read by: finalBalanceEntries, closingStatementText, buildArchiveData totals, totalOutstanding/membersShort.
- **finalBalanceEntries — closing DEBT** (`lib/cycle-close.ts:150`) — depends on: memberFinals, amountOutstanding, weeksCredited, lastPaymentWeek. Read by: ledgerBalance.
- **closingStatementText** (`lib/cycle-close.ts:169`) — depends on: memberFinals, weeksCredited, amountOutstanding, lastPaymentWeek. Read by: buildArchiveData totals.
- **buildArchiveData totals** (`lib/cycle-close.ts:225`) — depends on: memberFinals, week received, collected vs pending payout totals, amountOutstanding, closingStatementText. Read by: archive read-back for a member.
- **archive read-back for a member** (`lib/member-history.ts:123`) — depends on: buildArchiveData totals, ledgerBalance, cycleFinishPreview, parseDollarsToCents/formatMoney.
- **totalOutstanding / membersShort at close** (`app/actions/cycle-close.ts:294`, `:295`) — depends on: memberFinals, amountOutstanding. Read by: buildArchiveData totals.
- **closePlan** (`lib/participation-close.ts:309`) — depends on: amountOutstanding, weeksLeavingExpectation, amountLeaving, shortfallToCover/toCover, effectiveFinishWeek, inWindow, currentWeekFromRows. Read by: ledgerBalance, balanceRecorded.
- **presentation redaction** (`lib/presentation.ts:49`, `:106`, `:178`) — depends on: week expected, week received, membersExpected, membersPaid, grid row received/expected, memberAttention, weeksBehind, daysLeftInWindow/lastOpenDay, weeksRemainingInCycle.

## C2 — Root values

Values with no derived input. Everything else in the map is downstream of these.

| Root | Where | Reads |
|---|---|---|
| `weekHasElapsed` | `lib/derived.ts:68` | `Week.date`, today, `PAYMENT_WINDOW_DAYS` (`lib/derived.ts:13`). Verified: pure UTC-day arithmetic. |
| `currentWeekNumber`, projected | `lib/money.ts:162` | `Cycle.startDate`, today. Verified `:165-167`. |
| `dateOfWeek` / `generateWeekDates` | `lib/money.ts:150`, `:133` | `Cycle.startDate`, week number |
| `calculateFinishWeek` | `lib/money.ts:113` | `Participation.startWeek`, `weeksCommitted`. Verified `:116`. |
| `remainingWeeksInCycle` | `lib/money.ts:126` | `Cycle.plannedWeeks`, `Participation.startWeek`. Verified `:129`. |
| `calculateGross` / commitmentTotal | `lib/money.ts:73` | weeklyAmount (or `LuckyNumber.amount`) × weeksCommitted. Verified `:78`. |
| amountDue for one week | `Participation.weeklyAmount` | a stored column read fresh; the week row stores no due amount |
| week received | `lib/dashboard.ts:250` | `Payment.amountPaid` only. Verified: no window test, no deferral test on the received side. |
| totalPaid, receipts basis | `lib/contribution.ts:58` | Σ `PaymentEvent.amount`. Verified. |
| totalPaid, week-rows basis | Σ `Payment.amountPaid` | assembled independently at 13+ call sites — a SECOND root for the same human quantity |
| `inBreak` | `lib/participation-close.ts:93` | `ParticipationBreak.fromWeek` / `toWeek` |
| `isSkipped` / `isDeferred` / `markedLateAt` | `prisma/schema.prisma:171`, `:302`, `:314` | three stored decisions read as flags; `markedLateAt` is a TIMESTAMP collapsed to a boolean at 20+ sites |
| `ledgerBalance` | `lib/ledger.ts:23` | `LedgerEntry.type` + `amount` only. Verified `:24-28`. |
| `totalRaised` / `totalRepaid` / `totalForgiven` | `lib/ledger.ts:42`, `:32`, `:37` | `LedgerEntry.type` + `amount`. Verified. |
| `settledSoFarFromLedger` | `lib/settlement.ts:164` | `LedgerEntry.type` + `amount` + `notes` tag. Verified `:172-185`. |
| `reverseCarryDeduction` restored | `lib/carry-reversal.ts:39` | `LedgerEntry.amount` where `payoutId` matches |
| daysWaiting / longest wait | `lib/waiting.ts:70` | `Draw.drawnAt`, today |
| cash reading | `app/actions/cycle-position.ts:379` | `CashReading.totalAmount` / `bankAmount` / `cashAmount` — the ONLY stored money fact in the cash subsystem |
| `Payout.feeAmount`, stored | `app/actions/wheel.ts:696` | frozen at draw time; read in preference to any re-projection |
| `weekDateBounds` | `lib/date-bounds.ts:152` | neighbouring `Week.date` rows only |
| `parseDollarsToCents` / `formatMoney` | `lib/format.ts:25`, `:5` | the dollars/cents boundary |
| `member_progress` SQL view | `20260806020000/migration.sql:33`, `:37` | **a PARALLEL ROOT** — reads `Payment.amountPaid`, `Participation.weeklyAmount`/`weeksCommitted`/`startWeek`, `Week.date`, `Week.isSkipped` straight out of Postgres and re-implements weeks_paid and weeks_behind without touching any TypeScript node in this graph. It never sees `markedLateAt`. |
| `ownWeekNumber` | `lib/member-window.ts:25` | `Week.weekNumber`, `Participation.startWeek`, `weeksCommitted` |
| `splitIntoLuckyNumbers` | `lib/money.ts:55` | `weeklyAmount`, `Cycle.unitAmount` |

## C3 — Deepest chains

1. **13 hops, four subsystems, four stored writes.** `Week.date` → `weekHasElapsed`
   (`lib/derived.ts:68`) → `weekCountsAsDue` (`:95`) → `weeksElapsedInWindow`
   (`lib/standing.ts:164`) → `amountOutstanding` (`lib/derived.ts:286`) →
   `memberFinals.outstanding` (`app/actions/cycle-close.ts:107`) → `finalBalanceEntries`
   DEBT (`lib/cycle-close.ts:150`) → `ledgerBalance` (`lib/ledger.ts:23`) →
   `carryOffer.maxDeductible` (`lib/carry-balance.ts:104`) → `applyCarryDeduction`
   (`lib/carry-balance.ts:166`) → `Payout.netAmount` (`app/actions/carry-deduction.ts:206`)
   → collected/pending payout totals (`lib/dashboard.ts:60`, `:62`) →
   `cashPosition.currentlyHeld`/`uncommitted` (`lib/dashboard.ts:66`, `:72`) →
   `positionVerdict.coverage` (`lib/cycle-position.ts:390`).
2. **11 hops, the collection-position spine.** `Participation.weeklyAmount` + `inWindow`
   (`lib/participation-close.ts:120`, itself ← `calculateFinishWeek` + `inBreak`) → week
   expected (`lib/dashboard.ts:255`) → elapsed flag (`lib/dashboard.ts:286` ←
   `elapsedThroughWeek` ← `weekHasElapsed`) → `shouldHaveCollected`
   (`lib/cycle-position.ts:194`) → gap (`:209`) → shortfall net of willNotArrive (`:217` ←
   `balanceRecorded` ← `amountOutstanding` over a shortened window ← `effectiveFinishWeek`)
   → collectionSentence (`lib/cycle-position.ts:465`) and the Outstanding card.
3. **10 hops, the coverage spine every member surface hangs off.**
   `Participation.weeklyAmount` → amountDue → `remainingOn` (`lib/week-picking.ts:43`) /
   owed (`lib/allocation.ts:91`) → `allocatePayment` (`lib/allocation.ts:65`) →
   `coveredAtCurrentRate` (`lib/standing.ts:144`) → `paymentStatus` (`lib/standing.ts:209`
   → `lib/derived.ts:169`) → `consistencyFromStatus` (`lib/chart.ts:230`) →
   `longestOverdueRun` (`lib/chart.ts:201`) → the consistency strip. The same
   `coveredAtCurrentRate` node also feeds `amountOutstanding`, `nextDue` and the member
   portal's per-week amountPaid.
4. **9 hops, the cash-verdict spine.** `Payment.amountPaid` → week received
   (`lib/dashboard.ts:250`) → `paidAhead` (`lib/cycle-position.ts:226`, gated by
   `currentWeekFromRows` ← `currentWeekNumber`) → `cashOnHand.paidEarly`
   (`lib/cycle-position.ts:324`) → `holdingForOthers` (`:389`, also ←
   `drawnNotHandedOut` ← `Payout.netAmount`, and ← `owedBackToStopped` ← `feeOnReturn` ←
   `feePreview` ← `calculateFee`) → coverage (`:390`) → `positionVerdict.kind` (`:375`) →
   the verdict sentence.
5. **9 hops, freeze-then-read — the risk is that nothing downstream re-derives.**
   `computeStanding` (`lib/standing.ts:96`) → memberFinals weeksPaid / outstanding /
   totalPaid / receivedNet (`app/actions/cycle-close.ts:106-135`) → `buildArchiveData`
   totals (`lib/cycle-close.ts:225-256`) → `CycleArchive.data` JSON (stored) →
   `lib/member-history.ts:123` → `closingLine` (`lib/member-history.ts:85`) →
   past-cycle-card. Also branches to `finalBalanceEntries` → `ledgerBalance` → `/me/history`.
6. **8 hops, the fee spine.** `LuckyNumber.amount` + `Participation.weeksCommitted` →
   `calculateGross` (`lib/money.ts:73`) → `calculateFee` (`:90`) → `calculateNet` (`:100`)
   → `feePreview` per-number sums (`lib/fee-preview.ts:58`) → `feeOnReturn`
   (`lib/final-position.ts:61`) → `finalPosition.amount` (`:126`) → `owedBack`
   (`app/actions/cycle-position.ts:268`) → `owedBackToStopped` → `holdingForOthers` →
   coverage verdict.
7. **8 hops, the chase spine.** `Payment.amountPaid` → totalPaid → `coveredAtCurrentRate`
   → `paymentStatus` → `hasChaseableWeeks` (`lib/messages.ts:174`) → `sendDecision` block
   (`lib/messages.ts:576`) / `{lateWeeks}` placeholder (`lib/messages.ts:333`) → the
   message actually sent. A wrong coverage figure silently changes who receives a chase.
8. **Highest-risk SHORT chain — 2 hops, enormous blast radius.**
   `Participation.weeklyAmount` → amountDue → everything. Because amountDue is read fresh
   on every load and is the DIVISOR in `weeksCredited` (`lib/derived.ts:122`), a single
   rate change simultaneously restates every past week's cost, every week's status, weeks
   credited, weeks behind, outstanding, the grid, the archive input and every message
   placeholder.

## C4 — Highest fan-out

- **amountDue for one week** (`Participation.weeklyAmount`, read fresh) — the single
  highest fan-out node. 25+ direct dependents (listed in C1); effectively the whole money
  graph is downstream.
- **coveredAtCurrentRate** (`lib/standing.ts:144`) — read by `paymentStatus`
  (`lib/standing.ts:209`), `amountOutstanding` (`:179`), `nextDue`
  (`app/actions/member.ts:292`), the member portal's per-week amountPaid
  (`app/actions/member.ts:377`), week-stamp-list, and every status-derived value beyond it.
  Note the split at `lib/standing.ts:204-205`: the same object carries the STORED receipt
  beside it, and different surfaces read different ones.
- **weekHasElapsed** (`lib/derived.ts:68`) — everything time-gated is downstream, plus a
  bare literal 5 replicated in three migration views and two scripts.
- **amountOutstanding** (`lib/derived.ts:286`) — 13+ dependents across six subsystems.
- **`Payout.netAmount`** (live) — high fan-out AND high fan-in: read by ~19 consumers and
  written by four separate paths beyond creation.
- **week received** (`lib/dashboard.ts:250`) — read by week shortfall, collected-for-elapsed
  weeks, paidAhead, collectedThisWeek, cashSeries.received, archive week received, the cash
  page by-week table and both charts. **The reported trigger bug sits directly on it.**
- **week expected** (`lib/dashboard.ts:255`) — read by week shortfall,
  membersExpected/membersPaid, shouldHaveCollected, expectedThisWeek, the
  collected-vs-expected chart, the this-week card and the cash page. Its divergent twin,
  grid row expected (`lib/payments-view.ts:225`), feeds the payments grid instead.
- **weeksCredited** (`lib/derived.ts:122`) — weeksBehind, the capped twin, memberFinals,
  waiting, message placeholders, closing statement, ledger description, every progress bar,
  and the SQL view's parallel copy.
- **calculateFinishWeek** (`lib/money.ts:113`) — ~14 direct dependents plus dozens of
  inline copies.
- **elapsedThroughWeek** (`lib/commitment.ts:154`) — the per-week elapsed flag (twice),
  memberAttention's due-week range, collectionPosition's three buckets, closedShortfalls
  and the position page header. Recomputed three times inside one dashboard request
  (`app/actions/dashboard.ts:158`, `:166`, `:186`).
- **allocatePayment** (`lib/allocation.ts:65`) — coveredAtCurrentRate, surplus, planCommit,
  rebuild, the stored `Payment.amountPaid` write, PaymentAllocation rows, and mirrored (not
  called) by `coverageForAmount`.
- **paymentStatus** (`lib/derived.ts:169`) — the status vocabulary, grid cells, this-week
  grouping, consistency, chase gate, members-view filters, week-stamp-list, the portal's
  PENDING remap, and three screens that run it BACKWARDS to recover `isSkipped`/`isDeferred`
  from the status string.
- **ledgerBalance** (`lib/ledger.ts:23`) — carryOffer, applyCarryDeduction, forgiveness
  refusal, ledger payment remaining, group total, people directory, add-to-cycle gate,
  member history, carry intention snapshot.
- **formatMoney / parseDollarsToCents** (`lib/format.ts:5`, `:25`) — the units boundary;
  every money surface terminates here, plus three modules that duplicate the formatter
  locally (`lib/member-history.ts:106`, `lib/lucky-numbers.ts:136`,
  `lib/participation-removal.ts:243`).

## C5 — Cycles in the graph

Six real cycles, all closed through a stored column. Recorded, not judged.

1. **`Payout.netAmount` ↔ winner-week settlement.** `planWinnerWeekSettlement` READS
   `payout.netAmount` to cap each deduction (`lib/settlement.ts:48`, verified) and
   `lib/draw-settlement.ts:156` DECREMENTS `Payout.netAmount` by the very figure it
   produced; `lib/draw-settlement.ts:195` increments it back on undo. `netAmount` is
   simultaneously an input to and an output of the same derivation.
2. **`Payment.amountPaid` ↔ allocation.** `allocatePayment` reads
   `week.amountAlreadyPaid` (`lib/allocation.ts:91`, verified) and its per-week result is
   written back to `Payment.amountPaid` (`app/actions/payments.ts:249`);
   `lib/rebuild.ts:23` zeroes that same column and replays the receipts through the same
   engine. The column the engine reads is the column the engine writes.
3. **Coverage ↔ `Payment.markedLateAt`.** `markedLateAt` feeds `weekCountsAsDue`
   (`lib/derived.ts:113`, verified), which decides the due-week set, which decides
   weeksBehind and amountOutstanding. And `lib/rebuild.ts:142-143` CLEARS `markedLateAt` on
   any week whose replayed coverage reaches weeklyAmount, while
   `app/actions/edits.ts:1499` refuses a new mark on a covered week. Coverage writes the
   flag that selects the weeks coverage is then measured over.
4. **Terms-settlement gap ↔ ledger** (documented as deliberate).
   `computeTermsSettlement.gap` (`lib/settlement.ts:128`, verified) is written to the
   ledger as tagged DEBT/PAYMENT rows (`app/actions/edits.ts:422-466`);
   `settledSoFarFromLedger` (`lib/settlement.ts:164`, verified) reads those same rows back,
   and `app/actions/edits.ts:376` subtracts them from the gap. The loop is the idempotency
   mechanism, stated in the module comment at `lib/settlement.ts:155-162`.
5. **The long ring.** `amountOutstanding` (`lib/derived.ts:286`) → `finalBalanceEntries`
   DEBT (`lib/cycle-close.ts:150`) → `ledgerBalance` (`lib/ledger.ts:23`) →
   `carryOffer.maxDeductible` (`lib/carry-balance.ts:104`) → `applyCarryDeduction` →
   `Payout.netAmount` decrement (`app/actions/carry-deduction.ts:206`) →
   `planWinnerWeekSettlement`'s per-payout cap (`lib/settlement.ts:48`) → pinned
   `PaymentEvent` → pinned settlement coverage (`lib/standing.ts:118`) →
   `coveredAtCurrentRate` → `amountOutstanding`. Seven derivations and four stored writes
   close the ring.
6. **Resize ↔ next terms edit.** `resizeWinnerWeekSettlement` (`lib/settlement.ts:211`,
   verified) reads `PaymentEvent.amount`, `Participation.weeklyAmount` and
   `Payout.netAmount`, and `app/actions/edits.ts:510`/`:515` writes BOTH
   `PaymentEvent.amount` and `Payout.netAmount`. Those two columns are exactly what
   `app/actions/edits.ts:353-355` sums as `alreadyReceived` for the next
   `computeTermsSettlement`, so an edit feeds the next edit's gap.

Three near-cycles are also recorded:

- **elapsedThroughWeek leaves and is reconstructed.** `lib/commitment.ts:154` computes the
  scalar; `lib/dashboard.ts:286` stamps it per week as
  `elapsed: w.weekNumber <= elapsedThroughWeek` (verified); `lib/cycle-position.ts:187`
  then re-derives the scalar back out of those flags (verified) and returns it as its own
  `elapsedThroughWeek` field. Any caller reading it off `collectionPosition` is reading a
  value that made a lossy round trip through a boolean.
- **The two clocks substitute for each other.** `currentWeekFromRows` falls back to
  `currentWeekNumber` when no stored row has arrived (`lib/commitment.ts:191`, verified),
  and `collectionPosition` falls back to `elapsedThrough` when no `currentWeek` is supplied
  (`lib/cycle-position.ts:188`, verified). Three distinct week-boundaries stand in for one
  another under failure.
- **Window ← money ← window.** `legacyBreak` (`lib/participation-close.ts:161`) derives a
  closed participation's window end from their LAST WEEK WITH MONEY when no closing week
  was recorded. That window then decides which weeks are `inWindow`, which decides week
  expected, amountOutstanding and weeksBehind.

## C6 — Suspected synonyms

Recorded as name collisions, not as defects. Pass 2 decides whether they should agree.

| Name(s) | Where they collide |
|---|---|
| Weeks credited = weeks paid = weeks covered = `weeksPaid` | `lib/derived.ts:122` (uncapped), `lib/contribution.ts:91` and the SQL view (capped), `app/actions/cycle-close.ts:106`, `app/actions/waiting.ts:213`. THREE cap behaviours and TWO source columns. |
| Amount outstanding = overdue = `amountOwed` = `owedBy` amount = `balanceRecorded` = `outstandingToDate` / `balanceToRecord` = `{amountOwed}` | `lib/derived.ts:286`, `lib/contribution.ts:36`/`:100`, `lib/dashboard.ts:588`, `app/actions/cycle-position.ts:205`, `:259`, `lib/participation-close.ts:331`, `lib/messages.ts:312` |
| Total paid = total contributed = paid in = `contributedThisCycle` = `receivedByMember` = `totalPaid` fed to computeStanding | Two stored bases that are NOT the same number after a settlement or an edit: `PaymentEvent.amount` (`lib/contribution.ts:58`) vs Σ `Payment.amountPaid` |
| Committed to winners = owed now = `pendingNet` = `drawnNotHandedOut` = `pendingTotal` | `lib/dashboard.ts:62`, `lib/waiting.ts:148`, `lib/cycle-close.ts:239`, `lib/cycle-position.ts:325`, `collections/page.tsx:232`. One set of rows, five names; two select it as `status !== COLLECTED` and three as `status === PENDING`. |
| Cash held = `currentlyHeld` = `shouldBeHolding` = `stillHeld` | `lib/dashboard.ts:66`, `lib/cycle-position.ts:323`, `lib/cycle-close.ts:254` — verified identical arithmetic in three modules |
| Total paid out = `handedOut` = `paidOutNet` = `receivedNet` = `alreadyPaidOut` = `paidOutTo` | `lib/dashboard.ts:60`, `lib/cycle-position.ts:326`, `lib/cycle-close.ts:238`, `app/actions/cycle-close.ts:114`, `app/actions/participation-close.ts:137`, `app/actions/cycle-position.ts:235` |
| Elapsed through week vs current week | NOT synonyms but repeatedly treated as one. `lib/cycle-position.ts:92-110` records that conflating them mis-reported $12,925 as paid ahead. `lib/cycle-position.ts:188` still falls back from one to the other. |
| Current week | FOUR derivations under one name: `lib/money.ts:162` (projected), `lib/commitment.ts:176` (stored rows), `20260804230000/migration.sql:149` (SQL `week_no`), `lib/cycle-position.ts:188` (elapsed-boundary fallback) |
| Shortfall | FIVE different quantities: per-week expected − received (`lib/dashboard.ts:264`); the cycle gap net of stopped members (`lib/cycle-position.ts:217`); `shortfallToCover`, the organizer's own hole (`lib/participation-close.ts:336`); `planWinnerWeekSettlement.shortfall`, one week's remainder (`lib/settlement.ts:43`); the cash page's whole-series "Short" (`app/admin/(protected)/cash/page.tsx:63`) |
| Surplus | TWO unrelated figures: money beyond the whole commitment (`lib/contribution.ts:90`) and the allocation engine's unallocated remainder (`lib/standing.ts:198` ← `lib/allocation.ts:106`). Only the first reaches a member surface. |
| Expected | THREE populations: `lib/dashboard.ts:255` drops deferred members; `lib/payments-view.ts:225` keeps them (both verified); `app/admin/(protected)/cash/page.tsx:62` sums every week with no elapsed filter while labelling it "Expected by now" |
| Received | THREE populations: `lib/dashboard.ts:250` counts every row including out-of-window and deferred; `lib/payments-view.ts:222` counts in-window cells only (both verified); `app/actions/cycle-close.ts:178` attributes by `weekId` rather than `weekNumber` |
| Weeks left | calendar weeks to the finish week (`lib/wheel.ts:86`, `app/actions/waiting.ts:202`) vs payments still owed (`lib/messages.ts:219`, also exposed as `{paymentsLeft}`). `lib/messages.ts:305` says they split the moment a member is behind or ahead. |
| Members short | THREE counts: `membersExpected − membersPaid` (`week-dates-data.ts:152`); members with outstanding > 0 at close (`lib/cycle-close.ts:256`); `membersAffectedByWeekDate` (`week-dates.ts:91`), which keeps deferred members in and drops marked-late ones out |
| Fee | SIX derivations: projected per lucky number (`lib/money.ts:90` via `lib/wheel.ts:542`); stored `Payout.feeAmount`; `feeOnReturn` on the whole commitment, per number (`lib/final-position.ts:61`); `feeAttributable`, total-first (`lib/participation-removal.ts:87`); `feeEstimate` off stored rows (`lib/cycle-position.ts:331`); `projection.totalFees` charged on the whole-cycle gross (`lib/projection.ts:115`) |
| Gap | `collectionPosition`'s expected − collected (`lib/cycle-position.ts:209`) vs `computeTermsSettlement`'s alreadyReceived − entitlement (`lib/settlement.ts:128`). Unrelated quantities, same word. |
| Coverage | THREE: `coverageForAmount`, a typed-amount preview (`lib/week-picking.ts:93`); `coveredAtCurrentRate`, per-week money landed (`lib/standing.ts:144`); `positionVerdict.coverage`, counted cash minus what he holds for others (`lib/cycle-position.ts:390`) |
| Weeks behind (TypeScript) vs `weeks_behind` (SQL) | `lib/derived.ts:138` vs the `member_progress` view. Same name, two engines: the SQL copy never consults `markedLateAt` and one superseded revision counts personal deferrals as excused. `/me` reads the TypeScript one, `/me/group` reads the SQL one. |
| Finish week | `lib/money.ts:113` (inclusive) = the SQL half-open bound `weekNumber < startWeek + weeksCommitted` = `effectiveFinishWeek` (`lib/participation-close.ts:133`) = `closedAtWeek` derived as `open.fromWeek − 1` (`app/actions/participation-close.ts:459`) |
| Amount leaving / amount returning; willNotArrive / balanceRecorded | `lib/participation-close.ts:324` and `:485` are the same product mirrored; `lib/cycle-position.ts:208` and `balanceRecorded` are a second pair for the same stopped-member money viewed from the group and the member |
| Carried balance = `ledgerBalance` = `carriedBalance` = `owed` = `balance` | `lib/ledger.ts:23`, `app/actions/people.ts:130`, `app/actions/ledger.ts:81`, `lib/carry-balance.ts:88` |
| "Paid in full for this week" | the bare comparison `amountPaid >= weeklyAmount` under SEVEN names: `lib/derived.ts:190`, `lib/dashboard.ts:257`, `lib/payments-view.ts:130`, `week-dates.ts:111`, `lib/rebuild.ts:143`, `app/actions/edits.ts:1499`, `lib/week-selection.ts:21` (inverted) |
| Remaining on a week | `lib/week-picking.ts:43` = `lib/payments-view.ts:64` = `lib/allocation.ts:91` = `lib/settlement.ts:72` = `lib/settlement.ts:43`, plus four inline copies in components. All verified as the same `Math.max(0, due − paid)` with a skipped-week zero. |
| Selection total = bulk catch-up amount = the "all owed" chip | `lib/week-picking.ts:63`, `lib/payments-view.ts:57`, `lib/week-picking.ts:163` |
| Progress | money-based `paidIn/commitmentTotal` (`lib/contribution.ts:103`) vs weeks-based `weeksCredited/weeksCommitted` (`member-personal-summary.tsx:39`, `member-group-list.tsx:84`, `people-directory.tsx:259`, `waiting-view.tsx:472`). The first two render on the SAME page. |
| Weeks elapsed in window | `lib/standing.ts:164` (per-row own date) = `dueWeeks.size` (`lib/dashboard.ts:561`, a week-number range plus marked weeks) = `closed.elapsed` (SQL). Verified as three different constructions of one count. |

## C7 — Verification pass on the graph

Claims spot-checked against the source. Confirmations are listed compactly; the two
**corrections** are called out and repeated in *Gaps in this map*.

CONFIRMED: `weekHasElapsed` inputs and arithmetic (`lib/derived.ts:68-79`, constant at
`:13`); `weekCountsAsDue`'s mark-then-elapsed order (`:113-114`); `weeksCredited` is
`Math.floor(totalPaid / weeklyAmount)` with **no** `weeksCommitted` parameter, so the cap
genuinely lives only at callers (`:127`); `weeksBehind` (`:146`); `paymentStatus`'s ladder
order and its re-inlined window test (`:189-197`, `:194-195`); pinned-first coverage with
`Math.min(pinned, w.amountDue)` and the skipped guard (`lib/standing.ts:118-128`, `:122`,
`:123`); `coveredAtCurrentRate` seeding (`lib/standing.ts:132-147`); `standing.surplus =
effective.unallocated` (`:198`); `computeStanding` accepts `cycleWeek` and never
references it again (`:100-105`); `allocatePayment` skips skipped weeks, computes
`amountDue − amountAlreadyPaid`, throws on out-of-order weeks (`:75`) and on
non-integer/negative cents (`:41`); `remainingOn`/`isPickable` (`lib/week-picking.ts:43-51`);
`coverageForAmount` is documented as a non-authoritative preview (`:85-92`) and re-sorts
the weeks itself (`:102-116`); `quickAmounts` dedupe (`:168`); `weekReceipts` accumulates
received at `:250` BEFORE the window/skip/deferral guards at `:252-253`, expected at
`:255`, membersExpected `:256`, membersPaid `:257`; week shortfall (`:264`); the per-week
elapsed flag in both `receiptsByWeek` and `cashSeries`; `memberAttention`'s hand-built due
set (`:543-559`); `cashPosition`'s five lines (`:46`, `:60`, `:62`, `:66`, `:72`) — note the
`else` at `:61` means pending is anything not COLLECTED; `bulkCatchUpAmount` (`:57-67`);
the payments grid's row expected excluding only `week.isSkipped || status === "SKIPPED"`
(`lib/payments-view.ts:225`) and its received summing in-window cells only (`:222`);
`collectionPosition`'s buckets and sums (`lib/cycle-position.ts:186-195`, `:226`);
`shortfall = gap − min(willNotArrive, gap)` with willNotArrive re-capped independently
(`:208`, `:209`, `:217`, `:220`, `:221`, `:222`); `cashOnHand` reporting
paidEarly/drawnNotHandedOut/owedToStopped without subtracting them (`:320-327`);
`positionVerdict.coverage` and the fee-exclusion comment (`:383-390`);
`calculateGross`/`Fee`/`Net` with integer basis points and the fee>gross refusal
(`lib/money.ts:78`, `:95`, `:96`, `:103`, `:106`); `calculateFinishWeek` (`:116`),
`MAX_MONEY_CENTS` (`:13`), `MAX_WEEKS` 1000 (`:16`); `currentWeekNumber` returning 0
before the start (`:165-167`); `currentWeekFromRows` fallback (`lib/commitment.ts:191`) and
seven-day continuation (`:194-197`); `elapsedThroughWeek` genuinely calls `weekHasElapsed`
(`lib/commitment.ts:162`); `resolveWeekDate` prefers stored and carries a `source`
discriminator (`:96-102`, `:71`); `planWinnerWeekSettlement`'s shortfall and per-payout cap
(`lib/settlement.ts:43`, `:48`); `allocatePinned`'s skipped-week zero (`:72`);
`computeTermsSettlement` gap and the SEPARATE float basis-point formula for
`netPerWeek` at `:119`; `settledSoFarFromLedger` requiring tag AND entry type (`:182-183`);
`resizeWinnerWeekSettlement`'s invariant and refusal (`:216-224`); `ledgerBalance` and the
three totals (`lib/ledger.ts:24-28`, `:32`, `:37`, `:42`); `carryOffer` maxDeductible,
netIfApplied and the trunc-and-floor at `:88`; `contribution`'s six figures and the fact
that `weeksCovered` IS capped here (`lib/contribution.ts:87-103`, `:93`); `finalPosition`'s
branches (`lib/final-position.ts:121`, `:126`, `:135`, `:136`) and the per-number
`feeOnReturn` with its module comment (`:45-50`, `:69`); `buildArchiveData` stillHeld and
COLLECTED-only paidOutNet (`lib/cycle-close.ts:234-256`); `memberAttention` builds its week
objects WITHOUT an `isSkipped` field (`lib/dashboard.ts:575-579`) — a real structural
difference from `computeStanding`, which passes `isSkipped` at `lib/standing.ts:184`.

**CORRECTION 1 — `amountOutstanding` and `isDeferred`.** The catalog listed
`Payment.isDeferred` among its inputs. `isDeferred` is a REQUIRED FIELD on the input type
(`lib/derived.ts:290`) but the function body never reads it; lines `:296-302` branch only
on `isSkipped`. The behavioural statement ("deferred weeks count as owed") is correct, but
it is true **by omission**, not by a deferral branch. Pass 2 must not look for deferral
logic in `lib/derived.ts:286`.

**CORRECTION 2 — `lastPaymentWeek` is not a maximum.** `lib/standing.ts:188`/`:199` take
the LAST ELEMENT of `windowWeeks.filter(w => w.storedPaid > 0)`, not a maximum. It equals
the highest week number only if the caller passes `windowWeeks` in ascending order, and
`computeStanding` does not assert that ordering (`allocatePayment` asserts it separately at
`lib/allocation.ts:75`).

**REFINEMENT — `weeksLeavingExpectation` line numbers.** The function is at
`lib/participation-close.ts:192`; `:197` is the `calculateFinishWeek` call and `:198` is
the subtraction `max(0, committedFinish − min(committedFinish, closingAtWeek))`.

**REFINEMENT — `finalPosition.drawn`.** Decided at `lib/final-position.ts:121` by
`input.received > 0`, and every caller feeds `received` from COLLECTED payout nets only —
so a member holding a PENDING payout evaluates as never-drawn on that path.

---

# Flagged for Pass 2

**Multiple implementations — flagged for Pass 2.** Every quantity below is computed in
more than one place, where "computed" means the code at that location INDEPENDENTLY
performs the arithmetic or the decision. Reads, pass-throughs, calls to the canonical
function, type declarations, assertions, formatting and display are NOT counted, and
neither are test files. Every location was opened and its source line quoted before it
was retained; 114 previously-claimed locations were examined and
rejected.

`[SQL]` marks a second implementation inside a migration — the `member_progress` view
and its predecessors recompute several of these in Postgres, so a TypeScript fix does not
reach them. `[script]` marks a recomputation under `scripts/`, which can drift from the
app it verifies.

Nothing here is analysed, ranked, or called wrong. Divergences are recorded where a sweep
saw one, as description only.

**Counts:** 139 quantities re-checked · 107 have
multiple implementations · 32 have exactly one.

### 1. Total paid by a member (participation total / total contributed / paid in)

- **Canonical:** `lib/contribution.ts:58`
- **Also implemented at (28):**
  - `app/actions/member.ts:156` — Receipts basis: sums the payment events with its own reduce for a stopped member's final statement instead of calling totalContributed.
  - `app/actions/participation-removal.ts:132` — Receipts basis: its own reduce over payment events for the removal preview.
  - `app/admin/(protected)/people/[id]/page.tsx:157` — Receipts basis, computed by the database: a SUM aggregate over PaymentEvent.amount rather than the TypeScript definition.
  - `app/admin/(protected)/people/[id]/participation-editor.tsx:553` — Receipts basis: sums the loaded events client-side with its own reduce to state what a removal would destroy (the sum is computed here, then formatted).
  - `app/actions/payments.ts:390` — Week-rows basis: sums Payment.amountPaid with its own reduce to feed computeStanding.
  - `app/actions/payments-view.ts:76` — Week-rows basis: the same sum written again for the grid's standing.
  - `app/actions/member.ts:254` — Week-rows basis: the portal's own sum of the week rows.
  - `app/actions/cycle-close.ts:83` — Week-rows basis: memberFinals sums the week rows itself for the closing figures.
  - `app/actions/waiting.ts:182` — Week-rows basis: the awaiting-turn loop's own sum.
  - `app/actions/cycle-position.ts:191` — Week-rows basis: standingFor's own sum of the week rows.
  - `app/actions/cycle-position.ts:245` — Week-rows basis: a second, separately written sum in the same file for the stopped-member figures.
  - `app/actions/participation-close.ts:125` — Week-rows basis: describe() sums the week rows itself for the close confirmation.
  - `app/actions/dashboard.ts:214` — Week-rows basis: the dashboard loader's own per-participation sum.
  - `app/actions/people.ts:91` — Week-rows basis, computed by the database: a grouped SUM over Payment.amountPaid for the agreement gate's has-ever-paid test. **Differs:** CORRECTED ANCHOR: the previous entry gave app/actions/people.ts:93, but the quoted statement begins at :91 (:93 is the `_sum` line inside it).
  - `app/admin/(protected)/collections/page.tsx:125` — Week-rows basis: the collections page sums the week rows itself.
  - `lib/messaging-engine.ts:134` — Week-rows basis: loadStandingFacts computes its own total for message tokens.
  - `lib/dashboard.ts:300` — Week-rows basis: receivedByMember accumulates per-participation totals into a map with its own loop.
  - `lib/dashboard.ts:562` — Week-rows basis: memberAttention computes the member's total from the payment rows it grouped itself.
  - `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:46` `[SQL]` — The member_progress view sums the week rows in SQL and divides by weeklyAmount (:34, :41) to produce weeks_paid and weeks_behind for /me/group — arithmetic performed by the database, not by the TypeScript definition.
  - `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:79` `[SQL]` — An earlier revision of the same view performing the same SQL sum and the same division by weeklyAmount (:67, :74).
  - `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:167` `[SQL]` — The original member_progress view, again summing the week rows in SQL and dividing by weeklyAmount (:157, :161).
  - `scripts/audit-position-figures.mts:131` `[script]` — Week-rows basis: the audit script sums the week rows itself.
  - `scripts/deferral-impact.mts:86` `[script]` — Week-rows basis: the deferral simulator's own sum.
  - `scripts/elapsed-rule-impact.mts:94` `[script]` — Week-rows basis: the elapsed-rule simulator's own sum.
  - `scripts/verify-member-privileges.mts:94` `[script]` — Week-rows basis: recomputes the total and divides it by weeklyAmount (:95) to check the SQL view against a hand-written expectation.
  - `scripts/verify-cycle-close-money.mts:123` `[script]` — Week-rows basis: the close-money verifier's own per-member sum.
  - `scripts/verify-cycle-close-money.mts:206` `[script]` — Week-rows basis: a second, separately written per-member sum later in the same script.
  - `scripts/verify-participation-close.mts:404` `[script]` — Week-rows basis: the participation-close verifier's own per-member sum.

### 2. Is a given week inside a member's window

- **Canonical:** `lib/participation-close.ts:120`
- **Also implemented at (28):**
  - `scripts/audit-position-figures.mts:217` `[script]` — The by-hand audit rebuilds both halves of the predicate to check the app's figures against it. **Differs:** Quote verified verbatim at :217-223. Break-AWARE — the only re-implementation that rebuilds the inBreak half too.
  - `lib/wheel.ts:49` — eligibleNumbers decides window membership for the draw pool with its own comparison pair. **Differs:** Quote verified verbatim. Break-unaware.
  - `lib/week-winners.ts:163` — winnerSettlementAmount decides membership itself before computing the settlement. **Differs:** Quote verified verbatim; it is the right-hand side of `const inWindow =` opening at :162. Break-unaware.
  - `lib/week-winners.ts:209` — addWinnerRefusal decides membership a second time in the same file. **Differs:** Quote verified verbatim. Break-unaware; negated form.
  - `lib/participation-window.ts:47` — windowConflicts decides which plans and draws fall outside the proposed window with its own predicate. **Differs:** Quote verified verbatim. Break-unaware; negated form.
  - `lib/participation-window.ts:123` — weekInWindowRefusal decides membership itself to refuse a week-scoped write. **Differs:** Quote verified verbatim. Break-unaware.
  - `lib/payments-view.ts:217` — The grid builder decides per cell whether the week is in the member's window, and that decision drives what the week EXPECTED to collect. **Differs:** Quote verified verbatim at :217-218. Break-unaware; reads a pre-computed finishWeek off the member row rather than deriving it.
  - `lib/draw-settlement.ts:104` — Decides membership itself before settling the winner's own week. **Differs:** Quote verified verbatim. Break-unaware.
  - `lib/rebuild.ts:39` — Decides which weeks receipts are rebuilt onto. **Differs:** Quote verified verbatim. Break-unaware.
  - `lib/messages.ts:281` — Decides which weeks form the member's own window for the paid-up-to prefix. **Differs:** Quote verified verbatim. Break-unaware, and over a startWeek itself re-derived backwards at lib/messages.ts:237.
  - `lib/messaging-engine.ts:121` — Decides which weeks go into computeStanding for a message. **Differs:** Quote verified verbatim. Break-unaware.
  - `lib/dashboard.ts:556` — memberAttention decides membership itself when folding manually marked weeks into the due set. **Differs:** Quote verified verbatim. Break-unaware, applied only to hand-marked weeks.
  - `app/actions/member.ts:241` — Decides the member's window weeks for the portal's standing. **Differs:** Quote verified verbatim. Break-unaware.
  - `app/actions/payments.ts:53` — Decides the member's window weeks for payment entry. **Differs:** Quote verified verbatim. Break-unaware.
  - `app/actions/payments-view.ts:63` — Decides the member's window weeks for the payments grid. **Differs:** Quote verified verbatim. Break-unaware.
  - `app/actions/payments-view.ts:255` — Decides the member's window weeks for the week board. **Differs:** Quote verified verbatim. Break-unaware; a second copy in the same file.
  - `app/actions/cycle-position.ts:178` — Decides which weeks a member's standing is computed over for the position page. **Differs:** Quote verified verbatim. Break-unaware, and bounded by a caller-supplied throughWeek rather than the committed finish.
  - `app/actions/cycle-close.ts:70` — Decides the member's window weeks for the close-time final position. **Differs:** Quote verified verbatim. Break-unaware.
  - `app/actions/waiting.ts:169` — Decides the member's window weeks for the waiting list's standing. **Differs:** Quote verified verbatim. Break-unaware.
  - `app/admin/(protected)/cycle/page.tsx:43` — Decides who contributes to this week's pot. **Differs:** Quote verified verbatim at :43-44. Break-unaware, and tested against a week clamped to at least 1 rather than the raw current week.
  - `app/admin/(protected)/collections/page.tsx:112` — Decides the winner's window weeks for the outstanding-balance offer. **Differs:** Quote verified verbatim. Break-unaware.
  - `scripts/verify-member-privileges.mts:88` `[script]` — The script's own TypeScript-side window decision, checked against the SQL view's. **Differs:** Quote verified verbatim. Break-unaware.
  - `scripts/elapsed-rule-impact.mts:66` `[script]` — Decides the member's window weeks for the before/after simulation. **Differs:** Quote verified verbatim. Break-unaware.
  - `scripts/deferral-impact.mts:67` `[script]` — Decides the member's window weeks for the deferral simulation. **Differs:** Quote verified verbatim. Break-unaware.
  - `scripts/audit-position-figures.mts:118` `[script]` — Decides the member's window weeks when reproducing the page's own derivation. **Differs:** Quote verified verbatim. Break-unaware — the same file also carries the break-aware copy at :217.
  - `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:60` `[SQL]` — The view decides window membership in SQL to count elapsed weeks. **Differs:** Quote verified verbatim at :60-61. Break-unaware, half-open upper bound.
  - `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:98` `[SQL]` — Same SQL window-membership decision in the earlier view. **Differs:** Quote verified verbatim at :98-99. Superseded copy of the same view.
  - `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:177` `[SQL]` — The oldest view decides which of a member's weeks count toward the deferral/skip excusal with its own one-sided bound. **Differs:** Quote verified verbatim. Has NO start-week floor at all and bounds by the projected current week rather than the member's finish — a materially different set from every other copy.

### 3. Remainder still owed on one week (per-week remainder / tickable)

- **Canonical:** `lib/week-picking.ts:43`
- **Also implemented at (15):**
  - `lib/allocation.ts:91` — The engine subtracts each week's paid from its due itself and tests the result, never calling remainingOn. **Differs:** Quote verified verbatim. No Math.max(0, …) clamp; it guards with `owed <= 0` instead, so an overpaid week yields a negative intermediate.
  - `lib/week-selection.ts:21` — isSelectable writes the same still-owed decision as a direct comparison rather than deriving it from a remainder.
  - `lib/payments-view.ts:64` — bulkCatchUpAmount computes each week's clamped shortfall inline as the term of its sum.
  - `lib/payments-view.ts:130` — splitWeekRoster decides "does this member still owe this week" with its own comparison. **Differs:** Quote verified verbatim. Treats a DEFERRED member as paid, whereas the canonical remainder keeps a deferred week owed and tickable.
  - `lib/settlement.ts:43` — planWinnerWeekSettlement computes the drawn week's remaining shortfall by its own clamped subtraction.
  - `lib/settlement.ts:72` — allocatePinned computes the remainder including the skipped-week zero case — the closest line-for-line restatement of remainingOn in the repo.
  - `lib/week-winners.ts:165` — settlementFor computes the week's remainder from the raw weekly amount and what has already landed.
  - `lib/dashboard.ts:257` — weekReceipts makes its own fully-covered comparison on the week to count members paid.
  - `app/actions/member.ts:293` — The portal writes its own still-owed comparison over coverage rather than calling a remainder helper. **Differs:** Quote verified verbatim. Compares coveredAtCurrentRate (re-allocated) rather than the stored per-week paid, and excludes deferred weeks.
  - `app/actions/messages.ts:278` — The message preview repeats the same uncovered-week comparison a second time for the confirmation sample. **Differs:** CORRECTED QUOTE: the previous entry quoted lines 277-279 (starting `loaded.standing.weeks.find(`) against an anchor of :278. Line 278 alone is the comparison and is quoted here verbatim.
  - `components/admin/week-action-panel.tsx:81` — The panel header computes the week's remainder client-side instead of calling remainingOn.
  - `app/admin/(protected)/payments/payments-members.tsx:36` — cellTitle computes the cell's remainder itself for the tooltip figure.
  - `app/admin/(protected)/payments/payments-members.tsx:218` — dueNow recomputes the current week's remainder to size the "Record week N" button amount.
  - `app/admin/(protected)/people/[id]/member-payments.tsx:377` — The week list writes the tickability comparison inline rather than importing isPickable/isSelectable.
  - `app/admin/(protected)/people/[id]/member-payments.tsx:378` — The same row computes its own clamped remainder for the amount column.

### 4. Weeks credited / weeks paid / weeks covered

- **Canonical:** `lib/derived.ts:122`
- **Also implemented at (10):**
  - `lib/contribution.ts:93` — Recomputes the quotient from the receipts total and applies a cap at weeksCommitted. **Differs:** Quote VERIFIED verbatim. Capped, and computed off PaymentEvent receipts rather than week rows; lib/derived.ts is uncapped.
  - `app/actions/member.ts:208` — The stopped-member branch performs the division inline and caps it at :209 with weeksCommitted. **Differs:** Quote VERIFIED verbatim. Carries a Math.max(1, …) divisor guard the shared function does not have (weeksCredited throws instead).
  - `app/actions/member.ts:349` — Applies the cap itself on the portal path — the capped figure exists nowhere as a shared function, so this Math.min is this screen's own definition of weeks paid. **Differs:** Quote VERIFIED verbatim. Does NOT recompute the quotient — it reads standing.weeksCredited and performs only the clamp. A second cap in the same response as contribution.weeksCovered, which is already capped.
  - `app/actions/cycle-close.ts:106` — Applies the cap itself before the figure is frozen into the archive. **Differs:** Quote VERIFIED verbatim. Clamp only, not a re-division.
  - `app/actions/waiting.ts:213` — Applies the cap itself for the awaiting-their-turn row. **Differs:** Quote VERIFIED verbatim. Clamp only, not a re-division.
  - `lib/messages.ts:218` — Applies the cap itself before rendering the {weeksPaid} placeholder, and drives {weeksLeft} at :219. **Differs:** Quote VERIFIED verbatim. lib/messaging-engine.ts:178 hands StandingFacts the UNCAPPED figure (`weeksCredited: standing.weeksCredited`), so the cap lives only here on the messaging path.
  - `app/admin/(protected)/people/page.tsx:64` — Performs the quotient inline from the directory's own contributed total. **Differs:** Quote VERIFIED verbatim. No cap at weeksCommitted, so a member who has overpaid sorts and displays above their committed count.
  - `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:33` `[SQL]` — The live view divides the summed stored amounts by the weekly amount in SQL and caps at weeksCommitted. **Differs:** Quote VERIFIED verbatim at :33-36. Divides through numeric then casts to int; reads Payment.amountPaid rather than PaymentEvent.amount. CORRECTION: 20260805150000:67 and 20260804230000:157 also quote accurately but are superseded revisions of this same view; dropped as prior versions.
  - `scripts/verify-member-privileges.mts:95` `[script]` — Recomputes the quotient by hand in TypeScript, then caps it at :97 (`const expectPaid = Math.min(credited, pt.weeksCommitted);`), to compare against the view. **Differs:** Quote VERIFIED verbatim, as is the :97 cap. The same file also computes it in SQL at :67.
  - `scripts/elapsed-rule-impact.mts:213` `[script]` — The script embeds its own copy of the view arithmetic and runs it with $queryRawUnsafe rather than selecting from the view. **Differs:** Quote VERIFIED verbatim at :213-214. A copy of the view's SQL living in a script, so it can drift from the migration.

### 5. Paid in / commitment total / still to save / surplus / progress (the savings figures)

- **Canonical:** `lib/contribution.ts:74`
- **Also implemented at (10):**
  - `lib/money.ts:78` — calculateGross is the shared, range-checked version of the same product that lib/contribution.ts:88 and the inlined copies below bypass. **Differs:** Quote VERIFIED verbatim. Asserts cents and checks for safe-integer overflow at :79-81; the inline copies do neither.
  - `lib/final-position.ts:135` — Computes the commitment product inline and then the still-unpaid remainder itself. **Differs:** Quote VERIFIED verbatim at :135-136. `unpaid` is NOT floored at zero here — it is tested with `if (unpaid <= 0)` at :137 instead. contribution.ts:89 floors it.
  - `lib/dashboard.ts:481` — standingIssues computes the commitment product inline for the unsigned row. **Differs:** Quote VERIFIED verbatim. No overflow or cents assertion.
  - `lib/dashboard.ts:492` — The same product a second time in the same function, for the never-paid row. **Differs:** Quote VERIFIED verbatim.
  - `lib/participation-removal.ts:100` — Computes the commitment product inline as the fee basis for a removal, feeding calculateFee at :101. **Differs:** Quote VERIFIED verbatim. The comment above it (:92-99) records that this line previously multiplied by numbers.length as well and doubled the fee.
  - `app/actions/agreement.ts:127` — Computes the commitment product inline for the agreement document. **Differs:** Quote VERIFIED verbatim. This is the figure that appears in a signed agreement.
  - `scripts/verify-number-amounts.mts:66` `[script]` — The verification script recomputes the commitment product by hand. **Differs:** Quote VERIFIED verbatim; the helper is named `bill` and its comment says "as lib/rebuild.ts reads it".
  - `components/member/member-personal-summary.tsx:39` — Computes the member's savings progress itself, and the remaining count at :40 (`const remainingWeeks = Math.max(0, totalWeeks - paidCount);`). **Differs:** Quote VERIFIED verbatim, as is :40. Derived from WEEKS (weeksCredited over weeksCommitted), not from cents. contribution.ts:103 divides paidIn by commitmentTotal, so a part-paid week moves one figure and not the other.
  - `app/admin/(protected)/people/people-directory.tsx:259` — A second weeks-based progress percentage computed at render time for the directory bar. **Differs:** Quote VERIFIED verbatim. Weeks-based, and no zero-denominator guard on the division itself (only the surrounding render guard).
  - `app/admin/(protected)/waiting/waiting-view.tsx:472` — A third progress fraction, computed from weeks for the waiting list row. **Differs:** Quote VERIFIED verbatim at :472 (the statement opens `const progress =` at :471). Weeks-based rather than cents-based, same clamp at 1.

### 6. Has this week's payment window closed (elapsed)

- **Canonical:** `lib/derived.ts:68`
- **Also implemented at (9):**
  - `lib/derived.ts:194` — paymentStatus does the whole UTC-day subtraction, floor, and >= windowDays comparison inline instead of calling weekHasElapsed two functions above it. **Differs:** Quote verified verbatim at :194-195 (the original quote carried four extra leading spaces per line; the file has two).
  - `lib/derived.ts:252` — manualLateAdvice recomputes the same day difference and applies the window threshold itself — a third copy of the boundary inside one file. **Differs:** Quote verified verbatim. Same subtraction, but the result is then tested two ways at :257 (days >= windowDays) and :263 (days < 0) rather than reduced to one boolean.
  - `app/actions/dashboard.ts:224` — Decides, per week, whether the payment window has shut, to build closedShortfalls — without calling weekHasElapsed. **Differs:** Quote verified verbatim. Written as an addition to the week's day rather than a subtraction-and-floor; uses a locally redeclared MS_PER_DAY (:29) and utcDay (:30-32), both confirmed present.
  - `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:62` `[SQL]` — The member_progress view decides in SQL whether each week's window has closed, to count elapsed weeks. **Differs:** Quote verified verbatim. Window length is a bare SQL literal 5, not PAYMENT_WINDOW_DAYS; `current_date` is the server timezone's day, not a UTC day.
  - `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:100` `[SQL]` — Same SQL window-closed decision, in an earlier copy of the view. **Differs:** Quote verified verbatim. An earlier CREATE OR REPLACE of the same view, superseded by 20260806020000 but still in the migrations tree.
  - `scripts/elapsed-rule-impact.mts:60` `[script]` — elapsedByStoredDate rewrites the whole comparison rather than importing weekHasElapsed, which the same file could have imported. **Differs:** Quote verified verbatim. Imports PAYMENT_WINDOW_DAYS (:25) but redefines MS_PER_DAY (:28) and utcDay (:29), both confirmed.
  - `scripts/elapsed-rule-impact.mts:234` `[script]` — Replays the view's window-closed arithmetic in a raw query so the script can compare SQL against TypeScript. **Differs:** Quote verified verbatim. SQL replay with the TypeScript constant interpolated, so this copy tracks the constant where the migrations' literal 5 does not.
  - `scripts/verify-member-privileges.mts:79` `[script]` — Replays the view's window-closed test in a raw query to verify the view. **Differs:** Quote verified verbatim. Bare literal 5 in SQL.
  - `scripts/verify-member-privileges.mts:89` `[script]` — The script's own TypeScript-side window-closed decision, which it then checks the SQL against. **Differs:** Quote verified verbatim. Bare literal 5 in TypeScript; MS_PER_DAY and utcDay redefined locally at :61-62, confirmed.

### 7. Finish week (a member's own last week, inclusive)

- **Canonical:** `lib/money.ts:113`
- **Also implemented at (9):**
  - `lib/week-winners.ts:161` — winnerSettlementAmount inlines the finish-week arithmetic rather than calling calculateFinishWeek. **Differs:** Quote verified verbatim. No assertPositiveInt guards on either input.
  - `lib/week-winners.ts:208` — addWinnerRefusal inlines the same arithmetic a second time in the same file. **Differs:** Quote verified verbatim.
  - `app/admin/(protected)/people/[id]/participation-editor.tsx:429` — Computes the finish week inline inside the refusal message. **Differs:** Quote verified verbatim. The arithmetic is performed here inside the template expression, not read from a value computed elsewhere.
  - `app/admin/(protected)/people/[id]/participation-editor.tsx:448` — Computes the finish week a second time in the same component to decide whether the save adds weeks to the cycle (:449). **Differs:** Quote verified verbatim.
  - `scripts/portal-test-fixture.mts:92` `[script]` — Inlines the finish-week arithmetic in the fixture's reported output. **Differs:** Quote verified verbatim; it sits in the summary object the fixture prints, so a stale rule here reports a figure the app would not agree with.
  - `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:61` `[SQL]` — The view bounds the member's window by computing the exclusive end itself. **Differs:** Quote verified verbatim. HALF-OPEN form (< startWeek + weeksCommitted) rather than the inclusive <= finishWeek the TypeScript uses.
  - `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:99` `[SQL]` — Same exclusive-end computation in the earlier view. **Differs:** Quote verified verbatim. Superseded copy of the same view, half-open form.
  - `scripts/verify-member-privileges.mts:78` `[script]` — Replays the half-open end computation in the script's raw query. **Differs:** Quote verified verbatim (single space after `<` here, two in the migrations).
  - `scripts/elapsed-rule-impact.mts:233` `[script]` — Replays the half-open end computation in the script's raw query. **Differs:** Quote verified verbatim.

### 8. Cash held / currently held / what you should be holding

- **Canonical:** `lib/dashboard.ts:66`
- **Also implemented at (9):**
  - `lib/cycle-position.ts:323` — Performs the received-minus-handed-out subtraction itself inside `cashOnHand`, under a different name. **Differs:** Quote verified verbatim.
  - `app/actions/cycle-close.ts:293` — Subtracts the pre-close review's own paidOut from its own received to produce the held figure. **Differs:** Quote verified verbatim.
  - `lib/cycle-close.ts:254` — Subtracts the archive's paidOutNet from its received to freeze the still-held figure into the snapshot. **Differs:** Quote verified verbatim.
  - `lib/dashboard.ts:149` — Accumulates the same subtraction week by week to produce the running held series. **Differs:** Quote verified verbatim. Per-week running form of the same arithmetic rather than a single whole-cycle figure.
  - `scripts/import-cycle.mts:316` `[script]` — Computes held inside the import transaction from its own two accumulators and rolls the whole import back if it disagrees with the hardcoded expectation. **Differs:** Quote verified verbatim.
  - `scripts/audit-position-figures.mts:294` `[script]` — Performs the subtraction on its own hand-computed totals and compares the result with the page's figure. **Differs:** Quote verified verbatim.
  - `scripts/verify-cycle-close-money.mts:157` `[script]` — Subtracts collected payout nets from received to form the expected still-held figure the archive is checked against. **Differs:** Quote verified verbatim.
  - `scripts/verify-cycle-close-money.mts:162` `[script]` — Reproduces the OLD still-held arithmetic (subtracting pending as well) as a second live computation kept for comparison. **Differs:** Quote verified verbatim. Deliberately subtracts pending payouts too, which the canonical does not.
  - `scripts/verify-cycle-position.mts:201` `[script]` — Recomputes money-in-minus-money-out from the holding object's own fields as the check's expected value. **Differs:** Quote verified verbatim.

### 9. Payout gross, one lucky number

- **Canonical:** `lib/wheel.ts:538`
- **Also implemented at (8):**
  - `lib/participation-removal.ts:100` — Multiplies weekly amount by weeks committed itself to get a gross, without calling calculateGross or calculatePayout. **Differs:** Quote verified verbatim at line 100. Total-first: uses the member's whole weeklyAmount rather than one lucky number's amount, so a multi-number member gets one gross instead of one per number.
  - `lib/final-position.ts:135` — Performs the weekly x weeks multiplication inline to produce the member's whole commitment figure used by the they-owe branch. **Differs:** Quote verified verbatim at line 135. Member total, not per lucky number; no safe-integer overflow guard (wheel.ts:539 and money.ts:79 both throw on overflow).
  - `lib/dashboard.ts:481` — Computes the commitment figure for the 'unsigned' standing issue by multiplying weekly by weeks, independently of money.ts. **Differs:** Quote verified verbatim at line 481. Member total, not per lucky number; no overflow guard.
  - `lib/dashboard.ts:492` — The same multiplication written a second time in the same function, for the 'never-paid' standing issue. **Differs:** Quote verified verbatim at line 492. Member total, not per lucky number; identical expression duplicated eleven lines below lib/dashboard.ts:481.
  - `lib/contribution.ts:88` — Derives commitmentTotal by multiplying weekly by weeks itself; stillToSave, surplus and progress are then all computed off that local product. **Differs:** Quote verified verbatim at line 88. Member total, not per lucky number.
  - `app/actions/agreement.ts:127` — Computes the total-contribution figure printed into the signed agreement by multiplying inline, while the gross/fee/net on the next three lines come from feePreview. **Differs:** Quote verified verbatim at line 127. Member total, not per lucky number; sits directly beside three fields (payoutGross :128, feeAmount :129, payoutNet :130) that DO come from the shared preview.
  - `scripts/lib/production-fixture.mts:227` `[script]` — The fixture multiplies each lucky number's amount by a week count it picks itself to produce the grossAmount it writes to the payout row. **Differs:** Quote verified verbatim at line 227. Carries its own per-member weeks override (PLANNED_WEEKS - 5 for the last member) rather than reading Participation.weeksCommitted.
  - `scripts/verify-number-amounts.mts:66` `[script]` — The bill() helper recomputes weekly x weeks in the verification script to compare against the app's entitlement figure. **Differs:** Quote verified verbatim at line 66. Member total, not per lucky number — deliberately so, since the script compares the two roads.

### 10. Who has paid / not paid for one week (the this-week grouping)

- **Canonical:** `lib/dashboard.ts:341`
- **Also implemented at (8):**
  - `lib/payments-view.ts:130` — splitWeekRoster decides paid-vs-owing for the week with its own two-term test instead of asking paymentStatus. **Differs:** Deferred is forced into "paid"; there is no week date, no today, and no mark in the decision. Quote verified verbatim: lines 130-131. The canonical quote is elided — verified as the signature at :341 plus the paymentStatus call at :372-379.
  - `lib/dashboard.ts:257` — weekReceipts makes its own covered/not-covered call for the same member and week, 84 lines above the function that asks the engine. **Differs:** Bare amount comparison: no deferral term, no date, no mark. Quote verified verbatim at line 257.
  - `app/admin/(protected)/cycle/position/week-dates.ts:111` — membersAffectedByWeekDate makes the covered call itself to decide whom a week's date can still affect, dropping covered members from the count. **Differs:** Same bare comparison as lib/dashboard.ts:257, used to EXCLUDE rather than to count; followed by its own markedLate exclusion at :113. Quote verified verbatim at line 111.
  - `lib/rebuild.ts:143` — Decides which weeks are covered so their stored late marks can be cleared, comparing the rebuilt paid amount against the weekly amount itself. **Differs:** Bare comparison plus a markedLate term; no deferral, no date. Its subject is the STORED mark rather than a displayed status. Quote verified verbatim at line 143.
  - `app/actions/edits.ts:1499` — Decides on the server whether the week is already covered, and refuses a manual late mark when it is. **Differs:** Bare comparison; the deferral and date parts of the decision are handled separately at :1486-1494 through manualLateAdvice. Quote verified verbatim at line 1499.
  - `lib/chart.ts:194` — consistencyState runs its own ordered ladder (deferred, paid, window-open, overdue) over raw amounts to produce a per-week dot state. **Differs:** Adds an `amountDue > 0` term the other tests do not have; puts deferred ABOVE paid at :193, where paymentStatus puts PAID above DEFERRED; takes a precomputed `windowClosed` boolean rather than a week date and today. Quote verified verbatim at line 194.
  - `lib/week-selection.ts:21` — isSelectable decides whether a week is still owed by this member using its own comparison — the complement of the covered test. **Differs:** Skipped weeks are excluded; a DEFERRED week stays selectable, so deferral is deliberately not part of this decision. No date, no mark. The subject is week-selectability rather than a displayed status, but the money comparison is the same one, made independently. Quote verified verbatim at line 21.
  - `app/admin/(protected)/people/[id]/member-payments.tsx:377` — The member's week list makes the same still-owed decision inline in the client component to decide which weeks get a checkbox. **Differs:** Character-for-character the same rule as lib/week-selection.ts:21, written out again rather than imported. Quote verified verbatim at line 377.

### 11. Member's whole projected payout (gross / fee / net across all their numbers)

- **Canonical:** `lib/fee-preview.ts:102`
- **Also implemented at (7):**
  - `lib/manual-payout.ts:220` — Sums the three columns across the chosen lucky numbers with its own reduces rather than going through feePreview. **Differs:** CORRECTION: previously cited as :220 for this entry and as :208 for the 'Manual payout preview totals' entry; the reduces are at 220-222 and 208 is only the function signature. Both entries point at the same three lines.
  - `app/actions/waiting.ts:193` — Accumulates gross, fee and net across a member's undrawn numbers in a single reduce written for this action. **Differs:** Quote verified verbatim at lines 193-197. Sums only the UNDRAWN numbers, so it is a partial member total by design.
  - `app/admin/(protected)/people/[id]/page.tsx:325` — Sums per number with its own reduce and additionally decides, per number, whether the recorded payout row or the projection is the term being added. **Differs:** Quote verified verbatim at lines 325-327. Mixes recorded and projected figures inside one total; feePreview sums projections only.
  - `app/admin/(protected)/people/[id]/assign-payout.tsx:154` — The client re-sums the three columns across the selected numbers, after the server already summed them. **Differs:** Quote verified verbatim at lines 154-157.
  - `app/me/page.tsx:237` — The portal page sums the per-number nets itself to produce the member's whole payout figure. **Differs:** Quote verified verbatim at line 237. Net only — no gross or fee total.
  - `components/member/member-payout-card.tsx:30` — The card sums the same per-number nets a third time for its own headline. **Differs:** Quote verified verbatim at line 30. Net only; duplicates the reduce app/me/page.tsx:237 already performed on the same array.
  - `scripts/verify-number-amounts.mts:51` `[script]` — The script performs the per-number summation itself to produce a member entitlement figure to compare against; the per-number term is a call, the aggregation is its own. **Differs:** Quote verified verbatim at lines 51-60. Gross only.

### 12. Total paid out to date (money that actually left)

- **Canonical:** `lib/dashboard.ts:60`
- **Also implemented at (7):**
  - `app/admin/(protected)/collections/page.tsx:231` — Filters the cycle's payouts to COLLECTED and sums their netAmount, producing the same whole-cycle handed-over total. **Differs:** Quote verified: the filter is line 229, the reduce line 231.
  - `app/actions/cycle-close.ts:261` — Triple-nested reduce over participations → lucky numbers → payouts, filtering COLLECTED and summing netAmount, for the pre-close review's cash figure. **Differs:** Quote verified verbatim at lines 261-270.
  - `lib/cycle-close.ts:238` — Rolls the archive's whole-cycle paid-out total up from each member's COLLECTED-only receivedNet, a different route to the same figure. **Differs:** Quote verified verbatim.
  - `scripts/import-cycle.mts:312` `[script]` — Accumulates COLLECTED payout nets during import and checks the total against a hardcoded expectation, rolling back on mismatch. **Differs:** Quote verified verbatim.
  - `scripts/audit-position-figures.mts:286` `[script]` — Recomputes handed-out by hand from the raw payout rows and asserts it equals holding.handedOut. **Differs:** Quote verified verbatim at lines 286-288.
  - `scripts/verify-cycle-position.mts:191` `[script]` — Independently sums COLLECTED payout nets from live rows for the 'money handed out counts only payouts actually COLLECTED' check. **Differs:** Quote verified verbatim at lines 191-193.
  - `scripts/verify-cycle-close-money.mts:90` `[script]` — Sums the netAmount of the separately-queried COLLECTED payouts to form the expected paid-out total. **Differs:** Quote verified verbatim.

### 13. Weeks (and money) leaving the expectation when a participation closes (amountLeaving)

- **Canonical:** `lib/participation-close.ts:198`
- **Also implemented at (7):**
  - `app/actions/cycle-position.ts:246` — Performs the weeks-times-weekly multiplication itself instead of taking amountLeaving from closePlan. **Differs:** Quote verified verbatim at lines 246-251. The canonical multiplication lives at lib/participation-close.ts:324 inside closePlan.
  - `app/actions/dashboard.ts:286` — A second inline copy of the same multiplication for the dashboard's stopped list. **Differs:** Quote verified verbatim at lines 286-291.
  - `scripts/audit-position-figures.mts:177` `[script]` — Inlines the multiplication when building the script's own stoppedBy rows. **Differs:** Quote verified verbatim at lines 177-182.
  - `scripts/audit-position-figures.mts:315` `[script]` — A SECOND inlined copy in the same file, accumulating the by-hand total to compare against Σ stoppedBy.amountLeaving at :322-326. **Differs:** Quote verified verbatim at lines 315-320.
  - `scripts/verify-participation-close.mts:143` `[script]` — Computes the expected amount leaving independently, then asserts the series drop equals it at :172-176. **Differs:** Quote verified verbatim at lines 143-148.
  - `scripts/verify-participation-close.mts:393` `[script]` — A second inlined copy in the same file, building the stoppedBy rows fed to collectionPosition. **Differs:** Quote verified verbatim at lines 393-398.
  - `scripts/verify-participation-close.mts:407` `[script]` — A THIRD copy in the same file, inside the shortfallToCover ternary at :405-412. **Differs:** Quote verified verbatim at lines 407-412.

### 14. Money I paid in before I stopped, and what I received

- **Canonical:** `app/actions/member.ts:156`
- **Also implemented at (7):**
  - `lib/contribution.ts:58` — Accumulates the payment-event amounts in its own loop to produce paid-in — the same total the stopped branch reduces by hand. The assertCents call is incidental; the `total += r.amount` is the arithmetic. The same action file reaches this via contribution() at member.ts:343 while computing paidIn by hand at :156. **Differs:** Quote verified verbatim at lib/contribution.ts:58-65. Asserts each receipt is a non-negative safe integer before adding; the member.ts reduce does not.
  - `app/actions/participation-removal.ts:132` — Sums the same participation's paymentEvents amounts in its own reduce to state how much money the member has put in before a removal is allowed. **Differs:** Quote verified verbatim at app/actions/participation-removal.ts:132.
  - `app/admin/(protected)/people/[id]/page.tsx:157` — An aggregate, not a select: the addition of every PaymentEvent.amount for the participation is performed in Postgres and the result coalesced to 0, producing paid-in for the admin-side finalPosition without going through totalContributed. **Differs:** Quote verified verbatim at app/admin/(protected)/people/[id]/page.tsx:157-163. Database-side SUM over every event row; the portal sums the events already loaded into memory, and unlike lib/contribution.ts:58 nothing here asserts the cents.
  - `app/actions/cycle-close.ts:114` — Applies the COLLECTED-only filter and sums netAmount per member for the archive snapshot, arriving at 'what they received' by its own nested reduce. **Differs:** Quote verified verbatim at app/actions/cycle-close.ts:114-121. Nested reduce over luckyNumbers instead of flatMap; same rule, same result.
  - `app/actions/participation-close.ts:137` — Independently applies the same COLLECTED filter and sums the same netAmount field to decide what the closing member has already been handed. **Differs:** Quote verified verbatim at app/actions/participation-close.ts:137-140.
  - `app/admin/(protected)/people/[id]/page.tsx:164` — A further copy of the received derivation — flatMap, COLLECTED filter, netAmount sum — on the admin person page, feeding the same finalPosition call. **Differs:** Quote verified verbatim at app/admin/(protected)/people/[id]/page.tsx:164-167.
  - `scripts/verify-cycle-close-money.mts:108` `[script]` — The verification script recomputes per-member receivedNet from the payout rows itself rather than calling the app code it checks, so its copy of the COLLECTED-net rule can drift from cycle-close.ts. **Differs:** Quote verified verbatim at scripts/verify-cycle-close-money.mts:108-112.

### 15. Elapsed flag stamped on each week of the series

- **Canonical:** `lib/dashboard.ts:286`
- **Also implemented at (6):**
  - `lib/dashboard.ts:156` — cashSeries applies the same week-number comparison to stamp its own points, rather than sharing receiptsByWeek's. **Differs:** Quote verified verbatim (indented eight spaces here, six at the canonical).
  - `lib/dashboard.ts:546` — memberAttention decides which weeks are inside the elapsed boundary by bounding its own loop with the same comparison. **Differs:** Quote verified verbatim; it is the condition clause of a for-loop opening at :544. Expressed as a loop bound over a range rather than a per-week boolean, intersected with the member's finish week.
  - `scripts/verify-cycle-position.mts:144` `[script]` — Re-derives the elapsed boundary per payment row instead of reading the stamped flag on the series. **Differs:** Quote verified verbatim. Applied to flat payment rows rather than week rows.
  - `scripts/audit-position-figures.mts:229` `[script]` — The by-hand recomputation applies its own elapsed comparison per week. **Differs:** Quote verified verbatim.
  - `scripts/audit-position-figures.mts:241` `[script]` — A second application of the same comparison, over flat payment rows, for handCollected. **Differs:** Quote verified verbatim.
  - `scripts/diagnose-paid-ahead.mts:92` `[script]` — Re-applies the elapsed boundary per payment row to reproduce what the page reports. **Differs:** Quote verified verbatim. The negation of the flag.

### 16. Payout net, live (Payout.netAmount — what crosses the table)

- **Canonical:** `app/actions/wheel.ts:697`
- **Also implemented at (6):**
  - `app/actions/week-winners.ts:511` — movePayoutToWeek recomputes the net from scratch as gross minus fee and overwrites the column, rather than reversing what was taken out of it. **Differs:** Quote verified verbatim at line 511. A blunt reset: it discards any carry deduction as well as the old settlement (the comment at :506-510 says the ledger half must be restored separately).
  - `app/admin/(protected)/collections/collections-view.tsx:917` — The client derives a proposed net by subtracting the member's outstanding (capped at the current net) and puts it in the edit field that is then written to netAmount. **Differs:** CORRECTION: previously cited as :918; the quoted pair begins at line 917 (setNet is line 918). Round-trips through dollars as a float; the deduction is proposed here rather than by the settlement modules.
  - `scripts/lib/production-fixture.mts:232` `[script]` — Computes the live net in one expression — gross minus fee minus the winner's own-week settlement — and writes it to netAmount at :242. **Differs:** Quote verified verbatim at line 232. Folds the settlement into the initial write instead of writing gross-minus-fee and letting the settlement decrement it, as settleWinnerWeeks does.
  - `scripts/verify-week-winners.mts:203` `[script]` — The script performs the gross-minus-fee reset itself to simulate a move, rather than calling the action that owns it. **Differs:** Quote verified verbatim at line 203.
  - `scripts/verify-draw-cascade.mts:151` `[script]` — A second script repeats the same gross-minus-fee reset when moving a payout between draws. **Differs:** Quote verified verbatim at line 151.
  - `scripts/verify-payout-invariants.mts:170` `[script]` — Re-derives the live-net formula independently to assert the stored column matches it — retained under the scripts/ rule, since a script that recomputes a quantity to verify it can drift from the app. **Differs:** Quote verified verbatim at line 170. The same formula is re-derived a second time at :175 as gross - fee - net === settlement.

### 17. Week total net, before and after a winner edit

- **Canonical:** `lib/week-winners.ts:130`
- **Also implemented at (6):**
  - `lib/manual-payout.ts:104` — weekChoice sums the week's payout nets with its own reduce to state what a replacement would destroy. **Differs:** Quote verified verbatim at line 104.
  - `lib/undo-draw.ts:46` — undoDrawConsequences sums the same set of payout nets for the week being undone. **Differs:** Quote verified verbatim at line 46.
  - `app/admin/(protected)/collections/page.tsx:225` — The server component builds each week option's total by reducing that draw's payout nets inline. **Differs:** Quote verified verbatim at line 225.
  - `app/admin/(protected)/collections/collections-view.tsx:397` — The client re-reduces the group's payout nets for the week subtotal, though the server already computed a total for the same rows. **Differs:** Quote verified verbatim at line 397.
  - `app/actions/manual-payout.ts:315` — The replace path sums the outgoing draw's payout nets itself, inside the transaction, for the audit line. **Differs:** Quote verified verbatim at line 315.
  - `app/actions/manual-payout.ts:518` — Sums the nets of the payouts just created to report the new week total. **Differs:** Quote verified verbatim at line 518.

### 18. Total received to date (whole-cycle cash in)

- **Canonical:** `lib/dashboard.ts:50`
- **Also implemented at (6):**
  - `app/actions/cycle-close.ts:260` — Sums the whole cycle's money in by adding each member's derived standing.totalPaid, rather than adding the payment rows. **Differs:** Quote verified verbatim at that line. Different base: Σ standing.totalPaid (engine output per member) instead of Σ Payment.amountPaid.
  - `lib/cycle-close.ts:234` — Adds the whole-cycle received total by summing every archived WEEK's received figure. **Differs:** Quote verified verbatim. Third base: Σ per-week received rather than Σ payment rows or Σ member totalPaid.
  - `scripts/import-cycle.mts:244` `[script]` — Accumulates every imported payment's amount into a running whole-cycle total, then compares it against a hardcoded expectation at :324 (`totalCollectedCents: collectedCents`) and rolls the transaction back on mismatch. **Differs:** Quote verified verbatim; the :324 comparison was also opened and confirmed.
  - `scripts/audit-position-figures.mts:270` `[script]` — Recomputes total received from the flattened raw payment rows by hand, then asserts it equals cash.totalReceived at :285. **Differs:** Quote verified verbatim; the assertion at :285 was confirmed.
  - `scripts/verify-cycle-close-money.mts:92` `[script]` — Nested reduce over participations and their payment rows producing the whole-cycle received total independently of lib/dashboard.ts. **Differs:** Quote verified verbatim at lines 92-95.
  - `scripts/verify-participation-close.mts:118` `[script]` — Sums received across EVERY series week (no elapsed filter) to produce the whole-cycle received figure the close assertions are made against. **Differs:** Quote verified verbatim.

### 19. Outstanding / shortfall, whole cycle, and will-not-arrive

- **Canonical:** `lib/cycle-position.ts:217`
- **Also implemented at (6):**
  - `components/charts/collected-vs-expected-chart.tsx:75` — Performs the expected-minus-received subtraction floored at zero to produce the chart's own 'overdue across closed weeks' headline. **Differs:** Quote verified verbatim. No stopped-member (willNotArrive) subtraction at all.
  - `app/admin/(protected)/cash/page.tsx:63` — Subtracts all cash ever received from the whole-series expected total, floored at zero, for the 'Short' card. **Differs:** Quote verified verbatim. Whole-series expectation minus ALL cash received (including paid-ahead money), where the canonical uses the elapsed slice only and sorts out the stopped members' share.
  - `lib/dashboard.ts:264` — Computes the same floored expected-minus-received gap for a single week inside weekReceipts. **Differs:** Quote verified verbatim. One-week scope rather than the whole cycle — kept because the two UI sites below re-derive this exact figure instead of reading the row it produces.
  - `app/admin/(protected)/cash/page.tsx:266` — Recomputes the one-week floored gap in the By-week table rather than reading the `shortfall` already on the row. **Differs:** Quote verified verbatim. One-week scope; duplicates lib/dashboard.ts:264 rather than the whole-cycle figure.
  - `app/admin/(protected)/this-week/page.tsx:121` — Performs the same floored subtraction for the one week on screen instead of reading the row's shortfall. **Differs:** Quote verified verbatim. One-week scope.
  - `scripts/audit-position-figures.mts:278` `[script]` — Re-derives the floored gap and re-adds shortfall and willNotArrive to check the split reconciles. **Differs:** Quote verified verbatim at lines 278-282.

### 20. Stopped member's hole — already paid out (net of their COLLECTED payouts)

- **Canonical:** `app/actions/participation-close.ts:137`
- **Also implemented at (6):**
  - `app/actions/cycle-position.ts:231` — Builds the per-member COLLECTED-payout total itself, then assembles the whole stopped-member hole inline at :237-287 rather than through closePlan. **Differs:** CANONICAL CORRECTED: the entry named lib/participation-close.ts:309 as canonical, but that location is only the `closePlan` parameter declaration (`/** Net cents of their COLLECTED payouts … */ alreadyPaidOut: number;`) — a type declaration that computes nothing and would fail the strict test. Canonical moved to app/actions/participation-close.ts:137, the close path that actually derives the figure; its quote was read and verified at lines 137-140. This duplicate's own quote is verbatim at lines 231-236.
  - `app/actions/dashboard.ts:280` — A third inline derivation of the same per-member already-paid-out figure, for the dashboard's stopped list. **Differs:** Quote verified verbatim at lines 280-285.
  - `app/actions/member.ts:157` — The same per-member COLLECTED-nets sum, for the member portal's stopped record. **Differs:** Quote verified verbatim at lines 157-160.
  - `app/admin/(protected)/people/[id]/page.tsx:164` — The same sum again, on the admin person page, feeding finalPosition. **Differs:** Quote verified verbatim at lines 164-167.
  - `scripts/audit-position-figures.mts:162` `[script]` — Rebuilds the per-member paid-out map and then the whole stoppedBy cluster (:170-197) from raw rows. **Differs:** Quote verified verbatim at lines 162-169.
  - `scripts/verify-participation-close.mts:399` `[script]` — Decides each stopped member's already-paid-out figure by identity against a single queried COLLECTED payout, in place of summing their payouts. **Differs:** Quote verified verbatim. Identity check, not a status filter over all their payouts.

### 21. Is there anything to chase this member about (the chasing gate)

- **Canonical:** `lib/messages.ts:174`
- **Also implemented at (5):**
  - `lib/messages.ts:224` — placeholderValues runs the same LATE filter itself for the {lateWeeks} token rather than reusing the gate. **Differs:** Quote VERIFIED verbatim at :223-225 (the prior audit cited :224; the statement begins at :223). Produces the week numbers rather than a boolean, but the predicate is the same and is written out again.
  - `app/actions/messages.ts:435` — prepareBatch re-filters the standing's weeks for LATE to decide which members a chasing type applies to. **Differs:** Quote VERIFIED verbatim. Used as `lateWeeks.length > 0` at :440 — the same test hasChaseableWeeks makes, written again on the batch path. CORRECTION: the prior audit cited that test at :439; it is at :440.
  - `app/actions/member.ts:300` — The member portal counts LATE weeks itself for its own summary. **Differs:** Quote VERIFIED verbatim. A count rather than a boolean; same predicate.
  - `scripts/deferral-impact.mts:158` `[script]` — The script counts LATE weeks itself on both sides of its before/after comparison (:158 and :159). **Differs:** Quote VERIFIED verbatim, as is :159.
  - `scripts/elapsed-rule-impact.mts:136` `[script]` — The script performs the same LATE filter to report how many weeks read late today. **Differs:** Quote VERIFIED verbatim.

### 22. Which members count as behind on the payments members list

- **Canonical:** `lib/members-view.ts:60`
- **Also implemented at (5):**
  - `lib/cycle-close.ts:155` — finalBalanceEntries decides who is short with its own outstanding-above-zero test before writing a debt entry. **Differs:** Quote VERIFIED verbatim. Note the canonical names a payments-screen filter while these sites decide a cycle-close population; what they share is the predicate, written out separately at each.
  - `lib/cycle-close.ts:256` — The archive totals count short members with the same test, performed again. **Differs:** Quote VERIFIED verbatim.
  - `lib/cycle-position.ts:218` — collectionPosition applies its own above-zero filter to decide who appears as owing. **Differs:** Quote VERIFIED verbatim. Callers already filter the same way before passing owedBy in, so the test runs twice on that path.
  - `app/actions/cycle-close.ts:295` — The close action counts short members with its own copy of the test, beside lib/cycle-close.ts:256. **Differs:** Quote VERIFIED verbatim. Two counts of the same population on one screen.
  - `lib/dashboard.ts:582` — memberAttention decides membership of the behind list from its own owed-above-zero test. **Differs:** Quote VERIFIED verbatim. Expressed as owed === 0 rather than owed > 0; combined with :567 it requires BOTH behind and owing.

### 23. Weeks paid and weeks behind as the database computes them (member_progress view)

- **Canonical:** `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:33`
- **Also implemented at (5):**
  - `lib/derived.ts:122` — The TypeScript root for weeks_paid — the same quotient, computed independently of the view. **Differs:** Quote VERIFIED verbatim at :122 and :127. Uncapped; the view caps at weeksCommitted. Divides integer cents; the view divides through numeric then casts to int. This entry restates, from the SQL side, the same pairing recorded in the weeks-credited and weeks-behind entries above.
  - `lib/derived.ts:138` — The TypeScript root for weeks_behind — the same subtraction and floor, fed by weekCountsAsDue rather than by a SQL date predicate. **Differs:** Quote VERIFIED verbatim at :138-146. Its elapsed term includes weeks the organizer marked late by hand; the view never reads markedLateAt. /me shows this figure and /me/group shows the view's.
  - `scripts/verify-member-privileges.mts:65` `[script]` — The script carries its own copy of the view's SQL and runs it directly, because the view is auth.uid()-scoped and returns nothing for a service connection. **Differs:** Quote VERIFIED verbatim at :65-69. Its excused filter (:74-75) still counts personal deferrals as excused, matching the SUPERSEDED 20260805150000 view rather than the live one. CORRECTION: the two superseded migration definitions (20260805150000:67 and 20260804230000:157) were claimed as duplicates here; both quotes are accurate, but each is a prior CREATE OR REPLACE of this same view object rather than a parallel implementation, so they were dropped. The 20260804230000 version differed materially — its elapsed term was a week number projected off cycle.startDate (cw.week_no at :149), verified.
  - `scripts/verify-member-privileges.mts:95` `[script]` — A third computation of both columns, by hand in TypeScript, to compare against the two above. **Differs:** Quote VERIFIED verbatim at :95-97. Its excused (:90-93) counts personal deferrals, unlike lib/derived.ts.
  - `scripts/elapsed-rule-impact.mts:213` `[script]` — A second script carrying its own copy of the view arithmetic, run with $queryRawUnsafe. **Differs:** Quote VERIFIED verbatim at :213-220. Interpolates PAYMENT_WINDOW_DAYS at :234 instead of the literal 5 the migration uses, so this copy and the view diverge if the constant changes.

### 24. Weeks committed (a member's commitment length)

- **Canonical:** `prisma/schema.prisma:188`
- **Also implemented at (5):**
  - `lib/money.ts:129` — remainingWeeksInCycle computes the default/cap figure — the inclusive count of weeks from a start week to the planned end. **Differs:** Quote verified verbatim.
  - `lib/commitment.ts:48` — weeksToFinishWithGroup decides the default commitment length with clamping rules the primitive does not have. **Differs:** Quote verified verbatim. Applies its own two clamps — start week clamped to plannedWeeks, result floored at 1 — on top of the primitive it calls.
  - `app/admin/(protected)/payments/payments-grid.tsx:352` — Recomputes the window length from finishWeek and startWeek rather than reading weeksCommitted. **Differs:** Quote verified verbatim; the identical expression repeats on :353 for the non-presentation branch, also verified.
  - `app/admin/(protected)/payments/payments-grid.tsx:357` — Recomputes the window length at the surface. **Differs:** Quote verified verbatim. The same inverse a third time in the same component, for the visible figure.
  - `app/admin/(protected)/payments/payments-members.tsx:256` — Recomputes the window length at the surface. **Differs:** Quote verified verbatim. The same inverse in a second component.

### 25. Received for a week

- **Canonical:** `lib/dashboard.ts:250`
- **Also implemented at (5):**
  - `lib/payments-view.ts:222` — buildPaymentGrid accumulates the week row's received itself, adding each grid cell's storedPaid as it walks the members. **Differs:** Only reached for cells inside the member's start..finish range (:217-221) and only when a week row exists, so money on a row outside the window is not added. The canonical adds every payment row on the week before any window test. Quote verified verbatim at line 222.
  - `lib/dashboard.ts:128` — cashSeries builds its own per-week received map from the flat payment list, keyed by weekNumber, with its own accumulator; the map is read back into each series row at :147. **Differs:** Same week attribution and same no-filter rule as the canonical, computed in a separate function over a separately shaped input list. Quote verified verbatim at line 128.
  - `app/actions/cycle-close.ts:178` — Re-sums the week's money by walking participations and picking each one's row for that week, producing the figure frozen into the archive. **Differs:** Attributes by weekId rather than weekNumber, and takes at most ONE payment row per participation per week (`.find`), where the canonical adds every row filtered to that weekNumber. Quote verified verbatim: lines 178-181.
  - `scripts/verify-cycle-close-money.mts:137` `[script]` — Independently re-sums each week's money from the fixture's participations to feed buildArchiveData and check the close figures. **Differs:** Same weekId-keyed, one-row-per-participation shape as app/actions/cycle-close.ts:178, written out a second time in the script. Quote verified verbatim: lines 137-140.
  - `scripts/diagnose-paid-ahead.mts:94` `[script]` — Buckets the flat receipt rows by week number and sums the amounts with its own `sum` helper (applied at :102, :106, :110) to report the money attributed to one week. **Differs:** Same no-window, no-deferral rule as the canonical; built from rows pre-filtered to amountPaid > 0 at :84. Quote verified verbatim: lines 94-96 (line 95 is blank). Note that the cited line :94 is the week filter alone — the arithmetic that finishes the quantity is the `sum` helper at :96, invoked at :106.

### 26. Committed to winners / owed now / pending (drawn but not handed out)

- **Canonical:** `lib/dashboard.ts:62`
- **Also implemented at (5):**
  - `lib/waiting.ts:148` — Sums netAmount across the awaiting-payment rows — which app/actions/waiting.ts:83 loads as `where: { status: "PENDING", luckyNumber: { cycleId: cycle.id } },` — producing the same total under the name 'owed now'. **Differs:** Quote verified verbatim, and the PENDING where-clause at app/actions/waiting.ts:83 was opened and confirmed.
  - `app/admin/(protected)/collections/page.tsx:232` — Filters the cycle's payouts to PENDING and sums their netAmount for the 'Still owed' card. **Differs:** Quote verified: the filter is line 230, the reduce line 232.
  - `lib/cycle-close.ts:239` — Rolls the archive's pending total up from each member's pendingNet. **Differs:** Quote verified verbatim. The per-member figure it sums is selected as `status !== "COLLECTED"` (app/actions/cycle-close.ts:130, confirmed), not `status === "PENDING"`.
  - `scripts/verify-cycle-close-money.mts:91` `[script]` — Sums netAmount over the separately-queried PENDING payouts to form the expected pending total. **Differs:** Quote verified verbatim.
  - `scripts/audit-position-figures.mts:290` `[script]` — Recomputes the drawn-but-not-handed-out total from raw rows and asserts it equals holding.drawnNotHandedOut. **Differs:** Quote verified verbatim at lines 290-292. Selects `status !== "COLLECTED"` rather than `status === "PENDING"`.

### 27. Shortfall the organizer must cover himself (shortfallToCover / toCover)

- **Canonical:** `lib/participation-close.ts:336`
- **Also implemented at (5):**
  - `app/actions/cycle-position.ts:264` — Makes the paid-out-or-not decision itself in an inline ternary rather than calling closePlan. **Differs:** Quote verified verbatim.
  - `app/actions/dashboard.ts:300` — The same ternary again, for the dashboard's stopped list. **Differs:** Quote verified verbatim.
  - `scripts/audit-position-figures.mts:190` `[script]` — Inlines the same ternary when building the script's stoppedBy rows. **Differs:** Quote verified verbatim.
  - `scripts/audit-position-figures.mts:329` `[script]` — A SECOND copy in the same file: re-applies the paid-out filter and re-multiplies the leaving weeks (:337-341) to produce the by-hand toCover total. **Differs:** Quote verified verbatim at lines 329-331.
  - `scripts/verify-participation-close.mts:405` `[script]` — Decides shortfallToCover by member identity and recomputes the amount inline. **Differs:** Quote verified verbatim at lines 405-407. Keyed on which fixture member was paid out rather than on a payout status check.

### 28. Percent of my weeks paid (the "You" ring), and weeks remaining

- **Canonical:** `components/member/member-personal-summary.tsx:39`
- **Also implemented at (5):**
  - `components/member/member-personal-summary.tsx:59` — Executes the percent formula a second time — same divide, same *100, same Math.round, same Math.min cap, same zero-denominator guard — against the animating count `n`. The number rendered while the count-up runs comes from this arithmetic, not from `pct`. **Differs:** Quote verified verbatim at components/member/member-personal-summary.tsx:59. Identical formula, different numerator (the interpolated count).
  - `components/member/member-group-list.tsx:84` — Divides the viewer's weeks paid by their weeks committed, multiplies by 100 and caps at 100, producing the /me/group header percent by its own arithmetic. **Differs:** Quote verified verbatim at components/member/member-group-list.tsx:84-85. No Math.round, so it yields a fractional percent where the /me ring rounds; its weeksPaid comes from the SQL member_progress view rather than computeStanding.
  - `app/admin/(protected)/people/people-directory.tsx:259` — Performs the weeks-paid-over-weeks-committed division, *100, rounding and 100-cap inline in the style attribute to size the directory progress bar. The percent exists only because this expression computes it. **Differs:** Quote verified verbatim at app/admin/(protected)/people/people-directory.tsx:259. Has no `weeksCommitted > 0` guard, unlike the canonical, so a zero denominator would yield NaN rather than 0.
  - `app/admin/(protected)/waiting/waiting-view.tsx:471` — Computes the same weeks-paid-over-weeks-committed completion ratio, with its own zero-denominator guard and cap, for the waiting row's bar (scaled to a percent at :516). **Differs:** Quote verified verbatim at app/admin/(protected)/waiting/waiting-view.tsx:471-472. Expressed as a 0..1 fraction capped at 1 rather than a rounded 0..100 percent.
  - `lib/messages.ts:219` — Subtracts weeks paid from weeks committed and floors the result at zero — the same subtraction as member-personal-summary.tsx:40 — to fill the {weeksLeft} and {paymentsLeft} message placeholders. **Differs:** Quote verified verbatim at lib/messages.ts:219. Its numerator is `Math.min(standing.weeksCredited, standing.weeksCommitted)` computed one line above (:218), where the component receives paidCount already capped by app/actions/member.ts:349.

### 29. Amount recorded on a week's row (stored per-week paid)

- **Canonical:** `app/actions/payments.ts:249`
- **Also implemented at (4):**
  - `lib/rebuild.ts:64` — applyToWeek maintains the stored aggregate itself during the replay — incrementing here, or creating the row at :71 with `amountPaid: applied` — a second write regime for the same column, outside the recording path. **Differs:** CORRECTED SCOPE: the previous entry also listed lib/rebuild.ts:53 (`data: { amountPaid: 0 }`) as a separate implementation; that line is an unconditional reset with no arithmetic, so it is dropped — but it is what makes this a distinct regime, since the replay zeroes every row before re-incrementing it.
  - `lib/draw-settlement.ts:140` — settleWinnerWeeks writes the week row's aggregate directly (or creates it at :147 with `amountPaid: deduction.deduct`), bypassing both the recording path and the replay.
  - `lib/draw-settlement.ts:202` — unsettleDraw decrements the stored aggregate itself to reverse a draw's settlements.
  - `lib/draw-settlement.ts:232` — unsettlePayout decrements the same aggregate again in a separately written loop, scoped to one payout.

### 30. Whether a week counts as due now (the arithmetic gate for behind and outstanding)

- **Canonical:** `lib/derived.ts:95`
- **Also implemented at (4):**
  - `lib/dashboard.ts:543` — memberAttention builds its own set of due weeks without calling weekCountsAsDue: a week-NUMBER range against elapsedThroughWeek (:544-550), then the deferral-beats-mark test re-written by hand at :555 and the marked-week add at :556-558. **Differs:** Quote VERIFIED verbatim at :543-558. Decides dueness by week NUMBER against a cycle-level boundary, not by each week row's own stored date. A week whose row date is out of sequence with its number lands differently here than in weekCountsAsDue.
  - `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:62` `[SQL]` — The live member_progress view decides the due set entirely in SQL with its own date comparison and its own literal 5-day window. **Differs:** Quote VERIFIED verbatim. markedLateAt is never consulted, so the organizer's own mark cannot make a week due on this path. The 5 is a SQL literal, not PAYMENT_WINDOW_DAYS. CORRECTION TO THE PRIOR AUDIT: two further migration lines were claimed (20260805150000:100 and, for the elapsed term, 20260804230000) — both quotes are real, but each is a superseded CREATE OR REPLACE of THIS SAME view object, replaced by this migration. They are prior revisions of one implementation, not additional parallel ones, and cannot drift; dropped.
  - `scripts/verify-member-privileges.mts:89` `[script]` — Builds the due set from a hand-written UTC-day comparison with a literal 5, rather than calling weekCountsAsDue or weekHasElapsed. **Differs:** Quote VERIFIED verbatim. No mark and no deferral input. The same file also replays the gate in SQL at :79 (`AND current_date >= (w.date::date + 5)`), verified.
  - `scripts/elapsed-rule-impact.mts:60` `[script]` — elapsedByStoredDate re-implements the day arithmetic in the script and is what :73 filters the window with. **Differs:** Quote VERIFIED verbatim. Takes PAYMENT_WINDOW_DAYS from the shared constant but performs the comparison itself; no mark, no deferral. The same script replays the SQL predicate at :234, verified. CORRECTION: scripts/audit-position-figures.mts:229 was also claimed here; its quote is real but its `elapsed` comes from `elapsedThroughWeek(cycle.weeks, today)` at :63 — the shared lib/commitment.ts helper — so :229 applies a canonical boundary rather than deriving one. Dropped.

### 31. Weeks elapsed in a member's own window

- **Canonical:** `lib/standing.ts:164`
- **Also implemented at (4):**
  - `lib/dashboard.ts:561` — The count comes from the set memberAttention built itself at :543-559 (week-number range plus marked weeks), never from each row's own date. **Differs:** Quote VERIFIED verbatim at :561. NOTE ON THE EVIDENCE: the quoted line alone only reads a set's size; the derivation it counts is at :543-559 (quoted in full under the due-now entry). Counts week NUMBERS in a range; lib/standing.ts counts week ROWS by their own stored dates.
  - `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:54` `[SQL]` — Counts the member's window weeks whose stored date plus five days has passed (predicate at :59-62) entirely in SQL. **Differs:** Quote VERIFIED verbatim, with its predicate at :58-62. Window is a plain startWeek..startWeek+weeksCommitted range; ParticipationBreak is ignored, and markedLateAt is never read. CORRECTION: 20260805150000:87 (`count(*) AS elapsed,`) and 20260804230000:159 (`least(cw.week_no - pt."startWeek" + 1, pt."weeksCommitted")`) both quote accurately, but both are superseded revisions of this same view object; dropped as prior versions rather than parallel implementations. The 20260804230000 version was materially different — it projected elapsed off cycle.startDate with no week-row scan.
  - `scripts/verify-member-privileges.mts:89` `[script]` — closed.length is the script's own elapsed count for the member's window, used at :96; the same count is also computed in SQL at :73 (`SELECT count(*) AS elapsed,`). **Differs:** Quote VERIFIED verbatim.
  - `scripts/elapsed-rule-impact.mts:73` `[script]` — Filters the member's window itself to produce the elapsed set, then feeds a synthesised cycleWeek into computeStanding. **Differs:** Quote VERIFIED verbatim. Also computed a second time in SQL in the same file at :226-235.

### 32. Payment status of one week (PAID / PARTIAL / LATE / UNPAID / DEFERRED / SKIPPED)

- **Canonical:** `lib/derived.ts:169`
- **Also implemented at (4):**
  - `lib/chart.ts:186` — A complete parallel five-state ladder derived straight from raw cents, isDeferred and a caller-supplied windowClosed flag. **Differs:** Quote VERIFIED verbatim at :186-197 (the prior audit omitted the `windowClosed` doc comment at :190; the code lines are exact). Ordered differently — deferred is tested ABOVE paid here, the reverse of paymentStatus. No isSkipped and no markedLate input, and windowClosed is decided by the caller rather than from the week's date.
  - `lib/payments-view.ts:130` — splitWeekRoster decides settled-versus-owing for the week roster from raw cents and the deferral flag rather than from a derived status. **Differs:** Quote VERIFIED verbatim. Files a deferred member under "paid", the opposite of lib/dashboard.ts:253 which drops a deferred member from what the week expected.
  - `lib/dashboard.ts:257` — weekReceipts performs the PAID comparison on raw stored cents to count members paid; the deferral branch is at :253 (`if (payment?.isDeferred) continue;`) and the skipped branch at :252 (`if (!inWindow || input.isSkipped) continue;`). **Differs:** Quote VERIFIED verbatim, as are :252 and :253. Compares the STORED amountPaid, not coverage at the current rate, so it can disagree with the grid after a rate change.
  - `app/admin/(protected)/cycle/position/week-dates.ts:111` — membersAffectedByWeekDate runs its own money-covers test and its own mark test to decide whose standing a week's date settles. **Differs:** Quote VERIFIED verbatim at :111 and :113. A deliberately different set from membersShort — the file's own comment says so — but the PAID and marked-late comparisons are performed here rather than read from a status. CORRECTION: scripts/import-cycle.mts:215 was claimed here; its quote is accurate, but it runs the mapping INVERSE — it consumes a status word from an import file and produces amountPaid/isDeferred. It does not produce a payment status, so it is not another implementation of this quantity. Dropped.

### 33. Last payment week

- **Canonical:** `lib/standing.ts:199`
- **Also implemented at (4):**
  - `app/actions/dashboard.ts:117` — Computes the member's latest week carrying money itself, from the filter at :112 (`const paid = p.payments.filter((pm) => pm.amountPaid > 0).map((pm) => pm.week.weekNumber);`). **Differs:** Quote VERIFIED verbatim, as is the :112 filter. A MAXIMUM over week numbers; lib/standing.ts takes the LAST ELEMENT of an assumed-ascending array. The two agree only when the caller ordered the rows.
  - `app/actions/cycle-position.ts:130` — The position action's breaksOf helper performs the same filter (:125) and maximum. **Differs:** Quote VERIFIED verbatim, as is the :125 filter. Same max-versus-last-element difference.
  - `app/admin/(protected)/cycle/position/week-dates-data.ts:84` — A third copy of the same filter (:79) and maximum, for the week-dates panel. **Differs:** Quote VERIFIED verbatim, as is the :79 filter. Same max-versus-last-element difference.
  - `scripts/audit-position-figures.mts:81` `[script]` — The audit script recomputes it by hand from the raw payment rows (filter at :76). **Differs:** Quote VERIFIED verbatim, as is the :76 filter.

### 34. Selected week (which week a screen is showing)

- **Canonical:** `app/actions/dashboard.ts:92`
- **Also implemented at (4):**
  - `lib/payments-view.ts:100` — resolveTargetWeek independently decides which week the board shows from requested/cycleWeek/row-set. **Differs:** Quote verified verbatim at :100-104. Five-branch ladder rather than two: it also falls back to the LAST week when the clock has run past the cycle, and to the FIRST week otherwise.
  - `lib/week-focus.ts:36` — focusedWeek performs its own parse-and-range decision producing the week a screen shows. **Differs:** Quote verified verbatim at :36-40. Range-checks against a caller-supplied count and returns null rather than falling back to the current week; also resolves a repeated ?week param by taking the first (:31).
  - `app/admin/(protected)/this-week/page.tsx:50` — Independently decides, from the URL, whether a requested week is forwarded or the default answers. **Differs:** Quote verified verbatim at :50-53. A fourth parse rule — Number.parseInt accepts "7abc" where lib/week-focus.ts's regex does not — and it decides whether ?week reaches the action at all.
  - `app/me/schedule/page.tsx:39` — The member portal decides for itself which of their weeks the calendar opens on. **Differs:** Quote verified verbatim. Picks the first week at or after the cycle week rather than an exact match, and falls back to their first week rather than to the current one.

### 35. The date of a week number

- **Canonical:** `lib/commitment.ts:90`
- **Also implemented at (4):**
  - `lib/money.ts:153` — dateOfWeek performs the seven-day projection itself; resolveWeekDate delegates to it only after the stored lookup misses. **Differs:** Quote verified verbatim. The raw projection with no stored-row precedence at all.
  - `lib/money.ts:141` — generateWeekDates performs the same seven-day projection in its own loop rather than calling dateOfWeek. **Differs:** Quote verified verbatim. Zero-indexed (i) rather than one-indexed (weekNumber − 1); creation-time only.
  - `lib/commitment.ts:140` — nextWeekDates projects new week dates from its own anchor — a write-side rule that can produce a different day than resolveWeekDate for the same week number. **Differs:** Quote verified verbatim. Anchored on the LAST STORED row rather than on the cycle start date, and uses a literal 7 with a module-local MS_PER_DAY rather than DAYS_PER_WEEK.
  - `app/actions/cycle-close.ts:206` — Projects the final week's date inline as the fallback when no week rows exist. **Differs:** Quote verified verbatim; it is the `??` fallback arm of the statement opening at :204. Literal 7 and literal 86_400_000; no stored-row precedence.

### 36. Effective finish week (where a stopped member's window actually ends)

- **Canonical:** `lib/participation-close.ts:133`
- **Also implemented at (4):**
  - `lib/participation-close.ts:169` — legacyBreak derives the ending point itself from the receipts rather than from a stored break. **Differs:** Quote verified verbatim at :169-170. A different rule for the same boundary: for a CLOSED participation the window is read as ending after their last week carrying money, or before their start week if they never paid.
  - `app/actions/participation-close.ts:453` — Computes the break's opening week itself when creating the missing break row. **Differs:** Quote verified verbatim. Rebuilds legacyBreak's arithmetic inline but DROPS the lastWeekWithMoney middle term, so a closed row with no closedAtWeek lands on startWeek rather than on their last paid week.
  - `app/actions/participation-close.ts:459` — Derives the effective finish week back out of the open break's start, rather than calling effectiveFinishWeek. **Differs:** Quote verified verbatim.
  - `prisma/migrations/20260811020000_participation_breaks/migration.sql:42` `[SQL]` — The backfill computes each closed member's stopping point entirely in SQL. **Differs:** Quote verified verbatim at :42-49. The full three-term COALESCE including the last-paid-week lookup — matching lib/participation-close.ts:169 and not the inline copy at app/actions/participation-close.ts:453.

### 37. Cycle length (planned weeks) and the cycle's own finish

- **Canonical:** `lib/commitment.ts:263`
- **Also implemented at (4):**
  - `app/actions/cycles.ts:109` — Decides the active cycle's real final date for the new-cycle overlap rule, by its own date comparison. **Differs:** Quote verified verbatim at :109-110. A DIFFERENT rule from the canonical: the real end is the LATER of the planned finish date and the last stored row, so a cycle running long ends later here than cycleFinishPreview says.
  - `app/admin/(protected)/cycles/new/page.tsx:53` — The page computes the active cycle's real final date itself to bound the picker. **Differs:** Quote verified verbatim at :53-58. The same later-of-two comparison rebuilt on the page rather than shared with app/actions/cycles.ts:109.
  - `app/actions/cycle-close.ts:204` — Decides the cycle's final week date for the close wait, projecting it itself when no rows exist. **Differs:** Quote verified verbatim at :204-206. A third rule: the LAST STORED ROW always wins, with an inline projection only when no rows exist — it never compares against the planned finish.
  - `lib/member-history.ts:167` — Derives an archived cycle's finish date from the snapshot by sorting and selecting the last row itself. **Differs:** Quote verified verbatim at :167-171. A rule of its own for an ARCHIVED cycle: sort the snapshot's week rows and take the last, falling back to closedAt.

### 38. Winner's own-week contribution settled FROM the payout

- **Canonical:** `lib/settlement.ts:43`
- **Also implemented at (4):**
  - `lib/settlement.ts:72` — allocatePinned re-derives the same owed-then-cap arithmetic for the replay path, with its own skipped test, instead of sharing the shortfall computation above it. **Differs:** Quote verified verbatim at lines 72-73. CORRECTION to the canonical only: cited as :35 (the function signature); shortfall is at :43 and the deduct cap at :48. Caps against the amount being replayed rather than against a payout's net.
  - `lib/draw-settlement.ts:103` — The write path decides for itself what the winner owes on the drawn week — its own window test and its own skipped-only excuse — before handing a figure to planWinnerWeekSettlement. **Differs:** CORRECTION: the previously elided quote is now the verbatim contiguous block, lines 103-108.
  - `lib/week-winners.ts:161` — settlementFor is a second complete derivation of the same figure: its own finish-week arithmetic, its own window test, its own skipped-only excuse and its own weekly-minus-already-paid remainder. **Differs:** Quote verified verbatim at lines 161-166. Inlines the finish week rather than calling calculateFinishWeek, and never caps against the payout's net the way planWinnerWeekSettlement does.
  - `lib/standing.ts:121` — Decides how much of a payout settlement lands on its week with its own skipped test and its own cap, rather than calling allocatePinned. **Differs:** CORRECTION: previously cited as :123; the quoted block begins at line 121 (the Math.min is line 123). Caps at the week's full amountDue, whereas allocatePinned caps at amountDue minus what the week already holds.

### 39. Owed now vs eventually owed (the waiting list)

- **Canonical:** `lib/waiting.ts:148`
- **Also implemented at (4):**
  - `lib/dashboard.ts:62` — cashPosition accumulates the net of every non-COLLECTED payout itself — the same set of rows owedNow sums, under the name committedPending. **Differs:** Quote verified verbatim at line 62. CORRECTION to the canonical only: cited as :140 (the function signature); owedNow is at :148 and eventualTotal at :151. Decides pending by `else` on a COLLECTED test (line 60-61) rather than by a PENDING filter, and asserts each net is valid cents first.
  - `app/admin/(protected)/collections/page.tsx:232` — Collections computes its own 'still owed' headline by filtering to PENDING (line 230) and reducing the nets. **Differs:** Quote verified verbatim at line 232.
  - `app/admin/(protected)/collections/collections-view.tsx:399` — The client repeats the filter-to-PENDING-and-sum-nets arithmetic for each week group's 'still to hand over' line. **Differs:** Quote verified verbatim at lines 399-401. Scoped to one draw group rather than the whole cycle.
  - `app/actions/cycle-close.ts:126` — The close plan sums the nets of not-yet-collected payouts with its own nested reduce to produce the still-owed figure frozen into the archive. **Differs:** Quote verified verbatim at lines 126-133. Per member rather than cycle-wide, and tests `!== "COLLECTED"` rather than `=== "PENDING"`.

### 40. Cash position per week (received, paid out, pending out, running held)

- **Canonical:** `lib/dashboard.ts:128`
- **Also implemented at (4):**
  - `app/actions/cycle-close.ts:178` — Builds the archive's per-week received by summing each participation's payment row for that week — a second per-week attribution alongside cashSeries. **Differs:** Quote verified verbatim at lines 178-181. The companion payout bucketing at :156-158 files a payout with no draw under week 0 (`?? 0`), where cashSeries folds it into the first week.
  - `lib/payments-view.ts:222` — Accumulates its own per-week received and expected while walking the grid cells, rather than reading the dashboard's series. **Differs:** Quote verified verbatim at lines 222-225. Excuses only SKIPPED weeks; lib/dashboard.ts:253 also skips deferred rows from `expected`.
  - `lib/dashboard.ts:250` — `weekReceipts` accumulates its own per-week received over participations, a second per-week received derivation in the same module as `cashSeries`. **Differs:** Quote verified verbatim.
  - `scripts/verify-cycle-close-money.mts:137` `[script]` — Re-implements the per-week received attribution to feed buildArchiveData in the verification fixture. **Differs:** Quote verified verbatim at lines 137-140.

### 41. Should have come in, whole cycle (shouldHaveCollected)

- **Canonical:** `lib/cycle-position.ts:194`
- **Also implemented at (4):**
  - `components/charts/collected-vs-expected-chart.tsx:73` — Re-filters the series to elapsed weeks (`const closed = weeks.filter((w) => w.elapsed);` at :72) and re-sums expected for the chart's own headline. **Differs:** Quote verified verbatim.
  - `app/admin/(protected)/cash/page.tsx:62` — Sums expected across the series to produce the card's 'Expected by now' figure. **Differs:** Quote verified verbatim. No elapsed filter — sums EVERY series week, while the card at :240 is labelled 'across the weeks that have elapsed' (label confirmed at that line).
  - `scripts/audit-position-figures.mts:227` `[script]` — Rebuilds the whole elapsed expectation from raw rows with its own window predicate (`inWindowByHand`, :217-223) and its own deferral/skip filters, then compares against position.shouldHaveCollected at :237. **Differs:** Quote verified verbatim at lines 227-236, and the hand-written window predicate at :217-223 was confirmed.
  - `scripts/verify-participation-close.mts:117` `[script]` — Sums expected across the whole series to produce the figure the close assertions at :174 and :185-189 are made against. **Differs:** Quote verified verbatim; the assertions at :174 and :185-189 were confirmed. Unfiltered whole-series sum rather than the elapsed slice.

### 42. Paid ahead (money on weeks that have not happened)

- **Canonical:** `lib/cycle-position.ts:226`
- **Also implemented at (4):**
  - `app/actions/cycle-position.ts:215` — Applies the after-the-current-week boundary itself to each member's payment rows and sums their amounts, deriving the per-member paid-ahead amount and week count independently of the series. **Differs:** Quote verified verbatim at lines 215-225.
  - `scripts/audit-position-figures.mts:152` `[script]` — Re-implements the per-member paid-ahead filter and sum from raw rows. **Differs:** Quote verified verbatim at lines 152-158.
  - `scripts/audit-position-figures.mts:252` `[script]` — Recomputes the group paid-ahead total from flat payment rows and asserts it equals position.paidAhead at :255. **Differs:** Quote verified verbatim at lines 252-254.
  - `scripts/diagnose-paid-ahead.mts:92` `[script]` — Computes the paid-ahead set twice, once against each boundary, and sums both (via the local `sum` helper at :96) at :102 and :110 to state the difference in money and members. **Differs:** Quote verified verbatim at lines 92-93; the two sums were confirmed at :102 and :110. Deliberately keeps the old elapsed-boundary version alongside the current-week one.

### 43. Written off / forgiven amount

- **Canonical:** `lib/ledger.ts:92`
- **Also implemented at (4):**
  - `app/actions/ledger.ts:146` — Re-performs the over-the-balance comparison from the raw inputs (`input.amount > owed`) — the same rung forgivenessRefusal evaluated at lib/ledger.ts:100 — and the refusal the organizer actually receives is produced by this branch, not by the canonical one (the canonical's `refusal` is used only in the else arm at :148). **Differs:** QUOTE CORRECTION: the two quoted lines are :146 and :147, not both at :146 (the `error:` key is at :145 and the `: refusal,` arm at :148). Text otherwise verbatim. Same `>` operator as the canonical; wording differs (formatMoney dollars here, raw cents at lib/ledger.ts:101).
  - `app/actions/ledger.ts:170` — Performs the subtraction and the zero floor itself (`Math.max(0, owed - input.amount)`) for the audit summary; the value is not read from anywhere, and the identical expression is evaluated again three lines later at :173. **Differs:** QUOTE VERIFIED verbatim at :170. CLASSIFICATION NOTE added: the figure computed here is the balance REMAINING after the write-off, not the forgiven amount or the refusal that lib/ledger.ts:92 owns — it duplicates :173 (and carried-balance.tsx:302) rather than the canonical function.
  - `app/actions/ledger.ts:173` — Evaluates the same remaining-after-write-off arithmetic a second time for the value returned to the caller. **Differs:** QUOTE VERIFIED verbatim at :173. CLASSIFICATION NOTE: as with :170 this computes the post-write-off remainder, not the refusal ladder; it is byte-identical to the recordLedgerPayment line at app/actions/ledger.ts:81, which the audit lists as a canonical of its own below.
  - `app/admin/(protected)/people/[id]/carried-balance.tsx:302` — Client-side subtraction and floor from the story balance and the typed cents, computed before any server call; it feeds the dialog body and the success sentence and never round-trips through the server figure. **Differs:** QUOTE VERIFIED verbatim at :302. Use sites confirmed: `left` renders at :315 (dialog) and :333 (success sentence) — the original note's ":314-315" is the surrounding paragraph. CLASSIFICATION NOTE: computes the post-write-off remainder, the same figure as :170/:173, not the canonical's refusal.

### 44. Amount due for one week

- **Canonical:** `lib/draw-settlement.ts:108`
- **Also implemented at (3):**
  - `lib/week-winners.ts:161` — settlementFor re-derives the finish week by hand (startWeek + weeksCommitted - 1, not via calculateFinishWeek), tests the window and the skip itself, and produces the week's cost from weeklyAmount. **Differs:** Quote verified verbatim at 161-165. Derives the finish week by hand rather than calling calculateFinishWeek, which the canonical uses at :103.
  - `lib/dashboard.ts:255` — weekReceipts writes its own ladder for one member-week — window at :245, cycle skip at :252, deferral at :253 — and, when it survives, charges the week the current weeklyAmount. **Differs:** Quote verified verbatim. A DEFERRED week contributes nothing here (`if (payment?.isDeferred) continue;` at :253), whereas the canonical rule at draw-settlement.ts:105-108 says only a SKIPPED week is excused and a deferred week is still due in full.
  - `scripts/audit-position-figures.mts:234` `[script]` — The "by hand, from the raw rows" section writes its own inWindowByHand (:217-223, including breaks), its own skip test (:229) and its own deferral test (:233), then charges the week the weekly amount. **Differs:** Quote verified verbatim. Excludes deferred weeks, unlike the canonical rule where a deferred week is still due in full.

### 45. Amount a ticked set of weeks is worth (selection total)

- **Canonical:** `lib/week-picking.ts:63`
- **Also implemented at (3):**
  - `lib/payments-view.ts:57` — Sums the shortfall of a chosen set of weeks with its own loop, its own skip test and its own clamped subtraction (:64) — the same "what do these ticked weeks add up to" figure, written separately.
  - `lib/week-picking.ts:153` — quickAmounts sums the remainders of the first N owing weeks with its own reduce rather than calling amountForWeeks.
  - `lib/week-picking.ts:163` — The "all owed" chip sums every owing week's remainder with a third, separate reduce in the same function.

### 46. Money that fits nowhere (unallocated / commit refusal)

- **Canonical:** `lib/allocation.ts:103`
- **Also implemented at (3):**
  - `lib/week-picking.ts:118` — `left` is carried down the preview's own walk (:98 initialise, :110 and :114 decrement) — the leftover is produced by that walk, not read from the engine. **Differs:** CORRECTED CANONICAL ANCHOR: the canonical was anchored at lib/allocation.ts:106 while quoting :103-107; moved to :103 so quote and line agree.
  - `lib/settlement.ts:54` — planWinnerWeekSettlement runs its own waterfall across payouts (:46-53) and computes by subtraction what could not be absorbed.
  - `lib/settlement.ts:74` — allocatePinned computes the pinned receipt's leftover by its own subtraction, independently of the engine.

### 47. Weeks behind

- **Canonical:** `lib/derived.ts:138`
- **Also implemented at (3):**
  - `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:37` `[SQL]` — A full SQL re-implementation of the subtraction and the floor at zero, over its own elapsed and excused counts. **Differs:** Quote VERIFIED verbatim at :37-42. Never sees markedLateAt, so a hand-marked week is not in its elapsed count. CORRECTION: 20260805150000:70 and 20260804230000:158 also quote accurately but are superseded revisions of this same view object; dropped as prior versions rather than parallel implementations.
  - `scripts/verify-member-privileges.mts:96` `[script]` — Recomputes the whole subtraction by hand from its own closed, excused and credited terms. **Differs:** Quote VERIFIED verbatim. Its `excused` (:90-93) counts personal deferrals as excused, unlike lib/derived.ts.
  - `scripts/elapsed-rule-impact.mts:215` `[script]` — The script carries its own copy of the view's behind arithmetic and runs it directly. **Differs:** Quote VERIFIED verbatim at :215-220. A copy of migration SQL inside a script.

### 48. Deferred (the organizer's other stored decision)

- **Canonical:** `app/actions/edits.ts:1365`
- **Also implemented at (3):**
  - `app/admin/(protected)/payments/patterns-view.tsx:55` — Re-derives the boolean from the derived cell STATUS rather than reading the stored column. **Differs:** Quote VERIFIED verbatim. Because PAID beats DEFERRED in the status ladder, a deferred week that is fully covered comes back isDeferred: false here. CORRECTION: app/actions/edits.ts:1278 (`isDeferred: input.isDeferred,`) was claimed here; the quote is accurate but the line writes the caller's input straight through with no comparison, branch or arithmetic — a second writer, not a second computation. Dropped.
  - `app/admin/(protected)/payments/payments-grid.tsx:88` — The grid's payment-entry target re-derives the flag from the cell status the same way. **Differs:** Quote VERIFIED verbatim. Same PAID-beats-DEFERRED consequence.
  - `app/admin/(protected)/payments/payments-members.tsx:96` — The members list re-derives the flag from the cell status the same way. **Differs:** Quote VERIFIED verbatim. Same PAID-beats-DEFERRED consequence.

### 49. On track / behind flag, and how many are current

- **Canonical:** `components/member/member-group-list.tsx:82`
- **Also implemented at (3):**
  - `lib/messages.ts:732` — The applicability panel decides whether BEHIND_NOTICE applies with its own inverted zero-test. **Differs:** Quote VERIFIED verbatim. Inverted form of the same comparison; the refusal sentence at :744-748 splits the zero case in two (the prior audit cited :737-745; the two branches are at :744-748).
  - `app/actions/messages.ts:438` — prepareBatch makes the same behind-versus-current decision independently for the batch relevance filter. **Differs:** Quote VERIFIED verbatim. A second site for the same gate, separate from lib/messages.ts:732.
  - `lib/dashboard.ts:567` — memberAttention drops a member with its own zero-test on the behind count. **Differs:** Quote VERIFIED verbatim. Paired with :582 (`if (owed === 0) continue;`), so the dashboard's list is behind-AND-owing, not behind alone. CORRECTIONS: two claimed duplicates were dropped as display rather than derivation — components/member/member-group-list.tsx:166 (`const onTrack = m.weeksBehind === 0;`) and app/admin/(protected)/people/[id]/page.tsx:377 (`sub: standing.data.weeksBehind === 0 ? "current" : "needs catching up",`); both quotes are accurate but each only picks a pill or a subtitle from a value derived elsewhere. By the same test the canonical cited here (member-group-list.tsx:82) is itself a display flag; the real root of this quantity is the count at app/actions/member.ts:460, verified verbatim.

### 50. Elapsed through week (the cycle-wide money boundary)

- **Canonical:** `lib/commitment.ts:154`
- **Also implemented at (3):**
  - `lib/cycle-position.ts:187` — collectionPosition re-derives the boundary as the max week number among elapsed rows rather than taking it from the caller. **Differs:** Quote verified verbatim. Derived from the series' already-stamped `elapsed` flag (:186) rather than from week dates, so it inherits whatever boundary the caller stamped.
  - `scripts/elapsed-rule-impact.mts:74` `[script]` — Recomputes the highest elapsed week number inline, from its own elapsedByStoredDate. **Differs:** QUOTE CORRECTED: both lines verified verbatim, but they sit at :73-74, not starting at :74. Computed per MEMBER over their window weeks, not once over the cycle.
  - `scripts/elapsed-rule-impact.mts:106` `[script]` — A second inline form of the same boundary, used for the context header. **Differs:** Quote verified verbatim. Takes the LAST row in the filtered array rather than the maximum week number, so it depends on row order where the canonical does not.

### 51. Weeks left in a member's window / at risk

- **Canonical:** `lib/wheel.ts:86`
- **Also implemented at (3):**
  - `app/actions/waiting.ts:202` — The waiting list computes the same subtraction independently of lib/wheel.ts. **Differs:** Quote verified verbatim. Reads its current week from currentWeekFromRows while lib/wheel.ts's dashboard caller feeds it the projected currentWeekNumber, so the two can differ by up to a week.
  - `lib/waiting.ts:77` — isAtRisk performs the at-risk comparison itself, against its own constant. **Differs:** Quote verified verbatim. Threshold is AT_RISK_WEEKS = 4 (lib/waiting.ts:67, verified).
  - `lib/wheel.ts:87` — undrawnWindowWarnings makes the at-risk decision inline against a caller-supplied threshold. **Differs:** Quote verified verbatim. Threshold is a caller-supplied weeksAhead, not AT_RISK_WEEKS = 4 — the dashboard and the Waiting screen warn at different distances.

### 52. Structural cycle fee projection (weekly pot, weekly fee, cycle total, total fees)

- **Canonical:** `lib/projection.ts:105`
- **Also implemented at (3):**
  - `lib/projection.ts:129` — cycleProjection answers the same four questions from the roster: the weekly pot as a sum of members' weeklies and total fees as a sum of per-member fees, rather than weeks x unit and a fee on the cycle total. **Differs:** Quote verified verbatim at lines 129-134. CORRECTION to the canonical only: it was cited as :86 (the function signature); the arithmetic is at 105-106, with weeklyFee at :110 and totalFees at :115. Roster-based, so its weeklyPot and totalFees can differ from the structural answer for the same cycle; the module header says conflating the two produced a wrong screen.
  - `app/admin/(protected)/cycles/new/new-cycle-form.tsx:390` — Recomputes the weekly pot inline as weeks x unitAmount for the override hint instead of reading it off the projection the same component already holds. **Differs:** Quote verified verbatim at line 390.
  - `app/admin/(protected)/cycles/new/new-cycle-form.tsx:399` — Performs the weeks x unitAmount multiplication a second time, nine lines later, for the input placeholder. **Differs:** Quote verified verbatim at line 399. Divides by 100 as a float to reach dollars.

### 53. Expected for a week

- **Canonical:** `lib/dashboard.ts:255`
- **Also implemented at (3):**
  - `lib/payments-view.ts:225` — Accumulates a week's expectation itself inside buildPaymentGrid's row map: it decides per cell whether the amount counts and adds mw.amountDue. It also carries its own window test at :217-221 (`if (week.weekNumber < member.startWeek) return { kind: "before-start" }`, `> member.finishWeek` → after-finish, missing row → after-finish) rather than calling inWindow. **Differs:** Excludes only cells whose derived status is SKIPPED (plus cycle-skipped weeks); a DEFERRED cell is added in. The canonical drops deferred rows at :253. Its window test uses a precomputed finishWeek and knows nothing about ParticipationBreak, and a missing payment row is treated as after-finish. Quote verified verbatim at line 225; the window test at :217-221 verified as described.
  - `app/admin/(protected)/cycle/page.tsx:40` — Performs the window comparison ladder and the sum of weeklyAmount inline for one week (effectiveWeek), producing that week's pot without calling weekReceipts. **Differs:** Filters on status === "ACTIVE" (line 34), uses startWeek/calculateFinishWeek directly with no ParticipationBreak hole test, and applies no deferral filter and no week-skipped filter. Quote verified verbatim: it spans lines 40-46, the cited :40 being the first line of the statement.
  - `scripts/audit-position-figures.mts:234` `[script]` — Re-derives the per-week expectation from raw rows week by week — in-window test, deferral skip, then `handShould += p.weeklyAmount` — expressly to compare against the app's figure. It also carries its own copy of the window predicate at :217-223 (`inWindowByHand`, including the break-overlap test). **Differs:** Matches the canonical's filters (in-window, non-deferred, skipped week excluded) but finds the payment row by weekId rather than weekNumber, and never materialises a per-week figure: the per-week ladder feeds one running total over elapsed weeks only. Quote verified verbatim: it spans lines 228-236, the cited :234 being the `handShould += p.weeklyAmount;` accumulation.

### 54. Actually collected for elapsed weeks

- **Canonical:** `lib/cycle-position.ts:195`
- **Also implemented at (3):**
  - `components/charts/collected-vs-expected-chart.tsx:74` — Re-filters the series to closed weeks and re-sums received for the chart headline. **Differs:** Quote verified verbatim.
  - `scripts/audit-position-figures.mts:240` `[script]` — Sums the raw payment rows whose week number is at or below the elapsed boundary, then asserts equality with position.collected at :243. **Differs:** Quote verified verbatim at lines 240-242. Filters flat payments by `weekNumber <= elapsed` instead of by each series row's stamped `elapsed` flag.
  - `scripts/verify-cycle-position.mts:145` `[script]` — Independently sums receipts on elapsed weeks from the flattened rows and asserts it equals position.collected at :148. **Differs:** Quote verified: the filter is line 144 and the reduce line 145; the assertion at :148 was confirmed.

### 55. Expected this week / collected this week (the open week)

- **Canonical:** `lib/cycle-position.ts:231`
- **Also implemented at (3):**
  - `app/admin/(protected)/cycle/page.tsx:40` — Builds this week's expectation directly from participation rows: its own in-window test and its own sum of weeklyAmount. **Differs:** Quote verified verbatim at lines 40-46. ACTIVE participations only, no breaks/holes, no deferral or skipped-week exclusion, and the week comes from `currentWeekNumber(cycle.startDate, new Date())` at :33 rather than the stored week rows.
  - `scripts/audit-position-figures.mts:246` `[script]` — Applies the open-week band (past elapsed, at or below current) to raw payment rows and sums them, then asserts equality with position.collectedThisWeek at :249. **Differs:** Quote verified verbatim at lines 246-248.
  - `scripts/diagnose-paid-ahead.mts:94` `[script]` — Isolates the current week's money and sums it at :106 to report what the open week has taken in. **Differs:** Quote verified verbatim; the sum at :106 was confirmed. Exactly the current week only, where the canonical takes every arrived-but-not-elapsed week.

### 56. What the group owes a stopped, never-drawn member (owedBack / owedBackToStopped)

- **Canonical:** `app/actions/cycle-position.ts:268`
- **Also implemented at (3):**
  - `lib/final-position.ts:126` — Computes the same owed-to-them amount — paid in less the fee on the commitment, floored at zero — from receipts rather than week rows. **Differs:** Quote verified: the fee is line 125 and the floored subtraction line 126. paidIn comes from PaymentEvent receipts on this path; the canonical sums Payment.amountPaid.
  - `scripts/audit-position-figures.mts:191` `[script]` — Makes the drawn-or-not decision and computes the owed-back amount as the raw sum of payments. **Differs:** Quote verified verbatim at lines 191-194. No fee subtracted and no floor.
  - `scripts/verify-participation-close.mts:401` `[script]` — A third arithmetic under the same field name: week rows summed, decision by member identity. **Differs:** Quote verified verbatim at lines 401-404. No fee, no floor, and the drawn test is an identity check.

### 57. Fee estimate, kept out of the cash position

- **Canonical:** `lib/cycle-position.ts:331`
- **Also implemented at (3):**
  - `app/actions/cycle-position.ts:312` — Performs the two status-filtered feeAmount sums that ARE the fee-already-earned and fee-still-to-come figures; feeEstimate only passes them through and adds them. **Differs:** Quote verified verbatim at lines 312-317. SCOPE NOTE ADDED: the canonical function performs no filtering or summing at all — it is a pass-through plus one addition — so the arithmetic that is genuinely repeated across these three sites is the per-status feeAmount sum, not feeEstimate's addition.
  - `scripts/audit-position-figures.mts:210` `[script]` — Re-implements both per-status fee sums from raw payout rows, then uses fee.soFar at :303 to assert the fee is absent from shouldBeHolding. **Differs:** Quote verified verbatim at lines 210-213; the :303 assertion was confirmed.
  - `scripts/verify-cycle-position.mts:171` `[script]` — A second script copy of the same two per-status fee sums. **Differs:** Quote verified verbatim at lines 171-174.

### 58. Total outstanding at close, and how many members are short

- **Canonical:** `app/actions/cycle-close.ts:294`
- **Also implemented at (3):**
  - `lib/cycle-close.ts:240` — Recomputes the whole-cycle outstanding total inside buildArchiveData rather than taking the review's figure. **Differs:** Quote verified verbatim.
  - `lib/cycle-close.ts:256` — Recomputes the short-member count inside buildArchiveData. **Differs:** Quote verified verbatim.
  - `scripts/deferral-impact.mts:214` `[script]` — Accumulates a whole-cycle outstanding total as the sum of every participation's derived amountOutstanding, twice (before and after the rule change). **Differs:** Quote verified verbatim at lines 214-215.

### 59. Archive totals at close (received, paid out net, pending net, still held, outstanding)

- **Canonical:** `lib/cycle-close.ts:234`
- **Also implemented at (3):**
  - `app/actions/cycle-close.ts:114` — Runs three separate status filters over the same payout rows (receivedNet at :114, awardedNet at :122, pendingNet at :126) to produce the per-member figures the archive totals are then built from. **Differs:** Quote verified verbatim at lines 114-121, and the companion sums at :122 and :126 were confirmed. pendingNet is selected as `status !== "COLLECTED"` while receivedNet uses `status === "COLLECTED"`, so any third status would land in pending.
  - `app/actions/cycle-close.ts:260` — The pre-close review computes the same three headline figures a third way — received from Σ standing.totalPaid rather than Σ archived week received (with paidOut at :261 and stillHeld at :293). **Differs:** Quote verified verbatim; the paidOut at :261 and stillHeld at :293 were confirmed.
  - `scripts/verify-cycle-close-money.mts:108` `[script]` — Re-implements all three per-member status splits (:108, :113, :117) plus the per-week received (:137) to drive buildArchiveData in the fixture, then checks the totals against separately-computed expectations. **Differs:** Quote verified verbatim at lines 108-112; the companion splits at :113 and :117 and the per-week received at :137 were confirmed.

### 60. Archived per-member figures — weeks paid, capped at weeks committed

- **Canonical:** `app/actions/cycle-close.ts:106`
- **Also implemented at (3):**
  - `lib/messages.ts:218` — Applies the same cap independently to build the {weeksPaid} placeholder every message template reads. **Differs:** Quote verified verbatim.
  - `app/actions/member.ts:207` — Derives weeks paid straight from money — paid-in divided by the weekly rate — and caps it at the commitment, without the standing engine. **Differs:** Quote verified verbatim at lines 207-210. Divides receipts by the weekly amount rather than using standing.weeksCredited.
  - `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:33` `[SQL]` — The member_progress view computes weeks paid in SQL: floor of total paid over the weekly amount, capped at weeks committed — the same quantity, derived by the database. **Differs:** Quote verified verbatim at lines 33-36. It is a SQL VIEW, not a trigger (the flag is set to mark it as database-side arithmetic); it divides the raw payment sum from the LATERAL at :45-49 by the weekly rate, where the app path uses standing.weeksCredited.

### 61. Final position of a stopped member (owed-to-them / they-owe / settled)

- **Canonical:** `lib/final-position.ts:121`
- **Also implemented at (3):**
  - `app/actions/cycle-position.ts:268` — Re-implements the drawn test and the owed-to-them branch inline — zero when paid out, otherwise paid-in less the commitment fee, floored at zero. **Differs:** Quote verified verbatim at lines 268-274. Drawn-ness is decided from COLLECTED payout nets summed here; paid-in is Payment.amountPaid, not PaymentEvent receipts. The they-owe branch is not implemented at all.
  - `lib/contribution.ts:88` — Duplicates the committed-total multiplication and the committed-minus-paid-in subtraction that make up the they-owe branch. **Differs:** Quote verified verbatim at lines 88-89. Floored at zero here; lib/final-position.ts:136 leaves it signed and tests `unpaid <= 0` separately.
  - `scripts/verify-participation-close.mts:401` `[script]` — A third inlined owed-to-them branch: drawn-or-not decision plus the amount, from week rows. **Differs:** Quote verified verbatim at lines 401-404. No fee subtraction and no floor.

### 62. Payment recorded against a carried balance, and what is left

- **Canonical:** `app/actions/ledger.ts:81`
- **Also implemented at (3):**
  - `app/actions/ledger.ts:79` — Evaluates `Math.max(0, owed - input.amount)` inline for the audit summary; the arithmetic happens at this line rather than being formatted from the value produced two lines later at :81. **Differs:** QUOTE VERIFIED verbatim at :79.
  - `app/admin/(protected)/people/[id]/carried-balance.tsx:217` — Client-side recomputation of what will be left after the payment, from the story balance and the typed cents, before recordLedgerPayment is called. **Differs:** QUOTE VERIFIED verbatim at :217. Use sites confirmed: `left` renders at :234 (confirmation body) and :256 (success sentence); the server's returned `remaining` is not used on this path.
  - `app/admin/(protected)/people/[id]/member-payments.tsx:231` — A second client-side evaluation of the same remainder in the collections-side ledger-payment confirmation, from the carriedBalance prop and the typed cents. **Differs:** QUOTE VERIFIED verbatim at :231. Note that this component does read the server figure elsewhere (`result.data.remaining` at :254), so the dialog and the success message get the number from two different computations.

### 63. My weekly amount

- **Canonical:** `app/actions/member.ts:339`
- **Also implemented at (3):**
  - `lib/lucky-numbers.ts:128` — reconcileWeeklyAmount sums the amounts of ALL the member's lucky numbers to arrive at their weekly contribution, then subtracts the stored weekly at :129 to produce a delta. The figure is arithmetic over the number rows, not a read of participation.weeklyAmount. **Differs:** Quote verified verbatim at lib/lucky-numbers.ts:128. Canonical reads the stored column; this reconstructs the same money from the LuckyNumber amounts, so the two can disagree — which is what the returned delta reports.
  - `app/admin/(protected)/people/[id]/participation-editor.tsx:1024` — The reduce on this line sums the member's lucky-number amounts to produce the weekly figure the sentence states ("N numbers, together $X a week"). formatMoney only formats the result; the addition is performed here and nowhere upstream, so the screen's weekly is derived independently of participation.weeklyAmount. **Differs:** QUOTE CORRECTED: the previously supplied three-line quote begins at line 1023 (`: `${props.luckyNumbers.length} numbers, together ${formatMoney(`), not 1024. Line 1024 is the reduce itself, quoted verbatim above, so the anchor is retained. Same summation as lib/lucky-numbers.ts:128, written out inline in JSX, and unlike that function it never compares the result to the stored weekly.
  - `scripts/verify-payout-invariants.mts:64` `[script]` — The script performs its own sum over the fixture's number amounts and compares the stored weekly against it. The reduce is a third independent copy of the sum-the-numbers derivation, living outside the app and free to drift from it. **Differs:** Quote verified verbatim at scripts/verify-payout-invariants.mts:64.

### 64. Bulk catch-up amount for chosen weeks

- **Canonical:** `lib/payments-view.ts:57`
- **Also implemented at (2):**
  - `lib/week-picking.ts:63` — Produces the same figure — the sum of the chosen weeks' per-week shortfalls — through its own filter and reduce.
  - `lib/derived.ts:286` — Totals what a set of weeks still owes with its own accumulation of due and paid. **Differs:** CORRECTED QUOTE: the previous entry elided the body with "…"; lines 286-302 are quoted in full here and verified verbatim. NETS across weeks (one clamp at the end) instead of clamping each week, so surplus on one week offsets debt on another — which the per-week version cannot do.

### 65. Marked late (the organizer's own stored decision)

- **Canonical:** `app/actions/edits.ts:1506`
- **Also implemented at (2):**
  - `app/actions/edits.ts:1377` — setWeekDeferral decides the stored mark's value itself in a branch: deferring a week clears markedLateAt and markedLateNote. **Differs:** Quote VERIFIED verbatim at :1377-1379. A second writer of the column, on a different action from the one that sets it.
  - `lib/rebuild.ts:143` — The receipt replay decides on its own that a week whose replayed coverage reaches the weekly amount has its mark cleared, and writes markedLateAt: null at :148. **Differs:** Quote VERIFIED verbatim, as is the write at :146-149. A third writer, driven by money rather than by an organizer action. Compares replayed coverage against weeklyAmount, whereas app/actions/edits.ts:1499 compares the STORED amountPaid.

### 66. Whether the manual late mark may be applied to this week (and what to say)

- **Canonical:** `lib/derived.ts:238`
- **Also implemented at (2):**
  - `app/actions/edits.ts:1499` — The money-beats-the-mark refusal is a fifth case decided at the write, separately from the four cases manualLateAdvice returns (whose two blocking kinds are consumed just above at :1492). **Differs:** Quote VERIFIED verbatim. Not part of manualLateAdvice at all, so the control can be offered and then refused. Tests the STORED amountPaid.
  - `lib/rebuild.ts:143` — The same money-beats-the-mark comparison performed a third time, here as the automatic clearing rule after a replay. **Differs:** Quote VERIFIED verbatim. Compares REPLAYED coverage (s.paid) against weeklyAmount; app/actions/edits.ts:1499 compares the stored amountPaid. The two can differ after a rate change.

### 67. Start week (a member's first cycle week)

- **Canonical:** `prisma/schema.prisma:187`
- **Also implemented at (2):**
  - `app/admin/(protected)/cycle/add/add-member-wizard.tsx:99` — Computes the start week the wizard proposes from the current week, and that proposal is what gets stored. **Differs:** Quote verified verbatim. Not clamped to plannedWeeks.
  - `lib/messages.ts:237` — Re-derives the start week backwards out of the finish week and commitment length, rather than carrying it. **Differs:** Quote verified verbatim.

### 68. A member's own week number (their week 1 is their start week)

- **Canonical:** `lib/member-window.ts:25`
- **Also implemented at (2):**
  - `lib/member-week-dates.ts:38` — A second ownWeekNumber performing the subtraction itself. **Differs:** Quote verified verbatim. Same arithmetic under the same function name in a different module; THROWS on non-integers (:35-37) and does NOT clamp to the member's window, so it can return 0 or negative where the canonical returns null.
  - `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:159` `[SQL]` — The oldest member_progress view computes the member's own week count in SQL, and it is the elapsed term the behind-count subtracts from. **Differs:** Quote verified verbatim. Computed off the SQL-projected week_no (:149) rather than a stored week row, and capped with least() rather than nulled outside the window.

### 69. Undo-draw consequences (total net removed, collected net un-recorded, settlements reopened)

- **Canonical:** `lib/undo-draw.ts:46`
- **Also implemented at (2):**
  - `lib/manual-payout.ts:104` — weekChoice computes the same three 'what disappears' figures — total net, which payouts are collected, which settlements reopen — for the replace path, with its own reduce and filters. **Differs:** Quote verified verbatim at lines 104-106. CORRECTION to the canonical only: cited as :37 (the function signature); the three reduces are at 46-48. Reports reopening weeks as a week-number list rather than per lucky number with its amount; highStakes is decided the same way (collected.length > 0).
  - `app/actions/manual-payout.ts:315` — Inside the transaction the replace path recomputes the removed total and collected count from the freshly read rows rather than calling undoDrawConsequences. **Differs:** Quote verified verbatim at lines 315-316.

### 70. Manual payout preview totals (gross, fee, net across the chosen numbers)

- **Canonical:** `lib/manual-payout.ts:220`
- **Also implemented at (2):**
  - `app/admin/(protected)/people/[id]/assign-payout.tsx:154` — The picker sums the three columns across the numbers the organizer ticked, in the client, with its own reduce. **Differs:** Quote verified verbatim at lines 154-157. CORRECTION to the canonical only: cited as :208, which is the function signature; the reduces are at 220-222. Sums only the SELECTED subset as the checkboxes change, whereas manualPayoutPreview sums whatever list it is handed.
  - `app/actions/manual-payout.ts:518` — The write path re-sums the created payout rows to report the assignment's total. **Differs:** Quote verified verbatim at line 518. Net only, and taken from the WRITTEN rows rather than from the preview lines.

### 71. Winner announcement payout amount ({payoutAmount})

- **Canonical:** `lib/winner-extras.ts:63`
- **Also implemented at (2):**
  - `app/actions/messages.ts:90` — The batch path makes the recorded-else-projected decision with its own expression, over its own calculatePayout call at :79 and its own first-number-wins loop. **Differs:** Quote verified verbatim at line 90.
  - `app/actions/messages.ts:295` — The preview path decides the same figure a third way: try the drawn-winner map, and otherwise project off the member's lowest-numbered lucky number. **Differs:** CORRECTION: previously cited as :296; the quoted block begins at line 295 and runs verbatim to 305. Falls back to the member's first lucky number and the CURRENT cycle week rather than a drawn number and its draw week.

### 72. Short for a week (per-week shortfall)

- **Canonical:** `lib/dashboard.ts:264`
- **Also implemented at (2):**
  - `app/admin/(protected)/this-week/page.tsx:121` — Recomputes the week's shortfall from the two components rather than reading the `shortfall` field already on the same `totals` object. The card's wording branch at :123 (`totals.expected <= totals.received`) and its emphasis at :129 (`totals.expected > totals.received`) make the same comparison twice more. **Differs:** Identical arithmetic to the canonical, applied to the same object that already carries the answer — `totals` is `d.selectedWeekTotals` (page.tsx:66), which is a `receiptsByWeek` row and therefore carries `shortfall`. Quote verified verbatim at line 121.
  - `app/admin/(protected)/cash/page.tsx:266` — The By-week table computes each row's gap itself from the series week's expected and received, then branches on `gap > 0` at :287 and :292 for tone and text. **Differs:** Identical arithmetic to the canonical, on a series row that already carries `shortfall` (`d.series` is getDashboard's `receiptsByWeek` output). Applied to every series week with no elapsed and no skipped filter. Quote verified verbatim at line 266.

### 73. Members short for a week

- **Canonical:** `app/admin/(protected)/cycle/position/week-dates-data.ts:152`
- **Also implemented at (2):**
  - `app/admin/(protected)/page.tsx:213` — Performs the subtraction itself and compares the result to zero to decide whether the "have not paid" clause is shown at all. **Differs:** Same subtraction as the canonical, without the Math.max(0, …) floor. Quote verified verbatim at line 213.
  - `app/admin/(protected)/page.tsx:214` — Performs the same subtraction a second time, on the next line, to produce the number that is printed. **Differs:** Same subtraction as :213 and as the canonical, again without the floor. Quote verified verbatim at line 214. The canonical's own quote spans lines 151-153, the cited :152 being the Math.max line.

### 74. Grid row received / expected (payments grid footer column)

- **Canonical:** `lib/payments-view.ts:211`
- **Also implemented at (2):**
  - `lib/dashboard.ts:250` — weekReceipts accumulates the same two per-week figures over participations, with its own window and deferral handling. **Differs:** Counts money on rows outside the member's window into received; drops deferred members out of expected. The grid does the opposite on both counts. Quote verified verbatim: lines 248-255, the cited :250 being the `received +=` line. The canonical quote is elided — verified as lines 211-215 plus 222-225.
  - `app/actions/cycle-close.ts:178` — A third sum of one week's money, walking participations and their rows rather than grid cells. **Differs:** Keyed by weekId; takes at most one row per participation; produces no expected figure at all. Quote verified verbatim: lines 178-181.

### 75. Gone out in total, and payout progress

- **Canonical:** `app/admin/(protected)/collections/page.tsx:269`
- **Also implemented at (2):**
  - `app/actions/cycle-close.ts:122` — Sums every payout net regardless of status — the same collected-plus-pending total — per member, for the archive. **Differs:** Quote verified verbatim at lines 122-125. Per member rather than whole cycle, and reached by summing rows rather than adding two status-filtered subtotals.
  - `scripts/verify-cycle-close-money.mts:113` `[script]` — Re-implements the all-statuses payout-net sum in the verification fixture, independently of app/actions/cycle-close.ts. **Differs:** Quote verified verbatim at lines 113-116.

### 76. Difference vs the books, coverage, and the verdict

- **Canonical:** `lib/cycle-position.ts:382`
- **Also implemented at (2):**
  - `app/admin/(protected)/cycle/position/page.tsx:78` — Re-adds the holding-for-others terms and makes the same short/not-short comparison inline for the section dot. **Differs:** Quote verified verbatim. Compares against the BOOKS (shouldBeHolding) rather than the counted reading, and omits the owed-to-stopped term the canonical includes.
  - `app/actions/cycle-position.ts:367` — Computes the reading-minus-books difference itself for every historical reading, in a loop separate from positionVerdict. **Differs:** Quote verified verbatim. Every past reading is compared against TODAY's shouldBeHolding.

### 77. Carried balance for a person (ledger balance)

- **Canonical:** `lib/ledger.ts:23`
- **Also implemented at (2):**
  - `app/actions/ledger.ts:231` — Derives the balance itself, in SQL plus JS, without calling ledgerBalance: two Prisma groupBy aggregates (`where: { type: "DEBT" }` at :211-215 and `where: { type: { not: "DEBT" } }` at :218-222) produce per-person sums, and this line subtracts the credit sum from the debt sum and floors at zero. **Differs:** QUOTE VERIFIED verbatim at :231, indentation included. The two groupBy blocks and the :216-217 comment ("`ledgerBalance` treats every non-DEBT type as a credit, and this must not disagree with it") are present as described. The DEBT/non-DEBT split is a SQL where clause rather than the ternary at lib/ledger.ts:25, and the floor is applied per person on an aggregate rather than on a reduced array.
  - `lib/ledger.ts:73` — Writes the DEBT-positive / everything-else-negative sign rule and the zero floor a second time, over the same array, inside ledgerStory; it calls nothing. ledgerStory then obtains `balance` by calling ledgerBalance at :80 rather than reading its own accumulator. **Differs:** QUOTE VERIFIED verbatim at lines 73-76. Correction to the original note: `running` itself is never clamped — only the emitted `balanceAfter` is — so the last entry's balanceAfter equals ledgerBalance(entries) by construction; the two coincide today and the duplication is of the sign rule and the floor, not of a differing figure. Note also that these same lines are the canonical for the separate quantity "Balance after each ledger entry" below.

### 78. Carry-deduction offer (balance, most deductible, suggested, net if applied)

- **Canonical:** `lib/carry-balance.ts:80`
- **Also implemented at (2):**
  - `app/admin/(protected)/collections/collections-view.tsx:922` — Evaluates min(debt, payout net) at this line — the same most-deductible decision carryOffer makes at lib/carry-balance.ts:104 — inside the payout edit panel, which calls neither carryOffer nor getCarryOffer. **Differs:** QUOTE VERIFIED verbatim at :922. Divergence confirmed by reading the props: `outstanding` is declared at :39 as "Their derived outstanding, for the OFFER (2.18 — never automatic)", i.e. the member's WEEK outstanding, not the ledger balance; and the net is whatever is currently typed in the Net field, falling back to p.netAmount.
  - `app/admin/(protected)/collections/collections-view.tsx:918` — Computes net minus min(owed, net) — the same subtraction as `netIfApplied` at lib/carry-balance.ts:114 — and writes the result straight into the Net field. **Differs:** QUOTE CORRECTION: the first quoted line (`const current = …`) is at :917; the `setNet(…)` line is at :918. Text otherwise verbatim. Same shape against week outstanding rather than the ledger balance, and the result is saved through updatePayout, so this path does not pass applyCarryDeduction (whose only call site is app/actions/carry-deduction.ts:196) and writes no ledger entry.

### 79. Applied carry deduction (deducted, payout net after, balance after)

- **Canonical:** `lib/carry-balance.ts:166`
- **Also implemented at (2):**
  - `components/admin/carry-deduction-offer.tsx:177` — Reconstructs the payout net as balance + netIfApplied and subtracts the typed cents at this line to state what the member will receive — the netAfter arithmetic, performed client-side before anything is submitted. **Differs:** QUOTE VERIFIED verbatim at :177. Independence confirmed: this component never calls applyCarryDeduction (its only call site is app/actions/carry-deduction.ts:196). The reconstruction `balance + netIfApplied` equals payoutNet only when balance <= payoutNet, since maxDeductible is min(balance, payoutNet); it also floors at zero, which lib/carry-balance.ts:178 does not.
  - `components/admin/carry-deduction-offer.tsx:179` — Evaluates offer.balance minus the typed cents at this line — the same subtraction as balanceAfter at lib/carry-balance.ts:179 — to state the balance left. **Differs:** QUOTE VERIFIED verbatim at :179. Floored at zero here; lib/carry-balance.ts:179 applies no floor and relies on deductionRefusal (:142) instead.

### 80. Allocation of a payment, oldest-first (where the money lands)

- **Canonical:** `lib/allocation.ts:88`
- **Also implemented at (1):**
  - `lib/week-picking.ts:93` — Performs the whole oldest-first waterfall a second time — its own ascending sort (:102), its own zero-owed/skip pass (:107), its own fill-or-partial branch (:108-115) and its own carry-forward of `left` — without calling allocatePayment. Its doc comment at :85-92 states it is a deliberate mirror. **Differs:** CORRECTED CANONICAL ANCHOR: the previous entry anchored the canonical at lib/allocation.ts:65 (the function signature) while quoting the loop at :88-94; the anchor is moved to :88 so the quote and the line agree. The duplicate's own quote is verified verbatim at 93-98.

### 81. Preview coverage for a typed amount (full weeks, partial week, fits-nowhere)

- **Canonical:** `lib/week-picking.ts:93`
- **Also implemented at (1):**
  - `lib/allocation.ts:88` — The authority the preview mirrors: it walks the same ascending weeks, fills each shortfall with Math.min(owed, remaining) and carries the leftover, producing the full-weeks / partial-week / fits-nowhere split independently of the preview. **Differs:** CORRECTED QUOTE AND ANCHOR: the previous entry quoted the signature at lib/allocation.ts:65-68, which is a declaration; the arithmetic is the loop at :88-94, quoted here verbatim.

### 82. Amount of one receipt applied to one week (allocation audit row)

- **Canonical:** `app/actions/payments.ts:270`
- **Also implemented at (1):**
  - `lib/draw-settlement.ts:153` — The settlement path decides the per-week slice from its own per-payout deduction plan (planWinnerWeekSettlement, not allocatePayment) and writes the audit row directly. **Differs:** CORRECTED SCOPE: the previous entry also listed lib/rebuild.ts:78; that line writes `amount: applied`, a value the canonical engine (allocatePayment/allocatePinned, called at :88 and :105) produced, so it is a write of the engine's own output rather than a second derivation, and is dropped.

### 83. Pinned settlement coverage (the winner's own week)

- **Canonical:** `lib/standing.ts:118`
- **Also implemented at (1):**
  - `lib/settlement.ts:72` — allocatePinned writes the same rule — a skipped week takes none, otherwise cap the pinned money at what the week owes — as its own function, and returns the overflow. **Differs:** CORRECTED QUOTE: the previous entry elided the body with "…" and anchored at :63 (the signature); lines 72-74 carry the arithmetic and are quoted verbatim here. Caps at amountDue MINUS what has already landed on the week, whereas the standing pass caps at amountDue alone; it also reports the excess, which the standing pass silently returns to the fungible pool.

### 84. Coverage of a week at the CURRENT rate (what the status ladder compares against)

- **Canonical:** `lib/standing.ts:144`
- **Also implemented at (1):**
  - `lib/rebuild.ts:83` — The replay decides per-week placement with its own regime — receipt by receipt in received order, pinned events onto their own week (:84-102), everything else oldest-first with earlier placements preserved in `s.paid` (:105-124) — and WRITES the result into Payment.amountPaid, so the stored figure is a second, persisted computation of the same coverage. **Differs:** CORRECTED QUOTE AND ANCHOR: the previous entry anchored at lib/rebuild.ts:23 and quoted only the function signature, which is a declaration; the loop at :83-84 is where the placement regime is decided and is quoted verbatim here. Replays receipt by receipt and preserves earlier placements as it goes, whereas computeStanding re-allocates one fungible total in a single pass.

### 85. Next week due for a member

- **Canonical:** `app/actions/member.ts:292`
- **Also implemented at (1):**
  - `app/actions/messages.ts:277` — Applies the same "first uncovered, non-deferred week" filter to pick the week the payment-confirmation preview names. **Differs:** Quote verified verbatim at 277-279. Takes the first uncovered week outright; it has no "at or after the current cycle week" pass and no oldest-week fallback.

### 86. Amount outstanding (owed right now)

- **Canonical:** `lib/derived.ts:286`
- **Also implemented at (1):**
  - `lib/payments-view.ts:64` — bulkCatchUpAmount sums a shortfall across the chosen weeks itself, with its own skipped exclusion at :60 (`if (w.isSkipped) continue;`), instead of calling amountOutstanding. **Differs:** Quote VERIFIED verbatim. Clamped PER WEEK rather than netted across weeks, so surplus sitting on one week does not offset debt on another. Deferred weeks are included in both.

### 87. Skipped (cycle-wide week nobody owed)

- **Canonical:** `prisma/schema.prisma:171`
- **Also implemented at (1):**
  - `app/admin/(protected)/payments/patterns-view.tsx:54` — Derives the cycle-wide skipped boolean from the derived cell status instead of reading Week.isSkipped. **Differs:** Quote VERIFIED verbatim. The only place in the tree that produces the flag rather than reading it. Note the canonical is a stored column declaration, not a computation — this entry records one derivation of a fact that everywhere else is read.

### 88. Consistency state per week, and longest overdue run

- **Canonical:** `lib/chart.ts:230`
- **Also implemented at (1):**
  - `lib/chart.ts:186` — Produces the same five states independently from raw cents rather than mapping an already-derived status. **Differs:** Quote VERIFIED verbatim at :186-197. CORRECTIONS: the canonicalSourceLine as given splices two separate functions — consistencyFromStatus at :230 and longestOverdueRun at :201 — which are different quantities; longestOverdueRun has no second implementation anywhere. This same pair is also recorded under the payment-status entry above, so it is one finding stated at two altitudes. No isSkipped and no markedLate input, and it takes windowClosed (:191) as an argument its callers must decide themselves.

### 89. Surplus beyond the member's whole window (allocation remainder)

- **Canonical:** `lib/standing.ts:198`
- **Also implemented at (1):**
  - `lib/week-picking.ts:118` — coverageForAmount walks the member's weeks oldest-first itself (:102-116) and returns its own leftover, as the typing preview of what the engine would do. **Differs:** Quote VERIFIED verbatim, and the independent walk it returns is at :102-116. The file's own comment (:88-91) calls it "deliberately the same walk" as allocatePayment, and says the engine wins if they disagree. It takes no pinned settlements.

### 90. Members needing attention (the behind list)

- **Canonical:** `lib/dashboard.ts:510`
- **Also implemented at (1):**
  - `lib/standing.ts:96` — Produces the same pair of figures per member — weeksBehind and amountOutstanding — by an independent route: each week row's own stored date through weekCountsAsDue (:164-173), and coverage re-allocated through the allocation engine (:132-147). **Differs:** Quote VERIFIED verbatim (a signature line; the independent derivation it heads is at :132-186). memberAttention builds its week objects at :575-579 with only { amountDue, amountAlreadyPaid, isDeferred } — no isSkipped field — so amountOutstanding's skipped exclusion cannot fire there; and its skipped count at :565 comes only from stored payment rows, so a member with no row for a skipped week is not counted. computeStanding passes isSkipped and counts from the week rows.

### 91. Current week of the cycle — projected off the start date

- **Canonical:** `lib/money.ts:162`
- **Also implemented at (1):**
  - `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:149` `[SQL]` — The member_progress view projects the current week number off the cycle start date entirely in SQL. **Differs:** Quote verified verbatim. Uses `current_date` in the server timezone rather than UTC days, and clamps the whole expression at 0 with greatest() rather than returning 0 for a negative day difference, so the two can disagree by a day at the timezone boundary.

### 92. Weeks remaining in the cycle (from today)

- **Canonical:** `app/actions/dashboard.ts:253`
- **Also implemented at (1):**
  - `lib/money.ts:129` — remainingWeeksInCycle performs the same subtraction-and-floor to answer how many weeks the cycle has left. **Differs:** Quote verified verbatim. Keyed on a member's start week rather than today, and INCLUSIVE — so for the same week number it answers one more than the dashboard's figure.

### 93. Payments left / weeks still to pay (the count owed)

- **Canonical:** `lib/messages.ts:219`
- **Also implemented at (1):**
  - `components/member/member-personal-summary.tsx:40` — The portal summary performs the subtraction and the zero floor itself rather than receiving the figure. **Differs:** Quote verified verbatim. Rebuilt CLIENT-SIDE from props, and the cap-at-weeksCommitted half (lib/messages.ts:218) is left to whoever supplied paidCount rather than applied here.

### 94. Actual cycle length (how many week rows really exist)

- **Canonical:** `lib/participation-rules.ts:117`
- **Also implemented at (1):**
  - `app/actions/edits.ts:2200` — updateCycle recomputes the deepest member finish week itself inside the transaction. **Differs:** Quote verified verbatim at :2200-2203. Identical reduce, but compared against the PROPOSED plannedWeeks to refuse a shrink rather than combined with Math.max to decide what to keep.

### 95. Bounds on a week's own date (weeks must run in order)

- **Canonical:** `lib/date-bounds.ts:152`
- **Also implemented at (1):**
  - `app/admin/(protected)/cycle/position/week-dates.ts:223` — outOfSequenceWeeks performs the strict-ordering rule itself to detect weeks already stored out of order. **Differs:** Quote verified verbatim. Lexicographic YYYY-MM-DD comparison of the stored strings rather than the ±1-day Date arithmetic, and the anchor stays on the last IN-SEQUENCE row (:227) rather than the immediate predecessor.

### 96. Fee, projected (one lucky number)

- **Canonical:** `lib/money.ts:90`
- **Also implemented at (1):**
  - `scripts/lib/production-fixture.mts:228` `[script]` — Applies a percent to a gross and rounds, producing the feeAmount the fixture writes to the payout row. **Differs:** Quote verified verbatim at line 228. Percent arithmetic in floating point (gross * FEE_PERCENT / 100) rather than the integer basis-points route calculateFee uses, and FEE_PERCENT is a script constant rather than Cycle.feePercent. CORRECTION MADE: the previously claimed duplicate lib/settlement.ts:118 was removed — its quote is real but it computes netPerWeek (a fractional week divisor), never a fee, so it is not another implementation of this quantity.

### 97. Fee withheld when returning an undrawn member's money

- **Canonical:** `lib/final-position.ts:61`
- **Also implemented at (1):**
  - `lib/participation-removal.ts:100` — Derives the same 'fee this member owes on their commitment' figure by multiplying the member total and applying the percent once, instead of summing a fee per lucky number. **Differs:** CORRECTION: previously cited as :87 with an elided quote; :87 is only the signature of feeAttributable — the arithmetic is at 100-101, quoted verbatim here. TOTAL-FIRST rather than per-number, so it can differ by a cent or two on a fee percent that does not divide evenly; the module comment at lib/final-position.ts:45-50 states that final-position exists to avoid exactly this route.

### 98. Fee attributable to a member being removed from a cycle

- **Canonical:** `lib/participation-removal.ts:100`
- **Also implemented at (1):**
  - `lib/final-position.ts:61` — Produces the same 'fee owed on this member's commitment' figure by the per-lucky-number route, splitting the weekly at the cycle unit and summing a fee per number. **Differs:** CORRECTION: the elided quote is now given verbatim as lines 61-70. Per-number rather than total-first; also needs unitAmount, which feeAttributable never reads.

### 99. Resized win-week settlement and the credit back to the payout

- **Canonical:** `lib/settlement.ts:216`
- **Also implemented at (1):**
  - `lib/week-winners.ts:380` — The move path performs the same conservation — give the old settlement back to the payout, then take the new week's out of it — as its own two-step arithmetic instead of going through resizeWinnerWeekSettlement. **Differs:** Both quoted lines verified: grossNet at line 380, movedNet at line 387 (the elided middle is the settlementFor call at 381-386). CORRECTION to the canonical only: cited as :211 (the function signature); resized/credit are at 216-217. Clamps at zero via Math.max rather than refusing when the payout cannot fund the larger week, which is what the canonical guard at :218-224 does.

### 100. Days waiting for a pending payout / longest wait

- **Canonical:** `lib/waiting.ts:70`
- **Also implemented at (1):**
  - `lib/dashboard.ts:467` — standingIssues defines its own floored, never-negative whole-days helper locally instead of importing daysBetween. **Differs:** Quote verified verbatim at lines 467-468. Truncates both instants to UTC calendar days first, so a wait of a few hours across midnight counts as one day here and zero in daysBetween.

### 101. Weeks that closed with money overdue (closed-week shortfall list)

- **Canonical:** `app/actions/dashboard.ts:221`
- **Also implemented at (1):**
  - `components/charts/collected-vs-expected-chart.tsx:188` — Decides per week whether that week closed short — the red dot — by re-deriving the shortness itself from the two components (`w.received < w.expected`) rather than reading the week's already-derived shortfall. **Differs:** Takes closedness from the stamped `elapsed` flag instead of re-deriving it from the week's date; adds an `expected > 0` term; tests `received < expected` rather than `shortfall > 0`; has no isSkipped term. Quote verified verbatim at line 188. Correction to the previous list: its sibling at :327 (`{w.elapsed && w.shortfall > 0 ? formatMoney(w.shortfall) : "none"}`) was claimed as a third site and I removed it — that line reads the derived `shortfall` and the stamped `elapsed`, and its only operation is a >0 test choosing between a formatted number and the word "none".

### 102. Who the outstanding money is with (owedBy, per member)

- **Canonical:** `app/actions/cycle-position.ts:205`
- **Also implemented at (1):**
  - `lib/dashboard.ts:581` — `memberAttention` builds its own due-week set and elapsed window and derives each member's owed figure straight from the lib/derived.ts primitive, never going through computeStanding/standingFor as the canonical does. **Differs:** QUOTE CORRECTED AND EXPANDED: the original entry quoted only line 581 (`const owed = amountOutstanding(elapsedWindow);`), which on its own is a bare call and would have been rejected. The quote now runs 571-581 and shows the window construction that is the independent part. No pinned-settlement handling, and the window is the elapsed due-weeks set rather than the member's whole commitment window.

### 103. Cash reading / counted cash (what he actually holds)

- **Canonical:** `app/actions/cycle-position.ts:409`
- **Also implemented at (1):**
  - `app/admin/(protected)/cycle/position/cash-reading-panel.tsx:105` — Parses the two dollar fields into cents client-side and adds them to derive the total that will be submitted, mirroring the server's own bank-plus-cash addition. **Differs:** Quote verified verbatim at lines 105-107. Client-side and in a dollars-to-cents parse; the server's copy performs the same addition but inside a refusal check rather than as a derivation.

### 104. Outstanding carried to the person's ledger at cycle close (the closing DEBT entry)

- **Canonical:** `lib/cycle-close.ts:154`
- **Also implemented at (1):**
  - `app/actions/participation-close.ts:343` — Makes the same skip-when-zero decision and composes its own origin description for the single-member mid-cycle close, in parallel with finalBalanceEntries. **Differs:** Quote verified verbatim at lines 343-351. Different wording ("stopped at week N" rather than "closed — paid N of M weeks"), and no weeksPaid/lastPaymentWeek in the text.

### 105. Closing statement text for a member

- **Canonical:** `lib/cycle-close.ts:175`
- **Also implemented at (1):**
  - `lib/member-history.ts:90` — `closingLine` runs its own branch ladder over the archived row to produce the member-portal closing sentence. **Differs:** LINE CORRECTED: the entry gave lib/member-history.ts:86, which is the `outstanding: number;` field of the input type. The ladder actually begins at line 90; the location and quote are corrected to that, verified verbatim at lines 90-100. Branches on outstanding then pendingNet; the canonical branches on outstanding then weeksPaid vs weeksCommitted, and pendingNet plays no part in it.

### 106. Refusals that fence where balance money may land

- **Canonical:** `lib/cycle-close.ts:62`
- **Also implemented at (1):**
  - `lib/participation-close.ts:227` — `closeRefusal` makes both the closed-cycle and closed-participation decisions itself with its own wording, rather than calling frozenCycleRefusal / closedParticipationRefusal. **Differs:** Quote verified verbatim at lines 227-235. Used for the preview sentence; app/actions/participation-close.ts:299 (`const frozen = frozenCycleRefusal(p.cycle);`, confirmed) then calls frozenCycleRefusal separately for the enforcement, so the two ladders run one after the other.

### 107. The current cycle week, computed for the member and never shown

- **Canonical:** `lib/money.ts:162`
- **Also implemented at (1):**
  - `lib/commitment.ts:194` — currentWeekFromRows answers the same question with its own arithmetic: it scans the stored week rows for the highest week whose date has arrived (:183-190), then divides the elapsed milliseconds since that row's date by seven days and adds the result to that week number. currentWeekNumber is called only in the fallback branch at :191 when no stored row has arrived. **Differs:** QUOTE CORRECTED: the previously supplied quote began at line 191 (`if (last === 0) return currentWeekNumber(...)`), which is the fallback call, not the arithmetic. Re-anchored to lines 194-197, quoted verbatim above. Anchored on the stored week rows and their real dates; the canonical projects purely off Cycle.startDate, so the two differ whenever a stored week date has been corrected away from the 7-day rhythm.

---

# Gaps in this map

An unstated gap is worse than a stated one. Everything the sweeps could not establish is
here.

## 1. SOURCE NOT FOUND

- **`Standing.surplus` has no rendering surface.** `computeStanding` returns `surplus`
  (`lib/standing.ts:198`) and it is carried in the `getMemberStanding` payload
  (`app/actions/payments.ts:423`), but no component was found rendering it. Whether it is
  dead output or reaches a screen by a route the sweep missed is unresolved.
- **Write sites not recorded for thirteen stored columns.** Neither schema sweep captured
  a writer for: `Participation.closedAt` (`schema:215`), `LuckyNumber.cycleId`
  (`schema:285`), `Slot.position` (`schema:374`), `SlotMember.luckyNumberId`
  (`schema:385`), `WinnerPlan.weekId` (`schema:397`), `WinnerPlan.mode` (`schema:398`),
  `WinnerPlanNumber.luckyNumberId` (`schema:410`), `Payout.luckyNumberId` (`schema:443`),
  `Payout.drawId` (`schema:444`), `Setting.value` (`schema:537`), `AgreementVersion.body`
  (`schema:559`), `MessageLog.body` (`schema:129`). This is a gap in the map, **not** a
  claim that nothing writes them. Pass 2 should establish these before reasoning about
  who can change a payout's owner, a slot's arrangement, or a setting.
- **`LedgerEntry.description` writers are inferred, not captured.** No sweep produced a
  dedicated writer list for the column. The sites listed in Part A were derived from the
  nine `LedgerEntry.type` creation sites plus the places the description text is
  demonstrably built (`lib/cycle-close.ts:159-162`,
  `app/actions/participation-close.ts:350-352`, `app/actions/ledger.ts:69`, `:157-160`,
  `app/actions/carry-deduction.ts:211-223`). Treat that list as probable, not verified.

## 2. Verification corrections carried forward from Part C

- **`amountOutstanding` does not read `isDeferred`.** `Payment.isDeferred` is a REQUIRED
  FIELD on the input type (`lib/derived.ts:290`) but the body never reads it; `:296-302`
  branch only on `isSkipped`. The behaviour ("deferred weeks count as owed") is real but
  true **by omission**. Pass 2 must not look for deferral logic at `lib/derived.ts:286`.
- **`lastPaymentWeek` is not a maximum.** `lib/standing.ts:188`/`:199` take the LAST
  ELEMENT of the filtered window array, not a max, and `computeStanding` does not assert
  ascending order (only `allocatePayment` asserts it, `lib/allocation.ts:75`). Any caller
  that passes unordered `windowWeeks` gets a different answer.
- **`weeksLeavingExpectation` line numbers.** The function is at
  `lib/participation-close.ts:192`; the `calculateFinishWeek` call is `:197` and the
  subtraction is `:198`. Earlier sweep text cited `:197` for the subtraction.
- **`finalPosition.drawn`.** Decided by `input.received > 0` (`lib/final-position.ts:121`),
  and every caller supplies `received` from COLLECTED nets only — so a member with a
  PENDING payout evaluates as never-drawn on that path. Recorded, not judged.

## 3. The two schema sweeps disagreed on `kind` for fifteen columns

Both labels are shown in Part A. The disagreement is unresolved and is itself data:

`Cycle.plannedWeeks` (organizer-decision / calendar-fact), `Cycle.unitAmount`
(organizer-decision / money-fact), `Cycle.feePercent` (organizer-decision / money-fact),
`Participation.weeklyAmount` (organizer-decision / money-fact), `Participation.status`
(organizer-decision / derived-looking), `Participation.closedAtWeek` (organizer-decision /
derived-looking), `ParticipationBreak.fromWeek` (calendar-fact / organizer-decision),
`ParticipationBreak.toWeek` (calendar-fact / organizer-decision),
`ParticipationBreak.endedAt` (organizer-decision / calendar-fact), `LuckyNumber.amount`
(derived-looking / money-fact), `Payment.method` (derived-looking / money-fact),
`Payment.paidAt` (derived-looking / money-fact), `Payout.grossAmount` (derived-looking /
money-fact), `Payout.feeAmount` (derived-looking / money-fact — stored by deliberate
decision either way), `Payout.netAmount` (derived-looking / money-fact),
`CashReading.totalAmount` (derived-looking / money-fact).

## 4. Stored columns referenced by derivations but absent from Part A

These columns are read by catalogued derivations but were not documented as stored money
facts by either schema sweep, so they have no row in Part A:

- **`LedgerEntry.notes`** — read by `settledSoFarFromLedger` (`lib/settlement.ts:164`,
  `:172-185`) to decide idempotency of a terms settlement, written by
  `app/actions/edits.ts:428`, `:437`, `:448`, `:466`, and required (≥3 characters) for a
  write-off. It is money-decision-bearing and undocumented in Part A.
- **`LedgerEntry.createdAt`** — the tiebreaker in the ledger story's ordering
  (`app/actions/ledger.ts:250`, `app/admin/(protected)/people/[id]/page.tsx:89`).
- **`Setting.key`** — the discriminator that makes `Setting.value` mean `closingWaitDays`
  or `presentationMode`.
- **`Cycle.name`** — interpolated into every closing DEBT description
  (`lib/cycle-close.ts:159-162`) and into the frozen-cycle refusal (`lib/cycle-close.ts:62`).
- **`ParticipationBreak.startedAt`** (`schema:271`) — explicitly noted as not
  money-bearing by one sweep; recorded here so its absence is deliberate rather than
  accidental.
- **`PaymentEvent.idempotencyKey`** — named at
  `prisma/migrations/20260806010000_settlement_payout_link/migration.sql:24-28` as the
  parse source for the `settlementPayoutId` backfill, but never documented as a column.

## 5. Code that exists but could not be shown to be reachable

Recorded, not judged — Pass 2 may find callers the sweeps missed.

- `lib/payments-view.ts:91` (`resolveTargetWeek`) — imported at
  `app/actions/payments-view.ts:7` with **no call site**;
  `app/actions/payments-view.ts:87-91` records that the week board it served was removed.
- `lib/final-position.ts:260` (`owedToStoppedMember`, the signed-cents variant) — **no
  non-test caller found**.
- `lib/participation-close.ts:378` (`stoppedSentence`) — **no non-test caller found**.
- `lib/person-record.ts:100` (`PersonRemovalFacts.carriedBalance`) — the field is
  declared but no function in `lib/person-record.ts` reads it; both callers hardcode it to
  0 (`app/actions/edits.ts:211`, `app/admin/(protected)/people/[id]/person-edit-form.tsx:68`),
  and `ledgerEntryCount` (`app/actions/edits.ts:210`, `lib/person-record.ts:133`) is what
  actually gates removal.

## 6. Internal contradictions found but not resolved

- **`/me` paid-in and pinned settlement events.** The comment at
  `app/actions/member.ts:118-120` says pinned settlement events are filtered out of the
  member's paid-in total, while `app/actions/member.ts:344` sums `PaymentEvent.amount`
  **unfiltered**. One sweep recorded the discrepancy; it was not resolved here.
- **Two write-line pairs for the manual late mark.** One sweep cites
  `app/actions/edits.ts:1506` as the write site for `markedLateAt`; another cites
  `:1516` (create) and `:1519` (update) inside the same `setWeekLate` action. Both are in
  Part A; the exact statement boundaries were not re-read.
- **`docs/DOMAIN_RULES.md:570`** is cited by one sweep as the source for "the closing wait
  is the same span as `PAYMENT_WINDOW_DAYS`". That file was not opened in this pass; the
  in-code pin (`lib/settings.test.ts:31-32`) was.
- **`weekReceipts` vs the grid on deferral, and on out-of-window money.** Both behaviours
  are verified (`lib/dashboard.ts:252-253` vs `lib/payments-view.ts:222`/`:225`). Which is
  intended is explicitly out of scope for Pass 1.

## 7. Scope and method limits

- **This map was assembled from eleven sweeps, not from an exhaustive re-read of the
  tree.** Part C carries a verification pass over roughly 45 structural claims (all
  CONFIRMED except the two corrections above). Every other `file:line` in this document
  is reported as the sweeps found it and has **not** been independently re-opened.
- **Line numbers are a snapshot.** At audit time the working tree carried uncommitted
  modifications to `app/actions/auth.ts`, `components/member/login-flow.tsx`,
  `components/member/login-flow.test.ts`, `lib/whatsapp.ts`, `lib/whatsapp.test.ts`, and
  untracked `components/member/code-input.tsx`, `lib/code-entry.ts`,
  `lib/code-entry.test.tsx`, `lib/resend-countdown.ts`. None of those files appear
  anywhere in this map, but any later edit to a mapped file will shift its line numbers.
- **Some references are ranges, not lines.** Where a sweep reported a range
  (e.g. `lib/dashboard.ts:543-559`, `app/actions/cycle-close.ts:63–135`), the range is
  reproduced rather than narrowed.
- **Merges were made on canonical-line evidence.** Duplicate catalogue entries were merged
  only where two sweeps named the same canonical `file:line`. Judgement calls made:
  "Amount due for one week" + "What this week costs me"; "Coverage of a week at the CURRENT
  rate" + "Money covered on a week at the current rate" + "What this week is covered by";
  "Total paid by a member" + "Total contributed" + "Received by member" + "My total paid
  in"; "Committed to winners" + "Owed now"; "Undo-draw consequences" + "Undo-draw money at
  stake"; "Change in money committed to payouts" + "Cash position delta from removing a
  participation"; the four cash-verdict entries; the three archive entries; the three
  week-date-consequence entries. If any of those merges was wrong, an implementation is
  hidden inside another entry rather than lost — but it would be hidden.
- **Not in scope, therefore not mapped:** the wheel shuffle and slot-arrangement
  arithmetic itself (only its money outputs — draws, payouts, fees — are here), message
  sending mechanics beyond the money placeholders, pagination, sort orders, colours, and
  counts of things that are not money or standing.
- **No database was queried.** Every live-data figure quoted in this document
  ($12,925 paid-ahead, $3,550, 20 planned / 23 generated weeks, the $750 trigger) comes
  from comments and records already in the repo, not from a query run during this pass.


## 8. The duplicate-detection defect, and what was re-verified

**This document's first draft was wrong about duplicates, and the error is worth stating
plainly because Pass 2 inherits whichever list it trusts.**

The first sweep was asked to find quantities computed in more than one place. It searched
for related tokens and counted every match, producing the claim that **all 257 catalogued
values had multiple implementations** — a figure that is false and, being 100%, was its own
evidence of a method failure. Verified examples of what it had counted as implementations
of "amount due for one week":

- `lib/money.ts:113` — `export function calculateFinishWeek(...)`, an entirely different
  quantity;
- `lib/dashboard.ts:254` — `assertCents("weeklyAmount", ...)`, an assertion;
- `app/me/page.tsx:215` — `amountDue: w.amountDue`, a pass-through read;
- `app/actions/payments.ts:56` — `const allocation: AllocationWeek = {`, an object literal.

Five of that entry's ~40 claimed locations were opened; none computed anything.

**What was redone.** Every quantity was re-checked under a strict definition — a location
counts only if it independently performs the arithmetic or the decision, excluding reads,
pass-throughs, calls to the canonical function, type declarations, assertions, formatting,
display, and test files — with a requirement to quote the verbatim source line for each
retained location, followed by an adversarial pass instructed to default to rejection.
Result: **139 quantities re-checked, 107 with genuine multiple implementations, 32 with
exactly one, and 114 previously-claimed locations rejected.** That corrected list is
*Flagged for Pass 2* above and is the one to use.

**What this means for the rest of the document.**

- *Flagged for Pass 2* — REBUILT and evidence-backed. Trust it.
- Part B's `Other implementations` lines — produced by the superseded method. All 142 are
  relabelled **SUPERSEDED** in place. They still contain genuine annotations the second
  sweep did not reproduce (for example the observation at "Payment status of one week" that
  `patterns-view.tsx:52-55` runs the status ladder BACKWARDS, re-deriving `isSkipped` and
  `isDeferred` from `cell.status`), so they were marked rather than deleted. Treat every
  location in them as UNVERIFIED until checked.
- Parts A and C were produced by different agents and different methods and are NOT
  affected. Spot-checks against source confirmed Part A's schema line numbers and quoted
  comments, and confirmed two of Part C's own corrections
  (`lastPaymentWeek` is a last-element read at `lib/standing.ts:199`, not a maximum; the
  `Standing.surplus` / `Contribution.surplus` name collision, where only the second reaches
  a surface).

**A count discrepancy, stated rather than reconciled.** The raw catalogue held 257 rows;
this document's Part B holds ~139 quantities after the synthesis merged rows that two
subsystem sweeps had found independently. The re-check worked from the merged Part B, so
its denominator is 139. The merge judgements are listed in *Scope and method limits* above.
