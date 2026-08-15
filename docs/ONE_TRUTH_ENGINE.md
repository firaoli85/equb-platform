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

### The message is the last unmigrated reader — and the one that breaks trust

**Every screen already reads the member's true status.** Verified live: for a $200 payment
on a $2,000 week, the `/me` weeks list, the admin grid and the member profile all show
week 14 as **"$200 of $2,000 · Partial"**, correctly.

**The WhatsApp confirmation is the only surface that lies.** For that same payment it says:

> *"…recorded on week 14. You have now paid 13 of 20 weeks. Thank you."*

It asserts the week is done. Every other reader in the platform got this right; the message
did not, and the message is the one that reaches the member when they are not looking at a
screen.

> ## TRUST LAW
>
> **A member's confidence depends on the message matching reality.**
>
> A member pays part, is told "paid, thank you", forgets the rest, and is chased weeks
> later. That chase is **lose-lose**: they believe the organizer made the error, and even
> when they pay, the trust is gone. The organizer is left arguing with his own records
> against a message the platform sent in his name.
>
> **So the message must always state, in the member's own terms, exactly what their money
> did and exactly what remains** — so that a later chase is never a surprise.

This is why the engine exists as much as the numbers are. A wrong figure on a screen is
found and corrected; a wrong sentence in someone's WhatsApp history is remembered, and the
member has no way to check it.

Three consequences, carried into §3.7 as build requirements:

1. **A payment's message is derived from the status that payment produced**, never computed
   separately. A payment leaving a remainder produces a partial-aware message.
2. **When a part-paid week later goes late, the notice must name that week's own
   remainder** — *"$300 still due for your week 14"*, never *"we did not receive your
   payment"*. A member who paid $200 must never be told nothing arrived.
3. **The engine emits the message-type for each status transition**; the send path selects
   by reading it, never by guessing.

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

### 3.0 THE MECHANICS — DESIGN LAW

**Ruled by the organizer, 15 August 2026.** These five rules are not a draft and are not
reconciled against anything — they are the law the engine implements. Where the tables in
§3.1–§3.8 disagree with them, the tables are wrong. They extend R0: R0 said every total is
arithmetic on the member's status; these say what the status *is*.

#### 1. A week's status is MONEY **and** CALENDAR, not one label

A week carries **two independent facts** — how much is paid against what is due, and
whether its own window has closed. The status is the pair, not a single word:

| Money | Calendar | Reads |
|---|---|---|
| fully paid | either | **PAID** — whenever it arrived |
| part paid | window open | **PARTIAL** — the rest is still expected, not late |
| part paid | window closed | **PARTIAL + LATE** — *"you paid $200, still owe $300, and it is now late"* |
| unpaid | window closed, or marked late | **LATE** |
| any | deferred | **DEFERRED** — see rule 3 |

**A LATE or PARTIAL+LATE week must state the specific remainder owed for that week** — a
figure, never a flag. Where several weeks are owed, **each states its own amount**, and they
are not interchangeable: one may be a whole week owed, the next a part-week remainder.

This settles R2 (a sixth state) and makes the calendar half a property of **the week's own
date**, which settles R7.

#### 2. Remainders roll forward and accumulate

**A partial remainder never disappears.** It stays owed. Owe $300 from week 4, then week 5
passes unpaid at $500, and the member is **$800 behind** — not $500, and not "week 4 is
over".

The engine sums outstanding **across all weeks**. Nothing is forgotten because a week
passed.

#### 3. DEFERRED is where "paused / unknown" lives — and there is no second concept beside it

> **Ruled by Oli, 15 August 2026:** *"There is nothing we hold here — if we don't know what
> happened we put DEFERRED; if someone is late, it's late."*

**There are exactly two things a not-yet-paid week can be: DEFERRED or LATE.** There is no
third "held" state, no "held" vocabulary, and no field implying one. Earlier drafts of this
document introduced *held* as a separate idea; that was one concept too many and is removed
throughout. Where the word survives in ordinary English ("the cash he holds"), it means cash
in hand, never a week's status.

Deferring a week means **"paused, outcome unknown."** Precisely:

- **not counted as owed right now** — it leaves the current expectation
- **not chased** — no message names it
- **not written off** — the money is not forgiven
- **shows as $0 for now**, and is **re-openable** by a payment landing on it

**A later payment fills the OLDEST owed or deferred week first**, never the current one
(2.15). Pay in week 5 and it fills deferred week 3, then 4, then forward.

> Note for the build: **this half is already the behaviour.** `allocatePayment` skips only
> `isSkipped` weeks ([lib/allocation.ts:90](../lib/allocation.ts#L90)); it has never skipped
> deferred ones, so money already lands oldest-first including deferrals. Rule 3 makes the
> existing behaviour law rather than accident.

The apparent tension is deliberate and must survive into the code: **a deferred week is
excluded from what is owed, and still eligible to receive money.** Deferred is not paid and
not forgiven — it is a hole in the record that the arithmetic does not currently charge for,
and rule 4 says when it stops being a hole.

#### 4. A deferred week ALWAYS RESOLVES — it never vanishes

**Ruled 15 August 2026, closing the one wording tension in this document.**

"Not counted" means **not counted in the CURRENT expectation** — not expected this week, not
chased, not in "N of M paid". It has never meant *gone*. A deferred week has exactly two
endings, and one of them always happens:

| Ending | When |
|---|---|
| **Filled** | The member returns and pays. Money lands oldest-first (rule 3), so it fills the deferred week before anything newer. |
| **Carried** | The participation is closed. The still-deferred and still-owed weeks **settle into the carried-balance ledger** for the next cycle, through the existing carry system (2.18). |

So deferral is never an ending and never a write-off. It is a decision **postponed to the one
moment the answer is actually known** — and the answer is always recorded somewhere.

> **This is what R1 means.** R1's ruling reads *"not expected, not chased, counts toward
> nothing."* Read against this rule, "counts toward nothing" scopes to the **current
> expectation** — the group's this-week figures, the chase, the headcount. It does not mean
> the money leaves the record, because rule 4 says where it goes. The two are one rule stated
> at two moments, not a contradiction.

##### The money model is now closed

**Four week states, and nothing else:**

> **PAID · PARTIAL · LATE · DEFERRED**

There is **no "held"** (rule 3) and **no "break"** (R4). Every not-yet-paid week is either
DEFERRED — the organizer agreed to pause it — or LATE. Nothing else exists, and nothing new
may be added without amending this rule.

#### 5. Everything derives from the profile — the engine's contract

```
payout          = weeklyAmount × weeksCommitted − fee
expected-by-now = weeklyAmount × elapsed non-deferred weeks
paid            = sum of receipts
owed            = expected − paid, DEFERRED weeks excluded, remainders ROLLED (rules 2, 3)
cash on hand    = sum of receipts
cash expected   = sum of owed
```

**No total is computed independently. Each reads the member's status.**

Two consequences worth stating, because they answer rulings on their own:

- **Money that clears a member's weeks must exist as a receipt.** `paid` is the sum of
  receipts and `owed` is `expected − paid`, so money taken out of a payout that is recorded
  nowhere leaves the member still owing it on every screen — and chased for money already
  taken. This settles R3 and R5.
- **A total can never disagree with the members it is made of**, because it is not a second
  computation. This is §1(a) made unrepresentable rather than fixed.

#### 6. THE EQUB IS NOT A STORE

**A week is never rejected for being underpaid.** Members pay what they have — $5, $200,
cash today and the rest next week. The system **always records what is given**, marks the
week partial, and **keeps expecting the rest**.

- It never refuses a payment for being short.
- It never treats short-paid as unpaid.

A store needs full payment before it hands anything over. An equb is **saving among people
who trust each other**: whatever they can give is accepted and tracked, and the remainder
stays owed (rule 2) rather than becoming a reason to turn the money away.

> **Already true, and to be kept true.** `allocatePayment` applies `min(owed, remaining)` to
> each week in turn ([lib/allocation.ts:93](../lib/allocation.ts#L93)) and has no minimum;
> the module's own note reads *"A leftover too small to fill a week becomes a PARTIAL on that
> week"* ([:58](../lib/allocation.ts#L58)). A search for a minimum-payment or
> short-payment refusal across the allocation, week-picking, payment-entry and record paths
> returns nothing. Rule 6 is therefore a **guard on existing behaviour**, not new work — it
> exists so no future validation adds one.
>
> The one refusal that does exist is the opposite case and stays: money that fits **nowhere**
> — beyond the member's remaining weeks — is refused with *"That amount does not fit their
> remaining weeks — reduce it."* ([payment-entry.tsx:496](../components/admin/payment-entry.tsx#L496)).
> That is an overpayment guard, not a minimum.

#### 7. CONFIGURABILITY OVER HARD-CODED CHOICE

> **"If I have the capability to choose, I don't have to decide it now."**

Where a decision is a matter of **the organizer's preference rather than correctness**, it
becomes **a setting he controls**, not a value hard-coded once by whoever built the screen.

**The engine computes the truth; SETTINGS decide when and how it is communicated.** The two
are separate concerns and must not be welded together — this is the messaging counterpart of
rule 5, and it is why a whole class of §4.4 rulings dissolves rather than needing an answer.

##### What becomes configurable — Settings → Messaging, per message type

Covering `PAYMENT_CONFIRMED`, `PARTIAL_CONFIRMED`, `LATE_NOTICE`, `BEHIND_NOTICE`,
`WINNER_ANNOUNCEMENT`, the weekly reminder, and `GROUP_ANNOUNCEMENT`:

| Setting | Choice |
|---|---|
| **AUTO or MANUAL** | Fire automatically on the triggering event, **or** prepare it on the member's message list for the organizer to send by hand |
| **Day and time** | For time-triggered messages (late notices, reminders): which day and what time they fire |
| **Timezone** | The timezone the equb runs on — chosen once, applied **everywhere a deadline is computed** |

##### The timezone setting settles "whose midnight" (R8)

**Late is measured against the organizer's configured local day and time**, not a hard-coded
UTC and not the viewer's locale. One setting, chosen once, read by every deadline
computation — the TypeScript ladder and any SQL that survives §5.5.

This does not weaken 2.14. The *rule* for lateness is unchanged and still derived; what the
setting supplies is **the clock the rule is evaluated against**, which the platform has never
actually stated anywhere (Pass 2 open ruling 7 exists precisely because no section names a
timezone).

##### Defaults

**Every toggle defaults to current behaviour.** Nothing changes on the day this ships until
Oli flips something. A setting that silently changes what members receive on deploy would be
the opposite of the control this rule exists to give him.

##### The limit of this rule

Configurability is for **preference**, never for correctness. Whether a part-paid week still
owes its remainder is not a setting; whether the member hears about it on Tuesday morning or
the moment it happens is. **If two options would make a number wrong, it is a ruling, not a
toggle** — and R4, R6 and R12 stay rulings for exactly that reason.

**A useful test for the borderline cases:** ask whether the two options produce *different
truths* or *the same truth communicated differently*. R8 (whose midnight) looked like a money
question and is not — the rule for lateness never changed, only the clock it is read against.
R13 (warn at three weeks or four) is the same shape: §2.27 makes the warning mandatory and
fixes no number, so the number is his. Both become settings.

Note what the setting does **not** excuse: where two screens currently read *different*
values for one threshold, that is a real defect and the fix is one constant read by both —
the setting decides what that shared value is, not whether there is one.

---

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

**The ladder as built** is `paymentStatus`
([lib/derived.ts:189-197](../lib/derived.ts#L189-L197)): SKIPPED → PAID → DEFERRED → LATE
(marked) → LATE (window closed) → PARTIAL → UNPAID. **This ladder is superseded** — it
returns one label from a chain of early returns, and §3.0 rule 1 requires two facts.

> ## RULED — §3.0 rule 1, and R2. This section is no longer blocking.
>
> A single-label ladder cannot express PARTIAL + LATE, because the window test at
> [derived.ts:196](../lib/derived.ts#L196) returns before the money test at `:197` is
> reached. Markos's week 13 reads LATE with $500 in it.
>
> **The engine returns the pair, not a word:** `{ money: paid | part | none, remainder,
> windowClosed, deferred }`, with a display label derived from it. A part-paid week whose
> window has closed reads **part-paid, still owed $500, and late** — and **stays
> chaseable**.
>
> **Six consumers keyed on `status === "LATE"` must each be taught the new state** —
> [messages.ts:177](../lib/messages.ts#L177) (`hasChaseableWeeks`),
> [messages.ts:224](../lib/messages.ts#L224) (`lateWeeks`, feeding `{myLateWeeks}` and
> LATE_NOTICE), [messages.ts:435](../app/actions/messages.ts#L435) (the chasing gate),
> [member.ts:300](../app/actions/member.ts#L300) (the portal's late count),
> [equb-calendar.tsx:164](../components/member/equb-calendar.tsx#L164), and
> [week-stamp-list.tsx:183](../components/member/week-stamp-list.tsx#L183). **Include the
> new state, never exclude it** — excluding it is the money-visibility trap: $500 owed and
> no chase can name it.
>
> Each such week must carry **its own remainder as a figure**, so a member owed two weeks
> is told two amounts, not one flag (rule 1).

### 3.4 Money totals

| Field | S/D | Notes |
|---|---|---|
| `totalPaid` | S | Sum of receipts — the one stored aggregate, and it is a sum of facts |
| `weeksCredited` | D | `totalPaid ÷ weeklyAmount`, floored |
| `weeksPaid` | D | `min(weeksCredited, weeksCommitted)` |
| `weeksBehind` | D | Elapsed − skipped − **deferred** − credited, floored at 0 (§3.0 rule 3) |
| **`amountOutstanding`** | D* | **Per-week sum of `remainder`, over every week, rolled forward** (§3.0 rule 2) — never a group subtraction, and never reset because a week passed. This is the shape that makes bug (a) unrepresentable |
| `amountDeferred` | D | **New.** Sum of `remainder` on **deferred** weeks — not owed now, not chased, not written off (§3.0 rule 3). Kept separate from `amountOutstanding` so a deferred week's money is never silently read as "paid" or as "owed". **Not a second state** — it is simply the money attached to weeks that are DEFERRED |
| `surplus` | D | Money beyond the entire window at the current rate |
| `lastPaymentWeek`, `paidUpToWeek` | D | `paidUpToWeek` is the contiguous fully-PAID prefix; any gap ends it |

**Rule 2 worked:** $300 remaining on week 4, week 5 unpaid at $500 → `amountOutstanding`
is **$800**. Week 4's remainder does not lapse because week 4 ended.

**Rule 3 worked:** those same weeks, week 4 deferred → `amountOutstanding` is **$500** and
`amountDeferred` is **$300**. The $300 is not gone; it is not being asked for. A payment of
$200 lands on **week 4 first** — the oldest — and `amountDeferred` falls to $100.

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

**The deferral lifecycle ends here (§3.0 rule 4).** While the participation is open, a
deferred week's money sits in `amountDeferred`, not `amountOutstanding` (§3.4). **At account close it
stops being unknown:** the still-deferred and still-owed weeks settle into
`carriedBalance` through the existing carry system, and the person carries them into the
next cycle.

So the engine has exactly one moment where a deferred week resolves, and it is the moment the
answer is actually known. Two build consequences:

- **Close is the only writer.** Nothing else may move a deferred week's remainder into the
  ledger, and no path may drop it. `amountDeferred` at close is the amount that must appear.
- **The four DEBT-writing paths must agree on this.** Pass 2 recorded four
  (`cycle-close.ts:350`, `participation-close.ts:344`, `edits.ts:422`, `:442`) where an
  earlier draft claimed two. Each must write deferred-plus-owed under one rule, or the ledger
  disagrees with the truth that produced it.

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
- **The gap is surfacing, not recording.** Partial already works and is already correct
  (§3.0 rule 6). What is missing is the closed-window state (§3.3, now ruled) and this
  message.

#### The message is a REQUIRED OUTPUT of the status, not an optional extra

The trust law in §2 makes this a build requirement rather than a nicety:

- **The confirmation is derived from the status the payment produced.** The five cases above
  are not five decisions — they are the five shapes the event can take, and the send path
  reads which one occurred. A payment leaving a remainder **cannot** select the message that
  says a week was paid in full, because the event that selects it records the remainder.
- **A status TRANSITION emits a message-type too, not just a payment.** When a part-paid
  week's window closes, that transition is what a late notice reads.

##### The late notice must name the week's own remainder

This is the second half of the trust law and it is **not** covered by the confirmation work.
Today's approved body ([lib/whatsapp-templates.ts](../lib/whatsapp-templates.ts)) reads:

> "Hi {{1}}, **we did not receive your payment** for your week(s) {{2}}. That is {{3}} to
> catch up. …"

with `variableOrder: ["name", "myLateWeeks", "amountOwed", "myPaidUpToWeek", "myCurrentWeek"]`.

Two defects against the trust law, in fixed Meta-approved text:

1. **"we did not receive your payment"** is false for a member who paid $200. It is the exact
   sentence the trust law forbids, and it is frozen in an approved template — it cannot be
   fixed in code.
2. **`{{3}} amountOwed` is the member's TOTAL outstanding**, not the remainder on the named
   week. A member owed a whole week plus a part-week is given one lump figure, when §3.0
   rule 1 requires **each week to state its own amount**.

So the late notice needs its own replacement body and a **per-week remainder placeholder**
that does not exist in the registry today. That is a **second Meta submission**, and it is
the reason the answer to "is the message migration the only change" is no.

#### The output is FILTERED to what the member needs

The engine holds the **full** truth; member-facing surfaces show the **subset the member
needs** — *rip the necessary, not all the things inside*.

- **Shown:** the week, what it cost, what arrived, what is still due on it, and their
  standing.
- **Not shown:** the allocation trace — which receipt filled which week in what order,
  running remainders, pinned settlement mechanics, internal week coordinates.

The member portal already does this well (≈95% right), and the design **keeps that
filtering**. Computing the full truth and displaying a subset is not a compromise of the
one-source rule — it is the point of it: one place holds everything, each surface takes what
its reader needs. A surface that showed everything would be as unusable as one that
recomputed its own.

#### THE MESSAGE DECISIONS — ruled 15 August 2026, and they are law

Four rulings that fix the shape of every member-facing payment message. They
supersede the "three things to settle" list below, which is kept as the record of
what was open before them.

##### 1. NO RECEIPT DATES, anywhere, ever

**A recorded date is not the date the money moved.** Oli records payments when he
can get to them, around a full-time job and a network; a member reads their bank
or Zelle statement and sees a different day. Near a week boundary the two land on
opposite sides of it, and the message then argues with the member's own bank.

**The code says the same thing, harder.** `PaymentAllocation` is not a ledger — it
is a REPLAY. `rebuild.ts` deletes every allocation and re-creates it by replaying
events oldest-first at the CURRENT weekly amount, on every receipt edit, deletion,
commitment change, settlement and un-defer. So *"you paid $900 on Aug 12 and $900
on Aug 19"* can silently become a different split, while the member is holding a
WhatsApp message asserting the old one.

> **A message states facts that STAY TRUE.** Anything that a later edit can
> rewrite has no business in a message that cannot be recalled.

##### 2. ANCHOR TO THE WEEK, NEVER THE DATE OF A PAYMENT

Every reference is **the member's own week number plus that week's SCHEDULED
date**, in brackets. Both are stable cycle facts: the week's date is stored on the
week row and does not move when money moves.

##### 3. ONE MESSAGE PER PAYMENT EVENT — the history is the thread, not the message

Each message documents **that payment and the standing it produced**, and nothing
about earlier payments. Three payments on one $2,000 week send three messages:

> "You paid $900 for your week 14 (Sunday, August 16). $1,100 is still due for
> that week."
> "You paid $900 for your week 14 (Sunday, August 16). $200 is still due for that
> week."
> "You paid $200 for your week 14 (Sunday, August 16). Your week 14 is now paid in
> full."

**Every one of those is true when sent and stays true forever.** The member's
message history becomes the record, and no single message has to reconstruct a
split that a later edit could rewrite. This is §3.7's per-payment shape already,
and Phase 1's settings are already per-message.

##### 4. NO {weekHistory} PLACEHOLDER — dropped, not deferred

The receipt-date/prior-split placeholder proposed in the Phase 4 diagnostic is
**deleted from the design**. It cannot be composed from anything that stays true
(ruling 1). Two placeholders survive, and only two:

| Placeholder | Renders | Composed from |
|---|---|---|
| `{paymentBreakdown}` | "week 14 (Aug 16), week 15 (Aug 23), week 16 (Aug 30)" | the cycle's stored week dates — stable |
| `{stillDueOnWeek}` | "$1,800 is still due for your week 14 (Aug 16)" | the engine's per-week `remainder` |

**Both are NON-DASHABLE.** No list, no send — the default-deny sentinel guard
(`lib/placeholder-kinds.ts`) refuses them empty, so a confirmation can never go out
unable to say which weeks the money reached.

**No ranges, ever.** `{paymentBreakdown}` enumerates every week with its own date.
The existing `myWeeksCovered` composer produces `"2–3 (Aug 23 – Aug 30)"` and is
retired from the confirmation: it is the "week(s) 14-16" form Oli rejected, and it
carries the en dashes v3 bans.

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

### 3.8 THE DRAW IS CHOSEN, NOT GATED — design law

**Ruled 15 August 2026.** This replaces the framing of R12 rather than answering it: the
question was *"which clock decides the current week for draw eligibility"*, and the answer is
that **eligibility does not decide anything**. The organizer does.

#### The four rules

1. **The organizer selects WHICH WEEK a payout is awarded to — any week: past, current, or
   future.** The reason is cash flow, not bookkeeping. Money accumulates across weeks while
   some members are late or deferred, and the pot is drawn when enough has actually come in.
   So an earlier week's slot may legitimately be awarded during a later week.
2. **The organizer selects WHO wins.** Multiple winners may be awarded in one sitting, and to
   one week.
3. **Adding a winner is ADDITIVE.** Selecting another person **never deletes or replaces** an
   existing winner. Removing a winner is a **separate, explicit action**. A selection that
   silently overwrites a prior award is a defect, not a shortcut.
4. **The engine computes ELIGIBILITY and surfaces it; it does not gate or auto-select.** Who
   has not yet won, and who is paid in far enough to be drawn, are facts — the engine's job
   (rule 5). Presenting them is help. Enforcing them is not the engine's decision to make.

> **Truth informs; the organizer decides.** This is 2.2 (organizer discretion is a feature)
> applied to the wheel, and it is the same shape as rule 7: the engine is authoritative about
> **what is true**, never about **what he is allowed to do**.

#### Why this dissolves the clock question

R12 asked whether "the current week" is the projection off the cycle start date or the stored
week rows, because `lib/wheel.ts` uses it to decide **who may be drawn**. Under rule 4 above,
**nothing is decided by that number** — eligibility is displayed, and the organizer picks
regardless of what it says. A figure that gates nothing cannot cause a wrong award.

What remains of R12 is a display label, which is where it now sits.

#### This is a REBUILD, not an invention

**This behaviour existed and worked in the prior project.** It is not a new design being
attempted for the first time on live money; it is known behaviour being rebuilt on the engine.
That materially lowers its risk and should be reflected in how it is sequenced in §5 — the
open question is how the wheel reads the engine, not what the wheel should do.

### 3.9 Open questions for the audit

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

### R0. THE GOVERNING PRINCIPLE — ruled 15 August 2026

> **The member's status is the single source.** Active or stopped; weeks paid; and per
> week, current / late / partial. **Every total — cash on hand, cash expected, paid-ahead,
> "N of M paid" — is arithmetic ON that status, never a separate computation.**

This is not a new idea in this document; it is §2's goal stated as a rule with a date, and
it is now binding rather than aspirational. Two consequences worth stating plainly:

1. **It settles a whole class of rulings without further judgment.** Wherever a ruling asks
   "which of these two computations of a total is correct", the answer under R0 is
   **neither** — the total is arithmetic over per-member status, and the only remaining
   question is what the per-member status says. Several of R3–R19 dissolve on this alone.
2. **It makes the §1(a) defect unrepresentable rather than fixed.** A group total that is a
   sum over per-member statuses has no group subtraction to get wrong, so one member's
   surplus cannot mask another's debt. That is the structural cure §2 promised.

R0 governs R1 through R19: where a ruling's options differ only in *how a total is
computed*, R0 has already answered it. Where they differ in *what the status itself means*,
it has not.

---

### RE-CLASSIFICATION AGAINST §3.0 — 15 August 2026

The mechanics in [§3.0](#30-the-mechanics--design-law) are design law, and they answer
rulings that were open when this section was written. Every one of R3–R19 was re-read
against them.

> **FINAL — 15 August 2026. Every ruling is now closed.** After rules 1–7 and Oli's
> decisions on the break, the draw, skip-week and the archive:
>
> | Outcome | Count | Which |
> |---|---:|---|
> | **ANSWERED** by rules 1–5 | 5 | R3, R5, R7, R10, R11 |
> | **RULED** directly by Oli | 3 | R1, R2, R4 |
> | **RESOLVED** — superseded by design law (§3.8) | 1 | R12 |
> | **RESOLVED** — fixed to one value (correctness) | 5 | R15, R16, R17, R18, R19 |
> | **DISSOLVED** by rule 7 — became a setting | 3 | R8, R9, R13 |
> | **PARKED** — capability kept, design deferred | 1 | R6 |
> | **DEFERRED** — not important enough to rule | 1 | R14 |
> | **STILL OPEN** | **0** | — |
>
> **Nothing in §4.4 is open.** R0 governs; R1–R19 each carry a verdict and a date. The build
> gate in §5.2 stands at **zero**.

| # | Question | Verdict against §3.0 |
|---|---|---|
| **R3** | Typing a lower payout net; what records the money kept back | **ANSWERED — rule 5.** `paid` is the sum of receipts and `owed = expected − paid`, so money that clears weeks **must exist as a receipt**. Option (a) leaves the member chased for money already taken. → **option (b)** |
| **R5** | Netting current-cycle arrears off a payout | **ANSWERED — rule 5**, identically. Option (c) charges the member twice by its own description. → **option (b)**, through the settlement engine |
| **R7** | Weeks elapsed: per-week row or cycle-wide high-water mark | **ANSWERED — rule 1.** The calendar fact is *"whether **its** window has closed"* — a property of the week's own date. → **option (a)**, per-week everywhere |
| **R10** | "Next due": oldest uncovered week or current one | **ANSWERED — rule 3.** Money fills the oldest owed/deferred week first, and under rule 5 a screen must name what the engine will actually do. → **option (a)** |
| **R11** | Does the overdue headline count money nobody will send | **ANSWERED — rules 3+4+5.** A stopped member's weeks are **deferred**, so they leave `amountOutstanding` and the headline; they are not written off — they settle into the ledger at close. → **option (a)** |
| R9 | Progress ring: money or weeks | **RESOLVED — SETTING, default WEEKS.** Matches the "13 of 20" language members already read. All four surfaces must read the one setting |
| R12 | Which clock is "the current week" | **RESOLVED into §3.8.** Eligibility is shown, never enforced, so nothing is gated by it. What remains is a label: screens name the week by the STORED ROWS |
| R15 | The "what you should hold" dot | **RESOLVED — FIXED to (b).** Books-based, with `owedToStopped` added. Correctness, not preference |
| R16 | "N weeks remaining" inclusive of this week | **RESOLVED — FIXED to inclusive**, one function. 6 at week 15 of 20, agreeing with the cap |
| R17 | "Days waiting": 24-hour periods or calendar days | **RESOLVED — FIXED to calendar days**, the way a person reading dates counts |
| R18 | `?week` parsing and the empty-week fallback | **RESOLVED — FIXED, both halves.** One parser; a non-existent week resolves to the last real one and says so |
| R19 | Past-cycle sentence wording | **RESOLVED — FIXED to (c),** one sentence for archive and portal. The sent WhatsApp closing joins the Meta queue |
| **R4** | Are the weeks a returning member was away still owed | **RULED — option (b). THERE IS NO "BREAK".** Silent stop = LATE; arranged pause = DEFERRED. Away weeks are owed unless deferred |
| **R6** | Does a drawn member owe a skipped week | **PARKED.** Oli will not design skip-week blind and does not want it deleted. Capability stays, behaviour unchanged, revisit on a real case |
| **R8** | Which midnight closes a payment window | **DISSOLVED — rule 7.** Becomes the timezone setting; late is measured against the organizer's configured local day. Default UTC |
| **R13** | At-risk warning: three weeks or four | **DISSOLVED — rule 7.** Becomes a configurable notice period, default 4. The one-constant-two-values defect is still a build task |
| **R14** | Where a payout with no draw sits in the archive | **DEFERRED — not important.** No rendered total is wrong today; revisit only if a member asks |

> **Rules 3 and 4 refine R1, and shrink its conflict with the ground truth.** R1 ruled a
> deferred week *"excused… counts toward nothing"* and carried a warning that it reverses
> §2.29's *"deferral has never excused the money."* Rules 3 and 4 are narrower: deferred is
> **deferred, not excused** — not owed *right now*, never written off, and it **settles into the
> carried balance at close**. The money is still remembered, which is what §2.29 was
> protecting. That narrower change is the one that was made: **the ground truth was amended
> on 15 August 2026 as D-42** (commit `3999eae`) to read *"a deferred week is a pause and
> resolves at close"* rather than *"a deferred week is forgiven"* — and it keeps 2.18's
> promise that the software's job is **to remember, never to enforce**.

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

> **OLI'S RULING — RULED.** A deferred week is **excused**. Not expected, not chased,
> counts toward nothing. *"We're not getting that money by agreement."*
>
> So a deferred week leaves the group's expectation, leaves what the member owes, leaves
> the chase, and leaves every count — headcount included. This settles the headcount
> question above and, going further than it was asked, the money question with it.
>
> **Recorded date:** 15 August 2026

> ### ✅ THE LAW HAS MOVED — amended as D-42, 15 August 2026 (`3999eae`)
>
> **This ruling reversed written law, and the law was changed rather than the ruling being
> softened.** The conflict is kept below exactly as it was recorded, because this document's
> own preamble says that where it and the ground truth disagree, **the ground truth wins and
> this document is wrong** — so the ground truth had to move first, and it did.
>
> **What changed:** `EQUB_GROUND_TRUTH.md` §2.29a and D-42 now state that a deferred week
> leaves the CURRENT expectation, is never forgiven, and always resolves — filled
> oldest-first if the member pays, or carried into the person's balance at close. The
> superseded sentence is kept there as dated history, not deleted.
>
> **The deferral slice is unblocked.** What remains is code, not law: three sites still count
> a deferred week in what is owed right now, listed as the D-42 gap in §6.4 and closed by
> §3.0 rule 4 and §3.4 of this document.
>
> **What it contradicted, verbatim — the record of what the amendment had to overturn:**
>
> - `EQUB_GROUND_TRUTH.md` §2.29, the five-effects table, row 2 — a **12 August 2026
>   ruling recorded as D-40**: *"An **elapsed** deferred week still counts as owed:
>   **deferral has never excused the money.**"*
> - `docs/DOMAIN_RULES.md` §5, which separates the two states on exactly this axis:
>   Deferred — *Chased? No · Counts toward what they owe? **Yes***; Skipped — *No · **No***.
>   The sentence above that table reads: *"Two different facts that a single 'excused' flag
>   would destroy."*
> - The same rule is written into the code and the database: `lib/derived.ts:141-142`
>   *"Deferred weeks are NOT subtracted: the money is still owed"*, and the SQL view at
>   `…20260806020000…/migration.sql:55-56` *"ONLY a cycle-wide skip is excused. A personal
>   deferral is still owed (Aug 2026 ruling) — it only stops the chasing, never the debt."*
> - Pass 2 **RESOLVED** the money half the other way on that authority (row C1, canonical
>   `lib/payments-view.ts:225`, which keeps deferred weeks in `expected`). That row is now
>   overturned by this ruling, not by an error in it.
>
> **What the ruling makes true.** DEFERRED and SKIPPED become arithmetically identical;
> the only surviving difference is that one is per-member and the other whole-group. The
> worked example in `DOMAIN_RULES.md` §5 changes: a 20-week member with week 11 deferred
> and week 14 skipped, paid 18 weeks at $500, currently owes **$9,500** — under this
> ruling they owe **$9,000**, and the deferred week is gone from the figure.
>
> **Money that moves.** Every member currently shown as behind on a deferred week becomes
> square; the group's outstanding falls by the same amount; and the DEBT written to a
> person's ledger at cycle close (§2.18) drops by every deferred week they never paid.
> That last one is the consequential part — it changes what a person still owes after the
> cycle ends.
>
> **Three things must change before the build reads this ruling**, and they are Oli's to
> confirm, not mine to assume:
> 1. Amend §2.29 row 2 and record the reversal as a new D-number, keeping D-40 visible as
>    superseded history in the document's own style.
> 2. Amend the `DOMAIN_RULES.md` §5 table and its worked example.
> 3. Decide whether DEFERRED and SKIPPED remain two states at all, now that they differ
>    only in scope. If they stay separate, the reason must be written down; if they merge,
>    that is a schema question, not a display one.

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

> **OLI'S RULING — RULED: option (c), a sixth state.** A partial payment is money received
> with **the rest still expected**. A partly-paid week keeps the money it got **and** keeps
> owing the remainder. It shows as "still owed $X", and it **stays in the chase until it is
> paid in full**. It is not late/give-up, and it is not done. It gets its own state — the
> blue *part-paid, still owed* state — and the remainder stays chaseable.
>
> **Recorded date:** 15 August 2026

> **This unblocks build step 1** (§3.3 said the engine ships the ladder it is given and
> cannot invent one). Consequences, carried forward to §5:
>
> - The status ladder gains a sixth state. `PARTIAL` stops being window-open-only, and the
>   window-closed test stops swallowing part-paid weeks into LATE.
> - **The six consumers keyed on `status === "LATE"` must each be taught the new state** —
>   `lib/messages.ts:177` (`hasChaseableWeeks`), `:224` (`lateWeeks`, feeding `{myLateWeeks}`
>   and LATE_NOTICE), `app/actions/messages.ts:435` (the chasing gate),
>   `app/actions/member.ts:300` (the portal's late count),
>   `components/member/equb-calendar.tsx:164`, `components/member/week-stamp-list.tsx:183`.
>   "Stays chaseable" means each of these must include the new state, not exclude it — the
>   opposite of what option (b) would have done, which was the money-visibility trap §3.3
>   warned about.
> - Markos's week 13 is the worked case: $500 of $1,000 paid, window closed. Under this
>   ruling it reads *part-paid, still owed $500*, and the chase still names it.
> - **A test may now be written** for a part-paid week whose window has closed. §5.7 held
>   that test back pending this ruling; it is released.
> - The partial-aware confirmation template (§3.7) is now specified: the message must be
>   able to say a week was part-paid with a remainder, which is the Meta submission §5.8
>   already flags as not on the critical path.

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

> **ANSWERED BY §3.0 RULE 5 — option (b).** `paid` is the sum of receipts and
> `owed = expected − paid`, so money that clears a member's weeks must exist as a receipt.
> Under (a) the deduction is recorded nowhere, the weeks stay unpaid, and he is chased for
> money already taken out of his payout — which rule 5 forbids by construction.
> (c)'s server constraint follows from (b) rather than competing with it.
>
> **Recorded date:** 15 August 2026 (by rule, not a separate decision)
> **⤷ SUPERSEDED — kept for the audit trail, not deleted.** This verdict was written
> before §3.0 existed and reasons from *"R1, R2 or the principle"* alone. The §3.0-derived
> answer above supersedes it: the mechanics are law and postdate this block. Its plain-language
> framing of the question is still the best in the document and is why it is kept.
>
> **STILL NEEDS OLI.** Verdict unchanged, but sharpened. This headline is two questions and the principle answers one of them. 'Does anything record the money he kept?' is ANSWERED: yes, it must. Cash kept back out of a payout is money that left the member, and 'the member's status is the single source... weeks paid' means it has to land in that status or every total over it is wrong — cash on hand counts money the books still call owed, and he chases a man for money already taken. That kills option (a), 'recorded nowhere', which is also the option that silently restores the full net when the payout is moved to another week, because there is no row to reverse. Verified in code: the button at collections-view.tsx:917-918 only calls setNet() — it edits a text box and writes nothing. What is NOT answered is the other half, 'may he simply type the lower figure': between (b) 'the button writes a receipt and the net follows from it' and (c) 'the same, plus the server refuses any net that is not gross − fee − recorded settlements/deductions'. That is a locking judgment, not a computation, and the principle governs computations of totals. A payout's net is a record of an act (what cash actually crossed the table), not a total derived from member status, so R0 does not force it to be derived. CORRECTION to the prior pass, which cuts slightly IN FAVOUR of (c): the option text in §4.4 cites §2.30's 'It can be corrected by hand, and the correction is audited' as explicit permission to type an odd hand-over amount. Read in place, that sentence is about correcting a payout's STORED FEE by hand after a fee-percent change — it does not sanction a net no record explains. So the written-law objection to locking the field is thinner than the ruling text implies. It does not disappear, though: (c) still needs a sanctioned way to record 'I handed over less, and here is why' before the field can be locked, and building that is real work Oli may not want. Two live options survive. Note for Oli: R3 and R5 are the same classification question on two different buttons and should be ruled in one sitting, or the two payout controls will behave differently for no reason a member could ever be told.
>
> **The question, plainly:** Someone wins the pot of $10,000 but still owes $2,000 from before, so the organizer hands over $8,000 and keeps the $2,000. Everyone now agrees the $2,000 must be written down as that member's payment. The remaining question is whether the hand-over figure should still be free to type: should the system let him write any smaller number he likes, or refuse any figure that does not add up to something recorded?
>
> **1. Let him type it. One press writes the $2,000 down as their payment and fills in the $8,000 for him, but he can still type over it if the real hand-over was something else.**
> He presses the same one button he presses today. Those weeks turn paid, reminders stop naming money he has already taken, and it can be undone if he got it wrong. If he handed over a different amount for a different reason — he was short of cash that day, they settled something at the table — he just types it, and the record shows a figure with no reason attached. Two years later, some smaller pots will have an explanation and some will not.
>
> **2. Refuse it. Every reduction must have something recorded behind it, and the system will not accept a hand-over figure that does not add up.**
> He can never again type a hand-over number out of thin air, so no pot is ever smaller for a reason nobody wrote down. The catch: before this can be switched on, there has to be a way to record 'I handed over less, and here is why' for the everyday reasons that are not old debt — otherwise the first time he is short of cash on a Thursday he is stuck and cannot save the record at all.
>

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

> **STILL NEEDS OLI.** Verdict unchanged; I tried hard to upgrade it and it will not go. The principle does two things here. It kills option (c) SPLIT outright — (c) proposes that the organizer's expected figure and the member's own statement disagree about the same weeks forever, two independent computations of one total, which the principle answers with NEITHER. And it settles that the stopped/started record belongs IN the member's status ('Active or stopped' is named in it), so whatever an away week is, /admin and /me must both read it off the same status and neither may keep its own view. That is real progress and it is airtight. But (a) HOLES and (b) OWED differ precisely in what the per-member status SAYS about an away week, which the principle explicitly leaves as 'the remaining question'. Both are single-source; neither is a second computation of a total; the principle has no purchase between them. R1 does not reach it either: R1 rules on the deferral flag, a per-week decision the organizer takes on a named week, with a decision behind it. A participation break is a different mechanism with different evidence — it records that someone went quiet, which is not the same as the organizer agreeing to let the money go. Nothing lets one be read across to the other. R4's own stated risk is a judgment only Oli can make: a member closed and reopened by mistake silently loses a real debt under (a), and the books under-report by that amount at close. Worth telling Oli: R1 makes option (b) more workable than it was, not less. Under the old rule (D-40) deferral excused nothing, so 'a break never excuses money' left him with no way to excuse an absence at all; now he can defer the away weeks one at a time and they are genuinely gone — that half depends on R1, which reverses D-40. It is an argument, not a ruling.
>
> **The question, plainly:** Someone goes quiet for a month — they stop after week 5, the organizer marks them as stopped, and they start paying again at week 9. Do they owe the three weeks they were away, at $500 a week?
>
> **1. No — the weeks they were away are simply gone, as if they had not been in the group for those weeks.**
> Her own page stops saying '3 weeks behind, $1,500 overdue'. No reminder ever names weeks 6, 7 or 8. The organizer's shortfall never expects that $1,500. When she pays again, the money goes onto week 9 onwards instead of being swallowed by the gap. The cost: if she only went quiet for a fortnight and he marked her stopped out of habit, that $1,500 vanishes and never appears in the end-of-cycle books.
>
> **2. Yes — marking someone away records where they were, but it never cancels money.**
> Her page and the organizer's screens both say $1,500 for weeks 6-8, and the group's shortfall rises to match — so he starts seeing arrears on screen for weeks he had quietly decided not to chase. If he does want to let those weeks go, he excuses them one at a time, and under his new decision that excusing genuinely wipes the money (it did not before).
>
> ## ✅ RULED — THERE IS NO "BREAK". 15 August 2026
>
> **Oli's ruling:** a member who stops and says nothing is **LATE** — the existing late system
> already handles the ordinary four-or-five-week fall-behind-then-recover perfectly well. A
> member who **arranged** a pause is **DEFERRED**. There is no third concept.
>
> **So the away weeks are OWED (late) unless they were deferred.** That is option (b) — *"a
> break records where they were but never excuses money"* — and it matches §2.18 verbatim:
> *"Unpaid means owed. A week stops being owed only when it is marked paid. Nothing else
> clears it."*
>
> **What this ruling actually removes is a concept, not just an option.** The question assumed
> a "break" was a third thing alongside paid and unpaid. It is not. A break is a **record of
> where someone was**, and it never touches the money. The distinction that matters is not
> stopped-versus-active; it is **did the organizer agree to pause this week, or not** — and
> that distinction already has a name: DEFERRED.
>
> **Consequences for the build:**
>
> - **Twenty sites become correct as written.** The break-unaware `inWindow` used at those
>   sites is right; `lib/participation-close.ts:120-124`'s break-aware variant is the outlier.
>   The `inBreak` term comes out of the window test; `effectiveFinishWeek` stays for an OPEN
>   break, which is a genuine window end rather than a gap.
> - **Option (c) SPLIT is dead** — it is §5.10's defect written down as policy: the organizer's
>   shortfall and the member's own statement permanently disagreeing.
> - **The member's page was already right.** `/me` says "3 weeks behind, $1,500 overdue" today;
>   under this ruling the organizer's screens come to agree with it, rather than the member's
>   page being quietened to match theirs.
> - **The organizer keeps the escape hatch**: if a pause was genuinely agreed, he defers those
>   weeks and they leave the chase — by decision, on the record, per week.
>
> **Recorded date:** 15 August 2026 — RULED, option (b).

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

> **ANSWERED BY §3.0 RULE 5 — option (b).** The same rule as R3, on the second control:
> arrears netted off a payout are money received, so a receipt must exist or the member is
> charged twice — which is exactly what option (c) describes on its own terms.
>
> **Recorded date:** 15 August 2026 (by rule, not a separate decision)
> **⤷ SUPERSEDED — kept for the audit trail, not deleted.** This verdict was written
> before §3.0 existed and reasons from *"R1, R2 or the principle"* alone. The §3.0-derived
> answer above supersedes it: the mechanics are law and postdate this block. Its plain-language
> framing of the question is still the best in the document and is why it is kept.
>
> **STILL NEEDS OLI.** Verdict unchanged. Same shape as R3 and it should be ruled in the same sitting. The principle removes option (c), 'keep it as a pure typing convenience and say so on screen': the member hands back $1,500 out of his pot and his weeks go on reading unpaid, so he is charged twice and the status is not the source of what he paid. Money the member has actually parted with must land in his status or every total over it is wrong. So the recording half is settled — if he takes it, it is recorded as that member's payment, clearing those weeks. What survives is a straight policy question the principle cannot reach: whether THIS cycle's missed weeks may be netted off a pot at all. §2.18's offer is written against the carried ledger balance — money owed from before — and nothing in §2 says current-cycle arrears may come out of a pot at the table, nor forbids it. Under (a) he can still take the cash back across the table; he just records it as an ordinary payment and hands over the full pot, so the money outcome is identical and only the record differs (two acts, because two things happened). Under (b) it is one press. That is a judgment about how the organizer should be allowed to work, not about how a total is computed, and both options leave the status correct. R1 and R2 say nothing about payouts. Genuinely Oli's.
>
> **The question, plainly:** Someone wins the pot this week but is three weeks behind on their own payments for this same cycle — the pot is $10,000 and they are $1,500 short. May the organizer take that $1,500 straight out of the pot as he hands it over, in one go?
>
> **1. No. Hand over the whole pot. Missed weeks are collected as ordinary payments, like everyone else's. The only thing that may come off a pot is old debt carried over from before.**
> The one-press deduct button disappears from this cycle's payout row; the one for old debt stays. He can still take the $1,500 back in cash across the table — he just writes it down as a payment, the same way he writes down everyone else's money. Two acts instead of one, and the record shows two acts because two things happened. Nothing about what the member ends up with changes.
>
> **2. Yes — and the amount he takes is written down as that member's payment, clearing those weeks.**
> One press: the three weeks turn paid, the reminders stop, the pot figure on screen and the week grid agree, and it can be reversed if he changes his mind. The system refuses if the arrears are bigger than the pot. The record shows one act, which is what actually happened at the table.
>

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

> **STILL NEEDS OLI.** Verdict unchanged, but the HEADLINE QUESTION IS ANSWERED and the option set hides a different question underneath it — Oli should be told this plainly or he will answer the wrong thing. The headline: no, a drawn member does not owe a skipped week. Option (a) dies twice over. On the principle: what a member owes at the end is a total, and a total is arithmetic on per-week status, not a flat contract figure — verified, lib/final-position.ts:135-137 computes weeklyAmount × weeksCommitted − paidIn and never reads a week row at all. On written law R1 never touched: DOMAIN_RULES §5 says of a skipped week 'Counts toward what they owe? No — Skipped is gone for everyone', so billing for it makes a member's closing sentence disagree with their own week list, which shows that week as SKIPPED and $0. (§2.30 does not save (a): it fixes the FEE to weekly × weeks committed regardless of attendance and says nothing about a drawn member's remaining contributions — I checked the section.) If Oli wants (a) he must reverse §5's skipped row, which is a different ruling from this one and one R1 just leaned away from. What is NOT answered is (b) versus (c), and they are materially different in money: under (b) the group collects one week's payment less from every member than the pots were sized for and the organizer absorbs it; under (c) nothing is forgiven — the cycle runs a week longer and the same number of payments is collected. That is a straight choice between wearing a shortfall and collecting it later, and no ruling so far makes it. NOTE THE COMPANION QUESTION R1 CREATES (depends on R1, which reverses D-40): R1 makes one member's excused week arithmetically identical to a whole-group skipped week. So if a skipped week is replaced by an extra week at the end, does an excused week get replaced by an extra week for that one member? Rule them together or the two will drift apart. There is also a live edge with R4: under (c) a stopped member's added final week only helps if they are expected to pay it.
>
> **The question, plainly:** The group agrees to skip a week — nobody pays anything for week 7, and nobody will ever be billed for it. But the pots people take home were worked out on twenty weekly payments, and now only nineteen get collected from each person. Does the group simply wear that gap, or does everyone pay one extra week at the end to make it up?
>
> **1. Wear it. Twenty weeks on paper, nineteen payments collected, and the organizer covers the difference.**
> Nobody is ever billed for the skipped week, and every member's finish date stays exactly what their signed agreement says. The cost lands in one place: pots go out sized on twenty payments while only nineteen come in from each member, and the organizer makes up that gap himself — as he covers every other gap. With twenty members at $500 that is one week's takings, and it happens again every time a week is skipped.
>
> **2. Make it up. Nobody pays for the skipped week, but a real extra week is added at the end so the same number of payments is collected.**
> Week 7 reads skipped and $0 for everyone, and a genuine extra week appears at the end. Nothing is forgiven and nothing is short — every member still makes twenty payments. The price: every member's finish date moves a week later each time a week is skipped, and finish dates are written into agreements people have already signed, so he has to tell everyone their end date has moved.
>
> ## 🅿 PARKED — not ruled, and deliberately not deleted. 15 August 2026
>
> **Oli's position:** he has no real-world experience of a skipped week and will not design
> one blind. He also does not want the capability removed.
>
> So the skip-week capability **stays in the tree, parked**, with this note attached:
>
> > **`isSkipped` needs a real design before it is used.** The three options above are a
> > genuine fork with money on each branch, and choosing between them from imagination rather
> > than from a week that actually happened is how a wrong answer gets locked into a signed
> > agreement.
>
> **What "parked" obliges the build to do:**
>
> - **Do not delete `isSkipped`.** It is load-bearing in the ladder, in `allocatePayment`, in
>   `amountOutstanding` and in the view. Removing it is a larger change than answering the
>   question, and it would break the one thing everyone agrees on: a skipped week owes $0 today.
> - **Do not silently pick a branch.** The engine keeps today's behaviour — a skipped week owes
>   nothing and the finish week does not move — because that is what the code already does, not
>   because it is ruled.
> - **Warn at the point of use.** If the organizer ever marks a week skipped, the screen should
>   say the consequence for a member who has already been drawn is undesigned, and point here.
> - **Revisit when it happens.** The first real skipped week converts this from a design
>   question into an observation, which is the only way Oli has said he will answer it.
>
> **Recorded date:** 15 August 2026 — PARKED. Not a ruling; not a deletion.

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

> **ANSWERED BY §3.0 RULE 1 — option (a), per-week everywhere.** Rule 1 makes the calendar
> half *"whether **its** window has closed"* — a fact belonging to the week and its own
> stored date, not to a cycle-wide boundary. `memberAttention` must call the per-week test
> and drop `elapsedThroughWeek` as a due-set input.
>
> The per-week *elapsed stamp* used by the cash chart and the shortfall series is a
> different question and keeps its range rule; the two must be documented as different.
>
> **Recorded date:** 15 August 2026 (by rule, not a separate decision)
> **⤷ CONCURRING — independent derivation, same answer.** Written before §3.0, reaching
> option (a) from R0 and the code rather than from rule 1. Kept because two routes to one
> answer is evidence, not duplication.
>
> **RESOLVED — follows from the principle (R0) together with §2.14's per-week LATE definition; R1 changes only which weeks are excused, never how dueness is measured.** Per-week everywhere — option (a). A week counts as due when its own stored date's payment window has closed, or when the organizer marked that week late himself. Nothing else makes it due, and a week's position in the sequence never does. Weeks behind is the count of that member's own due-and-uncovered weeks; the amount owed is arithmetic over the same set. The cycle-wide high-water mark stops being an input to who is behind: memberAttention takes the week rows and asks the same per-row question computeStanding asks, so lib/standing.ts:164 and :192 become canonical and lib/dashboard.ts:561 and :544-550 are retired. /admin's attention line and the person page then print the same '3 behind · $1,500' for Abebe by construction, and correcting one week's date moves only that week. The date-range boundary survives in exactly one place and for a different question — bucketing the cash chart and the shortfall series over time, lib/dashboard.ts:156 and :286 — and must be documented as a different question so it is never mistaken for a second behind-count. CARRIED WITH IT: which weeks are EXCUSED from that due set is R1's question, not this one — under R1 as ruled a deferred week leaves the set; under the written law R1 reverses (D-40, still stated in lib/standing.ts's own comment and in derived.ts's weeksBehind) it stays in. The measuring rule above is identical either way, but the figures it produces are not, so if R1 is revised this answer's due set must be rewritten with it.
>
> *Why it follows:* I challenged this one hardest, because on its face 'which fact makes a week overdue' looks like a 'what does the status MEAN' question, which R0 explicitly does not settle — the same shape as R8, which is rightly open. It survives, on the options as the ruling actually writes them, for two reasons that are not preferences. FIRST, option (c) dies on the principle without argument: one member, one session, '4 behind · $2,000' on the dashboard and '3 behind · $1,500' on his own profile is two computations of one total. SECOND, and this is the load-bearing check I made in the code: option (b) does NOT propose changing what makes a SINGLE WEEK late. Its retire list is lib/standing.ts:164 and :192 only; lib/derived.ts's status ladder is untouched, and that ladder decides LATE from the week's own stored date (derived.ts paymentStatus: windowClosed is computed from that week's date). So under (b) the member's own page would show week 7 as unpaid with its window still open while the same page counted him behind for it — a total that contradicts the per-week statuses it is supposed to be arithmetic over, which is exactly what R0 forbids, and which §2.14's written LATE row ('unpaid AND either the window has closed or the organizer marked it late') already fixes per week. The engineering facts, verified: standing.ts:164 filters the member's own week rows through weekCountsAsDue, asking of each week whether ITS window closed or the organizer marked IT; dashboard.ts:544-550 walks week NUMBERS from startWeek to a cycle-wide elapsedThroughWeek and calls them due because of where they sit in the sequence — which is why a week deliberately dated in the future is counted overdue the moment any later week closes, the exact drift the 20260806020000 migration was written to remove. TWO HONEST CAVEATS, both carried into the answer. (1) dependsOnR1 is now TRUE, and the prior pass had it wrong: the CHOICE of per-week over high-water does not move with R1, but the CONTENTS of the due set do. The stated answer's 'and it is not excused' clause is R1's contribution alone — today's code says the opposite in terms, lib/standing.ts: 'Only SKIPPED weeks are taken off the behind-count. A deferred week the member has not paid makes them behind exactly like any other.' Revise R1 and this answer's due set must be re-edited, so it must be re-read. (2) If Oli means by (b) something the ruling text does not say — that a week becomes late because a LATER week's deadline passed, redefining lateness itself — that is an amendment to §2.14's LATE row and R7 comes back to him. Nothing stops him making it; it is simply not on the table as written.
>
> **Recorded date:** 15 August 2026 (derived, not separately ruled)
>
> ⚠ *Depends on R1, which reverses D-40. Revisit if R1 is revised.*

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

> **STILL NEEDS OLI.** Verdict unchanged. Nothing in R1, R2 or the principle names a clock, and no section of the ground truth does either — §2.14 fixes no boundary. The principle does remove option (c), 'confirm the setting is UTC and leave both alone': that leaves the TypeScript engine and the SQL view each deciding on their own whether a week is late, agreeing only because a database setting happens to be UTC today. That is a second source of the member's status, which is precisely what 'the member's status is the single source' forbids, and the failure it leaves is member-visible — for a window of hours each day a member's own page calls a week late and counts it in their balance while the group page's behind-count does not. But 'when does the deadline day end' is a judgment about the group's real life, not a derivation, and (a) and (b) both survive it intact — both are single-source, so the principle has nothing to choose between them. Note the contrast with R7, which looks similar and is not: there, one option contradicted the per-week statuses printed beside it, and here neither does. Oli should also know this may never have fired: Pass 2 could not query the database and Supabase's default is UTC, so this is a ruling that is needed rather than a proven live defect — but it is one line of SQL away from firing the day the setting moves, with no test that would catch it.
>
> **The question, plainly:** A week's payment counts as late once its deadline day is over. Whose clock decides when that day is over — the clock where the group actually lives, or one single world clock (Greenwich time) that is several hours off from theirs?
>
> **1. The single world clock, used everywhere in the system.**
> For a group on the US east coast the cut-off effectively falls at 8pm, so someone who pays at 9pm on the deadline evening is already marked late on their own page and counted in what they owe — even though where they are, it is still the deadline day. In exchange, the two halves of the system can never disagree by a day, whatever the server is set to, and no date handling has to be rewritten.
>
> **2. The clock where the group lives.**
> Nobody is ever marked late while it is still the deadline day for them — the deadline means what a member thinks it means. The price is that every date calculation has to be told which place the group is in, and the simple rule the system leans on today — that a week is always exactly seven twenty-four-hour days — stops holding twice a year when the clocks change.
>

> ## ✅ DISSOLVED — RESOLVED BY CONFIGURATION (§3.0 rule 7), 15 August 2026
>
> **This is no longer a ruling.** It was only ever a question because the platform had never
> named a clock — and naming one *in code* would have hard-coded a preference. Under rule 7
> it becomes **a setting**:
>
> > **Late is measured against the organizer's configured local day and time.** One timezone
> > setting, chosen once, read everywhere a deadline is computed.
>
> Option (a) hard-codes UTC and option (b) hard-codes a locale — the same mistake in opposite
> directions. Option (c) leaves the answer to whatever the database happens to be set to. The
> setting replaces all three, and the answer becomes whatever Oli says it is, changeable later
> without a migration.
>
> **What still has to be true, and is not a preference:**
>
> - Both engines must read the **same** configured clock. The SQL view's `current_date` follows
>   the Postgres session timezone and cannot see a setting at all, so this rides on §5.5's view
>   decision — retire the view and the divergence goes with it.
> - The default is **UTC**, matching today's behaviour, so nothing moves on deploy.
> - The block above names the real cost honestly: `lib/money.ts`'s "a week is always exactly
>   seven twenty-four-hour days" stops holding twice a year once a real timezone is configured.
>   **That is a build task with a test, not a reason to leave the clock unnamed.**
>
> **Recorded date:** 15 August 2026 — dissolved by rule 7, not separately ruled.

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

> **STILL NEEDS OLI.** VERDICT UPHELD, reasoning corrected with new evidence. Neither R1, R2 nor the principle picks between money and weeks. The principle names what per-member status CONTAINS — 'weeks paid' AND 'current/late/partial per week' — so both candidate fractions are legitimate arithmetic on the one status. The principle removes the framing 'which of these two implementations wins' (lib/contribution.ts:103 computes paidIn/commitmentTotal while components/member/member-personal-summary.tsx:39 independently computes paidCount/totalWeeks), and it kills option (c) in its documented form (two independent implementations kept) while permitting (c) restated as two labels read off one source. But it does not say which fraction a member sees. R2 comes closest and stops: option (b)'s only stated cost was that a half-paid week moves nothing and 'reads as my payment did not register' — R2 kills that objection, since the part-paid week now carries its own visible 'still owed $X' state beside the bar. Defusing an objection makes (b) more viable, not chosen. All three options survive. NEW EVIDENCE Oli should have before answering (this is not an answer, it is a fact that makes the question sharper). The weeks fraction is not currently a count of finished weeks at all. app/me/page.tsx:259 feeds paidCount from weeksCredited, and lib/derived.ts:122 defines weeksCredited as Math.floor(totalPaid / weeklyAmount) — money divided by the weekly rate, rounded down. So today's '19 of 20 weeks' IS the money fraction, coarsened. Under the principle ('weeks paid' is part of status) plus R2 (a part-paid week is not done), 'weeks paid' must become a count of weeks whose own state is paid in full. Concretely: a member who has half-paid two weeks reads '1 of 20' today and would read '0 of 20' as a true count, with both weeks showing 'still owed'. That change lands whichever option Oli picks — unless he rules that 'weeks paid' keeps meaning money divided by the rate, which is itself a thing he may want to say out loud. R1-dependent consequence to carry into whichever answer he gives (does not change this classification): if a week is excused it must leave BOTH sides of the fraction — a member with one deferred week is '19 of 19 weeks' and '$9,500 of $9,500', not 19 of 20. That reverses D-40 and would need revisiting if R1 is revised.
>
> **The question, plainly:** When a member opens her page, should the big number be the money she has saved, or the number of weeks she has finished paying? She has put in $9,750 towards a $10,000 goal and has fully paid 19 of her 20 weeks. Does her page lead with "$9,750 of $10,000 saved" or "19 of 20 weeks"?
>
> **1. Show the money she has saved**
> Her big number and bar are in dollars: "$9,750 of $10,000 saved, $250 still to save." Any part payment moves the bar the moment it is recorded. The weeks sentence becomes a smaller caption or goes away, and the organizer's member list and turn-order list switch to money bars too.
>
> **2. Show the weeks she has finished**
> Her bar counts finished weeks: "19 of 20 weeks." Every screen shows the same number and the caption matches the bar. A half-paid week does not move the bar until it is finished — though that week now sits there saying "still owed $250", so the money is not invisible. Worth knowing: this number is today worked out as her money divided by the weekly amount and rounded down, so a member who has half-paid two weeks currently reads "1 of 20" and would read "0 of 20" as a true count of finished weeks.
>
> **3. Show both, each clearly named**
> Her page says "$9,750 of $10,000 saved" and "19 of 20 weeks complete" side by side. Nothing on screen is wrong, but she is given two numbers where she probably wants one — and both must be counted off the same record rather than worked out twice.
>
> ## RESOLVED — SETTING, default WEEKS (§3.0 rule 7). 15 August 2026
>
> **Default: WEEKS.** It matches the language the platform already speaks to members — "13 of
> 20 weeks", "you have paid 6 of your 20 weeks" — so the caption matches the bar instead of
> contradicting it. **Settable to MONEY** whenever Oli prefers, per rule 7.
>
> **The known cost of this default, stated plainly:** a member who part-pays sees the bar not
> move until the week completes, which can read as *"my payment did not register"* — the exact
> alarm `member-personal-summary.tsx:30-35` was written about. **§3.0 rule 1 answers it:** the
> week list beside the ring states "$200 of $2,000 · Partial" with the remainder, so the money
> is visibly recorded even while the ring holds. The ring is the coarse story; the week list is
> the precise one.
>
> **Correctness half, not optional:** all four surfaces — the portal ring, /admin/people,
> /admin/waiting, and the caption — read the ONE setting. Two use weeks and two use money
> today, which is the §5.10 defect whichever way it is set.
>
> **Recorded date:** 15 August 2026 — setting, default WEEKS.

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

> **ANSWERED BY §3.0 RULE 3 — option (a).** Rule 3 states where money goes: the oldest
> owed or deferred week first, never the current one. Under rule 5 a screen names what the
> engine will actually do, so "Next due" must name the oldest uncovered week. A member three
> weeks behind is shown week 10, which is where his next dollar lands.
>
> **Recorded date:** 15 August 2026 (by rule, not a separate decision)
> **⤷ SUPERSEDED — kept for the audit trail, not deleted.** This verdict was written
> before §3.0 existed and reasons from *"R1, R2 or the principle"* alone. The §3.0-derived
> answer above supersedes it: the mechanics are law and postdate this block. Its plain-language
> framing of the question is still the best in the document and is why it is kept.
>
> **STILL NEEDS OLI.** VERDICT UPHELD; code claims re-verified. The options differ on WORDING and WHICH DATE IS SHOWN — precisely the axis none of the three rulings touches. The principle is about TOTALS being arithmetic on per-member status; 'next due' is not a total, it is a label pointing at a week, and all three options can be driven from the one status. R2 changes which weeks qualify as still-owed (a part-paid week stays uncovered and therefore stays a candidate for 'oldest uncovered') but says nothing about which week a label should name. R1 likewise only filters the candidate list. I re-read both implementations and confirm they ALREADY exclude deferred weeks — app/actions/member.ts:292-293 filters on `!w.isDeferred && w.coveredAtCurrentRate < w.amountDue`, and app/actions/messages.ts:277-278 uses the identical predicate. So R1 changes no behaviour here; it only ratifies what the code does. One fact worth putting in front of Oli: the portal is not cleanly option (b) today. app/actions/member.ts:294-297 takes the first uncovered week at or after the current week, and FALLS BACK to the oldest uncovered week when the member's window has fully passed. So one field named 'Next due' already answers two different questions depending on how far behind the member is. Whichever way Oli rules, that ambiguity has to go — but which way it goes is his call, not a consequence of R1, R2 or the principle.
>
> **The question, plainly:** A member is three weeks behind. His page shows one date labelled "Next due". Should that date be the oldest week he still owes — three weeks ago, the week his next payment will actually clear — or this Thursday, the week everyone is being asked to pay right now?
>
> **1. Name the oldest week he still owes**
> A member three weeks behind opens his page and sees a date from three weeks ago as what is due — which is honest, because his next payment really does clear that week first. It reads as further behind than the alternative, and it is the same week the reminder messages already name.
>
> **2. Name this week, and change the wording so it stops promising where the money goes**
> He sees this Thursday's date under words like "This week" or "Pay by". Nothing about where his money lands is implied, and no figure anywhere changes — but his page and his reminder message will be pointing at two different weeks, deliberately.
>
> **3. Keep both answers, each with its own name, from one source**
> The system holds two named facts — "the week you are being asked to pay" and "the week your money will land on" — so the page and the reminder can never drift apart. Oli still has to say which one is the big date on the member's page.
>

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

> **ANSWERED BY §3.0 RULES 3, 4 AND 5 — option (a).** A stopped member's weeks are **deferred**
> (rule 3), so they leave `amountOutstanding` and therefore leave "cash expected" (rule 5) —
> the headline stops naming money nobody will send. The money is **not** lost from the
> record: rule 4 settles it into the carried balance at close, and the position screen's
> stopped list carries it until then.
>
> This is the one place the ruling improves on the option as written: (a) was described as
> *"honest about what he is chasing, silent about what he lost."* Under rule 4 it is not
> silent — the loss has a named home with a date.
>
> **Recorded date:** 15 August 2026 (by rule, not a separate decision)
> **⤷ SUPERSEDED — kept for the audit trail, not deleted.** This verdict was written
> before §3.0 existed and reasons from *"R1, R2 or the principle"* alone. The §3.0-derived
> answer above supersedes it: the mechanics are law and postdate this block. Its plain-language
> framing of the question is still the best in the document and is why it is kept.
>
> **STILL NEEDS OLI.** VERDICT UPHELD, but the earlier reasoning was WRONG on a load-bearing point and is corrected here. It claimed the status question is unruled. It is not. EQUB_GROUND_TRUTH.md §2.18 says verbatim: 'Unpaid means owed. A week stops being owed only when it is marked paid. Nothing else clears it.' A stopped member's unpaid week is therefore still owed on his own record, and R1 does not reach it — R1 excuses weeks the organizer deferred by agreement, and a member walking away is not that. So the question the principle hands back ('what does the per-member status say?') is already answered by written law: it says owed. What that leaves open is not the status but WHICH TOTAL the headline names. The principle explicitly lists 'active or stopped' as part of the status every total is arithmetic on — so a total restricted to members who have not stopped ('what am I still waiting for') is exactly as much arithmetic on status as a total across everyone ('what never arrived'). Both are legitimate; the principle does not say which one a red headline should carry. That is a naming and scope judgment, which is the axis none of the three rulings touches. The principle DOES kill the current mechanism outright, in both places, and this is binding whichever way Oli rules. lib/cycle-position.ts:208-217 computes a group gap and then subtracts a group aggregate of stopped members' stored balances, capped by Math.min(willNotArrive, gap) so that any balance larger than the measured gap silently disappears — the exact group-subtraction shape the principle was written to make unrepresentable. components/charts/collected-vs-expected-chart.tsx:71-74 independently recomputes closedExpected − closedReceived. So: both figures must become one sum over members' own weeks, with active/stopped as a filter on that sum, never a subtraction of one group aggregate from another. Net effect: the question is narrower than it was, and still Oli's.
>
> **The question, plainly:** One member stopped paying and left $2,000 unpaid on weeks whose payment deadline has already passed. He still owes it on his own record, but nobody expects to see that money. The dashboard's red headline says how much is overdue. Should that headline include his $2,000?
>
> **1. No — the headline means "what I am still waiting for"**
> The dashboard flips from "$2,000.00 overdue" in red to "All in — every week past its deadline is fully collected." Honest about what he is still chasing, silent about what he lost; the $2,000 stays on that member's own record and on the list of people who stopped. Counted as the total owed by members who have not stopped — one addition over people, not a group figure with a deduction taken off it.
>
> **2. Yes — the headline means "money that never arrived"**
> Both screens show $2,000 outstanding, including money nobody will ever send. The loss can never quietly disappear, but the line underneath saying how many members owe it currently names a group that leaves out the very person the money is missing from, so that line has to be reworded to match.
>
> **3. Two numbers, each named for the question it answers**
> The screens read "Still to collect: $0" and "Never arrived: $2,000". The same two figures stay on screen, but as two labelled facts instead of a contradiction — and both are added up from members' own weeks, so they can never be worked out two different ways again.
>

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

> **STILL NEEDS OLI.** VERDICT UPHELD; the earlier reasoning overstated what is at stake and is corrected. I traced every clock source. The draw screen (app/actions/wheel.ts:110), the turn-order/waiting screen (app/actions/waiting.ts:75) and the money position screen (app/actions/cycle-position.ts:103) ALL already use currentWeekFromRows — the stored week rows — and lib/week-date-authority.test.ts:194-201 asserts the money paths never mention the projected helper at all. The projection survives in exactly ONE place: app/actions/dashboard.ts:88. So it is not true that draw eligibility and the paid-ahead boundary currently ask the projection; they do not. The principle settles one third of this and no more. It names paid-ahead as a total that is arithmetic on status, and per-week status is stamped off each week's OWN stored date plus a five-day window (lib/derived.ts:70-79, PAYMENT_WINDOW_DAYS = 5). So paid-ahead falls out of the stored rows without consulting any cycle-level clock — that sub-question is closed by the principle, and option (b) would have to break both that and an existing guard test to win it back. What survives untouched by R1, R2 and the principle: the week number the dashboard prints, and whether one clock or two is the honest thing to show. A displayed week number is not a total, so the principle does not fire; R1 and R2 change what individual weeks MEAN, not which week is now. Options (a), (c) and (d) all remain live on that narrower question, so by the strict test this is STILL-NEEDS-OLI.
>
> **The question, plainly:** A week gets postponed, so only 12 weeks have actually happened even though 13 weeks have passed on the calendar. The main dashboard prints a week number at the top. Should it say week 13 (counting weeks off the calendar from the start date) or week 12 (counting the weeks that actually happened)? Every other screen — draws, turn order, the money position — already counts the weeks that actually happened.
>
> **1. Count the weeks that actually happened, everywhere**
> After a week is postponed, every screen says "week 12 of 20" and stays there until the next week's date arrives. Correcting the start date can never move anyone's week number. The cost: the payments screen also stops advancing, so it can offer to record a week that has already been paid.
>
> **2. Count off the start date on the calendar, everywhere**
> The week number always moves forward with time, so the day after a postponement it still says week 13. But this would move the draw and turn-order screens off what they use today, so if the start date is ever corrected, who is eligible for the pot and what counts as paying ahead would both shift with it — the one thing the system was deliberately built to prevent, and a test currently exists to stop it.
>
> **3. Keep both and say which is which on screen**
> The organizer reads "week 13 by the calendar, week 12 by the record" and stops having to reconcile two labels himself. No number changes anywhere; it just writes down plainly what the software already does.
>
> **4. Leave it alone**
> After any date correction the dashboard and the other screens can be a week apart — one saying week 13, the other only letting week 12 people be drawn — with nothing on either screen saying so.
>
> ## RESOLVED — SUPERSEDED BY §3.8 (the draw is chosen, not gated). 15 August 2026
>
> **The question dissolves rather than being answered.** It mattered only because
> `lib/wheel.ts:49` used "the current week" to decide **who may be drawn**. §3.8 rules that
> **eligibility is shown, never enforced** — the organizer picks the week and the winner
> regardless. A number that gates nothing cannot produce a wrong award, so the correctness
> question is gone.
>
> **What is left is a label**, settled the member-friendly way:
>
> > **Screens name the week by the STORED WEEK ROWS** — the weeks that actually happened —
> > because that is what a member counts. The projection survives only as the no-rows
> > fallback (`lib/commitment.ts:191`).
>
> This keeps §2.14 intact (the current week is derived, never stored) while respecting that
> stored rows became the authority for a week's date. A screen needing both may say so in
> words — *"week 13 by the calendar, week 12 by the record"* — but no money and no
> eligibility reads the projection.
>
> **Recorded date:** 15 August 2026 — resolved into §3.8.

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

> **STILL NEEDS OLI.** VERDICT UPHELD; values re-verified. Nothing in R1, R2 or the principle speaks to how much notice a warning gives. This is not a total and not a per-week payment state; it is a threshold constant plus a clock choice — bullet-1 territory. Confirmed: AT_RISK_WEEKS = 4 at lib/waiting.ts:67, while both call sites pass 3 (app/actions/dashboard.ts:387 literal 3, app/actions/wheel.ts:36 WARNING_WEEKS_AHEAD = 3). The two screens differ on BOTH axes at once, which strengthens the case for a ruling: the waiting screen uses the stored week rows (app/actions/waiting.ts:75) while the dashboard is the single surface still on the calendar projection (app/actions/dashboard.ts:88). So they can name different people for two independent reasons on the same afternoon. The clock half is downstream of what survives in R12 and cannot be closed before it. One gap R1 OPENS rather than settles, which Oli should be told about: a member's last possible week is pure arithmetic today — start week + weeks committed − 1 (lib/money.ts:113-117) — with no allowance for excused weeks. R1 says an excused week 'counts toward nothing', which leaves undecided whether the member simply pays one week less and finishes on the same date, or whether their window pushes out by a week. That changes who is at risk and when they are flagged. No ruling covers it. Worth saying plainly: §2.27 calls this warning mandatory — 'silent automatic removal without the warning would let a real person be quietly missed' — and both halves of it are currently unruled.
>
> **The question, plainly:** A member's last possible chance to be given the pot is week 17. How early should the system start warning you about her — from week 13 (four weeks' notice) or from week 14 (three weeks' notice)? Right now the main dashboard and the turn-order list use different amounts of notice, and count weeks differently too, so on the same day they can flag different people.
>
> **1. Four weeks' notice on every screen**
> Someone whose last possible turn is week 17 gets flagged from week 13, on the dashboard and the turn-order list alike, and both screens name the same people. Slightly more warnings, and it keeps the extra week of planning room the organizer wrote down for himself.
>
> **2. Three weeks' notice on every screen**
> The same person is flagged from week 14 instead — fewer flags on screen, one week less to arrange her turn. Both screens still agree, but the margin before someone could be quietly missed is shorter.
>
> **3. Deliberately different notice on the two screens, clearly labelled**
> The dashboard is a nudge and the turn-order list is a standing state, each with its own timing and each saying so on screen. No code changes, but the two screens go on naming different sets of people, now on purpose.
>
> **4. Leave it alone**
> The two screens keep naming different people with nothing explaining why, and after any date correction the warning that must never be missed can name someone on one screen and leave her off the other.
>
> ## ✅ DISSOLVED — RESOLVED BY CONFIGURATION (§3.0 rule 7), 15 August 2026
>
> **This is no longer a ruling.** §2.27 makes the warning mandatory — *"the system must WARN
> the organizer in advance, clearly and on the dashboard"* — and fixes no threshold. The
> number is therefore preference, and under rule 7 preference is a setting:
>
> > **How many weeks of notice before a member's window closes undrawn** — one configurable
> > value, read by every surface that warns.
>
> **Default 4**, which is today's `AT_RISK_WEEKS` and the wider of the two, so nobody loses
> notice on deploy. Oli can narrow it to 3 whenever he likes.
>
> **The correctness half is NOT dissolved and is not optional.** Today the dashboard uses 3 at
> both `undrawnWindowWarnings` call sites while the Waiting screen uses 4 — one threshold,
> two values, so a member finishing at week 17 can be AT RISK on one screen and absent from
> the other. **One constant, read by all three call sites.** The setting decides what that
> shared value is; it does not excuse there being two.
>
> **The clock half is settled by R12**, resolved into §3.8: screens name the week by the
> **stored week rows**, so all three surfaces read one clock as well as one threshold. Today
> the dashboard feeds the projected current week where Waiting and the wheel feed the
> stored-row week — same threshold, two clocks, different people named. Both halves are fixed
> together, or the warning still disagrees with itself.
>
> **Recorded date:** 15 August 2026 — dissolved by rule 7, not separately ruled.

---

### R14. Where does a payout with no draw belong in a per-week record?

*visible* · Pass 2 ruling 13

**Why it is open.** §2.9 requires the archive to be "a readable record: who paid what, who was paid out, how much, when", but no rendered total is wrong today — the archive page renders received, paidOutNet, stillHeld and outstanding, never pendingNet — so the document never settles whether the archive must NAME money that was awarded and then lost its draw.

**a) The archive folds it into the first week, matching cashSeries** — The closed-cycle archive files the draw-less payout under week 1, the same week the live cash chart already shows it as pendingOut, so the archive's week list reconciles with its totals under one rule for both surfaces. It also attributes that payout to a week it has nothing to do with, permanently, in a document §2.9 says is not re-derivable afterwards.
  - *Makes canonical:* `lib/dashboard.ts:138`
  - *Retires:* `app/actions/cycle-close.ts:156`

**b) The archive gains an "unattributed payouts" block** — The archive page and the frozen JSON gain one new section listing each draw-less payout by number, member, net and status. Every payout is named honestly and none is invented onto a week. Costs one section in the frozen JSON and on the page.

**c) Leave it and say so on the page** — Cheapest, and no total is wrong today. It means a payout that was awarded, never collected, and whose draw was later undone appears in no week of the permanent record and nothing on the page names it — exactly the row a member might ask about two years later.

> **STILL NEEDS OLI.** VERDICT UPHELD; code re-verified. None of the three rulings reaches this. R1 and R2 are about what a member's week owes and whether it is chased; this is about a payout — money going OUT to a member — and where it is filed in the permanent frozen record. The principle does not fire: it settles how a total is assembled from per-member status, and a payout amount is a recorded fact about a payout, not anything derivable from a member's payment status; folding it into week 1 hides nobody's debt, which is the defect the principle exists to make unrepresentable. And by the document's own account no rendered total is wrong today — the archive renders received, paid out, still held and outstanding, never the pending figure. Confirmed on disk: lib/dashboard.ts:134-137 deliberately folds a draw-less payout into the first week ('folded into the first week so the two never disagree on a total'), while app/actions/cycle-close.ts:156-157 stamps it week 0, where nothing renders it. So the question is what a permanent, non-re-derivable record must NAME — a judgment about honesty in the archive, not arithmetic over member status. All three options survive untouched.
>
> **The question, plainly:** A member was awarded the pot and the payment was recorded, but the turn it was tied to was later undone — so that payment now belongs to no week at all. When the cycle is closed and its book is frozen for good, where should that payment appear in the week-by-week list?
>
> **1. File it under the first week**
> The frozen book's week-by-week list adds up to its own totals with no extra section, matching how the live cash chart already shows it. The cost is that the permanent record says money moved in a week it had nothing to do with — and that book can never be re-worked-out afterwards to correct it.
>
> **2. Give it its own short section**
> The frozen book gains a small block at the end: "paid out, not tied to a week" — who, how much, and whether they actually collected it. Every payment is named truthfully and none is invented onto a week. Costs one extra section on the page and in the saved record.
>
> **3. Leave it out of the weeks and put a note on the page**
> Cheapest, and nothing on screen adds up wrong today. But a payment that was awarded, never collected, and whose turn was later undone appears in no week of the permanent record and is named nowhere — exactly the row a member might come back and ask about two years later.
>
> ## ⏸ DEFERRED — NOT IMPORTANT ENOUGH TO RULE. 15 August 2026
>
> **Oli's position:** not important, and he does not understand the need for it. No ruling is
> forced.
>
> This is recorded as a decision, not an oversight. The reason it is safe to leave:
> **no rendered total is wrong today.** Pass 2 established that the archive page renders
> received, paidOutNet, stillHeld and outstanding, and never renders `pendingNet` — so an
> awarded-then-undrawn payout does not make any figure on any screen disagree with another.
> The cost of leaving it is narrow and nameable: such a payout appears in **no week** of the
> permanent record, and nothing on the page names it.
>
> **What the build does:** nothing. It keeps today's behaviour (option 3 by default, without
> the page note), and this entry is the record of why. If a member ever asks about a payout
> that appears nowhere, this becomes a real question and comes back.
>
> **Recorded date:** 15 August 2026 — DEFERRED, not important. Revisit only on a real case.

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

> **STILL NEEDS OLI.** Held at STILL-NEEDS-OLI, with one correction to the prior reasoning and one rejected upgrade argument. SETTLED by the principle (confirmed in source): the obligation side. "Money I am holding that belongs to somebody else" is a total, and it is arithmetic over per-member status — paid early for weeks not yet run, payouts drawn but not handed over, and money owed back to a stopped member who never drew. It is already computed once and completely at lib/cycle-position.ts:388-389. The dot at app/admin/(protected)/cycle/position/page.tsx:78 recomputes that same total as paidEarly + drawnNotHandedOut, dropping the third term — a separate, partial second computation of one quantity, which the principle forbids. owedToStopped is therefore IN under every surviving option. CORRECTION to the prior classification: option (c) does not merely close — it collapses. (c) is "leave the arithmetic and reword the section". But the reword does not remove the incomplete obligation figure from the comparison; the dot still computes one, minus a term. Add the term and (c) becomes (b) with a wording rider. So the live choice is strictly (a) vs (b), and the section's wording is a free rider on either. NOT SETTLED: which figure that obligation total is compared against — the cash the organizer counted and entered (a), or the books figure collected − handedOut (b, confirmed at lib/cycle-position.ts:323). The principle's "NEITHER" rule cannot reach this, because a counted reading is not a computation of a total at all; it is an observation, recorded precisely so it can disagree with the books, which the document calls "the whole reason the reading is recorded". UPGRADE ARGUMENT CONSIDERED AND REJECTED: the principle names "cash on hand" among the totals that must be status arithmetic, which could be read as forcing the books side (b). It does not. The principle governs how derived totals are computed; it does not abolish a physical count, and abolishing it would destroy the difference check (actual − shouldBeHolding) that the same module exists to run. Both (a) and (b) survive with real, opposite costs: (a) duplicates the neighbouring "What you hold" dot, which already fires on the identical condition (sections.ts:96) and is dark before the first count of a cycle; (b) works from day one but stays dark when cash has genuinely gone missing. R1 and R2 are irrelevant here: both sides of this comparison are actual money movements (counted, collected, handed out), and deferral changes what is EXPECTED, not what was received or paid out.
>
> **The question, plainly:** You hold the group's cash, and some of it is not yours to spend: one member paid three weeks in advance, another member's turn came up and you have not handed his money over yet, and someone who quit is still owed his savings back. There is a warning light meant to tell you "you are now dipping into other people's money." Should it come on based on the cash you actually counted and wrote down, or based on what your own records say you should be holding — before you have counted anything? (One part is already decided and is not a choice: the money owed back to the member who quit is other people's money either way, so the warning has to count it. Leaving that out is off the table.)
>
> **1. Go by the cash you actually counted.**
> The warning only works once you have counted the box and typed the figure in, so at the start of a cycle, before any count, it stays off. When it does come on, it is saying the same thing as the warning already lit on the next tab along — you get told twice.
>
> **2. Go by what your records say you should be holding.**
> The warning works from day one without you counting anything, and a rushed count cannot throw it off. But if $500 has genuinely walked out of the box, this warning stays off — only the counted-cash warning on the next tab catches that.
>
> ## RESOLVED — FIXED to option (b): books-based, with the missing term. 15 August 2026
>
> **Correctness, not preference**, so it is fixed rather than made a setting:
>
> > The dot fires on `shouldBeHolding < paidEarly + drawnNotHandedOut + owedToStopped`.
>
> **Why the term must be there:** §3.0 rules 3 and 4 say a stopped member's money is not
> forgiven — it is owed and resolves at close. So $1,500 of theirs sitting in the organizer's
> hands is exactly the "using someone else's money" signal this dot exists to raise. Omitting
> it is the dot failing at the one case it was built for.
>
> **Why books-based, not counted-cash:** the signal must work **before the first cash reading
> of a cycle exists**. Option (a) goes dark until a reading is recorded, and duplicates the
> neighbouring "What you hold" dot, which already fires on that test.
>
> **Recorded date:** 15 August 2026 — fixed to (b).

---

### R16. Does "N weeks remaining" include the week currently in progress?

*visible* · Pass 2 ruling 15

**Why it is open.** §2.22 fixes the answer for the commitment cap — "Join at week 15 of a 20-week cycle → the maximum offered is 6 weeks. The system does not allow more by accident." — and says nothing about the dashboard header.

**a) Make the header inclusive (remainingWeeksInCycle(cycle.plannedWeeks, currentWeek))** — At week 15 of a 20-week cycle the dashboard header changes from "5 weeks remaining" to "6", agreeing with the add-member wizard's pre-fill and cap. On the final week the header reads "1 week remaining" rather than "0", which is arguably more honest since that week's money is not collected yet. Both figures then come from one function.
  - *Makes canonical:* `lib/money.ts:129`
  - *Retires:* `app/actions/dashboard.ts:253`

**b) Keep the exclusive form and re-label it ("N weeks after this one", "N weeks to go")** — The header keeps printing 5 at week 15 while the wizard caps at 6, but the words stop implying they are the same figure. No arithmetic changes. Two functions still answer one question (§5.10), so the next screen that needs the figure has to pick.

**c) Leave both** — The dashboard header and the join screen disagree by one every week of every cycle — "5 weeks remaining" beside a commitment capped at 6. No money moves: weeksRemaining is display-only and never feeds a cap. But it is the figure the organizer plans the draw schedule against.

> **STILL NEEDS OLI.** Held at STILL-NEEDS-OLI. Nothing in R1, R2 or the principle reaches it. UPGRADE ARGUMENT CONSIDERED AND REJECTED: the two implementations really are two independent computations of one figure (lib/money.ts:129 computes plannedWeeks − startWeek + 1; app/actions/dashboard.ts:253 computes plannedWeeks − currentWeek — verified in source), which looks like the shape the principle answers with "NEITHER". But the principle's "NEITHER" only bites when the disputed figure is a TOTAL over per-member status — cash on hand, cash expected, paid-ahead, N-of-M-paid. "How many weeks of the cycle are left" is a calendar fact about the group, identical for every member, derived from a start date and a planned length. No per-member status produces a third answer, so there is nothing for the principle to substitute. It stays a judgment about what the words mean. The judgment is genuine: does the week you are standing in, whose money has not come in yet, count as a week still to come? (a) says yes and makes the dashboard read 6 at week 15 of 20, agreeing with the 6 weeks a joiner is capped at under the existing fixed law about late joiners (not in question here). (b) says no, keeps 5, and relabels it so it stops looking like the same figure. Both are defensible and they put different numbers on the organizer's screen. Option (c) — leave both — is separately condemned by the document's own rule against two functions answering one question, but that rule does not choose between (a) and (b). R1 is irrelevant: deferral is per-member, this is a group-level count of calendar weeks. R2 is irrelevant: a part-paid week changes what is owed, not how many weeks the cycle has left.
>
> **The question, plainly:** It is week 15 of a 20-week savings group, and this week's money has not come in yet. Does the group have 5 weeks left, or 6? Put another way: does the week you are standing in the middle of count as one of the weeks still to come?
>
> **1. Yes — the week you are in counts. Call it 6.**
> Your main screen says "6 weeks remaining" at week 15, the same 6 weeks a person joining today would be signed up for, so the two screens stop disagreeing. On the very last week it reads "1 week remaining" instead of "0" — arguably the honest reading, since that week's money is not in yet.
>
> **2. No — only the weeks after this one. Keep 5, but change the words.**
> Your main screen says "5 weeks after this one" at week 15. No number changes; the wording just stops implying it is the same figure as the 6 weeks offered to a new joiner. On the last week it reads "0 weeks after this one."
>
> **3. Leave both as they are.**
> Every week of every cycle, your main screen says one number and the join screen says one more — "5 weeks remaining" sitting beside a new member being signed up for 6. No money moves either way, but this is the number you plan the payout order against.
>
> ## RESOLVED — FIXED to INCLUSIVE, one function. 15 August 2026
>
> **Correctness:** two functions answer one question and disagree by one, every week of every
> cycle. Fixed to the **inclusive** form (`lib/money.ts:129`), read by both the dashboard
> header and the add-member cap.
>
> **The member-friendly reading wins:** at week 15 of 20 the header says **6 weeks remaining**,
> agreeing with the cap the wizard offers. On the final week it reads "1 week remaining" rather
> than "0", which is honest while that week's money is still uncollected.
>
> **Retires** `app/actions/dashboard.ts:253`.
>
> **Recorded date:** 15 August 2026 — fixed to inclusive.

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

> **STILL NEEDS OLI.** Held at STILL-NEEDS-OLI. Untouched by all three rulings. "How long has this person been waiting" is a counting convention for time, not a total over per-member status, so the principle's "NEITHER" rule has nothing to substitute — there is no status arithmetic that yields a third answer. R1 and R2 govern what is owed and by whom, not how a day is counted. UPGRADE ARGUMENT CONSIDERED AND REJECTED: the day count feeds the "waiting longest" ordering and the 14-day stale flag, which might look like status-derived outputs. They are not totals over member status; they are orderings and a threshold laid on top of a clock reading. The principle does not choose a clock. Both options survive and genuinely disagree in the field — verified in source: lib/waiting.ts:70-73 floors the millisecond gap into 24-hour periods, while lib/dashboard.ts:467-468 truncates both instants to UTC midnight first and so counts dates crossed. An event stamped at 11pm reads 1 day old at 1am under one and 0 days old under the other. Each has a real cost: calendar days can call something "1 day waiting" two hours after it happened; 24-hour periods can leave a member welcomed yesterday morning reading "0 days waiting", which reads as nothing having happened. That is a judgment about what the organizer wants the number to mean. Option (c) is already condemned by the one-question-one-function rule, but that does not choose between (a) and (b). Whichever is chosen must be used everywhere, because the ordering and the two-week stale flag both ride on it.
>
> **The question, plainly:** A member's turn came up at 11 o'clock last night and you have not handed his money over yet. At 9 o'clock this morning, how long has he been waiting — one day, because it is now the next day, or zero days, because a full 24 hours has not gone by?
>
> **1. Count the dates: it is 1 day.**
> The number ticks over at midnight, the way you would count looking at two dates written on a page. Someone whose turn came at 11pm shows as "1 day" by 1am. The "waiting longest" ordering and the "this has been sitting two weeks" flag all move onto this way of counting.
>
> **2. Count full days gone by: it is 0 days.**
> A member you welcomed yesterday morning still reads "0 days waiting" until the same hour today, which can read as "nothing has happened yet." The number only moves once a whole day has genuinely passed. The little "1d" stamps on your main screen move onto this way of counting.
>
> **3. Leave both ways in place.**
> Two things that both happened at 11pm last night: on the same morning, one screen says they have been waiting 0 days and another says 1 day. "Waiting longest" is ordered by one rule while the day stamps beside it use the other, and the "gone stale after two weeks" flag fires a day later than the other screen would say.
>
> ## RESOLVED — FIXED to CALENDAR DAYS. 15 August 2026
>
> **Correctness:** two definitions of "a day" produce different numbers on the same morning.
> Fixed to **calendar days crossed** (`lib/dashboard.ts:467-468`); `lib/waiting.ts` calls it.
>
> **The member-friendly reading:** "waiting 1 day" means the date changed once, which is how a
> person reading a list of dates counts, and it matches `formatDateUTC`, which is calendar-day
> throughout. A payout drawn at 11pm reads as 1 day old the next morning — which is what the
> organizer looking at it would say.
>
> **Carried with it:** the waiting list's counts, its "Waiting longest" sort and its 14-day
> stale threshold all move onto this clock, so the sort and the threshold stop disagreeing with
> the stamps beside them.
>
> **Recorded date:** 15 August 2026 — fixed to calendar days.

---

### R18. Should ?week be parsed by one rule, and should a week with no row render empty or fall back?

*visible* · Pass 2 ruling 17

**Why it is open.** The documented rules cover neither the parse nor the fallback.

**a) One parser — move /admin/this-week onto focusedWeek** — ?week=7abc stops rendering WEEK 7's money on /admin/this-week and is ignored on both screens, so a malformed or stale link no longer silently lands the organizer on a different week's money. Two lines change.
  - *Makes canonical:* `lib/week-focus.ts:36-40`
  - *Retires:* `app/admin/(protected)/this-week/page.tsx:50-53`

**b) Also change the fallback — resolve a non-existent week to the last real one rather than rendering it empty** — An empty week-24 page stops reading as "nobody owes anything" once the cycle overruns its generated rows, which §2.7 says to expect ("Track the truth: if it is actually running longer, show the real week"). Costs a visible behaviour change: "This Week" would sometimes show a week other than the calendar's current one. Note this can no longer be done by adopting resolveTargetWeek — that function is dead (no production caller).

**c) Leave as is** — Two parsers stay and an empty breakdown keeps rendering for a week with no row. §2.10's "Never leave doubt" is carried by a page that shows a week's worth of zeros with nothing saying the week does not exist, and ?week=7abc keeps rendering WEEK 7's money under a URL nobody meant.

> **STILL NEEDS OLI.** Held at STILL-NEEDS-OLI. Nothing in R1, R2 or the principle reaches it. How a link is read, and what a screen shows when it points at a week that does not exist, are neither of them totals over per-member status. The parse divergence is real and verified: /admin/this-week reads the week with Number.parseInt (app/admin/(protected)/this-week/page.tsx:50), which accepts "7abc" as 7, while lib/week-focus.ts:36 requires a pure digit string and then range-checks it. Two screens read the same link differently today. UPGRADE ARGUMENT CONSIDERED AND REJECTED: an empty week page renders zeros for what is owed and expected, and "cash expected" IS one of the totals the principle governs — so one could argue the principle forbids showing zeros. It does not. If the week does not exist, no member's status carries an obligation for it, so the zeros are truthful arithmetic over status; the complaint is that nothing on the page says the week is not a real week. That is presentation, and whether to substitute the last real week instead is a display decision with an argument on each side — the existing law says to show the real week when a cycle overruns, against which a screen labelled "This Week" showing a different week is its own confusion. That the two parsers disagree is a defect the document already condemns; which of the two live fixes to take, and what an out-of-range week should render, is Oli's call. R1 and R2 are irrelevant — they change what a member owes, not which week a link resolves to.
>
> **The question, plainly:** Someone opens a link to a week of the group that is not a real week — a typo in the link, an old bookmark, or week 24 in a group that was planned for 20. What should they see?
>
> **1. Ignore the bad link and show the current week — the same rule on every screen.**
> Right now a link with a typo in the week number quietly shows you week 7's money on one screen and is ignored on another. After this, anything that is not a plain week number is ignored everywhere, so a mistyped or stale link can never land you on a different week's money without you noticing.
>
> **2. That, plus: when the group has run past its planned weeks, show the last real week instead of an empty page.**
> When your 20-week group is still going in week 22, the page for a week with no record stops showing a screen full of zeros that reads as "nobody owes anything", and shows the last week you actually have instead. The cost is that the screen called "This Week" will sometimes be showing a week other than the one the calendar says you are in.
>
> **3. Leave it as it is.**
> A mistyped link keeps showing a real week's money under an address nobody meant, and a week with no record keeps drawing a full page of zeros with nothing on it saying that week does not exist.
>
> ## RESOLVED — FIXED: one parser, and a real week rather than an empty one. 15 August 2026
>
> Both halves are correctness.
>
> **One parser.** /admin/this-week moves onto `focusedWeek` (`lib/week-focus.ts:36-40`), so
> `?week=7abc` is ignored on both screens instead of silently rendering **week 7's money**
> under a URL nobody meant. Two lines.
>
> **A non-existent week resolves to the last real week** rather than rendering a page of zeros.
> An empty week-24 page reads as *"nobody owes anything"* — the one thing §2.10 forbids
> (*never leave doubt*) — and §2.7 already says to expect a cycle running past its generated
> rows. Where the resolved week is not the calendar's current one, **the screen says so**.
>
> **Recorded date:** 15 August 2026 — fixed, both halves.

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

> **STILL NEEDS OLI.** Held at STILL-NEEDS-OLI — this is a wording judgment and none of the three rulings picks a wording. The principle governs how the numbers inside a sentence are derived: "you paid 19 of 20" must be arithmetic over per-member status, which it already is under all three options (verified: lib/cycle-close.ts:175-179 branches on weeksPaid vs weeksCommitted and outstanding; lib/member-history.ts:96-102 branches on outstanding and pendingNet only). It does not say which sentence the member reads. R2 changes what the numbers SAY — a part-paid closed week still owes its remainder, so such a member reads an outstanding figure rather than "complete" — without choosing among (a), (b) and (c). CORRECTION to the prior classification: it claimed that under R1 option (a)'s main objection "largely dissolves". That is an over-read and I am withdrawing it. The objection recorded in the document is about a WHOLE-GROUP SKIPPED week leaving a member one week short of the committed count. R1 rules on DEFERRED weeks and describes them by analogy to skipped weeks as skipped weeks already behave; it does not re-rule how a skipped week is counted. So the objection to (a) stands at full strength on its own terms. WHAT R1 DOES RAISE, worth putting to Oli separately rather than folding into this ruling: R1 says an excused week "counts toward nothing" and is removed "from every count". Read strictly, that means a deferred week should leave BOTH sides of "X of Y" — the member reads "19 of 19 — complete". Read as the analogy it is worded as, deferred inherits skipped's current behaviour, which leaves the member at 19 of 20. Those two readings put different words on a member's closing card, and R1 as worded does not settle which. This does not change the verdict here (all three options survive either way), but it should be flagged: it depends on R1, which reverses D-40. Note also there is a third wording in play — the pre-approved WhatsApp closing template — which cannot simply be edited, and which option (c) forces a decision about.
>
> **The question, plainly:** When a cycle ends, every member sees one closing line about their year. Someone paid everything they owed but came out one week short of the full count — say, the week the whole group skipped. Should their line say "nothing owed — complete", or "you paid 19 of 20, balance zero"? And should that line be the same sentence you see in your own records, or is the member's line answering a narrower question — just "do you still owe money?"
>
> **1. One wording everywhere, with the week count, and save the word "complete" for people who paid every single week.**
> A member's own end-of-cycle card reads "You paid 19 of 20. Balance $0." instead of "$0 outstanding — complete." The same vocabulary then runs across your records and their screen. Cost: their card either loses the extra line it carries today — "part of your payout was never handed over, speak to the organizer" — or has to find room for it.
>
> **2. Leave the two wordings as they are, and say on the screen that the member's line is about money owed, not weeks attended.**
> Nothing in the numbers changes. The member keeps the "your payout was never handed over" warning, and "19 of 20 weeks" is already printed directly above the sentence, so the count is right in front of them. The risk is the word "complete" being quoted back at you on its own, without the count beside it.
>
> **3. One sentence serving both you and the member, including the unhanded-payout warning.**
> Wherever a cycle closes, the same sentence appears, and "part of your payout was never handed over" stops being something only the member's own screen ever mentions — you would see it in your records too. Cost: you would also have to settle what the WhatsApp closing message says, since that is a third wording, and it is a pre-approved template rather than free text.
>
> ## RESOLVED — FIXED to ONE SENTENCE, option (c). 15 August 2026
>
> **One closing sentence serves the organizer's archive and the member's card**, so §2.18's
> exemplars become the single source for every closing wording, and `pendingNet` stops being
> portal-only — a member whose payout was never handed over sees that fact wherever the cycle
> closes.
>
> **Why not (b), the cheap option:** it keeps two wordings for one moment — §5.10, in the one
> place a member is most likely to quote the platform back at the organizer years later.
>
> **The third wording is in scope.** `lib/whatsapp-templates.ts` carries the SENT closing
> statement, and under §2's trust law it may not say a third thing. It is Meta-frozen, so it
> joins the partial-confirmation and late-notice submissions rather than blocking this.
>
> **The "complete" trap, handled:** reserve that word for `weeksPaid >= weeksCommitted` and
> give the line the week counts, so a member left one week short by a SKIPPED week is never
> told they are incomplete when they owe nothing. (R6 is PARKED so this cannot arise today;
> written down now so it is not rediscovered later.)
>
> **Recorded date:** 15 August 2026 — fixed to (c).

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

> ## ✅ STEP 0 IS COMPLETE — 15 August 2026. THE GATE IS OPEN.
>
> **§4.4 holds 19 rulings and every one is closed:** 5 answered by rules 1–5, 3 ruled directly
> by Oli, 1 superseded by §3.8, 5 fixed to one value, 3 dissolved into settings, 1 parked (R6),
> 1 deferred as unimportant (R14). **Zero open.**
>
> The two that gated the engine are both resolved: **R1** (deferred in the headcount) is ruled
> and refined by §3.0 rule 4 — deferred always resolves, never vanishes; **R2** (part-paid and
> window closed) is ruled as a sixth state, which is what §3.0 rule 1 now builds.
>
> **Obligations out of step 0.** The first is **CLEARED**; two carry forward, and neither
> blocks starting:
>
> 1. ~~**The ground truth must be amended before the build reads R1.**~~ — **CLEARED,
>    15 August 2026** (commit `3999eae`). The amendment landed as **D-42**: `EQUB_GROUND_TRUTH.md`
>    §2.29a now states that a deferred week leaves the CURRENT expectation, is never forgiven,
>    and always resolves — filled oldest-first, or carried into the person's balance at close.
>    §2.14's derived table and §2.29 effect 2 moved with it, and the superseded sentence is kept
>    there as dated history. **The deferral slice has no remaining ground-truth blocker**; what
>    is left is the three code sites recorded as the D-42 gap in §6.4, which §3.0 rule 4 and
>    §3.4 close.
> 2. **Two Meta submissions** — the partial-aware confirmation (§3.7) and a replacement
>    LATE_NOTICE whose frozen body currently says *"we did not receive your payment"* to
>    members who paid. Off the critical path, but the trust law is not satisfied until they land.
> 3. **R6 stays parked.** `isSkipped` is not deleted and no branch is silently picked; today's
>    behaviour stands until a real skipped week gives Oli something to rule on.
>
> The historical framing below is kept for the record.

§4.4 held **19 rulings**. Two gated the engine itself:

- **§4.4 #1 (deferred in the headcount) — TIME-CRITICAL.** The money half is already
  RESOLVED (deferred weeks are owed, so they belong in `expected` — canonical
  `lib/payments-view.ts:225`). But the money and the headcount sit behind the **same
  `continue`** at [lib/dashboard.ts:253](../lib/dashboard.ts#L253), so shipping the money
  fix moves the headcount whether or not anyone decided it should.
- **§4.4 #2 (part-paid and window closed) — BLOCKING.** §3.3 already establishes this
  blocks step 1: the engine ships the status ladder it is given and cannot invent one.

The other 17 gated individual migrations, not the engine, and were expected to be answered in
the order their screens came up. **They were all answered first instead** — which is why step
1 now begins against a settled specification rather than a moving one.

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
