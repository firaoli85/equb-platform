# STATE-CONSISTENCY AUDIT

**Every action that changes state, what it must cascade to, and whether it does.**
August 2026. Verified against the code and, where marked, against the live database.

The principle this enforces: **an action must leave the system consistent, and every
surface must reflect it.** Two ways to fail — the cascade is incomplete (a child record
survives its parent's meaning), or a surface describes stale state (a picker built from
something other than the live rows).

Legend: **OK** verified · **FIXED** was broken, repaired in this pass · **GAP** known and
accepted, with the reason.

---

## 1. THE FAILURE THIS AUDIT CAME FROM

Moving week 6's only winner to week 7 moved the payout and the slot membership, and left
the `Draw` behind. The week was then in a half-state:

- counted as **drawn** — `Draw.@@unique([weekId])` refuses a second draw, so it could
  never be redrawn
- holding **nothing** — so the week picker rendered `Week 6 — already drawn · replacing
  it undoes that draw` with the money silently omitted, while every other drawn week
  quoted a figure
- **impossible to assign to** — the only escape was an undo that Collections did not even
  offer, because that page built its groups from *payouts*, and a draw with no payouts
  produced no group at all

Three separate paths could create it (`removeWinnerFromWeek`, `movePayoutToWeek`,
`deletePayout`) and none of them cleaned up. A fourth (`removeParticipation`) created it
by cascade.

**The rule now:** a `Draw` records that a slot **won** a week. With no payout left there is
no win, so the draw is deleted, the week becomes genuinely undrawn, and its slot numbers
return to the pool. One implementation — `lib/draw-cascade.ts` — called by every path.

---

## 2. DRAWS, PAYOUTS AND THE WHEEL POOL

| Action | Must cascade to | State |
|---|---|---|
| `recordDraw` | Draw + one Payout per slot number; settle each winner's own week from their payout; fulfil the plan targeting the week; numbers leave the pool | **OK** |
| `undoDraw` | Reverse settlements, delete payouts, delete draw, numbers return to pool, fulfilled plan → `PLANNED` | **OK** |
| `spinWheel` | Nothing written but the audit line; the plan decides or chance does | **FIXED** — a plan with **zero numbers** matched the first eligible slot and silently decided the week. `[].every(...)` is vacuously true. Now refused, and such plans are purged at source. |
| `addWinnerToWeek` | SlotMember **and** Payout together; re-run settlement; number leaves the pool | **OK** |
| `removeWinnerFromWeek` | Reverse that payout's settlement, delete payout, delete SlotMember, number returns · **and delete the draw if it was the last winner** | **FIXED** |
| `movePayoutToWeek` | Reverse source settlement, move payout **and** SlotMember, settle destination · **create the draw when the destination has none** · **delete the source draw if it was the last winner** | **FIXED** |
| `deletePayout` | Reverse that payout's settlement; draw stands while another winner remains · **draw deleted when it was the last payout** | **FIXED** |
| `moveDraw` | Un-settle the old week, move, re-settle the new one | **OK** |
| `changeDrawSlot` | Refuses outright once payouts exist — repointing would return the old numbers to the pool while their money stayed behind | **OK** |
| `assignPayoutManually` | Undo any existing draw + assign, in ONE transaction; new slot, draw, payouts, settlement; fulfilled plan → `PLANNED` | **OK** |
| `saveSlots` | Frozen slots must arrive byte-identical, including slot **identity** (a re-housed slot would cascade-delete its Draw) | **OK** |
| `reshuffleSlots` / `autoArrangeSlots` | Drawn and committed numbers excluded from the pool (2.3) | **OK** |
| `createWinnerPlan` / `cancelWinnerPlan` | Numbers locked / unlocked; vacated slots cleaned only if empty and undrawn | **OK** |

### Surfaces

| Surface | Must read | State |
|---|---|---|
| Collections week groups | Built from the cycle's **draws** | **FIXED** — was built from *payouts*, so a draw holding none was invisible and could not be undone. An empty draw now renders with a named callout. |
| "Move a winner to another week" picker | **Every** week of the cycle with live state; free weeks free, drawn weeks with real totals | **FIXED** — was derived from the payout groups, so free weeks were never offered and moving into an undrawn week was refused outright. |
| "Assign a payout" week picker | Live weeks, each labelled with its real consequence | **FIXED** — a drawn week holding no payout rendered with a blank money slot (`(, no payout recorded)`). Now named for what it is, and no typed confirmation is demanded when there is no money record to destroy. |
| Wheel setup / draw screen | Drawn-ness derived from `draw.slot.members`, never stored | **OK** |

---

## 3. PARTICIPATIONS AND LUCKY NUMBERS

| Action | Must cascade to | State |
|---|---|---|
| `addToCycle` / `addNewPersonToCycle` | Participation + lucky numbers in one transaction; weeks generated through the finish week | **FIXED** — no audit entry existed, so the numbers a member was given could not be traced to when or how they were chosen (D-32). |
| `updateParticipation` | Replay receipts oldest-first; resize win-week settlements and credit the difference **back to the payout**; settlement step for a drawn member; ledger keyed by cycle id so a second edit charges only the difference | **OK** |
| `removeParticipation` (legacy path) | Reverse settlements **before** the cascade nulls the payout FK; delete draws left empty; purge plans left empty; release emptied slots | **FIXED** — was a bare cascade delete leaving four orphans. |
| `removeFromCycle` (two-choice path) | Same, plus the "keep money records" option as a status change rather than a delete | **OK** |
| `addLuckyNumber` / `updateLuckyNumber` | Reject a duplicate — **and say who holds it, then offer replace or keep** | **FIXED (twice)** — both answered "Number 22 is already taken in this cycle": true, and useless. The holder is now named; KEEP offers the free number; REPLACE is refused when their number is drawn or carries a payout. **This row read FIXED while REPLACE could never succeed** — see §9. |
| `deleteLuckyNumber` | Blocked while payouts exist; **purge plans left with no numbers**; release emptied slots | **FIXED** |
| Carry-over numbering on a new cycle | Reuse each previous number **where free**, fill only the clashes | **FIXED** — was all-or-nothing: one clash discarded the whole set and silently renumbered someone who could have kept their number. |
| Fresh numbering on a new cycle | Next free sequential values from 1, manual override always available | **OK** |
| `deletePerson` | Refused while participations or ledger entries exist (2.5, 2.18) | **OK** |

---

## 4. MONEY: PAYMENTS, RECEIPTS, WEEKS, LEDGER

| Action | Must cascade to | State |
|---|---|---|
| `recordPayment` | Receipt → allocations oldest-first → week rows; duplicate rejected by the DB, not by memory; automatic confirmation message | **FIXED** — the only write with **no audit entry**. The receipt recorded *what* arrived; nothing recorded the *allocation decision* that turns one amount into a set of covered weeks. |
| `updatePaymentEvent` / `deletePaymentEvent` | Replay every week of the member's window | **OK** |
| `updatePaymentRow` / `setWeekDeferral` | Replay receipts when deferral flips (it changes what is owed) | **OK** |
| `updateWeek` (skip toggle) | Replay **every** participation in the cycle | **OK** |
| `updateCycle` (shrink) | Refuse while removed weeks carry payments or draws, or a commitment runs past the new end | **OK** |
| `updatePayout` | Recalculate the cash position | **OK** |
| `deductCarryFromPayout` | Ledger entry + payout decrement, never automatic (D-23) | **OK** |
| `recordLedgerPayment` / `forgiveBalance` | Balance derived from the ledger, never stored | **OK** |
| `closeCycle` | Archive **before** any wipe; a DEBT entry per short member; blocked while anyone is undrawn unless acknowledged (2.27) | **OK** |
| `deleteClosedCycle` | Cascade everything of the cycle; keep people, ledgers, archive, audit · **and the per-cycle numbering Setting row** | **FIXED** — `Setting` has no relation to `Cycle`, so `numberingMode:<id>` outlived the cycle forever. |
| Derived figures (weeks credited, behind, late, status, balance) | Never stored — always computed (2.14) | **OK** |

---

## 5. GAPS LEFT OPEN, DELIBERATELY

| Gap | Why it is left |
|---|---|
| Settlement receipts orphaned by a payout deleted **outside** the guarded paths | `PaymentEvent.settlementPayoutId` is `SetNull` on delete, so a receipt could survive its payout and keep a week credited. Every current path un-settles first, and the live audit found **zero** such rows. Making the FK `Cascade` would delete money records silently, which is worse. `scripts/audit-empty-draws.mts` reports any that appear. |
| Two removal paths coexist (`removeParticipation`, `removeFromCycle`) | Both are cascade-correct. Consolidating them is a refactor, not a fix, and doing it while another change was in flight risked losing one. |
| `recordDraw` / `undoDraw` do not release an emptied slot | Harmless: a slot with members and no draw is simply back in the wheel pool, which is the intended result. Only a slot with **no members and no draw** is dead weight, and those are released. |

---

## 6. HOW EACH FIX IS HELD IN PLACE

Per 2.24, two levels — unit tests for the pure rules, behavioural verification against the
live database for what only the database can prove.

| Test | Covers |
|---|---|
| `lib/draw-cascade.test.ts` | The emptiness rule, both live shapes (a stranded number, an emptied slot), and the audit clause |
| `lib/week-winners.test.ts` | `freedWeek` in every preview; an undrawn destination allowed; a committed plan still refused |
| `lib/lucky-numbers.test.ts` | Per-number carry-over; the conflict message names the holder; REPLACE refused on a drawn or paid number |
| `lib/wheel.test.ts` | A plan with zero numbers cannot decide a draw, and does not silently take the first slot |
| `lib/manual-payout.test.ts` | An empty draw never renders as a drawn week with a blank amount |
| `scripts/verify-draw-cascade.mts` | **The decisive one:** after the cascade the week *accepts a new draw* — what was impossible before. Plus slot release, plan restoration, stranded numbers returning, and a populated draw left untouched. |
| `scripts/verify-week-winners.mts` | Add / move / remove keep payout and slot membership together |
| `scripts/audit-empty-draws.mts` | Read-only sweep for every inconsistency named above |
| `scripts/repair-empty-draws.mts` | Repairs live data **through the same functions the app runs**, so repair and runtime cannot drift |

---

## 9. THE FULL AUDIT — 73 actions mapped, 48 breaks confirmed

An 88-agent pass in August 2026: every state-changing action mapped to what it MUST
cascade to (derived from the schema and the domain rules, before reading the code), then
compared, then every claimed break handed to an independent agent whose job was to
REFUTE it. The 48 below survived that. Sections 1–8 above were written DURING the run
and are corrected by it where they disagree.

**The most important finding is that this document was wrong.** §3 recorded the
number-conflict replace/keep work as FIXED. The verifier proved REPLACE could never
succeed — `renumberHolder` moved the holder onto a number the edited row still held, so
a plain (non-deferrable) unique index refused it every time and the organizer who
pressed *"Replace — take #22 and move Meheret"* was shown *"Number 22 is already taken
in this cycle"* — the exact dead end the feature exists to replace. Reproduced against
the live database, then fixed with a three-statement swap. The verification script that
had passed used a fixture numbered 10, 11, 20, so a low number was always free and
neither the swap nor the create path ever hit the case. It now runs on 1, 2, 3.

| # | Severity | Action | File | What is left inconsistent |
|---|---|---|---|---|
| 1 | **HIGH** | `updateLuckyNumber` | app/actions/edits.ts:641 | TWO independent defects. (1) REPLACE — the swap — CAN NEVER SUCCEED. Proven against the live database. renumberHolder parks the holder at max+1 and then sets it to `to` = before.number (edits.ts:688-692 calling lib/number-conflict.ts:76-86), but the row being edited still holds before.number: it doe… |
| 2 | **HIGH** | `addLuckyNumber` | app/actions/edits.ts:733 | (1) MONEY OUT WITH NO MONEY IN. edits.ts:786-793 creates the number with any amount from 1 to MAX_MONEY_CENTS and never touches participation.weeklyAmount, never replays receipts. The member's weekly bill is unchanged (lib/rebuild.ts:88 reads participation.weeklyAmount) while their payout entitlemen… |
| 3 | **HIGH** | `updatePayout` | app/actions/edits.ts:1420 | TWO distinct breaks. (1) The settlement pair is one-sided. lib/settlement-receipt.ts:62-78 refuses any amount edit on a settlement receipt and tells the organizer verbatim: 'To correct the payout itself, edit the payout on Collections.' Collections is this action, and it has NO settlement awareness … |
| 4 | **HIGH** | `updateParticipation` | app/actions/edits.ts:203 | Left inconsistent: (a) a PLANNED WinnerPlan whose numbers can no longer be drawn — it stays locked, keeps its numbers frozen, can never fire, and BLOCKS the target week's draw; (b) a Draw + Payout recording a win on a week the member no longer participates in; (c) orphan Week rows past the planned e… |
| 5 | **HIGH** | `removeFromCycle` | app/actions/participation-removal.ts:169 | keep-money-records leaves a CLOSED member's SlotMember rows and PLANNED WinnerPlan in place. Sequence: member A (#7) and member B (#9) share slot 4. A is removed with 'keep money records'. A's participation is CLOSED, but slot 4 still holds #7, so lib/wheel.ts:46 makes #7 ineligible and app/actions/… |
| 6 | **HIGH** | `undoDraw` | app/actions/wheel.ts:750 | THE ZERO-NUMBER WinnerPlan IS BORN HERE. app/actions/wheel.ts:802-807 does `findFirst({ where: { cycleId, weekId, status: "FULFILLED" } })` and unconditionally `update({ data: { status: "PLANNED" } })` with NO check that the plan still has numbers, and app/actions/wheel.ts never imports purgeEmptyWi… |
| 7 | **HIGH** | `spinWheel` | app/actions/wheel.ts:595 | loadWheel builds eligibleSlots at app/actions/wheel.ts:118-120 as `draws.length === 0 && members.length > 0 && members.every(m => eligibleIds.has(m.luckyNumberId))`, and eligibleIds (lib/wheel.ts:44-50) excludes only drawn numbers, inactive owners and closed windows. Numbers committed to a FUTURE we… |
| 8 | **HIGH** | `addWinnerToWeek` | app/actions/week-winners.ts:114 | THE SLOT MEMBERSHIP IS DUPLICATED, NEVER MOVED. app/actions/week-winners.ts:154-156 calls tx.slotMember.create({ slotId: week.draw.slotId, luckyNumberId }) with no preceding deleteMany. The number keeps its membership in the arrangement slot it was already in AND gains one in the drawn slot. This is… |
| 9 | **HIGH** | `movePayoutToWeek` | app/actions/week-winners.ts:332 | THE REPORTED DEFECT IS FIXED: line 435 calls deleteDrawIfEmpty(tx, fromWeek.draw.id), which restores a FULFILLED plan to PLANNED (lib/draw-cascade.ts:137-142), deletes the Draw (:144) and releases the emptied Slot (:146-151); an undrawn destination now gets a fresh Slot + Draw (app/actions/week-winn… |
| 10 | **HIGH** | `assignPayoutManually` | app/actions/manual-payout.ts:161 | THREE breaks. [1] A number COMMITTED TO A PLANNED WINNER PLAN can be silently consumed. The only per-number guard is numbersRefusal (manual-payout.ts:326-334), which tests `alreadyDrawn` only (lib/manual-payout.ts:164-174). The action DOES build a frozen-id set from PLANNED plan numbers (manual-payo… |
| 11 | **HIGH** | `numbersRefusal` | lib/manual-payout.ts:164 | ManualPayoutNumber (41-47) has `alreadyDrawn` and nothing else, and the function (164-174) tests only that. A number reserved by a PLANNED WinnerPlan passes straight through, is consumed into a manual Draw, and leaves the plan holding a drawn number — the state that makes selectWinningSlot throw on … |
| 12 | **HIGH** | `removeFromCycle` | app/actions/participation-removal.ts:169 | THE ORIGINAL DEFECT IS REPRODUCIBLE THROUGH THIS ACTION. Step 3 (:232-244) decides whether to delete a Draw from SLOT MEMBERSHIP (`survivors = sm.slot.members.filter(m => !mine.has(...))`), never from PAYOUTS REMAINING. Step 2 (:227) has just deleted every payout of the removed member. Sequence: slo… |
| 13 | **HIGH** | `addToCycle` | app/actions/participations.ts:252 | REPLACE IS DEAD IN THE DEFAULT CASE. With `to: null`, renumberHolder returns the holder to the very number being contested whenever every number below it is taken — which is the normal state, since lib/lucky-numbers.ts:48-69 assigns 'the next FREE SEQUENTIAL values counting up from 1'. Concretely: c… |
| 14 | **HIGH** | `addNewPersonToCycle` | app/actions/participations.ts:318 | The Person + Participation atomicity D-30 demands is genuinely correct — verified, not assumed. What is broken is the same REPLACE branch: :358 passes `manualNumbers: input.numbers` and `onConflict` into createParticipationWithNumbers, which at :121 calls `renumberHolder(..., to: null)`. Per lib/num… |
| 15 | **HIGH** | `createCycle` | app/actions/cycles.ts:43 | `status: active ? "DRAFT" : "ACTIVE"` (cycles.ts:132) is the ONLY place in the repo that ever writes DRAFT, and no code anywhere ever reads a DRAFT cycle or moves it out of DRAFT. I grepped every `cycle.update`/`updateMany` in the tree: there are exactly two — cycle-close.ts:353-356 (writes CLOSED) … |
| 16 | **HIGH** | `closeCycle` | app/actions/cycle-close.ts:294 | `memberFinals().receivedNet` sums every payout on the member's numbers with no status filter — `n.payouts.reduce((s, po) => s + po.netAmount, 0)` (cycle-close.ts:110-113). buildArchiveData then sets `paidOutNet = Σ receivedNet` and `stillHeld = received - paidOutNet` (lib/cycle-close.ts:183, 193-196… |
| 17 | **HIGH** | `closeCycle` | app/actions/cycle-close.ts:353 | closeCycle flips the status and nothing else changes anywhere member-facing. Every member-portal query is gated on `cycle: { status: "ACTIVE" }`, so the instant the organizer presses close, all 25 members lose their entire record. getMyPortal: `prisma.participation.findFirst({ where: { personId, sta… |
| 18 | **HIGH** | `deductCarryFromPayout` | app/actions/carry-deduction.ts:124 | THREE breaks. (1) THE RE-READ IS NOT IN THE TRANSACTION. loadPayoutContext (carry-deduction.ts:39-40) issues `prisma.payout.findUnique`, not `tx.payout.findUnique`, and is called from INSIDE serializableTransaction at carry-deduction.ts:137 under the comment 'Re-read inside the transaction so a bala… |
| 19 | **HIGH** | `signOutAction` | app/actions/auth.ts:787 | Member is signed in on phone and laptop; both have SignInSession rows with revokedAt = null. They tap 'Sign out' on the phone. Line 794 revokes the phone's row. Line 795 issues a GLOBAL Supabase logout, killing the laptop's refresh token too. The laptop's access token stays valid for its remaining T… |
| 20 | **HIGH** | `signOutEverywhereElse` | app/actions/sessions.ts:122 | The feature exists for the case where someone else is holding a device (lib/pin.ts:110-117 lists it as one of the compensating controls for the phone-digit default PIN). The person holding that device opens devtools → Application → Cookies and deletes the `equb_session` handle (lib/session-cookie.ts… |
| 21 | **HIGH** | `sendBatch` | app/actions/messages.ts:415 | Organizer opens the winner batch for week 6, prepareBatch renders correct text for the week-6 winner. Before he presses Send, either (a) week 7 is drawn, or (b) he runs app/actions/week-winners.ts:222 removeWinnerFromWeek / :332 movePayoutToWeek — the exact operation that prompted this audit. sendBa… |
| 22 | **HIGH** | `resetMemberPin` | app/actions/auth.ts:726 | A member reports someone else got into her account. Organizer opens her Settings tab, sees the intruder's row in 'Recent sign-ins' with a green 'Signed in' pill, and does the one thing that page tells him to do: Reset PIN. Line 739 clears pinHash. The intruder's SignInSession row is untouched (revok… |
| 23 | **MEDIUM** | `deleteLuckyNumber` | app/actions/edits.ts:823 | The three things it does are right: the payout refusal (edits.ts:839-843), purgeEmptyWinnerPlans (edits.ts:850) and the empty-slot release (edits.ts:853-855). Four things are missing. (1) SUM(amount) < weeklyAmount afterwards, silently. Nothing reconciles participation.weeklyAmount, so the member ke… |
| 24 | **MEDIUM** | `updatePerson` | app/actions/edits.ts:85 | The action accepts a phone that already belongs to another Person and neither refuses nor warns. Person.phone carries no @unique (prisma/schema.prisma:19), there is no check here (edits.ts:97-110), none in createPerson (app/actions/people.ts:104-111), and none in the database. findPeopleByPhone is a… |
| 25 | **MEDIUM** | `setWeekNote` | app/actions/edits.ts:1179 | edits.ts:1197-1202 resolves the week by (cycleId, weekNumber) — any week of the cycle — and 1206-1210 upserts a Payment row for it. participation.startWeek and weeksCommitted are loaded (via findUniqueOrThrow at :1193) but never consulted. Calling setWeekNote({participationId, weekNumber: 20, note: … |
| 26 | **MEDIUM** | `setWeekDeferral` | app/actions/edits.ts:1114 | Identical missing window guard to setWeekNote: edits.ts:1136-1141 resolves the week by (cycleId, weekNumber) with no bound against participation.startWeek / weeksCommitted, and 1146-1155 upserts. A direct call for a week outside the member's window creates a payments row flagged isDeferred that no s… |
| 27 | **MEDIUM** | `deletePayout` | app/actions/edits.ts:1518 | THE PRIME SUSPECT IS CLEAN. Deleting the LAST payout of a draw DOES delete the draw: edits.ts:1531 unsettlePayout, :1532 payout.delete, :1533-1535 deleteDrawIfEmpty(target.draw.id). lib/draw-cascade.ts:128-135 computes payoutsRemaining and returns early if any remain; :137-142 restores a FULFILLED W… |
| 28 | **MEDIUM** | `updateCycle` | app/actions/edits.ts:1530 | Shrinking plannedWeeks orphans a locked winner plan from its week, permanently. Sequence: a 20-week cycle where everyone joined at week 1 for 15 weeks (so deepestFinish is 15). The organizer plans '#7 wins week 18' (app/actions/wheel.ts:484-491 accepts any week row in the cycle; only the NUMBER must… |
| 29 | **MEDIUM** | `updateWeek` | app/actions/edits.ts:1180 | The server accepts a week date that runs backwards, which moves who is overdue and mis-dates every week generated afterwards. Sequence: the organizer fixes a typo on week 18 and enters 2026-05-24 (a date already past) instead of 2026-09-13. The picker's bound is bypassed by calling the action direct… |
| 30 | **MEDIUM** | `ensureWeeksThrough` | lib/participation-rules.ts:60 | Override weeks outlive the commitment that created them, and no product path can delete them. Sequence: cycle plannedWeeks 20; a member is extended to week 25 with the 2.22 override, so ensureWeeksThrough creates weeks 21-25. The member is then shortened back to week 20, or removed from the cycle en… |
| 31 | **MEDIUM** | `createWinnerPlan` | app/actions/wheel.ts:441 | The write path itself is correct and I could not break it: the frozen-neighbour check (:495-508) refuses to strand a locked number, the vacated-slot cleanup carries both `members: { none: {} }` and `draws: { none: {} }` (:524-526), and the position is taken as max+1 AFTER the member deletions but BE… |
| 32 | **MEDIUM** | `removeWinnerFromWeek` | app/actions/week-winners.ts:222 | THE CORE CASCADE IS CORRECT AND THE REPORTED DEFECT IS FIXED HERE. The ordering is right: unsettlePayout at :259 runs BEFORE payout.delete at :260, so the SetNull on PaymentEvent.settlementPayoutId never fires and no orphan receipt survives; the SlotMember is deleted at :263-265 so the number return… |
| 33 | **MEDIUM** | `poolCandidates` | app/actions/week-winners.ts:491 | It is genuinely LIVE — every call re-reads through prisma (:495-504) and rebuilds the drawn set from draw.slot.members via drawnNumberIds (:499, :69-78), with no cached flag anywhere; and revalidateAll (:481-488) covers /admin/collections, /admin/cycle/draws, /admin/wheel, /admin/wheel/setup, /admin… |
| 34 | **MEDIUM** | `getManualPayoutOptions` | app/actions/manual-payout.ts:35 | The `numbers` payload (137-152) carries only `alreadyDrawn`. It never says a number is committed to a PLANNED WinnerPlan, even though the action already knows how to compute that set (the same file does it at 338-342 inside the write path). So the picker cheerfully offers a reserved number as free, … |
| 35 | **MEDIUM** | `weekChoice` | lib/manual-payout.ts:78 | Its input type (ManualPayoutWeek, 26-39) has no slot for carried-balance deductions, so the sentence it builds (128-140) can never name them; a replace that silently strands a LedgerEntry PAYMENT is described to the organizer as touching only payouts and settlements. It also cannot see whether the C… |
| 36 | **MEDIUM** | `participationRemovalPreview` | app/actions/participation-removal.ts:129 | The preview is faithful to the mutation, and that is the problem — it inherits the wrong emptiness test rather than catching it. In the scenario where the removal will leave a Draw holding zero payouts (see removeFromCycle), `drawsLeftEmpty` is empty because the slot still has a member, so the confi… |
| 37 | **MEDIUM** | `removalConsequences` | lib/participation-removal.ts:201 | Three of its claims are not true of the code that implements them. (1) `cleanup` can never mention a draw stranded with zero payouts, because it is built from slot membership, not payouts — so the one orphan this whole module was written to prevent is the one it cannot describe. (2) keepMoneyRecords… |
| 38 | **MEDIUM** | `feeAttributable` | lib/participation-removal.ts:87 | The fee is multiplied by the number of lucky numbers the member holds. A member contributing $2,000/week at a $1,000 unit holds two numbers (lib/money.ts:59-69); real gross over 20 weeks is $40,000 and the 2% fee is $800, but feeAttributable reports gross $80,000 and a fee of $1,600 — double. Anyone… |
| 39 | **MEDIUM** | `recordPayment` | app/actions/payments.ts:156 | Nothing is left half-written — the transaction is sound. What is left inconsistent is WHERE the money can land. Sequence: (1) organizer uses Settings → remove from cycle → 'keep the money records' for a member; Participation.status becomes CLOSED, cycle stays ACTIVE (app/actions/participation-remova… |
| 40 | **MEDIUM** | `getMemberStanding` | app/actions/payments.ts:348 | Sequence: organizer skips week 5 for everyone (/admin/cycle/weeks → updateWeek). A member committed to 20 weeks now has a 20-week window of which only 19 are payable. Once they have paid all 19, getMemberStanding still reports contribution.stillToSave = one week's amount and progress = 0.95, and sav… |
| 41 | **MEDIUM** | `createCycle` | app/actions/cycles.ts:145 | The assignment rule itself is correct: fresh counts up from 1 skipping taken values (lib/lucky-numbers.ts:64-68), manual override is honoured and validated (app/actions/participations.ts:139-146), and carry-over is per-number rather than all-or-nothing (lib/lucky-numbers.ts:58-63 + participations.ts… |
| 42 | **MEDIUM** | `closeCycle` | app/actions/cycle-close.ts:294 | (a) IRREVERSIBLE. There is no reopen — I grepped every `export async function` in app/actions/*.ts and every `cycle.update` in the tree; the only status writes are cycles.ts:132 (creation) and cycle-close.ts:355 (→CLOSED). And the DEBT rows it writes cannot be removed: app/actions/ledger.ts exports … |
| 43 | **MEDIUM** | `deleteClosedCycle` | app/actions/cycle-close.ts:433 | The cascade itself is correct and complete — I verified every relation resolves to a real database-level ON DELETE CASCADE rather than a Prisma-emulated one (prisma/migrations/20260804172305_init/migration.sql:197-245, .../20260804190000_lucky_number_per_cycle_and_one_active_cycle/migration.sql:8, .… |
| 44 | **MEDIUM** | `recordCarryDecision` | app/actions/ledger.ts:227 | (1) THE INTENTION NEVER EXPIRES, AND RE-ARMS ITSELF ON AN UNRELATED DEBT. carryIntent is written only here (app/actions/ledger.ts:262-265) and read only by payoutCarryOffer (app/actions/carry-deduction.ts:52-54, 89-107). Nothing clears it — not the deduction, not a full ledger payment, not forgivene… |
| 45 | **MEDIUM** | `signInWithPin` | app/actions/auth.ts:152 | defaultPinFromPhone is off (app/actions/settings.ts:127 exists precisely so it can be) and a member has no pinHash. Anyone who knows her number POSTs signInWithPin repeatedly: every call increments pinFailedAttempts and returns the generic error, with no lock ever set (line 211 skips lockoutAfterFai… |
| 46 | **MEDIUM** | `setPinLoginAllowed` | app/actions/auth.ts:765 | Organizer sets a member to 'Always allowed (even when globally off)' — the option that keeps her PIN door open after PIN login is retired platform-wide. Nothing is recorded. Months later, after PIN login is switched off for cycle 2, that member is still signing in with four digits and the audit log … |
| 47 | **MEDIUM** | `setMemberPin` | app/actions/auth.ts:631 | Organizer replaces a compromised PIN. The compromised session keeps working for up to 7 idle days (lib/session-policy.ts:45). The audit entry the action writes even says 'The organizer knows this PIN — the member should change it' (auth.ts:661-663), acknowledging the credential is now shared, while … |
| 48 | **LOW** | `listCarriedBalances` | app/actions/ledger.ts:172 | The money is right and live — people are queried with their entries every call, the balance/raised/repaid/forgiven quadruple comes from ledgerStory, the total is summed in the request, and nothing is stored (app/actions/ledger.ts:179-210). One derived label is wrong: `oldest` is entries[0].occurredA… |

Full per-finding detail, including each verifier's reproduction sequence, is in the
workflow transcript. The fixes are being worked in severity order; this table is the
backlog and each row is struck as it closes.

---

## 10. TYPED CONFIRMATIONS — the audit, and where the line is drawn

**Found by pulling one thread.** `assignPayoutManually` checked
`nameConfirmed(input.replaceConfirmation, …)` server-side, which reads as a real gate. The
client sent `options.confirmPhrase` — **its own copy of the expected value** — so the check
passed unconditionally. Auditing every other typed confirmation found the same shape on the
two most consequential actions in the product.

### 10.1 Decorative — the server checked a value the client supplied

| Action | What the client sent | What it destroys |
|---|---|---|
| `closeCycle` | `review.cycleName` | writes a carried debt onto every short member, freezes the books |
| `deleteClosedCycle` | `cycle.name` | wipes every participation, week, receipt, draw and payout |
| `assignPayoutManually` | `options.confirmPhrase` | destroys collected payouts |

All three now forward what `ConfirmDialog` hands to `onConfirm`. The two that were already
real — `removeFromCycle` and the participation settlement — bind to actual input state.

### 10.2 Client-only — a dialog with no server check at all

Seven places set `requirePhrase` on the dialog while the action took no confirmation. **The
organizer's ruling, August 2026:** add a server check to four, leave three.

> **The threat is not an attacker.** There is one admin, and he owns the data. It is a tired
> organizer on a Sunday clicking something whose consequence he did not register, or a
> double-submit, or a stale form replay. A server check makes the confirmation unbypassable
> for actions that destroy money records; for a phone edit it is not worth the friction.

**Server-checked** — destroys something that cannot be rebuilt from anything else:

| Action | Condition | Compared against |
|---|---|---|
| `undoDraw` (both entry points) | any payout COLLECTED | the cycle name |
| `deletePayout` | that payout COLLECTED | the member's name |
| `forgiveBalance` | always | the person's name |
| `deletePerson` | always | the person's name |

**Left client-only** — recoverable, or the modern path already checks:

| Action | Why |
|---|---|
| `removeParticipation` | the legacy path; `removeFromCycle` supersedes it and does check |
| `updatePerson` clearing a phone | a mistyped number is retyped in ten seconds |

The distinction is deliberate and is **not** "how dangerous does it feel" — it is whether an
accidental click loses something the organizer cannot get back.

### 10.3 The guard

`lib/confirm-phrase.test.ts`, five assertions:

1. `ConfirmDialog` hands `onConfirm` what the human typed.
2. **No caller passes a client-derived value as the proof.** The tell is a *dot* —
   `review.cycleName`, `cycle.name`, `options.confirmPhrase` are member expressions; a real
   one forwards a bare identifier. Matching on the dot also steps around every type position,
   which two earlier attempts at this matcher kept tripping over.
3. The four irreversible actions each take a `typedName` **and** compare it, scoped to their
   own function body so a neighbour's check cannot satisfy them.
4. The comparison rejects an empty or absent value — the replay case *is* the empty case.
5. Every action accepting a proof field actually compares it — the mirror failure.

**Proven non-vacuous seven times**, not once: a script re-plants each of the three decorative
defects and neuters each of the four new checks in turn, running the guard against each and
restoring the file.
