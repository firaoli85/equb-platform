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
| `addLuckyNumber` / `updateLuckyNumber` | Reject a duplicate — **and say who holds it, then offer replace or keep** | **FIXED** — both answered "Number 22 is already taken in this cycle": true, and useless. Now the holder is named; REPLACE renumbers them (a true swap when the edit vacates a number), refused when their number is drawn or carries a payout; KEEP names the free number instead. |
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
