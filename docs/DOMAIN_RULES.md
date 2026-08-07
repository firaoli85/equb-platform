# DOMAIN RULES

Every settled money and cycle rule, in one place, written so each can be checked.

**What this is for.** The Ground Truth says *why*; this says *what*, in a form you can
verify. Each rule has a one-line statement, a worked example with real figures, and the
test that pins it. When a rule has **no test**, it says so — [the untested
list](#rules-with-no-test) at the bottom is real outstanding work, not a disclaimer.

**Precedence.** `EQUB_GROUND_TRUTH.md` wins over this document; this document wins over
the code. If code disagrees with a rule here, the code is wrong — unless the organizer
has ruled otherwise, in which case both documents get updated in the same change.

**Money is integer cents everywhere.** Never floats, never dollars in storage. `$500` is
`50_000`.

---

## 1. The pot is structural

> **A cycle of N weeks has N slots and collects `N × unitAmount` every week. The roster
> does not change the pot.**

Exactly one slot pays out per week, so the number of weeks *is* the number of slots.
Members fill those slots however that works out — two friends can share one, one person
can hold three — and the weekly pot is unmoved either way.

```
weeklyPot  = plannedWeeks × unitAmount
weeklyFee  = weeklyPot × feePercent
cycleTotal = weeklyPot × plannedWeeks
totalFees  = cycleTotal × feePercent
```

**Worked, at `unitAmount = $1,000`, `feePercent = 2`:**

| Weeks | Per week | Fee/week | Cycle total | Total fees |
|---|---|---|---|---|
| 20 | $20,000 | $400 | $400,000 | $8,000 |
| 25 | $25,000 | $500 | $625,000 | $12,500 |
| 30 | $30,000 | $600 | $900,000 | $18,000 |

**The consequence that is easy to get wrong:** both the pot *and* the week count grow
with length, so the total grows with the **square**. 30 weeks is **2.25×** a 20-week
cycle, not 1.5×. A projection that holds the pot fixed reports 1.5× and misinforms the
length decision.

`totalFees` is taken on the true total, never as `weeklyFee × weeks` — each is rounded to
the cent and multiplying a rounded figure drifts.

**Pinned by:** `lib/projection.test.ts` → *"cycleFeeProjection — a longer cycle is a
BIGGER cycle"*, *"the optional override, for when reality differs"*, *"refuses inputs
that cannot describe a cycle"*.

---

## 2. Fee and payout

> **Fee is 2% of gross. Payout is gross minus fee. Each lucky number pays its own fee.**

$100 per $5,000. The fee is charged **per member payout**, not once on the pot — a member
holding three numbers pays three fees, because they receive three payouts.

**Worked:** Alem, $500/week for 9 weeks → gross `$4,500` → fee `$90` → payout `$4,410`.

**Worked (multi-number):** a $2,000/week member at a $1,000 unit holds 2 numbers. Each
number is its own payout of `$1,000 × 20 = $20,000` gross, `$400` fee, `$19,600` net —
**not** one $40,000 payout with a single $800 fee. The arithmetic agrees here, but the
*record* differs, and the record is what the archive keeps.

Fee percent is configuration (2.6), read at calculation time. `2` is the current value,
not a constant in code.

**Pinned by:** `lib/money.test.ts` → *"calculateFee"*, *"calculateNet"*, *"calculateGross"*;
`lib/wheel.test.ts` → *"calculatePayout — one payout per number, each pays their own fee"*.

---

## 3. Money is the truth; everything else is derived

> **Store what happened. Compute everything else, every time.**

**Stored:** money received (amount, date, method), and `deferred` — a real decision the
organizer made.

**Derived, never stored:**

| Value | How |
|---|---|
| Weeks credited | total paid ÷ **current** weekly amount |
| Weeks behind | weeks elapsed in their window − weeks credited |
| Status | from amount against the weekly amount |
| Late | unpaid **and** the payment window has closed — from the calendar |
| Current week | from the stored week dates (see rule 7) |
| Finish week | start week + weeks committed |
| Total contributed | the sum of the receipts, and nothing else |

**Worked (the rate change):** paid 6 weeks at $250 = `$1,500`, then moves to $500/week.
`$1,500 ÷ $500 = 3` weeks credited → they are now **3 weeks behind**. No migration, no
special case, no stored value to correct.

**Worked (uneven):** $450/week, `$1,000` arrives → 2 full weeks (`$900`) + `$100` partial
on the third.

**Three figures that must never be conflated** (a savings group is not a debt collector):

| Figure | Meaning | Worked |
|---|---|---|
| Paid in | what they have saved | `$0` |
| Still to save | `weeklyAmount × weeksCommitted − paidIn` | `$4,500` |
| Overdue | only weeks whose window has **closed** unpaid | `$500` |

"Still to save" is not owed. Only "overdue" is.

**Pinned by:** `lib/derived.test.ts` → *"weeksCredited (2.14: money ÷ current rate)"*,
*"weeksBehind"*, *"paymentStatus"*, *"amountOutstanding"*; `lib/standing.test.ts` →
*"computeStanding — the 2.14 rate-change examples"*; `lib/contribution.test.ts` →
*"the three figures are never conflated"*, *"total contributed always equals the sum of
the receipts (2.14)"*.

---

## 4. Allocation: oldest debt first

> **The organizer enters an amount. The system allocates it — oldest unpaid week first,
> then the current week, then forward. The leftover is a partial on the next week.**

The allocation is **shown before it is committed**. The organizer never picks the week.

**Worked:** last paid week 7, $250/week, currently week 12 → `$1,250` behind.
- Enter `$750` → clears weeks 8, 9, 10. Nothing partial.
- Enter `$650` → clears weeks 8 and 9, leaves `$150` partial on week 10.

**One engine, two entry points** (2.19): the week view and the member profile run the
identical allocation. The profile is not a second system.

**After the cycle closes**, the weeks are final, so money recorded on the profile reduces
the **ledger balance** instead — same entry, same math, different target.

**Pinned by:** `lib/allocation.test.ts` → *"allocatePayment — the ground-truth cases
(2.15, 2.19)"*, *"oldest debt first with existing money"*, *"edges"*;
`lib/payments-view.test.ts` → *"describeAllocation — the preview sentence (2.15)"*,
*"allocationOutsideSelection — honest about oldest-debt-first"*;
`lib/week-selection.test.ts` → *"oldestN — oldest debt first (2.15's spirit)"*.

---

## 5. Deferred is not skipped

> **DEFERRED: not chased, still owed. SKIPPED: nobody owes it.**

Two different facts that a single "excused" flag would destroy.

| | Chased? | Counts toward what they owe? | Set by |
|---|---|---|---|
| Deferred | No | **Yes** | Organizer, per member per week |
| Skipped | No | **No** | Organizer, on the week itself (whole group) |

**Worked:** 20-week member, week 11 deferred, week 14 skipped, paid 18 weeks at $500.
- Weeks that count: `20 − 1 (skipped) = 19`. Skipped is gone for everyone.
- Owed: `19 × $500 = $9,500`. The deferred week is **in** that figure.
- Chasing messages: exclude weeks 11 and 14.

**Status precedence:** `SKIPPED → PAID → DEFERRED → LATE → PARTIAL/UNPAID`. A deferred
week that was later paid shows **PAID** — money outranks an intention.

**Pinned by:** `lib/derived.test.ts` → *"weeksBehind (never below zero; only SKIPPED weeks
are excused)"*, *"paymentStatus (derived from money and the calendar only)"*;
`lib/standing.test.ts` → *"computeStanding — SKIPPED weeks stay fully excused"*;
`lib/messages.test.ts` → *"deferral leaves a member out of the chasing, not out of the
books"*.

---

## 6. The winner does not pay the week they win

> **The week a member is drawn settles from their payout, not from their pocket.**

They are receiving the pot that week; asking them to also pay into it is money moving in
a circle.

**Worked:** $500/week member drawn in week 12, gross `$10,000`, fee `$200`, net `$9,800`.
Week 12's `$500` is settled **from the payout** → they receive `$9,300`, and week 12 is
recorded paid. The `$500` is a real receipt pinned to week 12, not a waived week.

**Pinned to its week, never fungible:** a settlement receipt carries `pinnedWeekId` and
replays onto that week only. Ordinary oldest-first allocation must never consume it.

**Edits charge the difference:** if the member's terms change after the settlement, a
repeat charges only the **difference**, never the whole gap again.

**The receipt and the payout are ONE movement, and they move together.** `Payout.netAmount`
was decremented by exactly the settlement receipt's amount when it was created, so
changing either half alone creates or destroys money. Two consequences, both now law:

- **Resizing runs BOTH ways.** `resizeWinnerWeekSettlement` was `Math.min(event, weekly)`
  — a one-way ratchet. Cut a weekly from `$500` to `$250` and back to `$500` and the
  receipt stayed at `$250` while week 12 again cost `$500`: the winner was dunned PARTIAL
  for the very week they won, and the payout kept a `$250` credit it was no longer owed.
  The settled week now costs exactly the new weekly and `credit` may be **negative** — a
  dearer week is funded out of the payout, which is where a winner's own week has always
  come from. Refused outright when the payout cannot cover it.
- **The receipts list cannot edit it.** `updatePaymentEvent` accepted any amount at or
  below the week (`allocatePinned` returns `unallocated: 0`) and never credited the payout
  back, so a `$500` settlement edited to `$0.01` lost `$499.99`. The amount is refused
  there; date, method and notes stay editable. Deleting is refused for the same reason.

**Identification is structural, never textual.** `pinnedWeekId` + `settlementPayoutId` is
the definition. The UI recognised settlement receipts by searching the notes for
"settled from the payout" — and the Save button on the same row can empty the notes, so
one ordinary edit made a settlement receipt stop *looking* like one while its money link
to the payout survived.

**Pinned by:** `lib/settlement.test.ts` → *"planWinnerWeekSettlement — the winner does not
pay the week they win"*, *"allocatePinned — a settlement replays onto its pinned week
ONLY"*, *"audit H4 — a repeated edit charges the DIFFERENCE, never the gap again"*,
*"resizeWinnerWeekSettlement — the cash always lands somewhere (2.14)"* (including
*"REVERSING an edit puts the books back exactly where they started"*);
`lib/settlement-receipt.test.ts` (whole file, plus a guard that no code sniffs the notes);
`lib/standing.test.ts` → *"computeStanding — payout settlements are PINNED, never
fungible"*.

---

## 7. Stored week dates are authoritative

> **A week's stored `date` is the truth for that week. Compute a date only when no row
> exists.**

Elapsed weeks — which decides who is in arrears — come from each week's **own** stored
date plus the payment window, never from projecting forward from `cycle.startDate`.

```
elapsed(week) = today ≥ storedDate(week) + PAYMENT_WINDOW_DAYS
PAYMENT_WINDOW_DAYS = 5    (opens Sunday, closes Thursday)
```

**Worked:** week 5 is dated Sunday June 16. On June 19 the window is still open — the
member is **not** late, and no message may say they are. On June 21 it has closed and
week 5 counts as elapsed.

**Why it matters:** if a week was moved (a holiday, a missed collection), a projected
clock accuses people before their window actually closed.

**Guarded structurally:** a source-scanning test forbids any screen from calling
`dateOfWeek`/`generateWeekDates` behind the resolver's back, and forbids any money path
from deriving its clock from `cycle.startDate`.

**Pinned by:** `lib/week-date-authority.test.ts` → *"no screen computes a week date behind
the resolver's back"*, *"no MONEY path derives its clock from cycle.startDate"*,
*"nextWeekDates — new rows continue from the last REAL week"*;
`lib/commitment.test.ts` → *"resolveWeekDate — the stored row beats the calculation"*,
*"after a start-date change, every surface shows the SAME date"*;
`lib/standing.test.ts` → *"elapsed weeks come from the week rows, not the cycle start
date"*.

---

## 8. Commitment is capped to the cycle

> **A late joiner's commitment is capped so they finish with the group. Extending past
> the cycle end requires a deliberate override.**

**Worked:** join at week 15 of a 20-week cycle → maximum offered is **6** weeks (15…20).
The system does not allow 20 by accident. The organizer may override and extend to week
23 — only then are the extra weeks generated and the cycle runs long (2.7).

**Every member sees their own finish date**, always, as a date and not just a week number:
> `Finishes week 20 — Sunday, September 27, 2026`

Someone joining week 12 for 6 weeks finishes at week 17, three weeks before the group.
Their portal shows **their** window, never the group's. One sentence, identical on every
surface (wizard, participation editor, member page, portal).

**Pinned by:** `lib/commitment.test.ts` → *"commitmentCap — 2.22's cap and its override
are UNCHANGED"*, *"weeksToFinishWithGroup — 2.22's default, unchanged"*, *"the finish line
— one sentence, identical on every surface"*, *"finishPreview — the finish is always
derivable, never typed"*; `lib/money.test.ts` → *"remainingWeeksInCycle (2.22 / D-31)"*.

---

## 9. Lucky numbers leave the pool

> **A number is drawable only while its owner's window is open. It leaves when drawn, or
> when the window ends — and the organizer is warned before the second happens.**

**Worked:** Meheret's window ends at week 18. At week 16, undrawn, the dashboard must say
so: *"Meheret's window ends in 2 weeks and she has not been drawn."*

**Why the warning is not optional:** everyone in an equb receives exactly once. A member
whose window closes undrawn has paid in and received nothing. Because the organizer
controls draw order, the system must actively protect against running out of weeks for
someone.

**A drawn number never comes back.** Undoing a draw is possible; resurrecting a number
while its payout still exists is refused.

**Pinned by:** `lib/wheel.test.ts` → *"eligibleNumbers — the pool (2.27)"*,
*"undrawnWindowWarnings — the 2.27 safeguard"*; `lib/cycle-close.test.ts` →
*"closeBlockers — 2.27: nobody may be quietly missed"*; `lib/undo-draw.test.ts` →
*"changeWinnerRefusal — a drawn number may never re-enter the pool while its payout
exists"*; `lib/manual-payout.test.ts` → *"numbersRefusal — 2.27: a drawn number never
comes back"*.

---

## 10. Balances live on the person

> **A carried balance belongs to the PERSON, not the cycle. It survives cycle deletion.
> It is never automatically deducted from anything.**

**Worked:** Cycle 1 closes with Tsion `$1,250` short. That becomes a `DEBT` ledger entry
on Tsion. Delete Cycle 1 entirely and the `$1,250` is still there.

**Settle outside any cycle:** recording `$250` against it takes the balance to `$1,000`.
This is **ledger** money — it never marks a week paid.

**Forgiveness is a different fact from payment.** Writing off `$1,000` clears the balance
and is recorded as `FORGIVEN`, shown as **"Written off"** — never "Paid". Nobody paid it,
and the record must say so. Totals read: `$2,000 owed over time · $1,000 repaid · $1,000
written off`.

**Never auto-deduct (D-23).** Adding someone with a balance to a new cycle *asks* what to
do — leave it, deduct from their payout, or settle first. "Deduct from payout" is stored
as an **intention** against that participation, and resurfaces at payout time as a
**pre-ticked offer**. Pre-ticked means *"we remembered what you said"* — never consent.

The rule is enforced by a split that makes the wrong thing unwriteable:

| Function | Can it move money? |
|---|---|
| `carryOffer()` | **No.** Its result type has no `deducted` or `netAfter` field at all |
| `applyCarryDeduction()` | Only with `confirmedByOrganizer: true`, a required field with no default |

`applyCarryDeduction` takes **no intention argument**, so there is no path from a
remembered choice to a smaller payout.

**Worked:** Tsion carries `$1,250`; her payout nets `$9,800`. The offer arrives pre-ticked
with *"You chose this when adding them to Cycle 2 2026."* The organizer presses Deduct →
payout net `$8,550`, balance `$0`, and a `PAYMENT` ledger entry reads *"Deducted from
payout — Cycle 2 2026, number #950"*. If he never presses it, nothing changes.

**Two database refusals back this up**, both verified live: a person still in a cycle
cannot be deleted, and a person with ledger history cannot be deleted. The balance
genuinely outlives the cycle.

**Pinned by:** `lib/carry-balance.test.ts` → *"the offer never applies anything"*,
*"applying requires an explicit organizer confirmation"*, *"GUARD — no other code path
deducts a balance from a payout"*; `lib/ledger.test.ts` → *"ledgerBalance"*, *"forgiveness
is recorded DISTINCTLY from payment"*, *"ledgerStory"*, *"forgivenessRefusal"*;
`lib/cycle-close.test.ts` → *"finalBalanceEntries"*, *"cycleDeletePlan"*.
**Live verification:** `scripts/verify-carry-deduction.mts` — 22 checks.

---

## 11. Dates respect their context

> **A date field must refuse dates that cannot be true, and always say why.**

A bound without a stated reason is worse than no bound: a greyed-out calendar with no
explanation reads as a broken app.

| Field | Bound | Worked |
|---|---|---|
| New cycle start | `≥ today`, and `≥ active cycle's final week` | *"Cycle 1 2026 runs until Sunday, September 27, 2026. A new cycle cannot start before then."* |
| Week date | strictly **between** its neighbours | *"Weeks run in order, so this one must fall after week 11 (2026-08-02) and before week 13 (2026-08-16)."* |
| Any money-received date | **no future** | *"Money can only be recorded on or before today."* |
| Cycle edit start date | **unbounded, deliberately** | It corrects a historical fact (2.23); bounding it to today would block the correction |

**Back-dating stays free everywhere.** Money is routinely recorded days after it arrived,
and a balance can be settled long after its cycle ended.

**Enforced server-side, not only in the picker.** A bound that lives in the UI is a hint.
`createCycle` re-checks inside its transaction, against the same pure function.

**Pinned by:** `lib/date-bounds.test.ts` → *"the new-cycle rule"*, *"money-received
dates"*, *"week dates stay in sequence"*, *"the default the picker opens on"*,
*"isWithinBounds"*.

---

## 12. Privacy and presentation

> **Presentation mode strips names, money, phones, winner plans and the audit log from
> what the SERVER sends — not from what the screen shows.**

Hiding with CSS is not hiding. The redaction happens in the actions, so a stale page
cannot keep sensitive data alive. Lucky numbers, weeks and everything needed to run a
draw stay visible — the wheel screen still works while sharing.

**Pinned by:** `lib/presentation.test.ts` → *"redactDashboard"*, *"redactGrid"*,
*"redactWeekBoard"*, *"redactWheelState"*, *"redactCycleDetail"*, *"redactProposedSlots —
proposals cross the wire by id only"*.

---

## 13. The winner plan is locked

> **A committed winner plan is frozen. Reshuffle, drag, and any other path must all
> refuse to move a locked number.**

Validated on the server as well as the client — the UI merely reflecting a lock is not a
lock.

**Pinned by:** `lib/arrangement.test.ts` → *"locked numbers cannot be moved by ANY path
(2.3)"*, *"validateArrangement — the server backstop (2.3) holds on its own"*;
`lib/wheel.test.ts` → *"reshuffle — THE pinned defect (2.3): frozen means frozen"*,
*"selectWinningSlot — plan first, then chance (2.2/2.3)"*.

---

## 14. A closed cycle is read-only, and closing waits

> **Once a cycle is CLOSED its books are final: nothing writes to it again. And closing
> is not offered until the last week's money has had time to arrive.**

Closing writes every shortfall onto the members' carried ledgers (rule 10) and freezes the
archive. Both halves of this rule protect the same thing — the books after the last week.

**Read-only was applied by hand and had drifted badly.** Of the 19 mutations in
`app/actions/edits.ts` only 9 carried `frozenCycleRefusal`; `participations.ts` carried
none; `wheel.ts` carried 3 of 10. The cause was friction, not carelessness: the pure check
needs the cycle, so each action first had to load it through whatever id it happened to
hold. `lib/cycle-guard.ts` resolves the cycle from **any** cycle-scoped id
(`cycleId | weekId | participationId | luckyNumberId | payoutId | drawId | slotId |
winnerPlanId | paymentId | paymentEventId`) and throws, so the guard is one line with no
plumbing and no reason to skip it. **14 actions were missing it and now carry it.**

**The wait is 5 days by default** — the same window a payment gets (`PAYMENT_WINDOW_DAYS`).
Measured from the final week's own **stored** date (rule 7), configurable to any value
including 0 (2.6), and stated on the pre-close review as a sentence with a date rather
than a greyed-out button. Enforced inside `closeCycle`'s transaction, not only in the UI.

**Pinned by:** `lib/cycle-lock.test.ts` (timing, what a closed cycle allows, **and a source
guard** that fails when a cycle-mutating action ships without the check — it found the 14);
`scripts/verify-cycle-lock.mts` proves all ten resolution paths refuse a CLOSED cycle and
allow an open one, against the live database. A wrong relation hop would return null and
silently allow the write the guard exists to refuse, which no source scan can catch.

---

## 15. The audit log is append-only

> **An entry is never edited or removed. A wrong entry is answered by a NEW entry.**

An entry that could be rewritten is not evidence of anything. Enforced by a Postgres
trigger that raises on UPDATE and DELETE of `audit_logs`
(`prisma/migrations/20260807030000_audit_log_append_only`) — not by convention, because the
log is precisely the record that must stay true when the application is not.

**The cost is accepted:** audit rows can never be pruned or corrected, exactly as a wrong
payment is answered by a correcting receipt rather than a rewritten one.

**Readable is part of the rule.** A record that cannot be searched is not much better than
one that was never written: the log showed the most recent 200 entries with no filter, so
entry 201 was unreachable. It now pages 50 at a time and filters by action, by entity, by
person and by date range, with the active filter stated in a sentence — a narrowed list
must never be mistaken for an empty history.

**Pinned by:** `lib/audit-query.test.ts` — paging, the inclusive end date, the clamped
page, the reversed range, the person-name boundary match (including Amharic, where `\b`
never fires), **plus a source guard** proven non-vacuous by planting an
`auditLog.deleteMany` and watching it fail with the file name.

---

## Rules with no test

**This list is the work.** Each entry is a rule that is real, is implemented, and is
currently held up by nothing but the code being correct today.

| # | Rule | Where it lives now | Why it matters |
|---|---|---|---|
| ~~D-1~~ | ~~Never auto-deduct a carried balance~~ | **CLOSED** — `lib/carry-balance.ts`, 20 unit tests + a source guard | The guard was proven non-vacuous: a planted `payoutNet - ledgerBalance` was caught with file and line |
| ~~D-2~~ | ~~The deduct intention is offered at payout time~~ | **CLOSED** — persisted on `Participation`, surfaced by `components/admin/carry-deduction-offer.tsx` | — |
| **D-3** | **`recordSignIn` writes a correct session row** | `lib/session-record.ts`; verified once by `scripts/verify-sessions.mts` against the live DB | The verification script is manual. Nothing runs in CI |
| **D-4** | **Empty wheel slots are legitimate and must not be reported as missing members** | Implicit in the slot code | The position-23 empty slot has already caused one false alarm |
| **D-5** | **A cycle running long (2.7) keeps generating weeks correctly past its planned end** | `ensureWeeksThrough` in `lib/participation-rules.ts` | Tested for date continuity, **not** for the planned-vs-actual length distinction the rule is about |
| **D-6** | **Fee percent is configuration read at calculation time** | Passed in everywhere | Nothing prevents a future caller hardcoding `2` |
| **D-7** | **The three contribution figures stay unconflated in the ADMIN surfaces** | Tested in `lib/contribution.ts`; the admin pages compose them by hand | The member portal is pinned; the admin composition is not |
| **D-8** | **Messages never state a figure the derivation disagrees with** | `renderMessage` is tested for placeholders | No test asserts a rendered message's numbers equal the standing they came from |

**D-1 and D-2 are closed.** Remaining order: **D-5** next (correctness under a condition
this cycle will actually hit), then D-3 and D-8. D-4, D-6 and D-7 are regression guards
rather than live risks.

### What closing D-1 taught

The gap was never a wrong function — it was a rule with **no owner**, living as a branch
in one screen. The fix that matters is not the tests, it is the split: `carryOffer` was
given a return type in which an applied deduction **cannot be expressed**, and
`applyCarryDeduction` a required `confirmedByOrganizer` field with no default. Wrong code
now fails to compile rather than failing to be noticed.

Apply the same shape to the remaining gaps where possible: make the unsafe thing
unwriteable before making it untested.
