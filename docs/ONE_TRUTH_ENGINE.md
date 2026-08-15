# THE ONE TRUTH ENGINE

**Status:** planning. No code written against this yet.
**Opened:** 14 August 2026.
**Owner:** Firaoli Seboka (organizer). Decisions in this document are his.

This is the plan for the largest remaining build. It exists so the plan survives lost
context and is never re-litigated: what we are fixing, why, what the fix is, and how we
will know it worked. It is **updated as the build proceeds** (§7) — the living record,
not a snapshot of one conversation.

Read `EQUB_GROUND_TRUTH.md` first. That document is the law; this one is a plan that
serves it. Where they appear to disagree, the ground truth wins and this document is
wrong and must be corrected.

---

## 1. WHY THIS EXISTS

The organizer found two money bugs **by eye, in seconds**, that 2430 passing tests did
not catch.

### (a) "Short $0" while two members owed $750

`/admin/this-week` reported the group as short nothing while two members were behind.
The defect is in `receiptsByWeek`, [lib/dashboard.ts:242-267](../lib/dashboard.ts#L242-L267):

```ts
for (const participation of input.participations) {
  const inWindow = inMemberWindow(participation, weekNumber);
  const payment = paymentFor.get(participation.id);
  // Received money always counts, even outside a window (edited data).
  if (payment) {
    received += payment.amountPaid;          // ← EVERY participation
  }
  if (!inWindow || input.isSkipped) continue; // ← the window gate, AFTER
  expected += participation.weeklyAmount;     // ← only in-window
  membersExpected++;
  if ((payment?.amountPaid ?? 0) >= participation.weeklyAmount) membersPaid++;
}
...
shortfall: Math.max(0, expected - received),
```

`expected` is gated on the member's window; `received` is not — the `continue` sits after
the money has already been added. So a member outside their window who overpays inflates
the group's `received`, and `shortfall` is a **group subtraction with no per-member cap**.
One member's surplus silently pays down another member's debt on screen. `Math.max(0, …)`
then guarantees the error can only ever hide a shortfall, never reveal itself as a
negative.

Two details matter for the cure:

- **The same function gets it right two lines later.** `membersPaid` / `membersExpected`
  (lines 256-257) compare **each member's payment against their own weekly amount**, so
  they carry no such flaw. The correct shape was already present in the same loop.
- **`lib/dashboard.ts` never calls `computeStanding`.** It imports primitives from
  `./derived` and rebuilds its own aggregates in six independent loops. Three of its
  comments nonetheless assert that its numbers "cannot disagree with computeStanding"
  ([lines 508, 540, 554](../lib/dashboard.ts#L508)) — a claim about a function the file
  does not import. Ground truth §5.5: *a comment can be the bug's best camouflage.*

### (b) "Paid, thank you" while $500 was still owed

Markos Worku, behind on weeks 12 and 13, paid $1,500. Allocation was **correct**: week 12
filled, week 13 left partial with $500 outstanding. Everything after allocation was
wrong. `allocatePayment` returns `fillsWeek` and `runningRemainder` on every allocation
([lib/allocation.ts:95-100](../lib/allocation.ts#L95-L100)), and the send path throws both
away:

```ts
weeksCovered: data.allocations.map((a) => a.weekNumber),   // app/actions/payments.ts:332
```

Only week numbers survive. `PAYMENT_CONFIRMED` then renders `{{3}} myWeeksCovered` as
"week(s) 12 and 13", asserting week 13 was covered when half its money arrived. No
placeholder in the registry carries a per-week remainder, and no partial-aware template
exists among the seven Meta-approved ones. The full diagnosis is in this repo's history;
its four findings feed §4 and §5.

### The one disease

These look unrelated — an aggregate on a dashboard, a variable in a WhatsApp template.
They are the same defect: **numbers are computed independently by each screen and never
forced to agree.** Nothing in the codebase makes the this-week total and the member's own
standing answer the same question the same way, and nothing makes the confirmation
message say what the allocator computed.

Two functions answering one question is the same defect as none: each looks correct in
review, and the disagreement between them is what reaches the member.

**The organizer's decision: stop patching instances. Build the cure once.**

---

## 2. THE GOAL

> **One function returns a member's complete, current truth. Every screen, message, and
> total READS from it. Nobody recomputes; nobody keeps a second copy.**

The principle, applied:

- **Cash position** is the sum of members' truths — not a separate walk over payments.
- **This-week Short** is the sum of what **in-window** members' truths say they owe. A
  member's truth cannot owe less than zero, so no member's surplus can mask another's
  shortfall — the per-member cap is structural, not a patch.
- **A member's message** is their truth written as a sentence. The confirmation cannot
  claim a week is covered that the truth reports as partial, because it has no
  independent notion of "covered".
- **A stopped member contributes nothing** because their truth says stopped (2.18) — not
  because each caller remembers to filter them out.

One source, many readers.

### The engine names the event

The engine does not only hold the truth. **It names what happened.**

When a payment is recorded, the engine already computes what that payment *did*: which
weeks it paid in full, which week it left partial and by how much, whether it completed a
week that was already part-paid, and whether it ran ahead into future weeks. It has to —
that is the allocation (2.15, 2.19), and §3.6 keeps its per-week detail instead of
discarding it.

Because it knows that, **it knows which message belongs.**

> **Message-type selection is not a separate decision made at send time. It is a property
> of the truth already computed.** The send path READS "which message" from the engine,
> exactly the way every screen reads its numbers.

No branching guesswork at the call site, no second reading of the allocation to work out
what to say. The correct message is a function of the event the engine already named —
so a confirmation cannot claim a week was covered while the same object records a
remainder on it. Bug (b) is not merely fixed by this; it is made **unrepresentable**,
which is the whole point of the build.

This is 2.21 (messages are statements, derived at send time) held to the same standard
2.14 now sets for screens: derived **once**, read everywhere.

**This extends 2.14, it does not amend it.** 2.14 says money is stored and everything
else is derived. It is silent on *how many times* a thing may be derived, and that
silence is where both bugs live. The extension:

> Derive **once**, read **everywhere**. Not storing a derived value is necessary and not
> sufficient; re-deriving it independently produces the same divergence that storing it
> would, and hides it better, because two live computations both look correct in review.

Nothing here weakens 2.14, 2.15 (allocation is untouched and correct), 2.19 (one
allocation engine, two entry points — the same shape, one level up), or 2.29.

---

## 3. WHAT THE TRUTH CONTAINS

**This is a DRAFT.** It is reconciled against Pass 1's derivation catalog (§4.1) before
any code is written; the audit may add fields, and may prove some listed here are two
names for one fact.

**The engine is not greenfield.** `computeStanding` ([lib/standing.ts](../lib/standing.ts))
is the nucleus. It has **9 call sites** — 18 is the number of files that MENTION it, and
`lib/dashboard.ts` is not a caller at all (§5.1 counts them). What it lacks is (a) identity, fee, payout,
carry and stopped/active, (b) the per-payment allocation record, and (c) any rule that
makes reading it mandatory. The build grows that function into the engine; it does not
replace it.

Legend: **[S]** stored fact · **[D]** derived at read time · **[D*]** derived, and today
computed in more than one place.

### 3.1 Identity and participation

| Field | S/D | Notes |
|---|---|---|
| `personId`, `participationId` | S | People are permanent, participation is per-cycle (2.5) |
| `nameAmharic`, `nameEnglishFirst/Last`, `phone` | S | |
| `cycleId`, `cycleName`, `cycleStartDate` | S | |
| `weeklyAmount` | S | Current rate. Historic receipts are not restated (2.14) |
| `startWeek`, `weeksCommitted` | S | Capped to the cycle unless overridden (2.22) |
| `finishWeek` | D | `startWeek + weeksCommitted − 1` |
| `luckyNumbers` | S | |
| `status`: `active` \| `stopped` \| `finished` \| `not-yet-joined` | D | From window break (2.18) and the calendar |
| `stoppedAtWeek` | S | Where the window broke, if it did |
| `noMessages` | S | Hardship flag (2.20) — the engine reports it; the send path enforces it |

### 3.2 The calendar

| Field | S/D | Notes |
|---|---|---|
| `currentCycleWeek` | D | Cycle start + today. Never hardcoded, never stored (2.14) |
| `myCurrentWeek` | D | Clamped to `finishWeek` — their frame, not the cycle's |
| `weeksElapsedInWindow` | D | From each week row's **own stored date**, not from a count |
| `missingWeekRows` | D | Window rows the cycle lacks (pre-D-31 data) — honesty about a gap |

### 3.3 Per-week truth

One entry per week of the member's window, ascending.

| Field | S/D | Notes |
|---|---|---|
| `weekNumber`, `date` | S | The week row's stored date |
| `ownWeekNumber` | D | Their counting: cycle week − startWeek + 1 |
| `amountDue` | D | Current `weeklyAmount`, or 0 if skipped |
| `amountPaid` | S | Receipts recorded on this row |
| `coveredAtCurrentRate` | D | What their fungible money covers here |
| **`remainder`** | D | `max(0, amountDue − covered)` — **the field the Markos message needs** |
| `isDeferred` | S | Organizer's decision (2.14) |
| `isSkipped` | S | Cycle-wide |
| `markedLateAt`, `markedLateNote` | S | His own mark — a timestamp, not a flag (2.29) |
| `status` | D* | The ladder below |
| `pinnedAmount` | S | Payout-settled cents — not fungible, stays on its week |

**The status ladder is `paymentStatus`** ([lib/derived.ts:189-197](../lib/derived.ts#L189-L197)):
SKIPPED → PAID → DEFERRED → LATE (marked) → LATE (window closed) → PARTIAL → UNPAID.

> ## OPEN RULING — BLOCKING. The organizer decides; no default is assumed.
>
> **There is no state for "partly paid AND window closed."** The window test returns LATE
> before the money test is reached, so `PARTIAL` is structurally window-open-only and
> Markos's week 13 reads LATE with $500 in it. §2.14's own table defines late as
> "**unpaid** and either the window has closed or the organizer marked it" — and week 13
> is not unpaid. Whether "unpaid" means *no money at all* or *not settled* is unresolved
> in the ground truth. It is his ruling to make, not the engine's to assume.
>
> Three readings, no recommendation:
>
> 1. **LATE stands.** Partial money does not soften the chase. Costs nothing to build.
> 2. **PARTIAL widens** — drop "window still open" from its definition, so money beats
>    the closed window.
> 3. **A sixth state** — "part-paid, still owed, still chased": its own colour, its own
>    sentence, and it stays chaseable.
>
> **This is not a colour choice.** Six consumers key off `status === "LATE"`:
> [messages.ts:177](../lib/messages.ts#L177) (`hasChaseableWeeks`),
> [messages.ts:224](../lib/messages.ts#L224) (`lateWeeks`, which feeds `{myLateWeeks}` and
> LATE_NOTICE), [messages.ts:435](../app/actions/messages.ts#L435) (the chasing gate),
> [member.ts:300](../app/actions/member.ts#L300) (the portal's late count),
> [equb-calendar.tsx:164](../components/member/equb-calendar.tsx#L164), and
> [week-stamp-list.tsx:183](../components/member/week-stamp-list.tsx#L183).
>
> Under reading 2, week 13 **silently leaves every chasing path**: no late notice can name
> it and it drops off the attention list, while $500 is still owed. That is a
> **money-visibility consequence**, and it is the reason this ruling comes before the
> engine rather than after it.
>
> **It blocks §5 step 1.** The engine ships the ladder it is given; it cannot invent one.
> The status quo is reading 1 by accident, not by decision, and this document does not
> treat an accident as a default.

### 3.4 Money totals

| Field | S/D | Notes |
|---|---|---|
| `totalPaid` | S | Sum of receipts — the one stored aggregate, and it is a sum of facts |
| `weeksCredited` | D | `totalPaid ÷ weeklyAmount`, floored |
| `weeksPaid` | D | `min(weeksCredited, weeksCommitted)` |
| `weeksBehind` | D | Elapsed − skipped − credited, floored at 0 |
| **`amountOutstanding`** | D* | **Per-week sum of `remainder`** — never a group subtraction. This is the shape that makes bug (a) unrepresentable |
| `surplus` | D | Money beyond the entire window at the current rate |
| `lastPaymentWeek`, `paidUpToWeek` | D | `paidUpToWeek` is the contiguous fully-PAID prefix; any gap ends it |

### 3.5 Fee, payout, carry

| Field | S/D | Notes |
|---|---|---|
| `feePercent` | S | Read from the cycle, never a constant (2.6) |
| `grossProjected` | D | `weeklyAmount × weeks **COMMITTED**` — never weeks paid (2.30) |
| `feeProjected` | D | `feePercent × gross` |
| `feeCharged` | S | `Payout.feeAmount` once drawn — **read in preference to the projection** (2.30) |
| `payoutNet` | D | Gross − fee, **per lucky number** |
| `payoutState`: `none` \| `planned` \| `drawn` \| `settled` | D | |
| `carriedBalance` | S | Belongs to the **person**, survives cycle deletion (2.18) |
| `carryOrigin` | S | How it arose — early close or cycle close |

### 3.6 The per-payment record — new, and the reason (b) shipped

Today `PaymentEvent` records an amount and the allocation is recomputed on demand; the
per-week detail exists only inside `allocatePayment`'s return value and is discarded at
the call site. The truth must carry it:

```
payments: [
  {
    paymentEventId,            // S
    amount,                    // S
    receivedAt,                // S
    method,                    // S
    pinnedWeekId,              // S — a settlement, not fungible
    allocations: [
      { weekNumber,            // D — from the one allocator (2.19)
        applied,               // D
        fillsWeek,             // D — did this receipt SETTLE the week?
        remainderOnWeek },     // D — what it left owing, per week
    ],
    unallocated,               // D — money that fit nowhere
  },
]
```

`fillsWeek` and `remainderOnWeek` are the two facts the confirmation message needs and
cannot currently see. They are **derived by the existing allocator** — this adds no new
arithmetic and no stored derived value. It stops throwing away an answer already
computed.

### 3.7 The payment event, and the message it names

The engine emits an **event** when a payment is recorded, derived entirely from §3.6's
allocation record. The event is what the send path reads (§2). It is not a new stored
fact and not a new arithmetic — it is a name for what the allocator already did.

```
paymentEvent: {
  amount,                    // D — the receipt
  fullWeeks:      [n, …],    // D — weeks this payment settled outright
  completedWeeks: [n, …],    // D — weeks ALREADY part-paid that this payment finished
  partialWeek:    n | null,  // D — the week left part-paid (at most one, per 2.15)
  remainder,                 // D — still owed on partialWeek
  aheadWeeks:     [n, …],    // D — future weeks covered
  unallocated,               // D — money that fit nowhere
  nowCurrent:     boolean,   // D — caught up after this payment
  weeksBehindAfter,          // D — 0 when current
}
```

**ONE message per payment, describing everything that payment did.** Not one message per
week touched, and not a generic confirmation with the detail dropped.

**The standard tail** closes every case: `You have now paid {weeksPaid} of
{weeksCommitted} weeks.` followed, **only when `weeksBehindAfter > 0`**, by the behind
clause — worded as BEHIND_NOTICE already words it, so the two messages cannot describe
one member in two vocabularies. Then `Thank you.`

#### The five cases

**1. Fully covers its week(s); member now current or ahead.**
> We received $X. That paid week N in full. You have now paid P of Q weeks. Thank you.

**2. Leaves a week partial — the Markos case.**
> We received $X. That paid week N in full, and paid part of week M. $R is still due for
> week M. You have now paid P of Q weeks. Thank you.

The `paid week N in full` clause appears **only if a full week was covered** — that is
`fullWeeks.length > 0`.

**3. Small partial only, covering no full week.**
> We received $X. That paid part of week M. $R is still due for week M. Thank you.

**4. The rest arrives, completing a prior partial.**
> We received $X. That completes week M, now paid in full. You have now paid P of Q
> weeks. Thank you.

If the member is still behind after it, the behind clause appears in the tail.

**5. Pay-ahead past the current week** (for example $1,250 clearing a past partial and a
future week). The message names **both** the past week completed and the forward week
covered, read straight off `completedWeeks` and `aheadWeeks`. It never summarises them
away — a member who paid ahead is owed the sentence that says so.

#### What this is, and is not

- **It is ONE partial-aware confirmation template shape**, not five templates. The
  still-due clause and the completes clause are conditional; the rest is constant.
  **One Meta submission, the organizer's, and off the critical path** (§5) — the branching
  and the event are buildable now against a draft registry entry.
- **It is NOT a new stored control.** Recording a small payment on a week **is** how a
  partial is created (2.15); the engine derives partial from the money. There is no
  mark-partial button to build and there must not be one, because a stored partial would
  breach 2.14 the moment the weekly amount changed.
- **The gap is surfacing, not recording.** Partial already works and is already correct.
  What is missing is the grid colour (blocked on the §3.3 ruling) and this message.

#### Three things to settle before submission

1. **Meta template bodies are fixed.** A WhatsApp Content template cannot omit a
   sentence, and our own boundary refuses a variable that renders empty (the default-deny
   sentinel guard). So "conditional clause" has to be realised as a **variable carrying
   the whole clause**, always non-empty — or as more than one approved template. Which of
   the two it is, is a design decision for §5, and it is the one place where "one template
   shape" may not survive contact with Meta.
2. **Week numbering and dates.** The v3 standing rules (14 Aug 2026) require the
   **member's own** week numbers with dates in brackets as reference, and no dashes in
   fixed text. The drafts above are written in cycle-week language for clarity; the
   submitted body uses the member's counting, as every other v3 template does.
3. **`weeks left` in the tail.** The tail as drafted carries weeks-paid and the
   conditional behind clause. Whether it should also carry `{paymentsLeft}` is open —
   none of the five drafts above shows it, and repetition of facts is good rather than
   clutter under the v3 rules, so this is a judgement for the organizer.

### 3.8 Open questions for the audit

1. Is `coveredAtCurrentRate` distinct from `amountPaid` in every case, or only where a
   rate changed mid-cycle? If only there, it is one fact with two names on most rows.
2. Does the engine return a member's truth for **one cycle** or for the person across
   cycles? The carried balance belongs to the person (2.18), everything else to the
   participation. Provisional answer: per-participation, with the person's balance
   attached — Pass 1 confirms or corrects.
3. What does the truth say for a member with `missingWeekRows > 0`? It must stay honest
   about the gap rather than composing a figure over rows that do not exist.
4. Cost: the truth is heavier than what most callers need today. Whether the engine
   returns one shape or a lazily-computed one is an implementation question for §5, not a
   licence for a second, thinner derivation.

---

## 4. AUDIT FINDINGS

**THE MAP IS COMPLETE.** 4.1 from `docs/AUDIT_PASS_1.md` (14 Aug 2026), 4.2 from
`docs/AUDIT_PASS_2.md` (15 Aug), 4.3 from `docs/AUDIT_PASS_3.md` (15 Aug). §3 is now
reconciled against 4.1 and §5 sequences from 4.3. Two rulings remain the organizer's and
block the build: the partial-but-window-closed status (§3.3) and the SQL view's future
(4.3 Part C).

### 4.1 Pass 1 — the money map

**Source:** [docs/AUDIT_PASS_1.md](AUDIT_PASS_1.md), 3,605 lines. Pass 1 **describes**; it
does not judge. Everything below is recorded fact, not a verdict — the verdicts are 4.2's.

#### The shape of the problem, in numbers

| | |
|---|---|
| Stored money facts, organizer decisions and calendar facts | **128 columns** across 20 models |
| Derived money and standing values | **139** |
| Of those, computed in **more than one place** | **107** |
| Of those, computed in exactly one place | **32** |

107 of 139 is the finding. Three quarters of the money questions this platform answers are
answered by more than one piece of code. That is the disease of §1 stated as a census, and
it is the number §2's engine exists to drive to zero.

*Method note: an earlier sweep claimed 257 of 257 — a figure that was 100% and therefore
its own evidence of a broken method. It had counted reads, assertions and type declarations
as implementations. The 107 above is the re-run under a strict definition (a location counts
only if it independently performs the arithmetic), with a verbatim source quote required for
every retained location and an adversarial pass that defaulted to rejection. **114 claimed
locations were examined and rejected.** `AUDIT_PASS_1.md` §Gaps.8 records the failure.*

#### (a) The trigger mechanism, confirmed

`weekReceipts` accumulates `received` at
[lib/dashboard.ts:250](../lib/dashboard.ts#L250) — **before** the window gate at
[:252](../lib/dashboard.ts#L252) and the deferral gate at
[:253](../lib/dashboard.ts#L253) — while `expected` is added at
[:255](../lib/dashboard.ts#L255), after both. The two sides of
`shortfall = Math.max(0, expected − received)` ([:264](../lib/dashboard.ts#L264)) therefore
**cover different populations**: `received` includes out-of-window and deferred members;
`expected` excludes both. §1(a) has the full reading.

#### (b) "Expected for a week" is implemented twice, with opposite rules and self-certifying comments

The two implementations disagree about whether a **deferred** week is expected, and each
carries a comment asserting its own correctness:

- [lib/payments-view.ts:223-225](../lib/payments-view.ts#L223-L225) — *"Only a SKIPPED week
  is off the books. A DEFERRED week is still owed, so it belongs in what the week EXPECTED
  to collect."* Deferred weeks are **counted**.
- [lib/dashboard.ts:253](../lib/dashboard.ts#L253) — `if (payment?.isDeferred) continue;`
  Deferred weeks are **dropped**.

Both cannot be right, and neither file knows the other exists. This is §5.5 again — *a
comment can be the bug's best camouflage* — but doubled: two comments, each true of its own
function, jointly describing a platform that contradicts itself.

#### (c) One word, many quantities

Pass 1's synonym table (`AUDIT_PASS_1.md` §C6) is the single most useful thing it produced.
The headline collisions:

| Word | Distinct quantities | Where |
|---|---|---|
| **Shortfall** | **5** | per-week expected − received [lib/dashboard.ts:264](../lib/dashboard.ts#L264) · the cycle gap net of stopped members [lib/cycle-position.ts:217](../lib/cycle-position.ts#L217) · `shortfallToCover`, the organizer's own hole [lib/participation-close.ts:336](../lib/participation-close.ts#L336) · one week's remainder [lib/settlement.ts:43](../lib/settlement.ts#L43) · the cash page's whole-series "Short" [cash/page.tsx:63](<../app/admin/(protected)/cash/page.tsx#L63>) |
| **Fee** | **6** | projected per lucky number [lib/money.ts:90](../lib/money.ts#L90) · stored `Payout.feeAmount` · `feeOnReturn` [lib/final-position.ts:61](../lib/final-position.ts#L61) · `feeAttributable` [lib/participation-removal.ts:87](../lib/participation-removal.ts#L87) · `feeEstimate` [lib/cycle-position.ts:331](../lib/cycle-position.ts#L331) · `projection.totalFees` [lib/projection.ts:115](../lib/projection.ts#L115) |
| **Current week** | **4** | projected off the start date [lib/money.ts:162](../lib/money.ts#L162) · from stored rows [lib/commitment.ts:176](../lib/commitment.ts#L176) · SQL `week_no` [migration 20260804230000:149](../prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql#L149) · elapsed-boundary fallback [lib/cycle-position.ts:188](../lib/cycle-position.ts#L188) |
| **Expected** | **3 populations** | drops deferred [lib/dashboard.ts:255](../lib/dashboard.ts#L255) · keeps deferred [lib/payments-view.ts:225](../lib/payments-view.ts#L225) · no elapsed filter at all, while labelled "Expected by now" [cash/page.tsx:62](<../app/admin/(protected)/cash/page.tsx#L62>) |
| **Received** | **3 populations** | every row, including out-of-window and deferred [lib/dashboard.ts:250](../lib/dashboard.ts#L250) · in-window cells only [lib/payments-view.ts:222](../lib/payments-view.ts#L222) · attributed by `weekId` rather than `weekNumber` [app/actions/cycle-close.ts:178](../app/actions/cycle-close.ts#L178) |

§3's vocabulary must resolve every row of this table. A name that still means five things
after the engine ships has not been fixed.

#### (d) `Payment.amountPaid` is a stored aggregate — the §2.14 drift candidate

`Payment.amountPaid` ([prisma/schema.prisma:301](../prisma/schema.prisma#L301)) is **not a
recorded money fact**. It is a per-week aggregate of the allocation engine's output —
[app/actions/payments.ts:243-245](../app/actions/payments.ts#L243-L245) calls it "a STORED
aggregate cache of this week's allocations", and [lib/rebuild.ts:8-11](../lib/rebuild.ts#L8-L11)
calls it a week aggregate rebuilt by replaying `PaymentEvent`s. The stored fact underneath is
`PaymentEvent.amount` ([schema:333](../prisma/schema.prisma#L333)).

**Thirteen write sites across three independent mechanisms:**

1. **Incremental** — [payments.ts:259](../app/actions/payments.ts#L259), [:264](../app/actions/payments.ts#L264)
2. **Full replay** — [rebuild.ts:53](../lib/rebuild.ts#L53) (zeroes every row), [:64](../lib/rebuild.ts#L64), [:71](../lib/rebuild.ts#L71)
3. **Settlement increment/decrement** — [draw-settlement.ts:140](../lib/draw-settlement.ts#L140), [:147](../lib/draw-settlement.ts#L147), [:202](../lib/draw-settlement.ts#L202), [:232](../lib/draw-settlement.ts#L232)

Plus rows created at 0 as a side effect of **non-money edits** — deferral
[edits.ts:1370](../app/actions/edits.ts#L1370), late mark [:1514](../app/actions/edits.ts#L1514),
note [:1598](../app/actions/edits.ts#L1598) — and [scripts/import-cycle.mts:236](../scripts/import-cycle.mts#L236).

Three mechanisms that can write the same cell is exactly the §2.14 drift this document
exists to end. §3.6's per-payment record has to decide whether this column survives at all.

#### (e) 17 of the 107 are not reachable from TypeScript

The `member_progress` Postgres view and its predecessors **recompute standing in SQL**. A
fix in TypeScript does not reach them:

- weeks credited — [migration 20260806020000:33](../prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql#L33), `least(floor(total / weeklyAmount), weeksCommitted)` — **capped**, where [lib/derived.ts:122](../lib/derived.ts#L122) is **uncapped**
- weeks behind — [:37](../prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql#L37)
- weeks elapsed / window closed — [:54](../prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql#L54), [:62](../prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql#L62), with the five-day offset written into the SQL
- finish week and window membership — [:60](../prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql#L60), [:61](../prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql#L61)

**`/me` reads the TypeScript derivation and `/me/group` reads the SQL view**
(`AUDIT_PASS_1.md` §C6), so the same member can be "2 weeks behind" on one screen and
something else on the next. A further ~97 locations are recomputations under `scripts/`,
which can drift from the app they verify. The engine's cutover plan (§5) must state what
happens to this view — porting the callers is not enough.

#### (f) Caveat — what Pass 1 did NOT verify

**The `surfaces` lists were not re-verified.** They were produced by the same sweeps whose
duplicate lists proved unreliable, and only the duplicate lists were re-run. Pass 3 depends
on `surfaces` to decide which screens compute their own numbers — and §5's refactor list is
sequenced from Pass 3 — so **Pass 3 must begin by re-checking every `surfaces` entry the way
the duplicates were re-checked**, before any of it is treated as a work list.

Also open, from `AUDIT_PASS_1.md` §Gaps: no writer was captured for **13 stored columns**;
the two schema sweeps **disagreed on the classification of 15 columns**; and Part B's
`Other implementations` lines are marked **SUPERSEDED** in place — they hold genuine
annotations the re-run did not reproduce, but every location in them is unverified.

### 4.2 Pass 2 — single-source integrity and label-vs-math correctness

**Source:** [docs/AUDIT_PASS_2.md](AUDIT_PASS_2.md), 9,022 lines. Pass 2 **judges**. Every
row below ends EQUIVALENT, RESOLVED (a ground-truth rule quoted verbatim settles it), or
OPEN (the documented rules are silent — Oli rules). Every divergence carries the verbatim
source of both implementations; every reconciliation was adversarially re-checked.

#### 4.2.0 THE OPEN RULINGS — the worklist before build step 1

**Eighteen decisions the documented rules do not make.** Nothing in §5 should be sequenced
until these are answered, because several of them change what the engine is supposed to
compute. Ordered by money-visibility.

**Ten that change what a member or the organizer sees as owed, paid, or their standing:**

1. **May the organizer type a payout's net figure freely — and what records the money he
   keeps back?** Two deduction paths leave a row behind; Collections' "Offer: deduct"
   button leaves none, so the money vanishes from every record
   ([collections-view.tsx:917-918](<../app/admin/(protected)/collections/collections-view.tsx#L917-L918>),
   refusal only when a settlement exists, [edits.ts:1959](../app/actions/edits.ts#L1959)).
2. **When a member stops and later comes back, are the weeks they were away still owed?**
   §2.18 "unpaid means owed" pulls one way; the hole rule pulls the other. ~20 sites
   implement one answer, the dashboard/week-dates pair the other.
3. **Does a DEFERRED member belong in a week's "N of M paid" headcount?** The money half is
   settled (§2.18, §2.29 — still owed). A headcount is not money, and nothing rules on it.
   *Decide this before the deferral money fix ships — both figures sit behind the same
   `continue` at [lib/dashboard.ts:253](../lib/dashboard.ts#L253).*
4. **May a payout be reduced by the member's CURRENT-cycle week arrears at all?** §2.18's
   offer is defined against the *carried ledger balance*; this button acts on week arrears.
5. **When a cycle-wide week is SKIPPED, does a drawn member who stopped early still owe
   it?** Every other derivation drops skipped weeks; the final-position path does not.
6. **Is "weeks elapsed" per week row, or a cycle-wide high-water mark?** §2.14 defines
   weeks-behind but never defines how elapsed is measured.
7. **Which day boundary closes a payment window — UTC midnight, or the group's own
   timezone?** TypeScript is hard-UTC; the SQL follows whatever `TimeZone` the Postgres
   session carries.
8. **Is savings progress the money fraction or the weeks fraction?** Both render on the
   same page today.
9. **What should "Next due" name — the oldest uncovered week, or the current one?**
10. **Should "overdue across closed weeks" count money nobody will ever send?**

**Eight that change an organizer-only figure:**

11. Which clock is THE current week — the projection off the start date, or the stored week
    rows? (§2.14 names the projection, but predates stored rows being authoritative and
    §2.23 making `startDate` editable.)
12. "Running out of weeks undrawn" — three weeks or four, and off which clock?
13. Where does a payout with no draw belong in a per-week record?
14. Should the "What you should hold" dot use counted cash, and include money owed back to
    stopped members?
15. Does "N weeks remaining" include the week in progress?
16. Is "days waiting" elapsed 24-hour periods, or calendar days crossed?
17. Should `?week` be parsed by one rule, and should a week with no row render empty or
    fall back?
18. Must the member portal's past-cycle sentence follow §2.18's closing-statement wording?

#### 4.2.1 Counts

| Verdict | Part A | Part C | Total |
|---|---:|---:|---:|
| **EQUIVALENT** — provably cannot differ | 47 | 2 | **49** |
| **RESOLVED** — they differ, a quoted rule settles it | 36 | 9 | **45** |
| **OPEN** — they differ, the rules are silent | 20 | 1 | **21** |
| | 103 | 12 | **115** |

The 21 OPEN rows collapse to the **18 distinct rulings** above (three questions appear
twice in Pass 1's list). **64 of the 115 rows rank `headline`** — they change what a member
or the organizer sees as owed, paid, or their standing.

Part B judged **31 displayed numbers**; **26 labels do not match their math** (5 MATCHES).

#### 4.2.2 What Pass 2 settled — 45 with a correct answer

The pattern across them: **the correct implementation almost always already exists in the
codebase**, and the wrong ones are re-derivations that drifted. §5.10 in one line.

- **Weeks behind** — correct at [lib/derived.ts:138-147](../lib/derived.ts#L138-L147) fed by
  `weekCountsAsDue`; **wrong** in the SQL view
  ([migration :52-63](../prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql#L52-L63)).
  See 4.2.4 — this one is live on `/me` vs `/me/group` today.
- **Per-week shortfall** — correct shape is the per-member comparison **already inside the
  same loop** at [lib/dashboard.ts:257](../lib/dashboard.ts#L257). The group figure must be
  a sum of per-member gaps, not a subtraction of two group totals. §1(a) predicted exactly
  this.
- **"Expected" for a week** — the ruling is **"correct: none as written."** Four
  populations under one name, and no existing implementation is right on every axis.
- **The fee** — recorded wins over projected (§2.30); the defect is at the *write*, not the
  read.

#### 4.2.3 Label vs math — 26 of 31 displayed numbers

Two member-facing findings verified by hand:

- **"All paid up" is shown to members who still owe money.**
  [member-payout-card.tsx:102](../components/member/member-payout-card.tsx#L102) renders it
  whenever `nextDue` is null, and `nextDue` is built from a filter that **excludes deferred
  weeks** — [member.ts:292-293](../app/actions/member.ts#L292-L293)
  `(w) => !w.isDeferred && w.coveredAtCurrentRate < w.amountDue`. A member whose only
  unpaid weeks are deferred is told they are square. §2.18: unpaid means owed. The comment
  directly above that filter guards a *different* case (window fully passed) — §5.5.
- **"Perfect record"** — [member-personal-summary.tsx:166](../components/member/member-personal-summary.tsx#L166),
  driven by `lateCount` = weeks whose status is *currently* LATE
  ([member.ts:300](../app/actions/member.ts#L300)). A late week that is later paid stops
  being LATE, so a member who paid late every week reads "Perfect record".

This is the same disease as §1(b): a sentence that certifies a state the arithmetic behind
it never checked.

#### 4.2.4 The divergence that is live right now

> **CORRECTED by Pass 3 (§4.3 Part A/A3), and the correction matters.** This section first
> said `/me` shows `weeksBehind` from TypeScript while `/me/group` shows it from SQL.
> **`/me` never renders `weeksBehind`.** Verified: `weeksBehind` is rendered in exactly one
> component, [member-group-list.tsx:128](../components/member/member-group-list.tsx#L128)
> and [:186](../components/member/member-group-list.tsx#L186), which is the `/me/group`
> screen. `standing.weeksBehind` is shipped into the `/me` payload at
> [member.ts:350](../app/actions/member.ts#L350) and **nothing reads it** — dead payload.
> What `/me` actually renders is `lateCount`.
>
> So the two screens do not disagree about one number computed twice. They answer **two
> different questions** and present both as "how am I doing": `/me` counts weeks whose
> status is currently LATE; `/me/group` counts weeks the SQL view calls behind. **That is
> harder to fix, not easier** — no reconciliation makes two different questions agree, so
> the build must decide what each screen is asking before it can make them consistent.

The engine divergence underneath is still real, and still live on `/me/group`:

- The TypeScript gate `weekCountsAsDue` returns true for a marked-late week **before** its
  window closes — [lib/derived.ts:113](../lib/derived.ts#L113)
  `if (args.markedLate && !args.isDeferred) return true;`
- The view has no such term. `markedLateAt` appears nowhere in it; its only due test is the
  calendar, [migration :62](../prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql#L62).

Pass 3 also proved the bounded half: **`weeks_paid` on the two screens cannot diverge** —
same formula, same input, same cap, checked on both sides. The view's defect is confined to
`weeks_behind` and to its row population (it filters neither participation status nor
breaks), on one screen with one reader.

Pass 2 also found the view ignores participation status and `participation_breaks`, so it
answers **three** questions with rules the TypeScript does not share.

**Correction to 4.1 above:** Pass 1's §C6 said the SQL "counts personal deferrals as
excused." The current revision does not — [migration :57](../prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql#L57)
reads *"ONLY a cycle-wide skip is excused. A personal deferral is still owed"*, matching
[lib/derived.ts:141-142](../lib/derived.ts#L141-L142). **The two engines agree on
deferrals; only the manual late mark diverges.** That narrows what the fix must touch.

#### 4.2.5 Caveat

Pass 2 queried no database, so every divergence is proven by reading code and constructing
a concrete input — not by observing a live figure. Part B **re-derived its own set of
displayed numbers** rather than using Pass 1's unverified `surfaces` lists; that
re-derivation now stands in for them, and 4.1(f)'s warning is discharged for the admin and
member routes Part B covered. Pass 3 still owes the cross-surface sweep.

### 4.3 Pass 3 — cross-surface agreement and test coverage gaps

**Source:** [docs/AUDIT_PASS_3.md](AUDIT_PASS_3.md), 15 Aug 2026. Read-only; no database
queried. Pass 3 asks two questions: does the same quantity tie across surfaces, and does a
test exist that would have caught it when it does not.

#### Part 0 — the surfaces lists, re-verified

Pass 1's `Surfaces:` lists were never verified, and Pass 2 refused to use them. Pass 3
re-derived them under one rule: **a surface RENDERS a money or standing value into output a
human reads**, proven by the render line. Rejected: prop pass-throughs (the render is in
the child), declarations, comments, and any `.ts`/`.sql` file, which cannot render. One
carve-out — an approved WhatsApp template body is a surface, because it is text a member
reads.

| | Count |
|---|---:|
| Raw surface citations in Pass 1 | **819** |
| Distinct `file:line` | **622** |
| **Survived** | **295** (corrected estimate ~265–270) |
| **Rejected** | **327** |

**Roughly 57% of Pass 1's surface citations are not surfaces.** 128 of the rejections are
whole files that cannot render anything — 40 distinct `.ts`/`.sql` files, including
`lib/derived.ts`, `lib/standing.ts` and eleven server actions.

Two things are worth carrying forward. **Every one of the 622 cited lines resolves** — no
stale line numbers; Pass 1's citations were accurate as locations and wrong as
classifications. And the 295 is an **upper bound**: a hand-checked 42-item sample found 7%
false positives in the largest bucket, and worse in two small ones. Parts A–C rest only on
lines opened and quoted by hand.

#### Part A — six divergent pairs, four of them member-visible

| # | Quantity | Surfaces | Cause | Seen by |
|---|---|---|---|---|
| **A1** | **Weeks behind** | `/me/group` (SQL view) · admin profile (`computeStanding`) · command centre (`memberAttention`) | **Three implementations.** TS counts a marked week as due at once (`derived.ts:113`); the view's only due test is `current_date >= date + 5`; `memberAttention` uses a cycle-wide high-water mark | **MEMBER** |
| **A2** | **The per-week figure** | `/me` week list shows `coveredAtCurrentRate` (`member.ts:377`) · admin grid shows `storedPaid` (`payments-view.ts:229`) | Two bases for one figure; nothing pins the invariant | **MEMBER** |
| **A3** | **"Am I on track?"** | `/me` renders `lateCount` · `/me/group` renders `weeksBehind` | **Not two implementations — two different questions.** Deferred weeks count in one and not the other | **MEMBER** |
| **A4** | **Group population** | `/me/group` "N of M current" | The view filters neither participation status nor breaks (grep returns **0**), so stopped members stay in the list and the denominator | **MEMBER** |
| **A5** | **This-week Short** | `/admin/this-week` vs each member's own outstanding | §1(a) — group subtraction, no per-member cap | organizer |
| **A6** | **The confirmation** | `PAYMENT_CONFIRMED` body vs the grid cell | §1(b) — a part-paid week is named as covered | **MEMBER** |

**One clean result, recorded because it is one:** `weeksPaid` on `/me` and `/me/group` was
expected to diverge with A1 and **cannot**. Same formula, same input, same cap, proven on
both sides. The view's defect is confined to `weeks_behind` and its row population.

**A correction to the brief this pass was given.** The headline was described as `/me`
showing `weeksBehind` from TS while `/me/group` shows it from SQL. **`/me` never renders
`weeksBehind`** — it renders `lateCount`. Pass 2 found this first (row C2); Part 0 confirms
it at line level. The divergence is real but **definitional**, which makes it harder to fix,
not easier — A3 is the row.

#### Part B — why 2430 tests passed over both bugs

- **The Short bug:** `weekReceipts` has **three dedicated tests that assert `shortfall`** and
  none can fail on it — every payer in every fixture is *in window* at the week under test.
  The defect needs an out-of-window payer, and no fixture builds one. Ground truth §5.1,
  exactly.
- **The Markos bug:** the confirmation test **hard-codes `weeksCovered: [4, 5, 6]`** and the
  extras type has no field for a remainder — the test *cannot* express a partial. §5.6: a
  test can pin a bug as intended behaviour.
- **The status half is untested in both directions.** `manual-late.test.ts:102` covers a
  marked, part-paid week whose window is **open**. **Nothing anywhere constructs a part-paid
  week whose window has closed** — the exact Markos state. Its answer is asserted by nothing,
  and the test to write depends on the OPEN ruling in §3.3, so writing one now would pin an
  answer that has not been given.

**Nine missing reconciliation tests (R1–R9)** are listed in Pass 3 Part B1 and become the
test plan the build writes against (2.24). R1 is the out-of-window-overpayer fixture; R6 and
R7 are the message-versus-allocation and message-selection assertions.

**Worse than missing tests — three verifications that reproduce the rule they check**, from
Pass 2 §5: `check:position` reproduces the deferral drop by hand, `verify-member-privileges`
never selects from the view it claims to verify and prints PASS, and `fee-preview.test.ts`
passes *because* it re-implements the defect. These convert holes into green ticks and must
be rewritten to read the engine — as part of retiring each duplicate (§5 step 3), not before.

#### Part C — the SQL view, evidenced

`public.member_progress` has **exactly one application reader** (`getGroupProgress`, serving
`/me/group`). Everything else — every admin screen, every message, and `/me` itself — reads
TypeScript.

**No test in the repository references `member_progress`.** Zero results across every test
file. So the 17-of-107 figure understates it: it is not only that a TS change cannot reach
the view — **nothing would report that it had not.**

Blast radius today is small and precisely bounded: `weeks_paid` is proven identical, so the
divergence is **one number (`weeks_behind`) plus the row population, on one screen**. The
three options — retire / regenerate from the engine / keep as a proven mirror — are costed
factually in Pass 3 Part C4. **That ruling is the organizer's**, like §3.3, and Pass 3 does
not take it.

#### Not yet observed live

A5 and A6 were seen by the organizer. **A1, A2, A3 and A4 are proven from source with
constructed member states and have never been confirmed on a real screen.** Confirming them
is the post-build verification in §6 — the run that currently wedges on admin sign-in.

---

### 4.4 THE RULINGS — Oli's decisions

**This section is the worklist. Nothing in §5 starts until every line below carries a
ruling and a date.** Nineteen decisions: the eighteen Pass 2 could not settle from the
documented rules ([AUDIT_PASS_2.md](AUDIT_PASS_2.md) §THE OPEN RULINGS), plus the
part-paid-and-closed status question from §3.3, which Pass 2 never examined and which
§3.3 states blocks build step 1.

Ordered by money-visibility: the ten that change what a member or the organizer sees as
owed, paid, or their standing come first, then the nine that change an organizer-only
figure. **No option is recommended.** Pass 2 was instructed not to pre-empt these and
this section does not either — the consequences are stated so the choice is informed,
not steered.

Each entry names which implementations the option would make canonical and which it would
retire, so a ruling translates directly into §5 work.

---

### R1. Does a DEFERRED member belong in a week's "N of M paid" headcount?

*headline* · **TIME-CRITICAL — decide before any deferral change ships** · Pass 2 ruling 3

**Why it is open.** §2.29's five effects of deferral name status, arithmetic, messages, the control and clearing but no headcount, and DOMAIN_RULES.md §5's table answers only 'Chased? No' and 'Counts toward what they owe? Yes' — a count of people is neither.

**a) Count them in both** — The `continue` goes entirely: the tile reads '5 of 7 paid' where it now reads '5 of 6', so the denominator finally matches the money on the same tile and the grid column beside it. Cost: the deferred member is filed under 'have not paid' on /admin and in the 'N of M members paid' card on /admin/this-week and inside the members-short count on the week-dates panel — factually true, but it is the chase-shaped reading deferral exists to soften, and it puts the person he decided not to pursue back at the top of the screen he opens to decide whom to pursue.
  - *Makes canonical:* `lib/dashboard.ts:255-257`
  - *Retires:* `lib/dashboard.ts:253`, `app/admin/(protected)/page.tsx:213-214`, `app/admin/(protected)/this-week/page.tsx:115`, `app/admin/(protected)/cycle/position/week-dates-data.ts:151-153`

**b) Count them in the denominator and report them separately** — A membersDeferred field on WeekReceipts makes the row read '5 of 7 paid · 1 deferred': nobody is mis-counted and nobody is filed as chased, and it is the only option that lets the money fix land without dragging the headcount with it. Cost: one field on the WeekReceipts type and three renderers — after which the week-date panel's apologetic footnote (already rewritten three times by its own account) can be deleted rather than rewritten a fourth time.
  - *Makes canonical:* `lib/dashboard.ts:200-218`
  - *Retires:* `lib/dashboard.ts:253`, `app/admin/(protected)/cycle/position/week-date-panel.tsx:186-192`

**c) Fix only the money** — The `continue` is split so it guards the two counters but not `expected`: money figures become correct and self-consistent while the headcount stays deliberately chase-shaped. Cost: the tile permanently says '$3,500 expected · 5 of 6 paid' where $3,500 is seven members' money and 6 is six members, and the week-date panel's footnote has to stay forever explaining it.
  - *Retires:* `lib/dashboard.ts:253`

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R2. Is a week that is PART-PAID and whose window has CLOSED late, part-paid, or a state of its own?

*headline* · **BLOCKING — it blocks build step 1** · from §3.3, not raised by Pass 2

**Why it is open.** There is no state for "partly paid AND window closed": the window test
returns LATE before the money test is reached, so `PARTIAL` is structurally
window-open-only and Markos's week 13 reads LATE with $500 in it. §2.14's own table defines
late as "**unpaid** and either the window has closed or the organizer marked it" — and week
13 is not unpaid. Whether "unpaid" means *no money at all* or *not settled* is unresolved.

**a) LATE stands** — Partial money does not soften the chase. Costs nothing to build; the
status quo becomes a decision instead of an accident.
  - *Makes canonical:* `lib/derived.ts:189-197`

**b) PARTIAL widens** — Drop "window still open" from its definition, so money beats the
closed window. **Money-visibility consequence:** week 13 silently leaves every chasing
path — no late notice can name it and it drops off the attention list, while $500 is still
owed.
  - *Makes canonical:* `lib/derived.ts:189-197` (rewritten)
  - *Retires:* the LATE-before-money order in the same ladder

**c) A sixth state** — "part-paid, still owed, still chased": its own colour, its own
sentence, and it stays chaseable. Every consumer keyed on `status === "LATE"` must be
taught the new state.
  - *Retires:* the six LATE consumers — `lib/messages.ts:177`, `lib/messages.ts:224`, `app/actions/messages.ts:435`, `app/actions/member.ts:300`, `components/member/equb-calendar.tsx:164`, `components/member/week-stamp-list.tsx:183`

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R3. When the organizer keeps money back out of a payout, may he simply type the lower net figure — and does anything record the money he kept?

*headline* · Pass 2 ruling 1

**Why it is open.** §2.18 sanctions the offer to deduct and nothing more, and §2.15/§2.19 would govern completely only if keeping money out of a payout counts as money RECEIVED from the member — and that classification is exactly what nobody has ruled on.

**a) Leave net free-typed; the button stays a display convenience** — The Collections 'Offer: deduct' button goes on editing only the Net field: the deducted money is recorded nowhere, so the member's weeks still read unpaid and he is chased for money already taken out of his payout, the cash position counts cash the books say is owed, and moving that payout to another week silently restores the full net (grossAmount − feeAmount) because reverseCarryDeduction finds no ledger row to reverse — the audit line states the change but cannot state the cause.
  - *Makes canonical:* `app/admin/(protected)/collections/collections-view.tsx:917-918`, `app/admin/(protected)/collections/collections-view.tsx:595-639`

**b) Keep the button, make it write the money half** — Accepting the offer writes a receipt for the deducted amount, allocated oldest-week-first through the one engine (§2.15/§2.19), with the payout net following from it: the member's weeks clear, he stops being chased, the deduction becomes reversible because it has a row, and movePayoutToWeek stops destroying it. Costs one more write inside the same transaction, and answers the classification question in the affirmative.
  - *Retires:* `app/admin/(protected)/collections/collections-view.tsx:917-918`, `app/admin/(protected)/collections/collections-view.tsx:595-639`

**c) Constrain updatePayout** — The server refuses any save where netAmount ≠ grossAmount − feeAmount − (recorded settlements + recorded deductions), and deductions must go through the paths that record them (draw settlement or carry deduction). The stored gross/fee/net triple can never again be a number no derivation could produce — at the cost of typing an odd hand-over amount directly, which §2.30 explicitly permits ('It can be corrected by hand, and the correction is audited'), so this needs a sanctioned way to record 'I handed over less, and here is why'.
  - *Makes canonical:* `app/actions/edits.ts:1959`
  - *Retires:* `app/admin/(protected)/collections/collections-view.tsx:917-918`, `app/admin/(protected)/collections/collections-view.tsx:595-639`

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R4. When a member stops and later comes back, are the weeks they were away still owed?

*headline* · Pass 2 ruling 2

**Why it is open.** §4.1 records the 'gaps are holes not cutoffs' rule but §4.1 is the CURRENT STATE build-status table describing what was built, not §2 law, while §2.18 pulls the other way inside §2 itself: 'Unpaid means owed. A week stops being owed only when it is marked paid. Nothing else clears it.'

**a) HOLES — the away weeks are never owed** — The break-aware inWindow is adopted at the twenty break-unaware sites. For a CLOSED break over weeks 6–8 at $500, /me stops saying '3 weeks behind, $1,500 overdue', the BEHIND_NOTICE stops saying it, cycle-close stops writing that $1,500 as a permanent ledger DEBT, and her next payment no longer allocates into weeks 6–8. Risk: a member who merely went quiet and was closed/reopened by mistake silently loses a real debt and the ledger at close under-reports by that amount. Cost: ten computeStanding call sites must load breaks, lib/rebuild.ts:39 must decide whether money may land in a hole, and the member_progress view needs a participation_breaks join it does not have.
  - *Makes canonical:* `lib/participation-close.ts:120-124`
  - *Retires:* `app/actions/member.ts:241`, `app/actions/payments.ts:53`, `app/actions/payments-view.ts:63`, `app/actions/payments-view.ts:255`, `app/actions/waiting.ts:169`, `app/actions/cycle-close.ts:70`, `app/actions/cycle-position.ts:178`, `lib/messaging-engine.ts:121`, `app/admin/(protected)/collections/page.tsx:112`, `lib/rebuild.ts:39`, `lib/wheel.ts:49`, `lib/week-winners.ts:162-163`, `lib/week-winners.ts:209`, `lib/draw-settlement.ts:104`, `lib/participation-window.ts:47`, `lib/participation-window.ts:123`, `lib/messages.ts:281`, `lib/payments-view.ts:217-218`, `lib/dashboard.ts:556`, `app/admin/(protected)/cycle/page.tsx:43-44`

**b) OWED — a break records where they were but never excuses money** — The inBreak term is stripped from inWindow (effectiveFinishWeek kept for an OPEN break) and the dashboard expects those weeks again: /admin/this-week starts showing arrears for weeks the organizer deliberately never chased, and the cycle-wide shortfall rises by every away-week of every reopened member — the $1,500 for weeks 6–8 appears on the organizer's screens to match what /me already tells her. Matches §2.18 verbatim; twenty sites become correct as written and only two change.
  - *Makes canonical:* `app/actions/member.ts:241`
  - *Retires:* `lib/participation-close.ts:120-124`

**c) SPLIT — holes for the group's EXPECTATION, owed for the MEMBER's balance** — Both screens stay exactly as they are and today's accident becomes the written rule: /admin/this-week permanently expects nothing from her for weeks 6–8 while /me permanently says $1,500 overdue and cycle-close permanently writes it as a ledger DEBT. It means the organizer's shortfall figure and the member's own statement are allowed to disagree forever — the state §5.10 names, 'TWO FUNCTIONS ANSWERING ONE QUESTION IS THE SAME DEFECT AS NONE' — and whoever reconciles the books later has to know which figure is which.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R5. May a payout be reduced by the member's CURRENT-cycle week arrears — and what records it?

*headline* · Pass 2 ruling 4

**Why it is open.** §2.18's offer is defined against the carried ledger balance, and nothing says whether current-cycle week arrears may be netted off a payout at all or what the acceptance must write — the same unruled classification question as ruling 1, on a second control.

**a) Delete the amber offer** — One offer, one debt, one audited write: the payout row shows only the carry-balance offer, which renders nothing ('They carry no balance.') when the ledger balance is 0. He loses the one-press way to net a winner's week arrears off the cash he hands over at the table.
  - *Makes canonical:* `lib/carry-balance.ts:104`
  - *Retires:* `app/admin/(protected)/collections/collections-view.tsx:922`

**b) Route it through the settlement engine the draw already uses** — Accepting writes a pinned PaymentEvent for the deducted cents plus a payout decrement, exactly as the winner's own-week settlement does: the member's weeks actually clear, the receipt is auditable and reversible, and the payout figure and the week grid agree. Costs a new action and a refusal for arrears exceeding the net.
  - *Makes canonical:* `lib/draw-settlement.ts:124-159`
  - *Retires:* `app/admin/(protected)/collections/collections-view.tsx:922`

**c) Keep it as a pure convenience for typing into the Net field, and say so on screen** — §2.18's 'Unpaid means owed… Nothing else clears it' then holds: the member hands back $1,500 of his payout and his weeks keep reading unpaid and his standing keeps saying $1,500 outstanding. He is charged twice and nothing on any screen says why.
  - *Makes canonical:* `app/admin/(protected)/collections/collections-view.tsx:922`

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R6. When a cycle-wide week is SKIPPED, does a drawn member who stopped early still owe it?

*headline* · Pass 2 ruling 5

**Why it is open.** §2.30 fixes the FEE to weekly × weeks committed regardless of attendance but says nothing about what a drawn member owes back, and §2.18's 'Unpaid means owed' presumes a week that was owed in the first place.

**a) A skipped week is still owed by a drawn member** — Final position stays weeklyAmount × weeksCommitted, so a stopped member who took the pot is billed one weekly amount per skipped week — consistent with §2.30's reasoning that the place was held either way and with the fact that the member took a full pot funded on the assumption of 20 weekly contributions. It means a member is billed for a week the platform told everyone was skipped, and the sentence on their portal will not reconcile with their own week list, which shows that week as SKIPPED and $0.
  - *Makes canonical:* `lib/final-position.ts:135-137`
  - *Retires:* `lib/derived.ts:299`

**b) A skipped week is owed by nobody, drawn or not** — The position page's arithmetic wins: the final figure never charges a week nobody owed, matching amountOutstanding, weekReceipts and allocatePayment (all of which pass over skipped weeks) and matching what the member sees on their own week list. It means the pot a drawn member received was larger than the contributions the group ends up collecting, by one skipped week per member, and the organizer absorbs that under §2.18.
  - *Makes canonical:* `lib/derived.ts:299`
  - *Retires:* `lib/final-position.ts:135-137`

**c) Skipped weeks push the finish week out instead of being forgiven** — Nobody loses a contribution and nobody is billed for a week that did not happen; the cycle simply runs longer, which §2.7 already contemplates. It changes every member's finish date whenever a week is skipped — and finish dates are in signed agreements (§2.30).

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R7. Is "weeks elapsed" measured per week row against its own stored date, or as one cycle-wide high-water mark?

*headline* · Pass 2 ruling 6

**Why it is open.** §2.14 says only 'Weeks behind = weeks elapsed in their window − weeks credited' and never defines how elapsed is measured, while lib/commitment.ts:146-153 and the 20260806020000 migration header argue per-week and lib/dashboard.ts's own comment claims memberAttention 'cannot disagree with computeStanding' even though its calendar half is the range.

**a) Per-week everywhere** — memberAttention takes the week rows and calls weekCountsAsDue per row, dropping elapsedThroughWeek as a due-set input: /admin's attention line and the person page agree by construction (both print '3 behind · $1,500' for Abebe instead of the dashboard's '4 behind · $2,000.00 owed'), and a corrected week date moves only that week. The per-week elapsed stamp used by the cash chart and the shortfall series still needs a boundary, so the range rule survives at lib/dashboard.ts:156 and :286 and the two must be documented as different questions.
  - *Makes canonical:* `lib/standing.ts:164`, `lib/standing.ts:192`
  - *Retires:* `lib/dashboard.ts:561`, `lib/dashboard.ts:544-550`

**b) High-water mark everywhere** — computeStanding takes elapsedThroughWeek and counts week numbers at or below it, so the person page prints the dashboard's '4 behind · $2,000.00' too — one boundary decided once, shared by the charts and the behind-count. But a week deliberately dated far in the future is then counted as overdue the moment any later week closes: the drift the 20260806020000 migration was written to remove.
  - *Makes canonical:* `lib/commitment.ts:159-165`, `lib/dashboard.ts:561`
  - *Retires:* `lib/standing.ts:164`, `lib/standing.ts:192`

**c) Leave as is** — The dashboard and the person page keep printing different behind-counts and different amounts owed for the same member whenever a week's stored date runs out of sequence with its number — '4 behind · $2,000.00 owed' on /admin and 'Weeks behind: 3' with $1,500 on his profile, in the same session.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R8. Which day boundary closes a payment window — UTC midnight, or midnight in the group's own timezone?

*headline* · Pass 2 ruling 7

**Why it is open.** §2.14 fixes no boundary and no section names a timezone; `lib/money.ts:5-7` states the UTC convention for the TypeScript and nothing states one for the database, so the SQL view's `current_date` follows whatever the Postgres session's TimeZone happens to be. (Pass 2 ranks this headline *contingent*: it queries no database and could not verify the deployed TimeZone; Supabase's default is UTC, so it may never fire. Recorded as a ruling that is needed, not a proven live defect.)

**a) Pin the view to UTC** — The SQL becomes `(now() AT TIME ZONE 'UTC')::date >= (w.date::date + 5)`, so the two engines agree by construction whatever the deployment's TimeZone. The late boundary then lands at 8pm local for an Eastern group: a member paying at 9pm Thursday is already LATE on /me.
  - *Makes canonical:* `lib/derived.ts:77-78`
  - *Retires:* `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:62`

**b) Move both to the group's local day** — The boundary matches how members actually experience Thursday — nobody is marked late while it is still Thursday evening where they live. Cost: every date function (`lib/money.ts`, `lib/derived.ts`, `lib/dashboard.ts`, `lib/commitment.ts`) has to take a timezone, and `lib/money.ts:5-7`'s "UTC has no DST, so 7 days apart is always exactly 7 × 24 hours" stops holding.
  - *Retires:* `lib/derived.ts:77-78`, `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:62`, `lib/money.ts:5-7`

**c) Confirm the deployment's TimeZone is UTC and leave both alone** — Costs one `SHOW TimeZone;` and no code changes. Leaves a silent one-day divergence that returns the moment the database moves or the setting changes, with no test that would catch it — for a window of hours each day /me would show a week LATE and count it in the outstanding balance while /me/group's behind-count does not.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R9. Is a member's savings progress the money fraction or the weeks fraction?

*headline* · Pass 2 ruling 8

**Why it is open.** §2.14 defines *weeks credited* but the documented rules never define "progress", so nothing says whether the portal's completion figure is cents-over-commitment or weeks-over-weeks.

**a) MONEY** — The ring is driven by `lib/contribution.ts`'s `progress` and the remainder is stated in cents — a member who has paid $9,750 of $10,000 sees 97.5% and "$250 still to save", and a part-paid week moves the bar immediately. The "19 of 20 weeks" caption must then be read as a separate, coarser fact or dropped, and the weeks-based bars on /admin/people and /admin/waiting move to money with it.
  - *Makes canonical:* `lib/contribution.ts:103`
  - *Retires:* `components/member/member-personal-summary.tsx:39-40`, `app/admin/(protected)/people/people-directory.tsx:259`, `app/admin/(protected)/waiting/waiting-view.tsx:471`

**b) WEEKS** — Everything is driven from `weeksCredited` and the cents fraction stops being rendered as a bar; all four surfaces agree instantly and the caption matches the bar. But a member who has paid half of this week sees no movement at all until the week completes, which reads as "my payment did not register" — the alarm `member-personal-summary.tsx:30-35` was written about.
  - *Makes canonical:* `components/member/member-personal-summary.tsx:39-40`
  - *Retires:* `lib/contribution.ts:103`

**c) BOTH, LABELLED** — The portal prints "$9,750 of $10,000 saved" and "19 of 20 weeks complete" side by side. Nothing on screen is wrong any more, at the cost of two numbers where a member wants one. Cheapest option; it does not remove the second implementation, so §5.10's defect stands.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R10. What should "Next due" on a member's portal name — the oldest uncovered week, or the current one?

*headline* · Pass 2 ruling 9

**Why it is open.** `EQUB_GROUND_TRUTH.md` never uses the phrase "next due" and fixes no label (re-checked by search); §2.15 governs where money LANDS — which `app/actions/messages.ts` answers correctly — and says nothing about what a portal date labelled "Next due" must name.

**a) Portal names the oldest uncovered week** — A member 3 weeks behind is shown week 10 — the week his money would actually clear under §2.15 ("Oldest unpaid weeks first, waterfalling forward"). Honest, but reads as further behind than "next due, week 12".
  - *Makes canonical:* `app/actions/messages.ts:276-279`
  - *Retires:* `app/actions/member.ts:295-298`

**b) Keep the current-week form and rename the label ("This week", "Pay by")** — The portal still shows week 12's date for a member 3 weeks behind, but the words stop implying an allocation target. No arithmetic changes anywhere. Note the fallback branch at `app/actions/member.ts:295-298` already IS the oldest-week form and its comment describes that branch accurately — the file is answering two questions with one field name.
  - *Makes canonical:* `app/actions/member.ts:295-298`

**c) One shared helper with an explicit argument for which question is being asked** — One function returns two named answers — "the week you are being asked to pay" and "the week your money will land on" — neither able to drift from the other. Costs a small refactor across two action files.
  - *Retires:* `app/actions/member.ts:295-298`, `app/actions/messages.ts:276-279`

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R11. Should the dashboard's "overdue across closed weeks" headline count money nobody will ever send?

*headline* · Pass 2 ruling 10

**Why it is open.** §2.18 settles only that the money must be remembered somewhere — "The organizer absorbs the gap so no other member is ever short… The software's job is to remember, never to enforce" — and both screens do remember it; which figure a headline carries is a presentation ruling the rules do not make.

**a) Chart adopts the sort-out (both read "still waiting on")** — With one member stopped owing $2,000, the /admin dashboard headline flips from "$2,000.00 overdue across closed weeks" in red to "All in — closed weeks are fully collected". Honest about what he is chasing, silent about what he lost; the loss lives only on the position screen's stopped list.
  - *Makes canonical:* `lib/cycle-position.ts:217`
  - *Retires:* `components/charts/collected-vs-expected-chart.tsx:75`

**b) Position drops the sort-out (both read "did not arrive")** — /admin/cycle/position's "Outstanding" rises from $0.00 to $2,000.00 and now includes money nobody will ever send — contradicting `lib/cycle-position.ts:197-201`'s own stated intent, re-mixing the two populations §2.18 separates, and leaving the card's sub-text "{n} members owe it" naming a count that excludes the person the money is missing from.
  - *Makes canonical:* `components/charts/collected-vs-expected-chart.tsx:75`
  - *Retires:* `lib/cycle-position.ts:217`

**c) Keep both, rename both (Pass 2 notes this is what the evidence recommends)** — `lib/cycle-position.ts:217` becomes `stillToCollect`, the chart's figure becomes `didNotArrive`, and the chart's caption says so — the same $2,000 and $0.00 stay on screen but as two labelled facts instead of a contradiction. No arithmetic changes; costs a rename across the chart, the position page and their tests.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R12. Which clock is THE current week — the projection off the cycle start date, or the stored week rows?

*visible* · Pass 2 ruling 11

**Why it is open.** §2.14's derived table names the projection literally ("Current week | cycle start date + today — never hardcoded, never stored"), but that line predates stored week rows becoming the authority for a week's date and §2.23 making `Cycle.startDate` editable, so nothing answers whether §2.14 governs EVERY use of "the current week" — including §2.27 draw eligibility and the paid-ahead boundary — or only the display figure.

**a) Stored rows win everywhere** — Correcting the start date can never move a week number and every screen agrees — /admin's header and /admin/cycle/position both print week 12 of 20 after a one-week postponement. Reads against §2.14's own wording, and after a postponement the payments header stops advancing until the next row's date arrives, so "Record week N" targets a week already paid. `currentWeekNumber` survives only as the no-rows fallback at `lib/commitment.ts:191`.
  - *Makes canonical:* `lib/commitment.ts:194-197`
  - *Retires:* `lib/money.ts:162-168`

**b) The projection wins everywhere** — Matches §2.14 literally and the week number always advances. But §2.27 draw eligibility (`lib/wheel.ts:49`) and the paid-ahead boundary would then move whenever the start date is edited — the exact thing `app/actions/cycle-position.ts:98-102` and `app/actions/waiting.ts:72-74` say must never happen, and which `lib/week-date-authority.test.ts` scans the source to prevent.
  - *Makes canonical:* `lib/money.ts:162-168`
  - *Retires:* `lib/commitment.ts:194-197`

**c) Keep both, name them apart on screen ("week 13 by the calendar, week 12 by the record") and write the split into the ground truth** — No number changes; the organizer stops reconciling two labels himself when /admin says "Week 13 of 20" and /admin/cycle/position says "week 12 of 20" the same afternoon. Ratifies what the code and its guard test already do.

**d) (d) Leave as is** — After any date correction the payments screen and the draw screen go on disagreeing by up to one week — the payments screen offers "Record week 13 · $X" while `lib/wheel.ts:49` admits only owners with `startWeek <= 12 <= finishWeek` — with nothing on either screen saying so. No money figure has two clocks: `lib/week-date-authority.test.ts:195-201` asserts `lib/standing.ts` and `lib/dashboard.ts` never mention `currentWeekNumber` at all.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R13. "Running out of weeks undrawn" — is the warning threshold three weeks or four, and off which clock?

*visible* · Pass 2 ruling 12

**Why it is open.** §2.27 makes the warning mandatory — "the system must WARN the organizer in advance — clearly and on the dashboard" — and gives an *example* of two weeks, but fixes no threshold and names no clock, while `weeksAhead` is 3 at both `undrawnWindowWarnings` call sites and `AT_RISK_WEEKS` is 4, and the dashboard feeds `currentWeekNumber` where the Waiting screen and the wheel feed `currentWeekFromRows` (the clock half is ruling 11).

**a) One constant, 4, exported once and used by all three call sites** — The dashboard warns a week earlier than it does today and the two screens name the same people — a member finishing at week 17 with the clocks at week 13 appears both on /admin/waiting as AT RISK and in /admin's "Windows ending undrawn (2.27)" block. Slightly more warnings; keeps the planning margin he wrote down at `lib/waiting.ts:63-66` as "the organizer's own working margin".
  - *Makes canonical:* `lib/waiting.ts:67`
  - *Retires:* `lib/wheel.ts:86-87`

**b) One constant, 3** — The Waiting at-risk pill appears a week later and fewer rows are flagged; he loses that margin. §2.27's "silent automatic removal without the warning would let a real person be quietly missed" argues against shortening the notice.
  - *Makes canonical:* `lib/wheel.ts:86-87`
  - *Retires:* `lib/waiting.ts:67`

**c) Keep two thresholds deliberately, and label them (a dashboard nudge vs a Waiting-list state)** — No code change, but the two screens keep naming different sets of members — a member finishing at week 17 is AT RISK on /admin/waiting and absent from /admin's undrawn-windows block — with nothing on screen saying why.

**d) (d) Leave as is** — Both the threshold and the clock divergences persist, and after any date correction the mandatory §2.27 safeguard can name a member on one screen and omit her on the other — with the clocks one week apart and one identical threshold of 3, a member finishing at week 16 is named on the dashboard and absent from the wheel-setup warning block.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R14. Where does a payout with no draw belong in a per-week record?

*visible* · Pass 2 ruling 13

**Why it is open.** §2.9 requires the archive to be "a readable record: who paid what, who was paid out, how much, when", but no rendered total is wrong today — the archive page renders received, paidOutNet, stillHeld and outstanding, never pendingNet — so the document never settles whether the archive must NAME money that was awarded and then lost its draw.

**a) The archive folds it into the first week, matching cashSeries** — The closed-cycle archive files the draw-less payout under week 1, the same week the live cash chart already shows it as pendingOut, so the archive's week list reconciles with its totals under one rule for both surfaces. It also attributes that payout to a week it has nothing to do with, permanently, in a document §2.9 says is not re-derivable afterwards.
  - *Makes canonical:* `lib/dashboard.ts:138`
  - *Retires:* `app/actions/cycle-close.ts:156`

**b) The archive gains an "unattributed payouts" block** — The archive page and the frozen JSON gain one new section listing each draw-less payout by number, member, net and status. Every payout is named honestly and none is invented onto a week. Costs one section in the frozen JSON and on the page.

**c) Leave it and say so on the page** — Cheapest, and no total is wrong today. It means a payout that was awarded, never collected, and whose draw was later undone appears in no week of the permanent record and nothing on the page names it — exactly the row a member might ask about two years later.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R15. Should the "What you should hold" attention dot use the counted cash and include money owed back to stopped members?

*visible* · Pass 2 ruling 14

**Why it is open.** Nothing in the ground truth defines which of the two comparisons a section's attention dot must carry.

**a) Make the dot read positionVerdict (verdictKind === "short")** — The "What you should hold" dot on /admin/cycle/position fires on the counted-cash test, which includes owedToStopped — one test, one answer. But it then duplicates the "What you hold" dot, which already fires on the same condition (app/admin/(protected)/cycle/position/sections.ts:96), and it goes dark before the first cash reading of a cycle.
  - *Makes canonical:* `lib/cycle-position.ts:388-390`
  - *Retires:* `app/admin/(protected)/cycle/position/page.tsx:78`

**b) Keep it books-based and add the missing term** — The dot becomes h.shouldBeHolding < h.paidEarly + h.drawnNotHandedOut + h.owedToStopped, so a stopped member's money — say $1,500 sitting in his hands — can no longer leave the dot dark, and the signal still works before any cash reading exists. It still disagrees with positionVerdict whenever counted cash differs from the books, which is the whole reason the reading is recorded.
  - *Retires:* `app/admin/(protected)/cycle/position/page.tsx:78`

**c) Leave it and reword the section to say it is about the books only** — No arithmetic change. He keeps a dot that stays off while $1,500 of a stopped member's money sits in his hands — though the "What you hold" dot does fire in that state and the "short by $500" sentence still renders (page.tsx:108), so the alarm is raised on the neighbouring tab rather than nowhere. The section stops claiming to be the "using someone else's money" signal.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R16. Does "N weeks remaining" include the week currently in progress?

*visible* · Pass 2 ruling 15

**Why it is open.** §2.22 fixes the answer for the commitment cap — "Join at week 15 of a 20-week cycle → the maximum offered is 6 weeks. The system does not allow more by accident." — and says nothing about the dashboard header.

**a) Make the header inclusive (remainingWeeksInCycle(cycle.plannedWeeks, currentWeek))** — At week 15 of a 20-week cycle the dashboard header changes from "5 weeks remaining" to "6", agreeing with the add-member wizard's pre-fill and cap. On the final week the header reads "1 week remaining" rather than "0", which is arguably more honest since that week's money is not collected yet. Both figures then come from one function.
  - *Makes canonical:* `lib/money.ts:129`
  - *Retires:* `app/actions/dashboard.ts:253`

**b) Keep the exclusive form and re-label it ("N weeks after this one", "N weeks to go")** — The header keeps printing 5 at week 15 while the wizard caps at 6, but the words stop implying they are the same figure. No arithmetic changes. Two functions still answer one question (§5.10), so the next screen that needs the figure has to pick.

**c) Leave both** — The dashboard header and the join screen disagree by one every week of every cycle — "5 weeks remaining" beside a commitment capped at 6. No money moves: weeksRemaining is display-only and never feeds a cap. But it is the figure the organizer plans the draw schedule against.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R17. Is "days waiting" elapsed 24-hour periods, or calendar days crossed?

*visible* · Pass 2 ruling 16

**Why it is open.** EQUB_GROUND_TRUTH.md says nothing about day counting anywhere (re-checked by search).

**a) Calendar days everywhere (the dashboard form); waiting.ts calls it** — "Waiting 1 day" means the date changed once, which is how a person reading a list of dates counts, and it matches formatDateUTC, which is UTC-calendar-day throughout. A payout drawn at 11pm reads as 1 day old at 1am. The waiting list's counts, its "Waiting longest" sort and its 14-day stale threshold all move onto the dashboard's clock.
  - *Makes canonical:* `lib/dashboard.ts:467-468`
  - *Retires:* `lib/waiting.ts:70-73`

**b) Elapsed 24-hour periods everywhere (the waiting.ts form); dashboard.ts imports it** — "Waiting 1 day" means a full day has actually passed. A member welcomed yesterday morning reads as 0 days waiting until the same hour today, which may read as "nothing has happened yet". The dashboard's "· 1d" stamps move onto the waiting list's clock.
  - *Makes canonical:* `lib/waiting.ts:70-73`
  - *Retires:* `lib/dashboard.ts:467-468`

**c) Leave both** — Two facts stamped at 2026-08-12T23:00Z, read at 01:00Z the next day: the waiting list says 0 days, the dashboard prints "· 1d". Two figures read side by side on the same morning keep differing by one for events at the same hour; "Waiting longest" is sorted by one definition while the dashboard's day counts use the other, and the waiting view's 14-day stale threshold fires a day later than the dashboard would.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R18. Should ?week be parsed by one rule, and should a week with no row render empty or fall back?

*visible* · Pass 2 ruling 17

**Why it is open.** The documented rules cover neither the parse nor the fallback.

**a) One parser — move /admin/this-week onto focusedWeek** — ?week=7abc stops rendering WEEK 7's money on /admin/this-week and is ignored on both screens, so a malformed or stale link no longer silently lands the organizer on a different week's money. Two lines change.
  - *Makes canonical:* `lib/week-focus.ts:36-40`
  - *Retires:* `app/admin/(protected)/this-week/page.tsx:50-53`

**b) Also change the fallback — resolve a non-existent week to the last real one rather than rendering it empty** — An empty week-24 page stops reading as "nobody owes anything" once the cycle overruns its generated rows, which §2.7 says to expect ("Track the truth: if it is actually running longer, show the real week"). Costs a visible behaviour change: "This Week" would sometimes show a week other than the calendar's current one. Note this can no longer be done by adopting resolveTargetWeek — that function is dead (no production caller).

**c) Leave as is** — Two parsers stay and an empty breakdown keeps rendering for a week with no row. §2.10's "Never leave doubt" is carried by a page that shows a week's worth of zeros with nothing saying the week does not exist, and ?week=7abc keeps rendering WEEK 7's money under a URL nobody meant.

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---

### R19. Must the member portal's past-cycle sentence follow §2.18's closing-statement wording?

*visible* · Pass 2 ruling 18

**Why it is open.** §2.18's two exemplars govern the closing STATEMENT, which closingStatementText follows exactly; they sit adjacent to a portal balance sentence that answers a narrower question and carries a fact (pendingNet) the statement does not.

**a) Give closingLine the week counts and reserve "complete" for weeksPaid >= weeksCommitted** — A member's own past-cycle card reads "You paid 19 of 20. Balance $0." instead of "$0 outstanding — complete.", so one vocabulary runs across the archive and the portal. Costs the portal the pendingNet sentence unless it is kept as a second line, and "complete" then disappears for anyone a skipped week left one week short — a member who genuinely owes nothing.
  - *Makes canonical:* `lib/cycle-close.ts:175-179`
  - *Retires:* `lib/member-history.ts:96-102`

**b) Leave the split and state on screen that the portal line is about the BALANCE, not attendance** — No arithmetic changes and the portal keeps its pending-payout warning. components/member/past-cycle-card.tsx:51 already prints "{weeksPaid} of {weeksCommitted} weeks" directly above the sentence, so the count is in front of the reader; the risk is the word "complete" alone being quoted back out of context.

**c) Fold both into one function returning the §2.18 sentence plus any pending-payout clause** — One sentence serves the organizer's archive and the member's card, so §2.18's exemplars become the single source for every closing sentence and pendingNet stops being portal-only — a member whose payout was never handed over sees that fact wherever the cycle closes. Costs a decision about what the sent WhatsApp closing statement — a THIRD wording, lib/whatsapp-templates.ts:251 — should say.
  - *Retires:* `lib/cycle-close.ts:175-179`, `lib/member-history.ts:96-102`

> **OLI'S RULING:** ______________________________________________
>
> **Recorded date:** ______________

---


## 5. THE BUILD PLAN

**No longer a placeholder — the audit has landed.** Passes 1, 2 and 3 are in §4. This
section is written from them.

### 5.0 The shape of the work: designation, not rewrite

Pass 2's central finding is the one that sizes this build: **the correct implementation
almost always already exists in the codebase, and the wrong ones are re-derivations that
drifted from it.** Of 115 adjudicated quantities, 45 have a demonstrably correct
implementation already written; only **one** — "expected for a week" — has none.

So the build is mostly:

> **designate the canonical implementation → migrate its readers → delete the drift.**

That is a very different project from rewriting the money layer, and the difference is
worth stating plainly because it changes the risk: a migration whose target already exists
and already has tests is provable step by step, and each step is revertible on its own.

**The scale, counted rather than estimated:** 48 quantities carry a named canonical
implementation, and retiring their drifted copies means removing or re-pointing
**114 locations**.

### 5.1 The nucleus, corrected

§3 says `computeStanding` "already has 18 callers." **That number is wrong and the
correction matters for sequencing.** Counted from source:

- **9 real call sites** — `app/actions/cycle-close.ts:63`, `cycle-position.ts:171`,
  `member.ts:234`, `participation-close.ts:85`, `payments-view.ts:56`, `payments.ts:375`,
  `waiting.ts:162`, `app/admin/(protected)/collections/page.tsx:105`,
  `lib/messaging-engine.ts:114`.
- 18 is the count of *files that mention it*. The rest import its types.
- **`lib/dashboard.ts` is not among the callers.** It mentions `computeStanding` three
  times — [:508](../lib/dashboard.ts#L508), [:540](../lib/dashboard.ts#L540),
  [:554](../lib/dashboard.ts#L554) — every one a comment asserting its numbers "cannot
  disagree with" a function it never calls. §5.5, and §1(a) already flagged it.

**Consequence for the plan:** the nucleus is smaller and the migration surface is larger
than "18 callers" implied. `lib/dashboard.ts` is not a caller to update — it is a parallel
implementation to retire, and it is the file both §1 bugs live in.

### 5.2 Step 0 — the rulings. Nothing starts until these are answered

§4.4 holds **19 rulings**. Two gate the engine itself:

- **§4.4 #1 (deferred in the headcount) — TIME-CRITICAL.** The money half is already
  RESOLVED (deferred weeks are owed, so they belong in `expected` — canonical
  `lib/payments-view.ts:225`). But the money and the headcount sit behind the **same
  `continue`** at [lib/dashboard.ts:253](../lib/dashboard.ts#L253), so shipping the money
  fix moves the headcount whether or not anyone decided it should.
- **§4.4 #2 (part-paid and window closed) — BLOCKING.** §3.3 already establishes this
  blocks step 1: the engine ships the status ladder it is given and cannot invent one.

The other 17 gate individual migrations, not the engine, and can be answered in the order
their screens come up — except that answering them early is cheaper than answering them
mid-migration.

### 5.3 Step 1 — build the engine

Unchanged from the ordering below: grown from `computeStanding`, reconciled with §3 against
Pass 1's catalog, shipping with its own tests and no readers.

**One genuine build-from-scratch piece.** Pass 2 ruled that **"expected for a week" has no
correct implementation today** — four populations under one name, and none right on every
axis (window, skipped weeks, deferral, and the stopped-member population). Every other
migration points at existing code; this one is written new, against the §4.4 rulings that
define its population. It is the only place in this build where "what should it be" is not
already answered by something in the repository.

### 5.4 Step 2 — migrate readers, one at a time

Each migration proves the screen's numbers are **identical or corrected**, per the ordering
below. The canonical targets, from Pass 2 Part A/C (headline quantities; the visible and
footnote rows are in [AUDIT_PASS_2.md](AUDIT_PASS_2.md)):

| Quantity | Canonical — the single source | Drifted copies to retire |
|---|---|---|
| SHORTFALL 1 of 5 — "Short" for ONE week (the group's per-week gap) | `lib/dashboard.ts:257` | 3: `lib/dashboard.ts:264` +2 more |
| SHORTFALL 2 of 5 — the whole-cycle collection shortfall over ELAPSED weeks | `app/actions/cycle-position.ts:206` | 3: `lib/dashboard.ts:253` +2 more |
| SHORTFALL 5 of 5 — the cash page's whole-series "Short" card | `lib/cycle-position.ts:194 (with :209) — or, for a headline, components` | 3: `app/admin/(protected)/cash/page.tsx:62` +2 more |
| RECEIVED for a week — two populations under one name | `lib/dashboard.ts:250` | 2: `lib/payments-view.ts:222` +1 more |
| Fee once drawn — the STORED Payout.feeAmount against every live derivation | `app/admin/(protected)/people/[id]/page.tsx:326 (and :730)` | 2: `lib/participation-removal.ts:100-101` +1 more |
| Payout gross, one lucky number | `lib/fee-preview.ts:79-104` | 3: `app/actions/edits.ts:534` +2 more |
| Member's whole projected payout (gross / fee / net across all their numbers) | `lib/fee-preview.ts:102-104 for the projection, and app/admin/(protecte` | 3: `components/admin/payout-equation.tsx:56-60` +2 more |
| Is a given week inside a member's window — whose rows the SQL view counts at all | `lib/dashboard.ts:531 / app/actions/cycle-position.ts:239` | 3: `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:43-44` +2 more |
| Does this week COUNT AS DUE NOW (the gate behind weeks-behind and outstanding) | `lib/derived.ts:95-115 (weekCountsAsDue), applied at lib/standing.ts:16` | 2: `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:52-63` +1 more |
| Weeks behind | `lib/derived.ts:138-147 fed by lib/standing.ts:164 (weekCountsAsDue)` | 2: `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:52-63` +1 more |
| On track / behind, and how many members are current | `lib/dashboard.ts:531 + :567` | 3: `app/actions/member.ts:459-460` +2 more |
| Remainder still owed on one week (per-week remainder / tickable) | `lib/standing.ts:205 (coveredAtCurrentRate) as the basis; lib/week-pick` | 4: `app/admin/(protected)/payments/payments-members.tsx:36` +3 more |
| Who has paid / not paid for one week (the this-week grouping) | `lib/derived.ts:169 (paymentStatus), asked rather than re-implemented, ` | 3: `app/admin/(protected)/cycle/position/week-dates.ts:113` +2 more |
| Payment status of one week (PAID / PARTIAL / LATE / UNPAID / DEFERRED / SKIPPED) | `lib/derived.ts:169, fed lib/standing.ts:205's coveredAtCurrentRate — t` | 3: `lib/dashboard.ts:365` +2 more |
| Effective finish week (where a stopped member's window actually ends) | `lib/participation-close.ts:169 (legacyBreak), matched exactly by prism` | 3: `app/actions/participation-close.ts:453` +2 more |
| Written off / forgiven amount | `app/actions/ledger.ts:173` | 1: `app/admin/(protected)/people/[id]/carried-balance.tsx:302` |
| Amount due for one week | `lib/draw-settlement.ts:105-108, with lib/payments-view.ts:225 and lib/` | 2: `lib/dashboard.ts:253` +1 more |
| Weeks behind (Pass 1 #47 — the SQL view and its guard) | `lib/derived.ts:138 fed by lib/standing.ts:164-173` | 2: `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:37` +1 more |
| On track / behind flag, and how many are current (Pass 1 #49) | `lib/dashboard.ts:567 and lib/messages.ts:732` | 2: `components/member/member-group-list.tsx:82` +1 more |
| Payment recorded against a carried balance, and what is left | `app/actions/ledger.ts:81` | 2: `app/admin/(protected)/people/[id]/carried-balance.tsx:217` +1 more |
| My weekly amount | `lib/lucky-numbers.ts:128` | 2: `app/actions/edits.ts:534` +1 more |
| Marked late (the organizer's own stored decision) | `app/actions/edits.ts:1377-1379` | 1: `app/actions/edits.ts:1278` |
| Applied carry deduction (deducted, payout net after, balance after) | `lib/carry-balance.ts:178` | 1: `components/admin/carry-deduction-offer.tsx:177` |
| Members needing attention (the behind list) | `lib/standing.ts:96` | 1: `lib/dashboard.ts:510` |
| Who the outstanding money is with (owedBy, per member) | `app/actions/cycle-position.ts:205` | 1: `lib/dashboard.ts:581` |
| Outstanding carried to the person's ledger at cycle close (the closing DEBT entry) | `app/actions/participation-close.ts:343` | 1: `lib/cycle-close.ts:154` |
| What one week EXPECTED to collect: is a DEFERRED member's weekly amount in it? | `lib/payments-view.ts:225` | 2: `lib/dashboard.ts:253` +1 more |
| A member's WEEKS BEHIND: does the organizer's manual late mark pull a not-yet-elapsed week into the count? | `lib/standing.ts:164` | 1: `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:62` |
| WHICH WEEKS form a member's elapsed/due set: week rows with their flags, or an integer range plus whatever payment rows exist? | `lib/standing.ts:164` | 3: `lib/dashboard.ts:544-550` +2 more |
| "Should have come in" / collection Outstanding versus the per-member outstanding printed under it, for a manually marked week whose window is still OPEN | `lib/derived.ts:113` | 2: `lib/dashboard.ts:286` +1 more |
| Deferring a week CLEARS an existing manual late mark (the stored markedLateAt) | `app/actions/edits.ts:1378` | 1: `app/actions/edits.ts:1277-1282` |
| (a) RETIRE the view — serve /me/group from the engine through a server action | `lib/derived.ts:138-147 fed by lib/standing.ts:164-173 (Pass 2 rows A16` | 8: `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:24-66 (the live view body)` +7 more |
| (b) REGENERATE the view from the engine so one definition produces both | `lib/derived.ts:138-147 fed by lib/standing.ts:164-173 (Pass 2 rows A16` | 4: `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:52-63 (hand-written elapsed term, replaced by generated SQL)` +3 more |
| (c) KEEP the view as a mirror, with a test proving it agrees with the engine | `lib/derived.ts:138-147 fed by lib/standing.ts:164-173 (Pass 2 rows A16` | 5: `scripts/verify-member-privileges.mts:65 (queries its own SQL copy, never public.member_progress — Pass 2 :3598-3599 "the PASS line at :108 is a claim about code it did not read")` +4 more |

### 5.5 The structural sub-decision — the `member_progress` SQL view

**This is a decision, not a task, and it is the organizer's.** The view re-derives standing
in Postgres, so a TypeScript fix cannot reach it — and Pass 3 proved something worse:
**no test in the repository references `member_progress` at all.** Nothing would report that
a change had failed to reach it.

Pass 3 also bounded the damage precisely, which makes this decidable rather than alarming:
**one application reader** (`getGroupProgress`, serving `/me/group`), `weeks_paid` **proven
identical** to the TypeScript, so the divergence is **one number (`weeks_behind`) plus the
row population, on one screen**.

Before choosing, note **why the view exists**: it is read through the caller's own Supabase
session so the *database* enforces the §2.8 privacy boundary. "Just delete it" therefore
costs a privacy guarantee, and any option that moves the read into a server action must say
what enforces that boundary instead.

The three options — **retire**, **regenerate from the engine**, or **keep as a proven
mirror** — are costed in Pass 3 Part C4. Whichever is chosen, the outcome must include a
test that fails when the two disagree; today none exists.

### 5.6 Step 3 — retire the drift, and the verifications that hide it

Deleting the 114 drifted locations comes last, once nothing reads them.

**Three "verifications" must be rewritten as part of this step, not before it.** Pass 3
found they reproduce the rule they check, converting holes into green ticks:
`check:position` reproduces the deferral drop by hand; `verify-member-privileges` never
selects from the view it claims to verify and prints PASS; `fee-preview.test.ts` passes
*because* it re-implements the defect. Rewriting them before their subject migrates would
pin the current answer; rewriting them after leaves a window where nothing checks. They move
**with** each retirement.

### 5.7 The test plan

**Nine reconciliation tests (R1–R9)**, listed in Pass 3 Part B1, are what the build writes
against (2.24). R1 is the out-of-window-overpayer fixture — the one whose absence let §1(a)
ship past three tests that assert `shortfall` and cannot fail on it. R6 and R7 are the
message-versus-allocation and message-selection assertions for §1(b).

**One test must not be written yet.** Nothing in the repository constructs a part-paid week
whose window has closed — the exact Markos state. Writing one now would pin an answer
§4.4 #2 has not given.

### 5.8 What falls out, and what does not

**The two bugs in §1 are NOT separate tasks.** They fall out when their screens read the
engine: this-week's Short becomes a sum of per-member `amountOutstanding` (§3.4), which has
no group subtraction to get wrong; and the confirmation reads the payment event (§3.7),
which the allocator already computes. Fixing either ahead of the engine is exactly the
patching this build exists to stop.

**What does NOT simply fall out — Pass 3's A3.** `/me` and `/me/group` do not disagree
about one number computed twice; they answer **two different questions** (`lateCount` versus
the view's `weeks_behind`) and present both as "how am I doing". No reconciliation makes two
different questions agree. This one needs a decision about what each screen is asking before
any migration can make it consistent — see the corrected §4.2.4.

**Message selection migrates like any other reader.** The send path is not a special case:
it stops deciding which message to send and starts reading the named event (§2, §3.7), on
the same identical-or-corrected proof every screen migration carries.

**One item is Meta's, not ours:** the partial-aware confirmation template (§3.7) needs
submission and approval. The event and the branching are buildable now against a draft
registry entry, so approval is not on the critical path — but the message cannot tell the
truth about a partial week until the template exists.

### 5.9 The ordering

1. **Rulings first (§4.4).** #1 and #2 before anything is built; the rest before their
   screen migrates.
2. **Build the one-truth function.** Grown from `computeStanding`, reconciled with §3
   against Pass 1's catalog. Nothing reads it yet; it ships with its own tests. Includes the
   one new implementation, "expected for a week".
3. **Migrate readers one at a time.** Each proves its numbers **identical or corrected** —
   and where corrected, the reason is recorded here. A screen whose numbers change silently
   is a failed migration, not a finished one.
4. **Decide the SQL view (§5.5)** — it can be decided any time after the engine exists, and
   must be decided before `/me/group` is called migrated.
5. **Retire the duplicate derivations last**, each with its self-reproducing verification
   rewritten alongside it. Deleting a derivation before its last reader has moved is how a
   migration turns into an outage.

**Audit status:** all three passes are complete (§4.1–§4.3). Pass 3 re-derived Pass 1's
surfaces lists rather than trusting them and found **roughly 57% of Pass 1's surface
citations are not surfaces** — so the earlier caveat in §4.1(f) is discharged, and §4.3
Part 0 is the list to work from.

---

## 6. VERIFICATION

**Per migrated screen.** Its numbers match the engine, or are corrected with the reason
recorded in §5. "Looks the same" is not evidence; the comparison is asserted in a test.

**Reconciliation tests — the ones whose absence let both bugs ship.** Unit tests over
pure functions cannot catch a disagreement between two functions that are each correct in
isolation, which is precisely what happened 2430 times. So: tests that **force
independently-shown numbers to agree**, built on a fixture that resembles production
(§5.1) — in particular a member outside their window who has overpaid, which is the
fixture that would have failed bug (a) on the day it was written. At minimum:

- Sum of per-member outstanding **=** this-week Short, over a fixture containing an
  out-of-window overpayer.
- Sum of per-member truths **=** cash position.
- The confirmation message's claims **=** the allocation that produced it — and the
  message **chosen** = the event the engine named (§3.7), asserted over all five cases,
  including the one that shipped wrong: a payment leaving a remainder can never select
  the message that says a week was paid in full.
- Every surface showing one member's status **=** every other surface showing it.

Each of these is proven to fail before it is trusted (§5.2).

**A final full audit.** Playwright / agent-browser against the real screens, **if it can
be made to work against admin sign-in — which currently wedges.** We intend to **fix
that**, not skip it: a test credential path, or whatever the smallest honest mechanism
turns out to be. Recorded here as a known blocker with an owner rather than as a reason
to settle for less. If it proves genuinely intractable, the fallback is systematic
page-by-page verification against the engine, and that fallback is a decision to be
recorded here — not a silent substitution.

---

## 7. NON-NEGOTIABLES

- **Build once, to last two years.** No patches, no slap-fixes. A defect found mid-build
  is fixed at its source in the engine, never at the screen that surfaced it.
- **The database is live production.** Real members, real money.
- **The cycle closes 27 September 2026.** Migrations are proven before they touch
  readers. Nothing lands untested against a date this close.
- **Tests accompany every money change (2.24).** Not later, not "when there's time." A
  build that changes money behaviour is not finished until its tests pass and are shown.
- **The ground truth stays the law.** If this build needs a rule changed, the rule is
  changed **in `EQUB_GROUND_TRUTH.md` first**, by the organizer, and this document follows.
- **This document is kept current.** It is updated as the build proceeds — decisions,
  corrections, and what each migration changed. The plan is never reconstructed from
  chat.
