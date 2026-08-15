# Financial Audit — Pass 2: Integrity and Correctness

**Date:** 15 August 2026 · **Scope:** every quantity Pass 1 flagged as having more than one
implementation, plus the label-versus-math sweep, plus the deferral/window/late agreement check.

## What Pass 2 is

Pass 1 mapped the ground and deliberately judged nothing. **Pass 2 judges.** Every divergence
here carries one of three verdicts:

- **EQUIVALENT** — the implementations provably cannot produce different numbers. The row says
  why, in arithmetic, not in assurance.
- **RESOLVED** — they can differ, and the documented rules settle which is right. Every RESOLVED
  row quotes the governing rule **verbatim** from `EQUB_GROUND_TRUTH.md` with its section number.
- **OPEN** — they can differ and the documented rules do **not** settle it. That is a ruling only
  the organizer can make. The row states the options and the consequence of each. No rule was
  invented to close one; an honest OPEN is worth more than a confident guess.

## What Pass 2 read, and what it refused to read

- **USED:** Pass 1's `# Flagged for Pass 2` section — 107 quantities, rebuilt under a strict
  definition of "implementation" (independent arithmetic or decision; not reads, pass-throughs,
  calls to the canonical function, type declarations, assertions, formatting, or tests), with every
  location opened and quoted before retention. That list is trusted.
- **NOT USED:** Part B's "Other implementations" lines, marked SUPERSEDED in Pass 1 and known to
  contain false positives.
- **NOT USED:** every "Surfaces:" list anywhere in Pass 1. None was ever re-verified. **Wherever
  this document says where a number is displayed, that surface was re-derived by searching the tree
  and opening each file in this pass.** Rows say so explicitly. Part B's set of label findings was
  likewise derived independently and is not Pass 1's.

## The evidence rule

Every claim that two implementations differ carries the **verbatim source lines of both**, quoted
from the files, with path and line. An unquoted claim is inadmissible — that is the lesson Pass 1
learned when a sweep counted assertions and pass-through reads as implementations.

Every divergence carries a **concrete input** — named member, week, amounts, flags — under which
the two produce different numbers. Where no such input could be constructed, the row says
EQUIVALENT or says plainly that it could not be constructed. Several of Pass 1's and of this
audit's own earlier drafts' proofs were **refuted** during verification; those refutations are
recorded in the rows rather than quietly dropped.

## Money-visibility ranking, applied to everything

| Rank | Meaning |
|---|---|
| **headline** | changes what a member or the organizer sees as owed, paid, or their standing |
| **visible** | changes an organizer-only figure (cash position, projections, planning) |
| **internal** | changes an intermediate value that is corrected before display |
| **footnote** | cannot reach any screen |

The rank describes **the divergence**, not the quantity. An EQUIVALENT row has no divergence, so
nothing can reach a screen differently — several such rows were downgraded to footnote on that
ground even though the underlying quantity moves real money.

---

# THE OPEN RULINGS — decisions only Oli can make

**21 OPEN rows collapse to 18 distinct rulings**, because three questions appear twice in Pass 1's
list (the break hole, the current-week clock, the at-risk window). They are merged here and both
row numbers are cited. Most money-visible first. This list is the deliverable: it is a worklist.

---

## 1. May the organizer type a payout's net figure freely — and what records the money he keeps back?

**headline** · Part A row A10 (`Payout net, live — Payout.netAmount`)

**The question.** `Payout.netAmount` is born as `gross − fee` (`app/actions/wheel.ts:697`
`              netAmount: payout.net,`). Two paths reduce it and leave a row behind: the winner's
own-week settlement (`lib/draw-settlement.ts:156-158`, paired with a `PaymentEvent`) and the carry
deduction (`app/actions/carry-deduction.ts:204-207`, paired with a `LedgerEntry` PAYMENT). A third
path reduces it and leaves **nothing**: Collections' "Offer: deduct" button edits the Net field and
saves through `updatePayout`.

```
app/admin/(protected)/collections/collections-view.tsx:917-918
                  const current = parseDollarsToCents(net) ?? p.netAmount;
                  setNet(String(Math.max(0, current - Math.min(p.outstanding, current)) / 100));
```

`saveEdit` (`:595-639`) calls `updatePayout` with the typed net and writes no Payment, no
PaymentEvent and no LedgerEntry. The server's only relevant refusal fires when a settlement exists
(`app/actions/edits.ts:1959` `      if (settled > 0 && moneyChanged) {`); with no settlement, gross,
fee and net are three independent fields.

**Why the rules do not settle it.** §2.18 sanctions the *offer* and nothing more — "**Winning while
owing NEVER auto-deducts.** If someone wins $20,000 while owing $5,000, the organizer may still
hand over the full $20,000. The system shows the balance and *offers* to deduct. The decision is
human, always." — and says nothing about what the acceptance writes. §2.15 and §2.19 would govern
completely **if** keeping money out of a payout counts as money RECEIVED from the member ("Money
can be recorded from the week view (during the cycle) or from the member profile (any time). Both
run the identical oldest-first allocation (2.15)") — but Collections is neither of those two entry
points, and whether this is a receipt at all is exactly the classification nobody has ruled on.
**That classification is the ruling.**

**Options.**

- **(a) Leave net free-typed; the button stays a display convenience.** He keeps the fastest path he
  has. The deducted money is recorded nowhere: the member's weeks still read unpaid so he is chased
  for money already taken out of his payout, the cash position counts cash the books say is owed,
  and `movePayoutToWeek` silently restores the full net (`app/actions/week-winners.ts:511`
  `        data: { drawId: targetDraw!.id, netAmount: payout.grossAmount - payout.feeAmount },`)
  because `reverseCarryDeduction` finds no ledger row to reverse. §2.18's "Unpaid means owed…
  Nothing else clears it" is satisfied to the letter and violated in substance.
- **(b) Keep the button, make it write the money half.** A receipt for the deducted amount,
  allocated oldest-week-first through the one engine (§2.15/§2.19), with the payout net following
  from it. The weeks clear, the member stops being chased, the deduction becomes reversible because
  it has a row, and the move-to-another-week reset stops destroying it. Costs one more write inside
  the same transaction and answers the classification question in the affirmative.
- **(c) Constrain `updatePayout`.** Refuse any save where
  `netAmount ≠ grossAmount − feeAmount − (recorded settlements + recorded deductions)`, and route
  deductions through the paths that record them. The stored triple can never again be a number no
  derivation could produce. Costs the ability to record an odd hand-over amount directly, which
  §2.30 explicitly permits ("It can be corrected by hand, and the correction is audited"), so this
  needs a sanctioned way to record "I handed over less, and here is why".

**On screen either way.** Today: a member is handed less than his payout and is still chased for the
same money, and the difference appears in no record; a payout later moved to another week quietly
gives the deduction back, with an audit line that states the change
(`app/actions/week-winners.ts:548-549`) and cannot state the cause.

---

## 2. When a member stops and later comes back, are the weeks they were away still owed?

**headline** · Part A rows A11 (`the break hole`) and A18 (`2. Is a given week inside a member's window`)
— Pass 1 listed this quantity twice; it is one ruling.

**The question.** Exactly two production sites are break-aware. Twenty are not.

```
lib/participation-close.ts:120-124   (canonical, BREAK-AWARE)
export function inWindow(p: ClosableWindow, weekNumber: number): boolean {
  if (weekNumber < p.startWeek) return false;
  if (weekNumber > calculateFinishWeek(p.startWeek, p.weeksCommitted)) return false;
  return !inBreak(p.breaks, weekNumber);
}
```

```
app/actions/member.ts:241            (break-unaware — the member's own portal)
        .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
```

The same flat range is written again at `app/actions/payments.ts:53`,
`app/actions/payments-view.ts:63` and `:255`, `app/actions/waiting.ts:169`,
`app/actions/cycle-close.ts:70`, `app/actions/cycle-position.ts:178`,
`lib/messaging-engine.ts:121`, `app/admin/(protected)/collections/page.tsx:112`,
`lib/rebuild.ts:39`, `lib/wheel.ts:49`, `lib/week-winners.ts:162-163` and `:209`,
`lib/draw-settlement.ts:104`, `lib/participation-window.ts:47` and `:123`,
`lib/messages.ts:281`, `lib/payments-view.ts:217-218`, `lib/dashboard.ts:556`, and
`app/admin/(protected)/cycle/page.tsx:43-44`.

**Why the rules do not settle it.** §4.1 records the hole rule — "| Mid-cycle participation close |
Done — `ParticipationBreak`, gaps are holes not cutoffs (rule 17) |" — but §4.1 is the CURRENT STATE
build-status table, a report of what was built, not §2 law, and it describes rather than rules.
§2.18 pulls the other way *inside §2 itself*: "**Unpaid means owed.** A week stops being owed only
when it is marked paid. Nothing else clears it."

**Options.**

- **(a) HOLES — the away weeks are never owed.** Adopt `inWindow` at the break-unaware sites (they
  already load `breaks`, or their callers do). A returned member's portal, her statements and her
  closing balance drop the away weeks. Matches §4.1 and the reactivation code's own stated reason
  (`app/actions/participation-close.ts:473-474`: "giving them back would invent arrears for weeks
  nobody ever asked / them about."). Risk: a member who simply went quiet and was closed/reopened by
  mistake silently loses a real debt, and the ledger at close under-reports by that amount. Cost:
  ten `computeStanding` call sites need `breaks` loaded, `lib/rebuild.ts:39` must decide whether
  money may land in a hole, and the `member_progress` view needs a `participation_breaks` join it
  does not have.
- **(b) OWED — a break records where they were but never excuses money.** Strip the `inBreak` term
  from `lib/participation-close.ts:120` (keeping `effectiveFinishWeek` for an OPEN break) and let
  the dashboard expect those weeks again. Matches §2.18 verbatim. Twenty sites become correct as
  written and only two change. Risk: `/admin/this-week` starts showing arrears for weeks the
  organizer deliberately never chased, and the cycle-wide shortfall rises by every away-week of
  every reopened member.
- **(c) SPLIT — holes for the group's EXPECTATION, owed for the MEMBER's balance.** Keeps both
  screens as they are and formalises today's accident as a rule. It means the organizer's shortfall
  figure and the member's own statement are permanently allowed to disagree — the state §5.10 names:
  "TWO FUNCTIONS ANSWERING ONE QUESTION IS THE SAME DEFECT AS NONE". Whoever reconciles the books
  later has to know which figure is which.

**On screen either way.** Today, with a CLOSED break over weeks 6–8: `/me` tells the member "3 weeks
behind, $1,500 overdue", a BEHIND_NOTICE says the same, `app/actions/cycle-close.ts:70` feeds that
$1,500 into `lib/cycle-close.ts:155` `.filter((m) => m.outstanding > 0)` which writes it as a
**permanent ledger DEBT**, and `lib/rebuild.ts:39` will allocate her next payment into weeks 6–8 —
while `/admin/this-week` expects nothing from her for those weeks and the cycle-position shortfall
excludes the same $1,500.

---

## 3. Does a DEFERRED member belong in a week's "N of M paid" headcount?

**headline** · Part C row C12 · **Decide this before the deferral money fix ships — one `continue`
controls both.**

**The question.** The money half is settled (Part C row C1: a deferred member's weekly belongs in
`expected`, by §2.18 and §2.29 effect 2). The headcount half is not. Both sit behind one line:

```
lib/dashboard.ts:253
    if (payment?.isDeferred) continue;
lib/dashboard.ts:255-257
    expected += participation.weeklyAmount;
    membersExpected++;
    if ((payment?.amountPaid ?? 0) >= participation.weeklyAmount) membersPaid++;
```

**Why the rules do not settle it.** §2.29's five effects name status, arithmetic, messages, the
control and clearing — **no headcount**. `docs/DOMAIN_RULES.md` §5's table answers exactly two
columns, "Chased? No" and "Counts toward what they owe? Yes". A count of *people* is neither. A
deferred member is neither someone who has paid nor someone the organizer will chase.

**Options.**

- **(a) Count them in both.** Remove the `continue` entirely: `membersExpected` includes the deferred
  member, `membersPaid` does not. "5 of 7 paid" where it now reads "5 of 6"; the denominator finally
  matches the money on the same tile and the grid column beside it. Cost: the deferred member is
  filed under "have not paid" on `/admin` (`page.tsx:213-214`) and `/admin/this-week`
  (`page.tsx:115`) and inside the members-short count on the week-dates panel
  (`week-dates-data.ts:151-153`) — factually true, but it is the chase-shaped reading deferral exists
  to soften, and it puts the person he decided not to pursue back at the top of the screen he opens
  to decide whom to pursue.
- **(b) Count them in the denominator and report them separately.** Add `membersDeferred` to
  `WeekReceipts` so the row reads "5 of 7 paid · 1 deferred". Nobody is mis-counted and nobody is
  filed as chased; the only option that lets the money fix land without dragging the headcount with
  it. Cost: one field on `lib/dashboard.ts:200-218` and three renderers, after which the week-date
  panel's apologetic footnote (`week-date-panel.tsx:186-192`, already rewritten three times by its
  own account) can be deleted rather than rewritten a fourth time.
- **(c) Fix only the money.** Split the `continue` so it guards the two counters but not `expected`.
  Money figures become correct and self-consistent; the headcount stays deliberately chase-shaped.
  Cost: the tile permanently says "$3,500 expected · 5 of 6 paid" where $3,500 is seven members'
  money and 6 is six members, and the footnote has to stay forever explaining it.

**On screen either way.** Today, week 12 with seven in-window members at $500 and one deferred and
unpaid: `/admin/this-week` reads "Expected $3,000 · 6 of 6 members paid · short $0" while the
payments grid renders "$3,000 / $3,500" for the same week and `computeStanding` puts the deferred
member's $500 in their outstanding.

---

## 4. May a payout be reduced by the member's CURRENT-cycle week arrears — and what records it?

**headline** · Part A row A44 (`#78 Carry-deduction offer`)

**The question.** Two offers render on the **same payout row**, computed from different debts.

```
lib/carry-balance.ts:104        (carryOffer — the LEDGER balance)
  const maxDeductible = Math.min(balance, payoutNet);
```
```
app/admin/(protected)/collections/collections-view.tsx:922   (the amber box — WEEK arrears)
                Offer: deduct {formatMoney(Math.min(p.outstanding, parseDollarsToCents(net) ?? p.netAmount))} from the net
```

`p.outstanding` is `standing.amountOutstanding` for the running cycle
(`app/admin/(protected)/collections/page.tsx:128`), not the ledger balance. `carryOffer` returns
`{ kind: "none", reason: "They carry no balance." }` when the ledger balance is 0
(`lib/carry-balance.ts:92-94`) and the panel renders nothing, while the amber box offers $1,500.

**Why the rules do not settle it.** §2.18's offer is defined against the *carried* balance. Nothing
says whether current-cycle week arrears may be netted off a payout at all, and nothing says what the
acceptance must write. This is the same classification question as ruling 1, on a second control.

**Options.**

- **(a) Delete the amber offer.** One offer, one debt, one audited write. He loses the one-press way
  to net a winner's arrears off the cash he hands over at the table.
- **(b) Route it through the settlement engine the draw already uses** — a pinned `PaymentEvent` for
  the deducted cents plus a payout decrement, as `lib/draw-settlement.ts:124-159` does for the
  winner's own week. The weeks actually clear, the receipt is auditable and reversible, and the
  payout figure and the week grid agree. Costs a new action and a refusal for arrears exceeding the
  net.
- **(c) Keep it as a pure convenience for typing into the Net field, and say so on screen.** §2.18's
  "Unpaid means owed… Nothing else clears it" then holds: the member hands back $1,500 of his payout
  and his weeks keep reading unpaid and his standing keeps saying $1,500 outstanding. He is charged
  twice and nothing on any screen says why.

**On screen either way.** Today, for one member in one minute: one panel offers $0 and the other
offers $1,500, and only one of them writes anything to the record.

---

## 5. When a cycle-wide week is SKIPPED, does a drawn member who stopped early still owe it?

**headline** · Part A row A34 (`#61 Final position of a stopped member`)

**The question.** Two derivations of the same member's final position disagree by one weekly amount
per skipped week.

```
lib/final-position.ts:135-137
  const committed = input.weeklyAmount * input.weeksCommitted;
  const unpaid = committed - input.paidIn;
  if (unpaid <= 0) {
```
```
lib/derived.ts:299          (the basis the position page's balanceRecorded rides on)
    if (!week.isSkipped) due += week.amountDue;
```

`weeklyAmount × weeksCommitted` counts every week of the commitment. `amountOutstanding` never
charges a week nobody owed.

**Why the rules do not settle it.** §2.30 fixes the FEE to weekly × weeks committed regardless of
attendance and says nothing about what a *drawn* member owes back. §2.18's "Unpaid means owed"
presumes a week that was owed in the first place. Every other derivation in the platform drops
skipped weeks. Nothing decides between them.

**Options.**

- **(a) A skipped week is still owed by a drawn member** — `final-position.ts:135` is right.
  Consistent with §2.30's reasoning that the place was held either way, and with the fact that the
  member took a full pot funded on the assumption of 20 weekly contributions. It means a member is
  billed for a week the platform told everyone was skipped, and the sentence on their portal will not
  reconcile with their own week list, which shows that week as SKIPPED and $0.
- **(b) A skipped week is owed by nobody, drawn or not** — the position page's arithmetic is right.
  Consistent with `amountOutstanding`, `weekReceipts` and `allocatePayment`, all of which pass over
  skipped weeks, and with what the member sees. It means the pot a drawn member received was larger
  than the contributions the group ends up collecting, by one skipped week per member, and the
  organizer absorbs that under §2.18.
- **(c) Skipped weeks push the finish week out instead of being forgiven.** Nobody loses a
  contribution and nobody is billed for a week that did not happen; the cycle runs longer, which §2.7
  already contemplates. It changes every member's finish date whenever a week is skipped, and finish
  dates are in signed agreements (§2.30).

**On screen either way.** A member who stopped after taking the pot reads one outstanding figure on
their portal (`app/actions/member.ts:220`) and the organizer sees a different one on the position
page. Both are presented as the final word on what they owe.

---

## 6. Is "weeks elapsed" measured per week row, or as a cycle-wide high-water mark?

**headline** · Part A row A15 (`Weeks elapsed in a member's own window`)

**The question.**

```
lib/standing.ts:164 + :192      (per-week-row, each row against its OWN stored date)
    weeksElapsedInWindow: elapsed.length,
```
```
lib/dashboard.ts:561            (a count of week NUMBERS in a range)
    const elapsedCount = dueWeeks.size;
```
where the range is built at `lib/dashboard.ts:544-550` from `elapsedThroughWeek` —
`lib/commitment.ts:159-165`, a single cycle-wide MAXIMUM week number whose date has passed. A week
whose own date has **not** passed is counted if a LATER week's date has.

**Why the rules do not settle it.** §2.14 says only "| Weeks behind | weeks elapsed in their
window − weeks credited |" and never defines how elapsed is measured. `lib/commitment.ts:146-153`
and the `20260806020000` migration header both argue per-week; `lib/dashboard.ts:536-542`'s own
comment claims `memberAttention` "cannot disagree with computeStanding" while its calendar half is
the range.

**Options.**

- **(a) Per-week everywhere.** `memberAttention` takes the week rows and calls `weekCountsAsDue` per
  row, dropping `elapsedThroughWeek` as a due-set input. The attention list and the person page agree
  by construction, and a corrected week date moves only that week. The per-week `elapsed` **stamp**
  used by the cash chart and the shortfall series (`lib/dashboard.ts:156`, `:286`) still needs a
  boundary, so the range rule survives there and the two must be documented as different questions.
- **(b) High-water mark everywhere.** `computeStanding` takes `elapsedThroughWeek` and counts week
  numbers at or below it. One boundary decided once, shared by the charts and the behind-count. But a
  week deliberately dated far in the future is then counted as overdue the moment any later week
  closes — the drift the `20260806020000` migration was written to remove.
- **(c) Leave as is.** The dashboard and the person page keep printing different behind-counts and
  different amounts owed for the same member whenever a week's stored date runs out of sequence with
  its number.

**On screen either way.** With week 10 re-dated to October while weeks 11–13 keep their July/August
dates: `/admin` prints "Abebe · 4 behind · $2,000.00 owed" and his own profile prints "Weeks behind:
3" with $1,500 beside it, in the same session.

---

## 7. Which day boundary closes a payment window — UTC midnight, or midnight in the group's own timezone?

**headline (contingent)** · Part A row A13 (`Has this week's payment window closed`)

**The question.** The four TypeScript copies are provably identical (Part C row C11). The SQL is
not necessarily:

```
lib/derived.ts:77-78
  const daysSinceWeekOpened = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
  return daysSinceWeekOpened >= windowDays;
```
```
prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:62
    AND current_date >= (w.date::date + 5)
```

`weeks.date` is `TIMESTAMP(3)` without time zone, so `w.date::date` equals the UTC day — but
`current_date` is the date in the Postgres session's `TimeZone`.

**Why the rules do not settle it.** §2.14 fixes no boundary and no section names a timezone.
`lib/money.ts:5-7` states the UTC convention for the TypeScript, and nothing states one for the
database.

**Options.**

- **(a) Pin the view to UTC** — `(now() AT TIME ZONE 'UTC')::date >= (w.date::date + 5)`. The two
  engines agree by construction whatever the deployment's TimeZone. The late boundary lands at 8pm
  local for an Eastern group, so a member paying at 9pm Thursday is already late.
- **(b) Move both to the group's local day.** The boundary matches how members experience Thursday,
  but every date function (`lib/money.ts`, `lib/derived.ts`, `lib/dashboard.ts`, `lib/commitment.ts`)
  has to take a timezone and `lib/money.ts:5-7`'s "UTC has no DST, so 7 days apart is always exactly
  7 × 24 hours" stops holding.
- **(c) Confirm the deployment's TimeZone is UTC and leave both alone.** Costs one `SHOW TimeZone;`,
  but leaves a silent one-day divergence that returns the moment the database moves or the setting
  changes, with no test that would catch it.

**On screen either way.** If the deployed TimeZone is not UTC, then for a window of hours each day
`/me` shows a week as LATE and counts it in the outstanding balance while `/me/group`'s behind-count
does not. **This audit queries no database and could not verify the deployed TimeZone**; Supabase's
default is UTC, so this may never fire. It is recorded as a ruling that is needed, not as a proven
live defect.

---

## 8. Is a member's savings progress the money fraction or the weeks fraction?

**headline** · Part A row A21 (`5. Paid in / commitment total / still to save / surplus / progress`)

**The question.** Two completion figures on one portal screen.

```
lib/contribution.ts:103           (MONEY)
    progress: commitmentTotal > 0 ? Math.min(1, paidIn / commitmentTotal) : 0,
```
```
components/member/member-personal-summary.tsx:39-40    (WEEKS)
  const pct = totalWeeks > 0 ? Math.min(Math.round((paidCount / totalWeeks) * 100), 100) : 0;
  const remainingWeeks = Math.max(0, totalWeeks - paidCount);
```

**Why the rules do not settle it.** §2.14 defines *weeks credited*; the documented rules never define
"progress".

**Options.**

- **(a) MONEY.** Drive the ring from `lib/contribution.ts`'s `progress` and state the remainder in
  cents. A part-paid week moves the bar, which is what a savings member expects. The "N of M weeks"
  caption then has to be read as a separate, coarser fact or dropped, and every weeks-based bar
  (`people-directory.tsx:259`, `waiting-view.tsx:471`) moves with it.
- **(b) WEEKS.** Drive everything from `weeksCredited` and stop rendering the cents fraction as a bar.
  All four surfaces agree instantly and the caption matches the bar. But a member who has paid half
  of this week sees no movement at all until the week completes, which reads as "my payment did not
  register" — the alarm `member-personal-summary.tsx:30-35` was written about.
- **(c) BOTH, LABELLED.** "$9,750 of $10,000 saved" and "19 of 20 weeks complete". Nothing is wrong on
  screen any more, at the cost of two numbers where a member wants one. Cheapest; does not remove the
  second implementation, so §5.10's defect stands.

**On screen either way.** A member who has paid $9,750 of $10,000 sees 97.5% of the money and 95% of
the weeks on one page, with "$250 still to save" beside "1 week remaining" — and "1 week remaining"
is $500 of weeks, not $250.

---

## 9. What should "Next due" on a member's portal name — the oldest uncovered week, or the current one?

**headline** · Part A row A48 (`#85 Next week due for a member`)

**The question.**

```
app/actions/member.ts:295-298     (current-week-first, then oldest as fallback)
    const nextDue =
      uncovered.find((w) => w.weekNumber >= Math.max(cycleWeek, participation.startWeek)) ??
      uncovered[0] ??
      null;
```
```
app/actions/messages.ts:276-279   (oldest outright)
      const firstUncovered =
        loaded.standing.weeks.find(
          (w) => !w.isDeferred && w.coveredAtCurrentRate < w.amountDue,
        ) ?? null;
```

**Why the rules do not settle it.** `EQUB_GROUND_TRUTH.md` never uses the phrase "next due" and fixes
no label (re-checked by search). §2.15 governs where money LANDS — which is the question
`messages.ts` answers, and answers correctly — and says nothing about what a portal date labelled
"Next due" must name.

**Options.**

- **(a) Portal names the oldest uncovered week.** What the portal says is due is where his money
  actually goes. §2.15: "1. **Oldest unpaid weeks first**, waterfalling forward." A member 3 weeks
  behind then sees week 10, which is honest but reads as further behind than "next due, week 12".
- **(b) Keep the current-week form and rename the label** ("This week", "Pay by"). No arithmetic
  changes and the label stops implying an allocation target. Note the fallback branch already IS the
  oldest-week form and its comment describes that branch accurately — the file is answering two
  questions with one field name.
- **(c) One shared helper with an explicit argument for which question is being asked.** One function,
  two named answers, neither able to drift. Costs a small refactor across two action files.

**On screen either way.** A member 3 weeks behind is told week 12's date on his own portal while the
oldest week his money would actually clear is week 10. No amount changes, and the *real* confirmation
message is built from the actual allocation (`app/actions/payments.ts:332`), so a member's sent
message can never carry the preview's number.

---

## 10. Should the dashboard's "overdue across closed weeks" headline count money nobody will ever send?

**headline** · Part A row A3

**The question.** Two figures over the same elapsed slice of the same series.

```
components/charts/collected-vs-expected-chart.tsx:75
  const behind = Math.max(0, closedExpected - closedReceived);
```
```
lib/cycle-position.ts:217
    shortfall: Math.max(0, gap - Math.min(willNotArrive, gap)),
```
where `willNotArrive` is `lib/cycle-position.ts:208`
`  const willNotArrive = stoppedBy.reduce((s, m) => s + m.balanceRecorded, 0);`

**Why the rules do not settle it.** §2.18 says only "**The organizer absorbs the gap so no other
member is ever short.** That is his responsibility and it is not negotiable. The software's job is to
**remember, never to enforce**." That settles that the money must be remembered somewhere — both
screens do remember it — and says nothing about which figure a headline should carry. That is a
presentation ruling.

**Options.**

- **(a) Chart adopts the sort-out** (both read "still waiting on"). The dashboard headline reads "All
  in — closed weeks are fully collected" on a cycle where $2,000 genuinely never arrived. Honest about
  what he is chasing, silent about what he lost; the loss lives only on the position screen's stopped
  list.
- **(b) Position drops the sort-out** (both read "did not arrive"). "Outstanding" would include money
  nobody will ever send, contradicting `lib/cycle-position.ts:197-201`'s own stated intent and
  re-mixing the two populations §2.18 separates — and the card's sub-text "{n} members owe it" would
  name a count that excludes the person the money is missing from.
- **(c) Keep both, rename both (recommended by the evidence).** `lib/cycle-position.ts:217` becomes
  `stillToCollect`, the chart's becomes `didNotArrive`, and the chart's caption says so. Nothing about
  the arithmetic changes; the gap between two screens stops being a contradiction and becomes two
  labelled facts. Costs a rename across the chart, the position page and their tests.

**On screen either way.** With one member stopped owing $2,000: the `/admin` chart headline reads
"$2,000.00 / overdue across closed weeks" in red and `/admin/cycle/position` reads "Outstanding
$0.00 — nothing is owed for elapsed weeks".

---

## 11. Which clock is THE current week — the projection off the start date, or the stored week rows?

**visible** · Part A rows A57 (`Current week of the cycle`) and A88 (`#107 The current cycle week`)
— one question, listed twice in Pass 1.

**The question.**

```
lib/money.ts:162-168
export function currentWeekNumber(startDate: Date, today: Date): number {
  ...
  const dayDiff = Math.floor((utcDay(today) - utcDay(startDate)) / MS_PER_DAY);
  if (dayDiff < 0) return 0;
  return Math.floor(dayDiff / DAYS_PER_WEEK) + 1;
}
```
```
lib/commitment.ts:194-197
  const weeksSince = Math.floor(
    (input.today.getTime() - lastDate!.getTime()) / (7 * MS_PER_DAY),
  );
  return last + Math.max(0, weeksSince);
```

**Why the rules do not settle it.** §2.14's derived table names the projection literally — "| Current
week | cycle start date + today — never hardcoded, never stored |" — which is `currentWeekNumber` and
not `currentWeekFromRows`. But that line was written before stored week rows became the authority for
a week's date, and §2.23 makes `Cycle.startDate` editable, a case §2.14 never contemplates. So the
ruling is narrower than "which function": **is §2.14's line the law for EVERY use of "the current
week" — including §2.27 draw eligibility and the paid-ahead boundary — or only for the display
figure, with money and eligibility reading the stored rows?** Nothing answers that. §5.10 settles only
that having both unlabelled is itself the defect.

**Options.**

- **(a) Stored rows win everywhere** (`currentWeekNumber` survives only as the no-rows fallback at
  `lib/commitment.ts:191`). Correcting the start date can never move a week number and every screen
  agrees. Reads against §2.14's own wording, and after a postponement the payments header stops
  advancing until the next row's date arrives, so "Record week N" targets a week already paid.
- **(b) The projection wins everywhere.** Matches §2.14 literally and always advances. But §2.27
  eligibility (`lib/wheel.ts:49`) and the paid-ahead boundary would then move whenever the start date
  is edited — the exact thing `app/actions/cycle-position.ts:98-102` and `app/actions/waiting.ts:72-74`
  say must never happen, and which `lib/week-date-authority.test.ts` scans the source to prevent.
- **(c) Keep both, name them apart on screen** ("week 13 by the calendar, week 12 by the record") and
  write the split into the ground truth. No number changes; the organizer stops reconciling two labels
  himself. Ratifies what the code and its guard test already do.
- **(d) Leave as is.** The payments screen and the draw screen go on disagreeing by up to one week
  after any date correction, with nothing on either screen saying so.

**On screen either way.** After a one-week postponement of week 8 onward: `/admin` header prints "Week
13 of 20" and `/admin/cycle/position` prints "week 12 of 20" on the same afternoon; the payments
screen offers "Record week 13 · $X" while `lib/wheel.ts:49` admits only owners with
`startWeek <= 12 <= finishWeek`. **No money figure has two clocks** —
`lib/week-date-authority.test.ts:195-201` asserts that `lib/standing.ts` and `lib/dashboard.ts` never
mention `currentWeekNumber` at all.

---

## 12. "Running out of weeks undrawn" — three weeks or four, and off which clock?

**visible** · Part A rows A58 (`Weeks left in a member's window / at risk`) and A72 (`#51`) — one
question, listed twice.

**The question.** One subtraction, two thresholds and two clocks.

```
lib/wheel.ts:86-87                 (dashboard + wheel setup)
    const weeksLeft = finishWeek - input.currentWeek;
    if (weeksLeft > input.weeksAhead) continue;
```
```
lib/waiting.ts:77                  (the Waiting screen)
  return input.weeksLeft <= AT_RISK_WEEKS;
```
`weeksAhead` is 3 at both `undrawnWindowWarnings` call sites; `AT_RISK_WEEKS` is 4
(`lib/waiting.ts:67`), justified at `:63-66` as "the organizer's own working margin". The dashboard
feeds `currentWeekNumber`; the Waiting screen and the wheel feed `currentWeekFromRows`.

**Why the rules do not settle it.** §2.27 makes the warning mandatory — "the system must WARN the
organizer in advance — clearly and on the dashboard" — and gives an *example* of two weeks. It fixes
no threshold and names no clock.

**Options.**

- **(a) One constant, 4, exported once and used by all three call sites.** The dashboard warns a week
  earlier than today and the two screens name the same people. Slightly more warnings; he keeps the
  planning margin he wrote down as his own.
- **(b) One constant, 3.** The Waiting at-risk pill appears a week later; fewer rows flagged; he loses
  that margin. §2.27's "silent automatic removal without the warning would let a real person be
  quietly missed" argues against shortening the notice.
- **(c) Keep two thresholds deliberately, and label them** (a dashboard nudge vs a Waiting-list
  state). No code change, but the two screens keep naming different sets with nothing on screen
  saying why.
- **(d) Leave as is.** Both divergences persist, and after any date correction the mandatory §2.27
  safeguard can name a member on one screen and omit her on the other.

**On screen either way.** With both clocks agreeing at week 13, a member finishing at week 17 is
flagged AT RISK on `/admin/waiting` and absent from `/admin`'s "Windows ending undrawn (2.27)". With
the clocks one week apart and one identical threshold of 3, a member finishing at week 16 is named on
the dashboard and absent from the wheel-setup warning block.

---

## 13. Where does a payout with no draw belong in a per-week record?

**visible** · Part A row A66 (`#40 Cash position per week`)

**The question.** `Payout.drawId` is nullable with `onDelete: SetNull` (`prisma/schema.prisma:444`,
`:456`), so deleting a draw leaves live payouts with `drawId` null.

```
lib/dashboard.ts:138        (cashSeries — folds it into the FIRST week, deliberately)
    const week = p.weekNumber ?? input.weeks[0]?.weekNumber ?? 1;
```
```
app/actions/cycle-close.ts:156   (archive — files it under week 0, which no row has)
      const weekNumber = po.drawId ? (…) : 0;
```

**Why the rules do not settle it.** §2.9 requires the archive to be "a readable record: who paid what,
who was paid out, how much, when". A PENDING payout has not been paid out, and **no rendered total is
wrong** — the archive page renders received, paidOutNet, stillHeld and outstanding, never
`pendingNet`, so `stillHeld = received − paidOutNet` still carries the cash correctly. The document
does not settle whether the archive must *name* money that was awarded and then lost its draw.

**Options.**

- **(a) The archive folds it into the first week, matching cashSeries.** One rule for both surfaces and
  the week list reconciles with the totals. It also attributes a payout to a week it has nothing to do
  with, permanently, in a document §2.9 says is not re-derivable afterwards.
- **(b) The archive gains an "unattributed payouts" block** listing them by number, member, net and
  status. Every payout is named honestly and none is invented onto a week. Costs one section in the
  frozen JSON and on the page.
- **(c) Leave it and say so on the page.** Cheapest, and no total is wrong today. It means a payout
  that was awarded, never collected, and whose draw was later undone is invisible in the permanent
  record — exactly the row a member might ask about two years later.

**On screen either way.** On the live cash chart such a payout appears as week 1's pendingOut; in a
closed cycle's archive it appears in no week and nothing on the page names it.

---

## 14. Should the "What you should hold" attention dot use the counted cash and include money owed back to stopped members?

**visible** · Part A row A63 (`#76 Difference vs the books, coverage, and the verdict`)

**The question.**

```
lib/cycle-position.ts:388-390       (positionVerdict — COUNTED cash, includes owedToStopped)
  const holdingForOthers =
    input.cash.paidEarly + input.cash.drawnNotHandedOut + input.cash.owedToStopped;
  const coverage = input.actual - holdingForOthers;
```
```
app/admin/(protected)/cycle/position/page.tsx:78     (the nav dot — BOOKS, omits owedToStopped)
    holdingLessThanOwed: h.shouldBeHolding < h.paidEarly + h.drawnNotHandedOut,
```

`sections.ts:87-89` says of that dot that holding less than other people's money "IS the 'using
someone else's money' signal — the question the screen exists to answer". `cashOnHand` does populate
`owedToStopped` (`app/actions/cycle-position.ts:306`).

**Why the rules do not settle it.** Nothing in the ground truth defines which of the two comparisons a
section's attention dot must carry.

**Options.**

- **(a) Make the dot read `positionVerdict`** (`verdictKind === "short"`). One test, one answer — but it
  duplicates the "What you hold" dot, which already fires on the same condition (`sections.ts:96`), and
  it goes dark before the first cash reading of a cycle.
- **(b) Keep it books-based and add the missing term**:
  `h.shouldBeHolding < h.paidEarly + h.drawnNotHandedOut + h.owedToStopped`. Fixes the omission while
  keeping a signal that works before any reading exists. Still disagrees with `positionVerdict`
  whenever counted cash differs from the books — which is the whole reason the reading is recorded.
- **(c) Leave it and reword the section to say it is about the books only.** No arithmetic change. He
  keeps a dot that stays off while $1,500 of a stopped member's money sits in his hands — though the
  "What you hold" dot does fire in that state, so the alarm is raised on the neighbouring tab rather
  than nowhere.

**On screen either way.** Which nav section on `/admin/cycle/position` carries the attention dot. The
platform is **not** silent in the proof: `sections.ts:96` dots "What you hold" and the "short by $500"
sentence renders at `page.tsx:108`. What is wrong is that the section built to answer "am I using
other people's money" answers it with a weaker test than the verdict two tabs along.

---

## 15. Does "N weeks remaining" include the week currently in progress?

**visible** · Part A row A80 (`#92 Weeks remaining in the cycle`)

**The question.**

```
app/actions/dashboard.ts:253        (EXCLUSIVE — the dashboard header)
        weeksRemaining: Math.max(0, cycle.plannedWeeks - currentWeek),
```
```
lib/money.ts:129                    (INCLUSIVE — the commitment cap and default)
  return Math.max(0, plannedWeeks - startWeek + 1);
```

**Why the rules do not settle it.** §2.22 fixes the answer for the commitment cap — "Join at week 15 of
a 20-week cycle → the maximum offered is 6 weeks. The system does not allow more by accident." — and
says nothing about the header.

**Options.**

- **(a) Make the header inclusive** (`remainingWeeksInCycle(cycle.plannedWeeks, currentWeek)`). Both
  figures come from one function and agree at 6. On the final week the header reads "1 week remaining"
  rather than "0", which is arguably more honest since that week's money is not collected yet.
- **(b) Keep the exclusive form and re-label it** ("N weeks after this one", "N weeks to go"). No
  arithmetic changes; the ambiguity is removed in words. Two functions still answer one question
  (§5.10), so the next screen that needs the figure has to pick.
- **(c) Leave both.** The header and the join screen disagree by one every week of every cycle. No
  money moves — `weeksRemaining` is display-only and never feeds a cap — but it is the figure the
  organizer plans the draw schedule against.

**On screen either way.** At week 15 of a 20-week cycle the dashboard header reads "5 weeks remaining"
while the add-member wizard pre-fills and caps the commitment at 6.

---

## 16. Is "days waiting" elapsed 24-hour periods, or calendar days crossed?

**visible** · Part A row A82 (`#100 Days waiting for a pending payout`)

**The question.**

```
lib/waiting.ts:70-73        (raw instants)
export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
```
```
lib/dashboard.ts:467-468    (UTC calendar days)
    const days = (from: Date) =>
      Math.max(0, Math.floor((utcDay(input.today) - utcDay(from)) / MS_PER_DAY));
```

**Why the rules do not settle it.** `EQUB_GROUND_TRUTH.md` says nothing about day counting anywhere
(re-checked by search).

**Options.**

- **(a) Calendar days everywhere** (the dashboard form); `waiting.ts` calls it. "Waiting 1 day" means
  the date changed once, which is how a person reading a list of dates counts, and it matches
  `formatDateUTC`, which is UTC-calendar-day throughout. A payout drawn at 11pm reads as 1 day old at
  1am.
- **(b) Elapsed 24-hour periods everywhere** (the `waiting.ts` form); `dashboard.ts` imports it.
  "Waiting 1 day" means a full day has actually passed. A member welcomed yesterday morning reads as 0
  days waiting until the same hour today, which may read as "nothing has happened yet".
- **(c) Leave both.** Two figures read side by side on the same morning keep differing by one for
  events at the same hour; "Waiting longest" is sorted by one definition while the dashboard's day
  counts use the other, and the waiting view's 14-day `stale` threshold fires a day later than the
  dashboard would.

**On screen either way.** Two facts stamped at 2026-08-12T23:00Z, read at 01:00Z the next day: the
waiting list says 0 days, the dashboard prints "· 1d".

---

## 17. Should `?week` be parsed by one rule, and should a week with no row render empty or fall back?

**visible** · Part A row A73 (`#34 Selected week`)

**The question.** Two parsers for one parameter name.

```
lib/week-focus.ts:36-40         (/admin/payments — strict, returns null)
  if (!/^\d+$/.test(value)) return null;

  const week = Number(value);
  if (week < 1 || week > weeksInCycle) return null;
  return week;
```
```
app/admin/(protected)/this-week/page.tsx:50-53      (/admin/this-week — parseInt)
  const requested = Number.parseInt(week ?? "", 10);
  const result = await getDashboard(
    Number.isSafeInteger(requested) ? { weekNumber: requested } : undefined,
  );
```

**Why the rules do not settle it.** The documented rules cover neither the parse nor the fallback.

**Options.**

- **(a) One parser** — move `/admin/this-week` onto `focusedWeek`, so `?week=7abc` is ignored on both
  screens. A malformed or stale link stops silently landing the organizer on a different week's money.
  Two lines change.
- **(b) Also change the fallback** — resolve a non-existent week to the last real one rather than
  rendering it empty. Stops an empty week-24 page reading as "nobody owes anything" once the cycle
  overruns its generated rows, which §2.7 says to expect ("**Track the truth:** if it is actually
  running longer, show the real week"). Costs a visible behaviour change: "This Week" would sometimes
  show a week other than the calendar's current one. Note this can no longer be done by adopting
  `resolveTargetWeek` — that function is dead (no production caller).
- **(c) Leave as is.** Two parsers stay and an empty breakdown keeps rendering for a week with no row.
  §2.10's "Never leave doubt" is carried by a page that shows a week's worth of zeros with nothing
  saying the week does not exist.

**On screen either way.** `?week=7abc` renders WEEK 7's money on `/admin/this-week` under a URL nobody
meant, and is ignored on `/admin/payments`.

---

## 18. Must the member portal's past-cycle sentence follow §2.18's closing-statement wording?

**visible** · Part A row A86 (`#105 Closing statement text for a member`)

**The question.** Two sentences about one closed cycle, carrying different facts.

```
lib/cycle-close.ts:175-179      (the organizer's archive statement — weeks AND balance)
  if (m.outstanding === 0 && m.weeksPaid >= m.weeksCommitted) {
    return `You completed all ${m.weeksCommitted} weeks. Balance $0.`;
  }
  if (m.outstanding === 0) {
    return `You paid ${m.weeksPaid} of ${m.weeksCommitted}. Balance $0.`;
```
```
lib/member-history.ts:96-102    (the member's portal card — balance, then pending payout)
  if (input.pendingNet > 0) {
    return (
      `Complete — nothing owed. ${money(input.pendingNet)} of your payout had not been handed ` +
      `over when the cycle closed; speak to the organizer if you have not received it.`
    );
  }
  return "$0 outstanding — complete.";
```

**Why the rules do not settle it.** §2.18's two exemplars govern the closing **statement**, which
`closingStatementText` follows exactly. They are adjacent to a portal balance sentence that answers a
narrower question and carries a fact (`pendingNet`) the statement does not.

**Options.**

- **(a) Give `closingLine` the week counts** and reserve "complete" for `weeksPaid >= weeksCommitted`.
  One vocabulary across both surfaces. Costs the portal the pendingNet sentence unless it is kept as a
  second line, and "complete" then disappears for anyone a skipped week left one week short — a member
  who genuinely owes nothing.
- **(b) Leave the split and state on screen that the portal line is about the BALANCE, not attendance.**
  No arithmetic changes. `past-cycle-card.tsx:51` already prints "{weeksPaid} of {weeksCommitted}
  weeks" directly above the sentence, so the count is in front of the reader; the risk is the word
  alone being quoted back out of context.
- **(c) Fold both into one function** returning the §2.18 sentence plus any pending-payout clause.
  §2.18's exemplars become the single source for every closing sentence, and `pendingNet` stops being
  portal-only. Costs a decision about what the sent WhatsApp closing statement — a THIRD wording,
  `lib/whatsapp-templates.ts:251` — should say.

**On screen either way.** A member left one week short by a cycle-wide SKIPPED week reads "You paid 19
of 20. Balance $0." on the organizer's archive and "$0 outstanding — complete." on her own card. No
figure differs; only the wording.

---

# Summary counts

**115 quantity rows were adjudicated** — 103 in Part A (multi-implementation reconciliation) and 12
in Part C (the deferral / window / late agreement check). Every one carries verbatim source lines for
each implementation named.

| Verdict | Part A | Part C | Total |
|---|---:|---:|---:|
| **EQUIVALENT** — provably cannot differ | 47 | 2 | **49** |
| **RESOLVED** — they differ, a quoted rule settles it | 36 | 9 | **45** |
| **OPEN** — they differ, the rules do not settle it | 20 | 1 | **21** |
| | 103 | 12 | **115** |

The 21 OPEN rows collapse to **18 distinct rulings**, because three questions appear twice in Pass 1's
list (the break hole, the current-week clock, the at-risk window).

**By money-visibility, across all 115 rows:**

| Rank | Count | Of which OPEN |
|---|---:|---:|
| **headline** | **64** | 11 |
| visible | 32 | 10 |
| internal | 3 | 0 |
| footnote | 16 | 0 |

**64 of 115 rows are headline** — they change what a member or the organizer sees as owed, paid, or
their standing. Of the 45 RESOLVED rows, **31 are headline**: those are defects with a known correct
answer, not questions.

**Part B — label versus math: 31 findings.**

| Verdict | Count | Headline | Visible | Footnote |
|---|---:|---:|---:|---:|
| **WRONG** — the label states something the math does not compute | **11** | 6 | 4 | 1 |
| **MISLEADING** — the math is defensible, the words oversell or misname it | **15** | 12 | 3 | 0 |
| MATCHES — verified and cleared | 5 | 3 | 2 | 0 |
| | 31 | 21 | 9 | 1 |

**26 label problems**, of which **18 are headline**. The 31 sweep findings resolve to **29 distinct labels** — the
cash page's "Expected by now" and "Short" cards were each found twice, with different worked numbers; both proofs
are kept. Five findings were **downgraded to MATCHES on verification** and are kept in the record with the
refutation, because a finding withdrawn silently is worse than one never made.

**Where the damage concentrates.** Three root causes account for most of the headline rows:

1. **`lib/dashboard.ts:253`** — one `continue` drops deferred members from every group expectation.
   It is the direct cause of Part A rows A1, A2, A4, A5, A6 and A30 and Part C rows C1 and C12, and the
   arithmetic behind Part B findings B10, B11, B12, B13 and B20.
2. **The `member_progress` SQL view** — it has never been taught about `markedLateAt`, participation
   status, or `participation_breaks`, so `/me/group` answers three questions with rules the TypeScript
   abandoned. Part A rows A12, A14, A16, A17, A32 and A33, Part C rows C2 and C3, and Part B findings B5 and B18.
3. **Stored-versus-coverage basis** — `/admin/this-week` and the week panels compare
   `Payment.amountPaid` while the grid beside them compares `coveredAtCurrentRate`. Only legacy
   imported rows can separate them today, but nothing pins the invariant. Part A rows A19, A20 and A27.

---

# Part A — Multi-implementation reconciliation

103 rows, grouped by money-visibility. Row format: **quantity — verdict**, then each implementation
with its verbatim line, the divergence proof with a concrete input, the ruling with the governing rule
quoted verbatim, and what a human sees differently.

---

## A · HEADLINE (56 rows)

---

### A1. SHORTFALL 1 of 5 — "Short" for ONE week (the group's per-week gap) — **RESOLVED**

**Implementations**

- `lib/dashboard.ts:264` — **THE DEFECT**
  ```
      shortfall: Math.max(0, expected - received),
  ```
  A GROUP subtraction with no per-member floor: Σexpected − Σreceived, not Σ max(0, theirDue −
  theirMoney). Any member whose money on this week exceeds their own expectation silently pays down
  another member's debt. `Math.max(0, …)` guarantees the error can only ever HIDE a shortfall, never
  surface as a negative. Two independent upstream conditions produce such a member, so the defect does
  not depend on any ruling about deferral.
- `lib/dashboard.ts:250` — operand 1, unconditional
  ```
        received += payment.amountPaid;
  ```
  Every payment row of every participation (ACTIVE and CLOSED; `app/actions/dashboard.ts:56-63` applies
  no status filter), in window or not, deferred or not, because both gates sit BELOW it. Deliberate,
  per the comment at `:247`: `// Received money always counts, even outside a window (edited data).`
- `lib/dashboard.ts:252` — operand 2's first gate, the source of the asymmetry
  ```
      if (!inWindow || input.isSkipped) continue;
  ```
  `inWindow` is `inMemberWindow`, imported at `lib/dashboard.ts:14` as
  `import { inWindow as inMemberWindow, type WindowBreak } from "./participation-close";` and therefore
  BREAK-AWARE. Money on a week outside a member's window is counted at `:250` and its expectation is
  dropped here.
- `lib/dashboard.ts:253` — operand 2's second gate
  ```
      if (payment?.isDeferred) continue;
  ```
  Drops a deferred member out of `expected` entirely, on EVERY week, elapsed or not. Adjudicated in row
  A5 and Part C row C1, not here — it is **not** what makes `:264` wrong.
- `lib/dashboard.ts:257` — **THE CORRECT SHAPE**, seven lines above the defect, in the same loop
  ```
      if ((payment?.amountPaid ?? 0) >= participation.weeklyAmount) membersPaid++;
  ```
  Compares EACH member's money against THEIR OWN weekly amount, so no member's surplus can cover
  another's debt. `membersPaid`/`membersExpected` answer "is anyone short this week" correctly while
  `shortfall` does not — and the two are printed side by side.
- `app/admin/(protected)/this-week/page.tsx:121` — re-derives a figure already on the object
  ```
              cents={Math.max(0, totals.expected - totals.received)}
  ```
  `totals` is `d.selectedWeekTotals` (`page.tsx:66`), a receiptsByWeek row that already carries
  `shortfall`. A §5.10 duplicate that inherits the defect.
- `app/admin/(protected)/cash/page.tsx:266` — third copy, By-week table
  ```
                    const gap = Math.max(0, w.expected - w.received);
  ```
  On a `d.series` row that already carries `shortfall`, applied to EVERY week with no elapsed filter
  (`:265` `{d.series.map((w) => {`), so weeks that have not happened yet render a red "Short" equal to
  their whole expectation.

**Divergence proof — two independent routes.**

*Route A (deferral).* Week 9, elapsed, $500/week. Alem's week 9 is DEFERRED and he pays $500 onto it —
reachable because `lib/allocation.ts:90` skips only `isSkipped` weeks, and
`app/actions/payments.ts:62-64` states it outright (`// DEFERRED rides alongside the allocation input,
never inside it: money  // lands on a deferred week like any other (organizer ruling, Aug 2026).`); no
write path clears `isDeferred` except the deferral toggle itself (`app/actions/edits.ts:1371-1379`) and
mark-late row creation (`:1515`). Bekele is in window, not deferred, has paid $0. weekReceipts(9):
Alem → `received += 500` at `:250`, then `continue` at `:253`, so no expected and no membersExpected.
Bekele → received += 0, expected += 500, membersExpected 1, membersPaid 0. Result expected $500,
received $500, **shortfall = Math.max(0, 0) = $0**.

*Route B (no deferral anywhere).* Meheret is CLOSED at week 12 and had paid $500 ahead onto week 13
before stopping. Closing writes a break at `closingAtWeek + 1`
(`app/actions/participation-close.ts:314-322`, `          fromWeek: input.closingAtWeek + 1,`) and does
NOT delete forward payment rows — there is no such deletion in the close transaction and `closeRefusal`
(`lib/participation-close.ts:226-257`) does not refuse a close with forward money. So on week 13 her
$500 is counted at `:250` while `:252` correctly drops her expectation. A live member owing $500 on
week 13 reads as **Short $0**.

*What the screen says, either route.* `app/admin/(protected)/this-week/page.tsx:119-131` renders
`Short $0.00` with the sub-text `"the week is fully collected"` (the ternary at `:123-124` fires because
`totals.expected <= totals.received`), immediately beside the Received card whose sub-text at `:115` is
`${totals.membersPaid} of ${totals.membersExpected} members paid` = "0 of 1 members paid". Bekele's own
standing, via `computeStanding → amountOutstanding` (`lib/derived.ts:299`
`    if (!week.isSkipped) due += week.amountDue;`), reports $500 owed for week 9. Two numbers, one week,
$500 apart.

**Ruling.** Correct: `lib/dashboard.ts:257`. The group figure must be Σ over in-window members of
`max(0, theirDue − theirOwnMoney)`, never Σexpected − Σreceived. Fixing `:264` to that shape closes BOTH
routes and requires no ruling on deferral. Wrong: `lib/dashboard.ts:264`; `this-week/page.tsx:121`;
`cash/page.tsx:266`.

> §2.18 THE CARRIED BALANCE — PEOPLE, NOT CYCLES, OWE: "- **Unpaid means owed.** A week stops being
> owed only when it is marked paid. Nothing else clears it."
>
> §5.10: "TWO FUNCTIONS ANSWERING ONE QUESTION IS THE SAME DEFECT AS NONE"

§2.18 governs directly and needs no deferral ruling: Bekele's week 9 is unpaid and therefore owed; the
only thing that cleared it on screen was ANOTHER member's money, which is exactly the "nothing else"
the rule names. §5.10 governs the three copies of the arithmetic.

**What a human sees.** Surfaces RE-DERIVED by search (`\.shortfall|expected - received|expectedTotal|selectedWeekTotals`
across `app/` and `components/`, then each file read): `app/admin/(protected)/page.tsx:199`
(`<Pill tone={d.thisWeek.shortfall > 0 ? "attention" : "good"}>`) and `:208-212`;
`this-week/page.tsx:107-131`; `cash/page.tsx:265-293`;
`components/charts/collected-vs-expected-chart.tsx:188`, `:256`, `:327`;
`app/actions/dashboard.ts:221-227 → app/admin/(protected)/page.tsx:380`. The dashboard card is not
wholly silent — `page.tsx:213-214` still appends `— 1 have not paid`. The contradiction is that the
Pill beside it is GREEN (`tone="good"`) while its own text reads "0 of 1 paid", and that
`/admin/this-week` states **in words** that a week with an unpaid member is "fully collected". The
organizer's eye goes to the tone and the money; both say fine.

---

### A2. SHORTFALL 2 of 5 — the whole-cycle collection shortfall over ELAPSED weeks — **RESOLVED**

**Implementations**

- `lib/cycle-position.ts:217` — canonical
  ```
      shortfall: Math.max(0, gap - Math.min(willNotArrive, gap)),
  ```
  Built on the elapsed slice only (`:186` `  const elapsed = input.series.filter((w) => w.elapsed);`,
  `:194`, `:195`, `:209` `  const gap = Math.max(0, shouldHaveCollected - collected);`). Stopped
  members' recorded balances are sorted out rather than deducted, so gap = shortfall + willNotArrive
  still reconciles.
- `lib/cycle-position.ts:194` — the expectation side
  ```
    const shouldHaveCollected = elapsed.reduce((s, w) => s + w.expected, 0);
  ```
  A sum of `weekReceipts.expected`, so it inherits `lib/dashboard.ts:253` wholesale — and because it is
  restricted to ELAPSED weeks, the deferral drop lands precisely on the case §2.29 effect 2 legislates.
- `app/actions/cycle-position.ts:206` — the SECOND route to the same figure, per member
  ```
          owedBy.push({ participationId: p.id, name, amount: standing.amountOutstanding });
  ```
  Through `computeStanding → amountOutstanding`. That path counts an elapsed DEFERRED week as due:
  `lib/derived.ts:113-114` (`  if (args.markedLate && !args.isDeferred) return true;` /
  `  return weekHasElapsed(args);`) lets a deferred elapsed week through `weekCountsAsDue`, and
  `lib/derived.ts:299` then charges it. Floored at zero PER MEMBER. The screen asserts the two routes
  are one quantity (`position/page.tsx:145`). Loops `active` only (`cycle-position.ts:201`, with `:108`
  `    const active = cycle.participations.filter((p) => p.status === "ACTIVE");`).
- `scripts/audit-position-figures.mts:233` — the Sunday check reproduces the drop by hand
  ```
      if (pay?.isDeferred) continue;
  ```
  It recomputes `shouldHaveCollected` by hand (`:227-237`) and reproduces the unfiltered received at
  `:240-242` (`flatPayments.filter((p) => p.weekNumber <= elapsed)`). So `npm run check:position` agrees
  with this defect by construction and can never report it.
- `app/admin/(protected)/cash/page.tsx:63` — a fourth route, broken on two axes at once
  ```
    const shortfall = Math.max(0, expectedTotal - d.position.totalReceived);
  ```
  Adjudicated in full as row A4.

**Divergence proof.** Alem is ACTIVE and in window, week 7 is elapsed, his week 7 is DEFERRED and unpaid
at $500, weeks 1-6 paid in full; every other member is fully paid. weekReceipts(7) drops Alem from
`expected` at `lib/dashboard.ts:253`, so shouldHaveCollected = collected and gap = $0 → `c.shortfall` =
**$0**. `computeStanding` for Alem: `weekCountsAsDue` returns `weekHasElapsed` for a deferred week, so
week 7 is in the elapsed set; `amountOutstanding` adds its $500 to `due` against $3,000 allocated over
weeks 1-6 → `standing.amountOutstanding` = 50,000 cents, and `:205-207` pushes him onto `owedBy`.
`/admin/cycle/position?section=collection` renders, in one column: StatCard "Outstanding $0.00" with
sub-text "nothing is owed for elapsed weeks" (`page.tsx:139-148`) and, immediately below, the card "Who
the outstanding money is with" listing Alem at **$500** (`page.tsx:220-227`). The nav badge shows count
1 with no attention dot: `sections.ts:73` `      count: input.owedByCount || undefined,` and `:76`
`      attention: input.shortfall > 0 || input.toCover > 0,` — with no stopped members `toCover` is 0.

**Ruling.** Correct: `app/actions/cycle-position.ts:206`. `lib/cycle-position.ts:217` is right in
structure — the willNotArrive sort-out is sound and is NOT part of this finding — but wrong in its
input, because `lib/cycle-position.ts:194` sums an expectation `lib/dashboard.ts:253` has already
emptied of deferred members. Wrong: `lib/dashboard.ts:253`; `scripts/audit-position-figures.mts:233`;
`cash/page.tsx:63`.

> §2.29, effect 2 (Arithmetic): "A mark cannot pull a not-yet-due deferred week forward, and the
> attention list applies the same test — so the list and the standing derivation cannot disagree. An
> *elapsed* deferred week still counts as owed: deferral has never excused the money."
>
> §2.14: "the organizer's own two decisions about a week — `deferred` (excuse the chase; the money is
> still owed)"

`shouldHaveCollected` is restricted to ELAPSED weeks at `lib/cycle-position.ts:186`, and the rule's
second sentence rules on precisely that case. Its first sentence rules on the second half too: "the list
and the standing derivation cannot disagree" is what this screen breaks, with the list and the total
side by side.

**What a human sees.** Surfaces RE-DERIVED: `cycle/position/page.tsx:139-148`, `:220-240`,
`position/sections.ts:73` and `:76`, `position/page.tsx:128-132`. The Outstanding card says nothing is
owed while the list directly under it names a member and an amount, and the card's own sub-text
(`${c.owedBy.length} member…owe it`) claims the two are one quantity — which is exactly the claim that
fails. Deleting `lib/dashboard.ts:253` closes this and the deferral half of row A5 together; the
willNotArrive sort-out at `:217` should be left alone.

---

### A3. "BEHIND / OVERDUE ACROSS CLOSED WEEKS" (dashboard chart) vs "OUTSTANDING" (cycle position) — **OPEN**

*(Ruling text at OPEN ruling 10. Evidence recorded here.)*

**Implementations**

- `components/charts/collected-vs-expected-chart.tsx:75`
  ```
    const behind = Math.max(0, closedExpected - closedReceived);
  ```
  Correctly restricted to elapsed weeks (`:72` `  const closed = weeks.filter((w) => w.elapsed);`) — its
  comment at `:70-71` reads `// The headline is about CLOSED weeks only. A shortfall that includes the`
  / `// week still being collected is not a shortfall, it is impatience.` — but applies NO willNotArrive
  sort-out. Rendered as the chart's headline at `:95-106`, red, labelled at `:104`
  `            {behind > 0 ? "overdue across closed weeks" : "closed weeks are fully collected"}`.
- `lib/cycle-position.ts:217`
  ```
      shortfall: Math.max(0, gap - Math.min(willNotArrive, gap)),
  ```
  Same elapsed slice, same source series, but sorts out the recorded balances of members who have
  stopped (`:208` `  const willNotArrive = stoppedBy.reduce((s, m) => s + m.balanceRecorded, 0);`). Its
  comment at `:197-201` states the intent: the shortfall answers "what am I still waiting on" and for
  these members the answer is nothing.

**Divergence proof.** Meheret stopped at week 12 owing $2,000 across weeks 9-12; nobody else is behind.
Both figures are computed from a `series` built by the same `receiptsByWeek` over the same rows
(`app/actions/dashboard.ts:161-167` and `app/actions/cycle-position.ts:157-162`). She was in window for
weeks 9-12, so those weeks' `expected` includes her and her money never arrived: closedExpected −
closedReceived = $2,000, and the `/admin` chart headline reads "$2,000.00 / overdue across closed weeks"
in red. Her `balanceRecorded` is `standingFor(p, closedAtWeek).amountOutstanding` = $2,000
(`app/actions/cycle-position.ts:259`), so willNotArrive = $2,000, gap = $2,000, and
`lib/cycle-position.ts:217` gives `Math.max(0, 2000 − 2000)` = **$0** — `/admin/cycle/position` renders
"Outstanding $0.00 — nothing is owed for elapsed weeks". Two admin screens, $2,000 apart, one dataset.

**Why OPEN.** §2.18 says only "**The organizer absorbs the gap so no other member is ever short.** That
is his responsibility and it is not negotiable. The software's job is to **remember, never to
enforce**." — that settles that the money must be REMEMBERED somewhere (both screens do) but says
nothing about which figure a headline should carry. A presentation ruling, not a derivation rule.

**Note on the earlier reconciliation.** This was previously folded into row A2 and stamped RESOLVED on
that §2.18 quote. The quote is adjacent, not governing — it does not choose between the two figures — so
per the OPEN rule it is split out and downgraded. The earlier prose conceded the point ("a DIFFERENT,
legitimate question that needs a different name") while its status field said otherwise.

---

### A4. SHORTFALL 5 of 5 — the cash page's whole-series "Short" card — **RESOLVED**

**Implementations**

- `app/admin/(protected)/cash/page.tsx:62`
  ```
    const expectedTotal = d.series.reduce((s, w) => s + w.expected, 0);
  ```
  Sums EVERY week in the series with no elapsed filter. `d.series` is the full week list:
  `app/actions/dashboard.ts:161-167` feeds receiptsByWeek
  `weeks: cycle.weeks.map((w) => ({ weekNumber: w.weekNumber, isSkipped: w.isSkipped })),`, and weeks
  are generated for the whole cycle up front (§2.6).
- `app/admin/(protected)/cash/page.tsx:63`
  ```
    const shortfall = Math.max(0, expectedTotal - d.position.totalReceived);
  ```
  Subtracts ALL cash ever received from a whole-cycle expectation. `totalReceived` is every payment row
  without qualification — `lib/dashboard.ts:50-54` sums `input.payments`, and
  `app/actions/dashboard.ts:140-143` passes `flatPayments`.
- `app/admin/(protected)/cash/page.tsx:240` — the label asserts an elapsed restriction `:62` does not apply
  ```
          <StatCard label="Expected by now" cents={expectedTotal} sub="across the weeks that have elapsed" />
  ```
- `app/admin/(protected)/cash/page.tsx:244` — second false claim about the same number
  ```
            sub={shortfall === 0 ? "the group is fully current" : "still to collect for elapsed weeks"}
  ```
  On the "Short" card at `:241-246`, emphasised red when > 0 (`          emphasis={shortfall > 0}`).
- `lib/cycle-position.ts:194` — the CORRECT implementation of the very thing the label describes, off the
  SAME series
  ```
    const shouldHaveCollected = elapsed.reduce((s, w) => s + w.expected, 0);
  ```
- `components/charts/collected-vs-expected-chart.tsx:72` — a second correct implementation, same `d.series`
  ```
    const closed = weeks.filter((w) => w.elapsed);
  ```

**Divergence proof.** Two members, $500/week each, 20-week cycle, currently week 3 (weeks 1-2 elapsed,
week 3's window still open). Both have paid weeks 1, 2 and 3 in full → every payment row totals $3,000,
so `d.position.totalReceived` = $3,000. All 20 week rows exist and both members are in window for all of
them, so `cash/page.tsx:62` gives expectedTotal = 20 × 2 × $500 = **$20,000**. `:63` gives
`Math.max(0, $20,000 − $3,000)` = **$17,000**. The Received tab renders "Expected by now $20,000.00 —
across the weeks that have elapsed" and "Short $17,000.00 — still to collect for elapsed weeks", in red.
For the identical data `lib/cycle-position.ts:194/:195/:209` gives shouldHaveCollected $2,000, collected
$2,000, gap $0, and `/admin/cycle/position` renders "Outstanding $0.00"; the dashboard chart, fed by the
SAME `d.series`, renders "All in — closed weeks are fully collected". Three screens, one dataset:
$17,000, $0, $0. The By-week table compounds it: `:265-266` maps every row with no elapsed filter, so
weeks 4-20 each render a red "Short $1,000.00" for money that is not due.

**Ruling.** Correct: `lib/cycle-position.ts:194` with `:209`, or for a headline
`collected-vs-expected-chart.tsx:72-75`. Wrong: `cash/page.tsx:62`, `:63`, `:266`.

> §8, "The Sunday check — `npm run check:position`": "| It proves | Against |" … "| what should have come
> in by now, and what did | every elapsed week × every member in window |"
>
> §2.1 THE PRESENTATION LAYER — "WHERE AM I, RIGHT NOW": "- What was supposed to be collected? What
> actually came in?"
>
> §5.5: "A COMMENT CAN BE THE BUG'S BEST CAMOUFLAGE"

§8's table row is the definitional anchor: it defines "what should have come in by now" as every ELAPSED
week × every member in window, which is exactly what the card's own label claims and exactly what its
arithmetic does not do.

**What a human sees.** Surfaces RE-DERIVED: `cash/page.tsx:240`, `:241-246`, `:265-293`. This is NOT a
fifth quantity: it is row A2's question implemented wrongly on two axes at once. On the live cycle the
card overstates by roughly the whole group's remaining contributions. Two remedies both close it —
restore the elapsed slice on both operands, or keep the arithmetic and relabel it "still to collect over
the rest of the cycle" with the red emphasis removed, since $17,000 IS a truthful whole-cycle figure
under that name. What is not defensible is the current pairing: a whole-cycle number, labelled
elapsed-only, painted red. `npm run check:position` cannot catch it —
`scripts/audit-position-figures.mts:199-207` never recomputes these two lines, despite §8 listing
`/admin/cash` among what it proves.

---
### A5. EXPECTED for a week — four populations under one name — **RESOLVED**

**Implementations**

- `lib/dashboard.ts:255` — **Population A**
  ```
      expected += participation.weeklyAmount;
  ```
  Gated by `inMemberWindow` at `:245` (BREAK-AWARE — `lib/dashboard.ts:14` imports
  `inWindow as inMemberWindow` from `./participation-close`, whose `:123` is
  `  return !inBreak(p.breaks, weekNumber);`), by the cycle-skipped flag at `:252`, and by DEFERRAL at
  `:253`. Population = every participation the caller passes, which in `app/actions/dashboard.ts:121-127`
  is ALL of them, ACTIVE and CLOSED. Its own doc at `:202-204` reads `/** What this week should bring in
  — window-aware (2.7): only members whose  *  window covers the week, minus deferred/excused members. */`.
- `lib/payments-view.ts:225` — **Population B**, keeps deferred cells
  ```
          if (!week.isSkipped && mw.status !== "SKIPPED") expected += mw.amountDue;
  ```
  Reason stated at `:223-224`: `        // Only a SKIPPED week is off the books. A DEFERRED week is
  still` / `        // owed, so it belongs in what the week EXPECTED to collect.` Its window test is its
  own — `:217` `        if (week.weekNumber < member.startWeek) return { kind: "before-start" as const };`
  and `:218` `        if (week.weekNumber > member.finishWeek) return { kind: "after-finish" as const };`
  — a flat range that knows nothing about `ParticipationBreak`.
- `app/actions/payments-view.ts:33` — the loader for Population B
  ```
          where: { status: "ACTIVE" },
  ```
  Inside `loadActiveCycleWithPayments`, which `getPaymentsGrid` calls at `:101` and
  `app/admin/(protected)/payments/page.tsx:24` renders. Stopped members are absent from the grid
  entirely — every cell, every column, and both footer figures.
- `lib/payments-view.ts:193` — the type doc asserting the OPPOSITE of the code, 32 lines away
  ```
      /** Window-aware expectation: in-window, non-deferred members only. */
  ```
  §5.5, doubled: one file carries both claims, and a reader who trusts the type sees Population A where
  the code produces Population B.
- `app/admin/(protected)/cycle/page.tsx:40` — **Population D**
  ```
    const weeklyPot = activeParticipations
  ```
  The statement spans `:40-46`, filtering
  `p.startWeek <= effectiveWeek && effectiveWeek <= calculateFinishWeek(p.startWeek, p.weeksCommitted)`
  and reducing `sum + p.weeklyAmount`. ACTIVE only (`:34`), break-unaware, no deferral filter, no
  cycle-skipped filter, and its week comes from `currentWeekNumber(cycle.startDate, new Date())` at `:33`
  rather than the stored week rows. Rendered as "This week's pot" (`:82-86`). **Reclassified:** this
  answers a different question — what the winner takes — and nothing in the ground truth equates the pot
  to `expected`, so it is not listed as a wrong implementation of this quantity. Its break-unawareness is
  a real defect against the same break rule, carried at OPEN ruling 2.

**Divergence proof — three axes.**

1. **DEFERRAL.** Week 9, elapsed, $500/week, Alem and Bekele both in window. Alem's week 9 is DEFERRED
   and unpaid; Bekele has paid his $500. `lib/dashboard.ts`: Alem hits `continue` at `:253` → expected =
   $500. `lib/payments-view.ts`: Alem's cell status is DEFERRED, not SKIPPED, so `:225` adds his $500 →
   expected = $1,000. `/admin/this-week` shows "Expected $500.00" (`this-week/page.tsx:107-111`); the
   `/admin/payments` grid footer for the same week 9 shows "$500.00 / $1,000.00" (`payments-grid.tsx:332`
   `                      {formatMoney(row.received)} / {formatMoney(row.expected)}`). $500 apart, same
   week, same rows.
2. **POPULATION.** Meheret is CLOSED, stopped at week 12 (break fromWeek 13), $500/week, paid weeks 1-12
   in full. Week 3: `inMemberWindow(Meheret, 3)` is true (week 3 precedes her break), so the dashboard
   adds her $500 to expected and her $500 to received. The grid never loads her
   (`app/actions/payments-view.ts:33`), so both its week-3 figures are $500 lower. The two disagree on
   BOTH numbers for every one of weeks 1-12.
3. **BREAK.** Tizita is ACTIVE, startWeek 1, weeksCommitted 20, $500/week, with a CLOSED break fromWeek 5
   toWeek 8 (she stopped and came back). Week 6: `inMemberWindow` returns false via
   `lib/participation-close.ts:123` so the dashboard excludes her $500; the grid's `:217`/`:218` range
   test sees 1 ≤ 6 ≤ 20 and includes it.

**Ruling.** None as written is wholly correct. `lib/dashboard.ts:255` is right on the window
(break-aware), on the skipped week, and on the member population (ACTIVE + CLOSED), and wrong only on
deferral for elapsed weeks; `lib/payments-view.ts:225` is right only on deferral. The single correct
predicate is `lib/dashboard.ts:255` with `:253` deleted, and the grid fed the same way: drop
`where: { status: "ACTIVE" }` at `app/actions/payments-view.ts:33` and replace
`lib/payments-view.ts:217-218` with `inWindow`. Wrong: `lib/dashboard.ts:253`;
`lib/payments-view.ts:217-218`; `app/actions/payments-view.ts:33`; `lib/payments-view.ts:193` (the doc
comment); `cash/page.tsx:62` (row A4); `scripts/audit-position-figures.mts:233`.

> §2.29, effect 2 (Arithmetic): "An *elapsed* deferred week still counts as owed: deferral has never
> excused the money."
>
> §2.18: "- **Closed members stay visible** — not removed from the cycle. They keep access to their own
> record and can see where they stopped. Dignity, and a useful record for them."
>
> §2.15: "**The grid stays.** It is genuinely good at showing everyone at once and spotting patterns
> (streaks of red, people paid ahead)."
>
> §4.1, for the break axis: "| Mid-cycle participation close | Done — `ParticipationBreak`, gaps are
> holes not cutoffs (rule 17) |"

**What a human sees.** Surfaces RE-DERIVED. Population A reaches `app/admin/(protected)/page.tsx:208`,
`this-week/page.tsx:107-111`, `cash/page.tsx:281`,
`collected-vs-expected-chart.tsx:148-158`/`:256`/`:326`, and — through `lib/cycle-position.ts:194` and
`:231` — "Should have come in" and "Week N is still open: X of Y is in" on `/admin/cycle/position`
(`page.tsx:128-132`, `:182-187`). Population B reaches exactly one place: `payments-grid.tsx:332`.
Population D reaches `cycle/page.tsx:84-86`.

**Scope, stated honestly.** The deferral axis is RESOLVED for ELAPSED weeks — §2.29's sentence is
explicitly about an elapsed deferred week. For a week still inside its payment window the documented
rules do NOT settle whether a deferred member belongs in `expected`; the repo argues the negative
deliberately at `app/admin/(protected)/cycle/position/week-dates.ts:77-81` and discloses it to the
organizer at `week-date-panel.tsx:201-208` ("except anyone whose week you have deferred, who is counted
in neither figure"). The population axis is resolved cleanly by §2.18 and §2.15. The break axis rests on
a §4.1 status-table line pointing at DOMAIN_RULES rule 17 rather than on a §2 rule, so its footing is
thinner than the other two — but the code's own reasoning at `lib/participation-close.ts:112-115` is
unambiguous ("Restoring those weeks would invent arrears for weeks nobody ever asked them about"), and
it is carried as OPEN ruling 2. Two admin screens describing week 9 disagree by one member's weekly
amount, and the disagreement always runs the same way — the screen the organizer actually watches
reports the SMALLER expectation, making the group look more current than it is.

---

### A6. RECEIVED for a week — two populations under one name (plus two provably equivalent restatements) — **RESOLVED**

**Implementations**

- `lib/dashboard.ts:250` — **Population A**
  ```
        received += payment.amountPaid;
  ```
  Every payment row of every participation the caller passes — ACTIVE and CLOSED
  (`app/actions/dashboard.ts:56-63`, `:121-138`) — with no window test and no deferral test, because both
  gates sit BELOW it at `:252` and `:253`. Deliberate, per `:247`:
  `    // Received money always counts, even outside a window (edited data).`
- `lib/dashboard.ts:128` — cashSeries builds the same per-week total again
  ```
      receivedBy.set(p.weekNumber, (receivedBy.get(p.weekNumber) ?? 0) + p.amountPaid);
  ```
  Keyed by weekNumber over the flat list rather than by walking participations. Same rows, same rule, fed
  from the same `flatPayments` at `app/actions/dashboard.ts:147-152`.
- `app/actions/cycle-close.ts:178` — the archive's frozen per-week figure
  ```
        received: cycle.participations.reduce(
  ```
  The statement spans `:178-181`, the arithmetic being
  `        (sum, p) => sum + (p.payments.find((pm) => pm.weekId === w.id)?.amountPaid ?? 0),`. Attributes
  by weekId rather than weekNumber and takes at most one row per participation via `.find`. Its
  participation set is unfiltered (`loadCycleForClose`, `:32-50`) — ACTIVE and CLOSED, like the dashboard.
- `lib/payments-view.ts:222` — **Population B**
  ```
          received += mw.storedPaid;
  ```
  Reached only for cells that pass `:217` and `:218` and only when a week row exists (`:221`
  `        if (!mw) return { kind: "after-finish" as const };`), over the ACTIVE-only member set from
  `app/actions/payments-view.ts:33`. Money on a row outside that range, and every cent of every stopped
  member, is silently absent.

**Divergence proof.** A vs cycle-close vs cashSeries: **EQUIVALENT, and provably so.**
`prisma/schema.prisma:178` declares `  @@unique([cycleId, weekNumber])` on Week and `:322` declares
`  @@unique([weekId, participationId])` on Payment, so within one cycle weekId ↔ weekNumber is a bijection
and each participation has at most one row per week. `lib/dashboard.ts`'s `paymentFor` map is keyed by
participationId (`:231-235`) and therefore also takes exactly one row per participation, so `.find` by
weekId and `filter` by weekNumber select the same row from the same participation set. No separating
input could be constructed.

A vs B: they differ, twice over. (1) Meheret, CLOSED, stopped at week 12, $500/week, paid weeks 1-12 in
full. `/admin/this-week` week 3 "Received" includes her $500 (`this-week/page.tsx:112-118`); the
`/admin/payments` grid footer for week 3 does not, because `app/actions/payments-view.ts:33` never loads
her — a $500 gap on every one of weeks 1-12. (2) Meheret had also paid $500 ahead onto week 13 before
stopping, and the close deletes no payment rows (verified: the close transaction at
`app/actions/participation-close.ts:309-335` writes a break and updates the participation, and nothing
else touches Payment). Week 13 is outside her window, so `lib/dashboard.ts:250` still counts that $500
into week 13's `received` while `:252` correctly keeps it out of `expected` — the received/expected
asymmetry that makes row A1's shortfall read $0 while a live member owes.

**Ruling.** Correct: `lib/dashboard.ts:250` — money that exists must be reported somewhere (§2.14), and
the archive (`app/actions/cycle-close.ts:178`) and the cash series (`lib/dashboard.ts:128`) already agree
with it. Wrong: `lib/payments-view.ts:222` (in-window only — hides real money that was received);
`app/actions/payments-view.ts:33` (the ACTIVE-only loader).

> §2.14 MONEY IS THE TRUTH — EVERYTHING ELSE IS DERIVED: "The system stores **what actually happened**,
> and calculates everything else."
>
> §2.18: "- **Closed members stay visible** — not removed from the cycle. They keep access to their own
> record and can see where they stopped. Dignity, and a useful record for them."
>
> §2.15: "**The grid stays.** It is genuinely good at showing everyone at once and spotting patterns
> (streaks of red, people paid ahead)."

§2.15 governs the grid specifically: a map that cannot show everyone at once is not doing the one job the
rule keeps it for.

**What a human sees.** Surfaces RE-DERIVED. Population A reaches `app/admin/(protected)/page.tsx:210`,
`this-week/page.tsx:112-118` (with `{membersPaid} of {membersExpected} members paid` as its sub-text),
`cash/page.tsx:278`, `collected-vs-expected-chart.tsx:160-186`/`:256`/`:325`, and — through
`lib/cycle-position.ts:195`/`:226`/`:232` — "Actually collected", "Paid ahead" and `collectedThisWeek`.
cashSeries reaches `components/charts/cash-position-chart.tsx:222`, `:300`, `:370`. The archive figure
reaches `app/admin/(protected)/cycles/[id]/archive/page.tsx:157` and the CSV at `export-button.tsx:55` —
permanently, since the archive is frozen at close. Population B reaches only `payments-grid.tsx:332`. The
payments grid shows less money coming in for a week than the dashboard does, and a member who stopped
mid-cycle has vanished from the map entirely, taking every cent they paid with them. Nothing in the
platform compares the two.

---

### A7. Fee once drawn — the STORED `Payout.feeAmount`, against every live derivation — **RESOLVED**

**Implementations**

- `app/actions/wheel.ts:696` — the draw freezes the fee
  ```
                feeAmount: payout.fee,
  ```
  The `calculatePayout` call is at `:685-689`.
- `app/actions/week-winners.ts:241` — adding a winner to an existing week freezes it the same way
  ```
            feeAmount: amounts.fee,
  ```
- `app/actions/manual-payout.ts:473` — the manual-assignment path, identical arithmetic
  ```
                feeAmount: payout.fee,
  ```
- `app/actions/edits.ts:1980` — the hand correction
  ```
            feeAmount: input.feeAmount,
  ```
  The only validation is `app/actions/edits.ts:1908-1916` (guard line `:1913`
  `      if (!Number.isSafeInteger(v) || v < 0 || v > MAX_MONEY_CENTS) {`). No check that the fee equals
  feePercent × gross and none that net = gross − fee.
- `app/admin/(protected)/people/[id]/page.tsx:326` — **READS THE STORED FEE IN PREFERENCE — correct**
  ```
              fee: acc.fee + (recorded?.feeAmount ?? projected.fee),
  ```
  Same preference at `:730` `                            {formatMoney(payout?.feeAmount ?? projected.fee)}`.
- `lib/participation-removal.ts:100-101` — RE-PROJECTS even when a payout exists
  ```
    const gross = a.weeklyAmount * a.weeksCommitted;
    return calculateFee(Math.max(0, gross), a.feePercent);
  ```
  `a.feePercent` is the cycle's CURRENT percent — `app/actions/participation-removal.ts:148`
  `    feePercent: p.cycle.feePercent,`. Never consults `Payout.feeAmount`, although the same attachments
  object carries the payout rows (read at `:111` and `:121`).
- `lib/final-position.ts:121` and `:69`
  ```
    const drawn = input.received > 0;
    return feePreview(input)?.fee ?? 0;
  ```
  `received` is fed from COLLECTED payout nets only — `app/admin/(protected)/people/[id]/page.tsx:164-167`
  and `app/actions/member.ts:157-160`. A member holding a PENDING payout therefore evaluates as
  never-drawn.
- `app/actions/edits.ts:2223` — `updateCycle` rewrites the fee percent with no guard on existing payouts
  ```
            feePercent: input.feePercent,
  ```
  The only refusals in the function are for shrinking plannedWeeks (`:2184-2213`). The confirmation the
  organizer reads is `app/admin/(protected)/cycle/edit/cycle-edit-form.tsx:146`
  `          <p>An audit entry records old and new values, and every derived figure recalculates.</p>` —
  stored payout fees deliberately do NOT recalculate.

**Divergence proof.** Cycle 1, unit $1,000, feePercent 2.0. Abebe holds #7 at amount 100,000c,
weeksCommitted 20. The week-6 draw stores grossAmount 2,000,000c, feeAmount 40,000c, netAmount
1,960,000c. The organizer then corrects the cycle's fee to 3.0 on `/admin/cycle/edit`; `updateCycle`
accepts it and nothing warns that a payout exists. For that ONE payout: his profile's per-number table
prints the stored **$400** (`people/[id]/page.tsx:730`) and the cash position's fee estimate counts $400
(`app/actions/cycle-position.ts:312-317`), while the removal preview for the same member prints **$600**
— `calculateFee(2,000,000, 3)` = 60,000c — at `components/admin/remove-from-cycle.tsx:300`, and writes
$600 into the audit entry. If that member is also CLOSED with the payout still PENDING, `finalPosition`
takes the undrawn branch and the portal sentence quotes a $600 fee against a payout row storing $400.

*Second case, corrected.* An earlier draft claimed a divergence "with no cycle edit at all". That is
WRONG as stated: with the percent unchanged, `feeOnReturn` and `Payout.feeAmount` are both $400, so no
two numbers differ. What that case actually produces is a wrong BRANCH — a member who was drawn is
classified "not drawn" because `received` counts only COLLECTED — and the consequence is that the
commitment fee is charged a second time: $400 is already withheld inside the pending payout's net, and
`finalPosition` subtracts $400 again from what is returned. The member's portal reads "You paid in $X.
You were not drawn. $Y is owed to you after the $400 fee" (`lib/final-position.ts:179-181`) beside a
payout that already charged it.

**Ruling.** Correct: `app/admin/(protected)/people/[id]/page.tsx:326` (and `:730`) — recorded wins over
projected. Wrong: `lib/participation-removal.ts:100-101` (re-projects at the CURRENT percent for a member
whose payout already stores the fee it charged); `lib/final-position.ts:121` (`received > 0` treats a
PENDING payout as never-drawn, so the projection is used where a stored fee exists, and the commitment
fee is deducted a second time from money the payout already charged it on).

> §2.30: "**Derived until it is real, then stored.** No fee is stored on a participation: every projected
> fee is computed at read time from the current commitment, so a terms change moves it everywhere at once
> — and when money has already gone out under the old terms the organizer is stopped and made to settle
> the difference rather than allowed to save past it. **Once a payout exists, the fee it charged is
> stored on that payout and is read in preference to the projection.** That is the design, not a lapse: a
> later change to the cycle's fee percent must never silently rewrite a payout that already happened. It
> can be corrected by hand, and the correction is audited."

Checked against `EQUB_GROUND_TRUTH.md` §2.30 and verbatim modulo line wrapping. It governs directly: it
names the preference order between the stored fee and the projection.

**What a human sees.** After any fee-percent correction, one payout carries two different fees on two of
the organizer's screens, and the wrong one is the one frozen into the permanent audit entry when he
removes the member. On the member's side — and this half needs no cycle edit at all — a stopped member
holding an uncollected payout is told on their own portal that they were not drawn and are owed their
money back less a fee the payout beside them already withheld.

---

### A8. Payout gross, one lucky number — **RESOLVED**

**Implementations**

- `lib/wheel.ts:538` — per STORED LuckyNumber row
  ```
    const gross = input.luckyNumber.amount * input.participation.weeksCommitted;
  ```
  What the draw writes, what the member's portal shows, what the waiting list totals and what the
  profile's per-number table prints.
- `lib/fee-preview.ts:79` and `:88-93` — per RE-SPLIT of `Participation.weeklyAmount`
  ```
      amounts = splitIntoLuckyNumbers(weeklyAmount, unitAmount);
      const p = calculatePayout({
        luckyNumber: { id: `preview-${i}`, amount },
        participation: { weeksCommitted },
        cycle: { feePercent },
      });
  ```
  Sums to weeklyAmount × weeks exactly, because `splitIntoLuckyNumbers`' outputs sum back to the weekly
  (`lib/money.ts:67-69`, pinned at `lib/money.test.ts:40-45`). It never reads a LuckyNumber row.
- `lib/final-position.ts:135` — member total, inline, no overflow guard
  ```
    const committed = input.weeklyAmount * input.weeksCommitted;
  ```
- `lib/participation-removal.ts:100` — member total, inline, the fee basis for removal
  ```
    const gross = a.weeklyAmount * a.weeksCommitted;
  ```
- `app/actions/agreement.ts:127` — member total, inline, printed in the signed document
  ```
      totalContribution: participation.weeklyAmount * participation.weeksCommitted,
  ```
- `app/actions/edits.ts:534` — **THE WRITE THAT BREAKS THE TIE BETWEEN THE TWO BASES**
  ```
            weeklyAmount: input.weeklyAmount,
  ```
  RE-VERIFIED INDEPENDENTLY: every occurrence of `luckyNumber` inside `updateParticipation`
  (`app/actions/edits.ts:247-570`) is a read — `:271`, `:291`, `:292`, `:299`, `:302`, `:308`, `:311`,
  `:324`, `:332`, `:340` — and there is no write to `LuckyNumber.amount` anywhere in the function.
  Confirmed a second way: `splitIntoLuckyNumbers` has exactly three non-test callers in the repo —
  `app/actions/participations.ts:92` (create), `app/admin/(protected)/cycle/add/add-member-wizard.tsx:194`
  (the wizard) and `lib/fee-preview.ts:79` (preview only). No edit path re-splits.
- `lib/lucky-numbers.ts:141-151` — the MIRROR of that write, and it is enforced
  ```
    if (input.payoutCount > 0) {
      return {
        refusal:
          `${input.memberName} has already been drawn, and this would change their weekly ` +
          `contribution from ${money(input.storedWeekly)} to ${money(impliedWeekly)} — which ` +
  ```
  Editing a lucky number's amount reconciles the participation's weekly to the sum of the numbers, or
  refuses outright if a payout exists. The invariant is stated at `:73` — `// THE CONTRIBUTION INVARIANT:
  a member's numbers ARE their weekly amount.` — and guarded in exactly one of its two directions.
- `app/admin/(protected)/people/[id]/participation-editor.tsx:1011-1013` and `:1022` — the editor that
  performs the breaking write states the broken invariant on screen
  ```
              THE AMOUNTS ARE SLICES, NOT COPIES (lib/money.ts
              splitIntoLuckyNumbers): they sum to the weekly amount, so a member
              with ONE number carries the whole weekly in it
                  ? "One number carries their whole weekly amount."
  ```
  After a weekly-amount edit the rendered sentence at `:1022` is simply false (§5.5), and it is the
  sentence the organizer would use to reassure himself.

**Divergence proof.** Cycle 1, unit $1,000 (100,000c), feePercent 2. Hana joins at $1,000/week for 20
weeks; `app/actions/participations.ts:92` splits that into one amount and `:162-168` creates lucky number
#12 with amount 100,000. Everything agrees. The organizer then opens her participation editor and raises
the weekly to $1,500 (150,000c). She is undrawn, so the settlement gate at `app/actions/edits.ts:346`
`      if (payouts.length > 0 && termsChanged) {` never fires; `:534` writes weeklyAmount 150,000 and her
lucky number row stays at 100,000. **On the same profile page after the save:** the fee calculator
(`participation-editor.tsx:740-745 → components/admin/fee-calculator.tsx:42 → feePreview`; the field
initialises from the stored weekly at `participation-editor.tsx:247`) reads "$1,500 a week for 20 weeks:
they receive $30,000, my fee is $600, they get $29,400", while the payout equation and the per-number
table below it (`page.tsx:325-327` and `:714-733`, off `calculatePayout` over the stored row) read gross
$20,000, fee $400, net $19,600. Her `/me` portal shows $19,600 (`app/actions/member.ts:283-284`, over
`luckyNumber: { id: n.id, amount: n.amount }` at `:268`). Her signed agreement re-renders at $30,000 /
$600 / $29,400 (`app/actions/agreement.ts:76`, `:127-130`). Her weekly bill is $1,500 — `lib/rebuild.ts:89`
and `:109` read `amountDue: participation.weeklyAmount` — so she pays $30,000 in and her number can win
$20,000. **The gap is $10,000** and every screen is internally consistent about its own half.

**Ruling.** Correct: `lib/fee-preview.ts:79-104` — the weekly × weeks-committed basis, sliced per number,
that §2.30 names; the defect is at the write, `app/actions/edits.ts:534`. Wrong:
`app/actions/edits.ts:534` (writes a weeklyAmount the member's lucky numbers no longer sum to, with
neither the re-split nor the refusal `lib/lucky-numbers.ts:141-151` applies in the opposite direction —
which of those two remedies to adopt is an implementation choice the rule does not dictate; the mirror
supplies the shape); `lib/fee-preview.test.ts:99-112` (the test that is supposed to pin
agreement-with-portal models the portal as
`      const portal = splitIntoLuckyNumbers(weekly, UNIT).map((amount, i) =>` at `:101` rather than the
member's stored rows, so it passes precisely because it re-splits too);
`participation-editor.tsx:1022` (prints "One number carries their whole weekly amount." on the screen that
just stopped making it true).

> §2.30: "> gross = weekly amount × weeks **committed**  ·  fee = the cycle's fee percent × gross" — and,
> in the same section: "- Change the **terms** and the fee moves with them: 20 weeks at $250 is a $5,000
> gross and a $100 fee. **Either** term moves it — the rate or the number of weeks."
>
> §2.14's derived table: "| Fee (projected) | the cycle's fee percent × gross, where gross is **weekly
> amount × weeks COMMITTED** — never weeks paid (§2.30). 2% today, but read from the cycle, never a
> constant. |"

Together with §2.30's "Per lucky number … its own amount" these require the numbers to be slices of the
weekly, which is precisely the invariant this write breaks.

**What a human sees.** A member whose weekly amount is ever edited upward is billed at the new rate and
paid out at the old one. She reads one payout on her portal, signs an agreement quoting another, and the
organizer sees both figures on one screen, twelve inches apart, with nothing marking either as stale —
under a card that tells him the two cannot disagree.

---

### A9. Member's whole projected payout (gross / fee / net across all their numbers) — **RESOLVED**

**Implementations**

- `lib/fee-preview.ts:102-104` — sums per-number lines built from a RE-SPLIT of the current weeklyAmount
  ```
      gross: numbers.reduce((s, n) => s + n.gross, 0),
      fee: numbers.reduce((s, n) => s + n.fee, 0),
      net: numbers.reduce((s, n) => s + n.net, 0),
  ```
  Pure projection — never consults a payout row. Feeds the fee calculator, the signed agreement and
  `feeOnReturn` (the only three non-test callers of `feePreview`, re-derived by search).
- `app/admin/(protected)/people/[id]/page.tsx:325-328` — sums over the STORED LuckyNumber rows
  ```
              gross: acc.gross + (recorded?.grossAmount ?? projected.gross),
              fee: acc.fee + (recorded?.feeAmount ?? projected.fee),
              net: acc.net + (recorded?.netAmount ?? projected.net),
              settled: acc.settled || recorded !== null,
  ```
  Decides per number whether the recorded payout or the projection is the term. **Mixes a live net
  (already decremented by settlements and deductions) with a projected gross and fee inside one total.**
- `app/actions/waiting.ts:193-197` — its own reduce over the member's UNDRAWN stored numbers only
  ```
            return {
              gross: acc.gross + payout.gross,
              fee: acc.fee + payout.fee,
              net: acc.net + payout.net,
            };
  ```
- `app/me/page.tsx:237` — the member's own headline figure, net only
  ```
    const payoutNet = p.numbers.reduce((sum, n) => sum + n.netAmount, 0);
  ```
  Over rows whose netAmount is `payout?.netAmount ?? projected.net` (`app/actions/member.ts:283`).
- `components/member/member-payout-card.tsx:30` — the same reduce a second time over the same array
  ```
    const totalNet = numbers.reduce((sum, n) => sum + n.netAmount, 0);
  ```
  `app/me/page.tsx:266` passes `numbers={p.numbers}`, so the two are provably equal. Rendered at `:42` as
  `            {formatMoney(totalNet)} when drawn, after the fee`.
- `components/admin/payout-equation.tsx:56-60` — renders the mixed total AS AN EQUATION
  ```
          <Figure label="They receive" amount={gross} tone="plain" />
          <Operator>−</Operator>
          <Figure label={`Fee (${feePercent}%)`} amount={fee} tone="fee" />
          <Operator>=</Operator>
          <Figure label="They get" amount={net} tone="net" emphasis />
  ```
  Restates it as arithmetic for screen readers at `:73-74`. Fed gross, fee and net separately and asserts
  a relation between them that its caller does not maintain. Surface re-derived: imported at
  `people/[id]/page.tsx:11` and used at `:633` — the sole render site.

**Divergence proof.** Abebe, one number #7 at $1,000/week, weeksCommitted 20, feePercent 2, drawn on week
6 with week 6 unpaid. `settleWinnerWeeks` decrements his net by his own week's $1,000
(`lib/draw-settlement.ts:156-158`), so the row holds gross 2,000,000c, fee 40,000c, net 1,860,000c.
`payoutTotals` (`page.tsx:325-327`) takes recorded gross 2,000,000, recorded fee 40,000, recorded net
1,860,000, and `PayoutEquation` prints "They receive $20,000 − Fee (2%) $400 = They get $18,600", with the
screen-reader sentence at `:73-74` "$20,000.00 gross, minus a 2% fee of $400.00, leaves $18,600.00 for the
member." **$20,000 − $400 = $19,600.** The equation is false by exactly his own week's contribution, on
every drawn member whose win week settled from their payout — which is every drawn member who had not
already paid that week. The second divergence on this quantity is the stale-split one proven in row A8.

**Ruling.** Correct: `lib/fee-preview.ts:102-104` for the projection, and `people/[id]/page.tsx:325-327`'s
recorded-wins preference for a drawn number. Wrong: `components/admin/payout-equation.tsx:56-60`
(presents gross, fee and live net as an equation; the live net has had the win-week settlement and any
carry deduction taken out of it); `components/member/member-payout-card.tsx:42` ("after the fee" describes
a net that is also after the member's own week); `payout-equation.tsx:65-66` ("Projected from their weekly
amount and commitment" describes a derivation the page does not perform — **narrowed**: a wording defect,
not a number defect, since the two agree whenever the split is current and it renders only while
`!settled`, so it is never on screen at the same time as the false equation; it becomes a number defect
only in the stale-split case).

> §2.14: "| Payout | gross − fee, **per lucky number** |"
>
> §2.30: "**Once a payout exists, the fee it charged is stored on that payout and is read in preference to
> the projection.**"

§2.14's table entry governs directly: it states the relation the component draws, which the stored triple
no longer satisfies once a settlement has been taken out of the net.

**What a human sees.** Every drawn member's profile shows an equation that does not add up, by exactly the
amount of their own week's contribution — and the discrepancy looks like a fee error, which is the one
place the organizer will not think to look. On the member's own portal, the card describes the same
reduced figure as being reduced only by the fee.

---
### A10. Payout net, live (`Payout.netAmount` — what actually crosses the table) — **OPEN**

*(Ruling text at OPEN ruling 1. Evidence recorded here.)*

**Implementations**

- `app/actions/wheel.ts:697` — born as gross − fee
  ```
                netAmount: payout.net,
  ```
- `lib/draw-settlement.ts:156-158` — the winner's own-week contribution settled OUT of the net
  ```
        await tx.payout.update({
          where: { id: deduction.payoutId },
          data: { netAmount: { decrement: deduction.deduct } },
  ```
  From here netAmount is gross − fee − settlement, and the paired `PaymentEvent` credits the week.
  Confirmed that a win week already paid settles nothing (`lib/draw-settlement.ts:51-55` and the
  amountDue/plan logic at `:105-110`).
- `app/actions/carry-deduction.ts:204-207` — writes the money half too
  ```
        await tx.payout.update({
          where: { id: payout.id },
          data: { netAmount: applied.data.netAfter },
  ```
  A `LedgerEntry` PAYMENT carrying payoutId at `:211-222`, which is what makes the deduction reversible.
- `app/actions/edits.ts:1981` — free-typed
  ```
            netAmount: input.netAmount,
  ```
  The settlement refusal is `app/actions/edits.ts:1959-1974`, guard at `:1959`
  `      if (settled > 0 && moneyChanged) {`. It fires ONLY when a settlement PaymentEvent exists on this
  payout; with no settlement, gross, fee and net are three independent fields with no relation between
  them.
- `app/admin/(protected)/collections/collections-view.tsx:917-918` — the "Offer: deduct" button
  ```
                    const current = parseDollarsToCents(net) ?? p.netAmount;
                    setNet(String(Math.max(0, current - Math.min(p.outstanding, current)) / 100));
  ```
  Under "They currently owe … on their weeks. You may hand over the full amount, or deduct" (`:911-913`).
  `saveEdit` (`:595-639`) then calls `updatePayout` with the typed net and writes no Payment, no
  PaymentEvent and no LedgerEntry.
- `app/actions/week-winners.ts:511` — `movePayoutToWeek` RESETS the net to gross − fee
  ```
          data: { drawId: targetDraw!.id, netAmount: payout.grossAmount - payout.feeAmount },
  ```
  It restores the two deductions it knows about — `unsettlePayout` at `:460` and `reverseCarryDeduction`
  at `:465` — and knows nothing about a hand-typed one, because a hand-typed one leaves no row to find.
- `app/actions/edits.ts:515` — the resize credit when a weekly changes
  ```
                data: { netAmount: { increment: credit } },
  ```
  The settled week's new cost moves between the receipt and the payout, conserved
  (`lib/settlement.ts:216-217`).

**Divergence proof.** Abebe, one number #7 at $1,000/week, 20 weeks, 2%, drawn on a week he had already
paid, so nothing settled (`lib/draw-settlement.ts:51-55`: "A week that is skipped, deferred, outside the
member's window, or already covered settles nothing."): stored gross 2,000,000c, fee 40,000c, net
1,960,000c. He owes $600 (60,000c) on weeks 2 and 3. The organizer presses "Offer: deduct $600.00" on
Collections and saves — `collections-view.tsx:917-918` computes 1,900,000c and `updatePayout` stores it
(settled === 0, so the refusal at `edits.ts:1959` does not fire). Two things diverge. (1) Weeks 2 and 3
still read as owed everywhere, because nothing was written against them; his standing still says $600
outstanding while the organizer has kept the $600. The $600 exists in no receipt and no ledger entry.
(2) He then moves the payout to another week: `week-winners.ts:511` writes netAmount = 2,000,000 − 40,000
= 1,960,000. `reverseCarryDeduction` at `:465` finds no LedgerEntry with this payoutId and reverses
nothing, so the deduction is silently undone.

*Correction to an earlier draft:* the audit entry is not silent about the change —
`app/actions/week-winners.ts:548-549` records
`        before: { weekNumber: fromWeek.weekNumber, net: payout.netAmount },` /
`        after: { weekNumber: toWeek.weekNumber, net: after.netAmount, createdDraw },` and the summary
states "payout now $X net". What it cannot record is the CAUSE, because the deduction it is undoing never
existed as a row. Compare the carry-deduction path, which for the same shape of decision writes a
LedgerEntry and is therefore both recorded and reversible.

**Why OPEN.** §2.18 sanctions the offer and nothing more — "**Winning while owing NEVER auto-deducts.**
If someone wins $20,000 while owing $5,000, the organizer may still hand over the full $20,000. The system
shows the balance and *offers* to deduct. The decision is human, always." — and says nothing about what
the acceptance writes. §2.15 and §2.19 would govern completely IF this deduction counts as money RECEIVED
from the member ("Money can be recorded from the week view (during the cycle) or from the member profile
(any time). Both run the identical oldest-first allocation (2.15).") — but Collections is neither of those
two entry points, and whether keeping money out of a payout is a receipt at all is exactly the
classification nobody has ruled on. That classification is the ruling.

**What a human sees.** A member is handed less than his payout and is still chased for the same money; the
difference appears in no record. And a payout later moved to another week quietly gives the deduction
back, with an audit line that states the change and cannot state the cause.

---

### A11. Is a given week inside a member's window — the break hole — **OPEN**

*(Ruling text at OPEN ruling 2, jointly with row A18. Evidence recorded here.)*

**Implementations**

- `lib/participation-close.ts:120-124` — canonical, break-aware
  ```
  export function inWindow(p: ClosableWindow, weekNumber: number): boolean {
    if (weekNumber < p.startWeek) return false;
    if (weekNumber > calculateFinishWeek(p.startWeek, p.weeksCommitted)) return false;
    return !inBreak(p.breaks, weekNumber);
  }
  ```
  Re-derived by grep: imported by exactly THREE non-test files — `lib/dashboard.ts:14`,
  `app/admin/(protected)/cycle/position/week-dates.ts:9`, `app/actions/participation-close.ts:42`.
- `lib/dashboard.ts:245` — `weekReceipts` uses it
  ```
      const inWindow = inMemberWindow(participation, weekNumber);
  ```
  The group's per-week `expected` and `membersExpected` DO respect break holes.
- `lib/dashboard.ts:544-550` — `memberAttention` does not
  ```
      for (
        let n = participation.startWeek;
        n <= Math.min(input.elapsedThroughWeek, finishWeek);
        n++
      ) {
        dueWeeks.add(n);
      }
  ```
  Same file, same dashboard response (`app/actions/dashboard.ts:161` receiptsByWeek, `:181`
  memberAttention), fed the same breaks array — and only skips members with an OPEN break (`:531`). A
  CLOSED break's weeks are counted as due.
- `app/actions/member.ts:241` — the `/me` standing window, break-unaware
  ```
          .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
  ```
  **Correction to an earlier draft**, which claimed "none of the nine computeStanding call sites passes
  breaks": `app/actions/participation-close.ts:102-113` DOES — it filters windowWeeks through `inWindow`
  with the member's breaks plus the pending close. The break-unaware sites are
  `lib/messaging-engine.ts:121`, `app/actions/payments.ts:53`, `app/actions/payments-view.ts:63` and
  `:255`, `app/actions/cycle-close.ts:70`, `app/actions/waiting.ts:169`,
  `app/admin/(protected)/collections/page.tsx:112`, plus two omitted before —
  `app/actions/cycle-position.ts:178` (a range to `effectiveFinishWeek`: truncation-aware, hole-blind) and
  `lib/rebuild.ts:39` (which decides where money LANDS).
- `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:59-61` — the view
  does not join `participation_breaks` at all
  ```
    WHERE w."cycleId" = pt."cycleId"
      AND w."weekNumber" >= pt."startWeek"
      AND w."weekNumber" <  pt."startWeek" + pt."weeksCommitted"
  ```

**Divergence proof.** Meron: startWeek 1, weeksCommitted 20, $500/week. She stopped at week 9 and came
back at week 12, so her stored break is `{fromWeek 9, toWeek 11}`; ACTIVE again. She has paid $5,000.
Today 2026-08-14, `elapsedThroughWeek` = 13 (week 13 dated 2026-08-09, +5 = 2026-08-14).

- (a) `lib/dashboard.ts:245` — weeks 9, 10 and 11 do not expect her $500, so the cycle's `expected` for
  those three weeks is $1,500 lower and she is absent from `membersExpected`.
- (b) `lib/dashboard.ts:544-550`, SAME response — her break is CLOSED so `:531` does not skip her;
  dueWeeks = {1..13}, elapsedCount 13; credited = floor(500000/50000) = 10; behind = 13 − 0 − 10 = 3;
  owed = 13×$500 − $5,000 = $1,500. `app/admin/(protected)/page.tsx:283` prints "Meron · 3 behind ·
  $1,500.00 owed" — including week 11, which the Expected column beside it never asked her for.
- (c) `app/actions/member.ts:241` — her `/me` window is weeks 1-20 with no hole. Oldest-first coverage
  puts her $5,000 on weeks 1-10, so weeks 11, 12 and 13 are elapsed and uncovered and read LATE
  (`lib/standing.ts:209`). Week 11 is inside her recorded break and reads LATE on her own portal;
  lateCount = 3.

**Why OPEN.** **Correction to an earlier draft**, which said the hole rule "exists only as a code comment
at `lib/participation-close.ts:109-115`". It is also written into `EQUB_GROUND_TRUTH.md` §4.1: "| Mid-cycle
participation close | Done — `ParticipationBreak`, gaps are holes not cutoffs (rule 17) |". This is still
recorded OPEN rather than upgraded, for two reasons: §4.1 is the CURRENT STATE build-status table, not §2
law, and it describes what was built rather than ruling what is right; and §2.18 pulls the other way in §2
itself — "**Unpaid means owed.** A week stops being owed only when it is marked paid. Nothing else clears
it." Oli should know the hole rule is written down before he rules, but the document does not settle which
figure wins.

**What a human sees.** How many weeks a returned member is told they are behind and how much they owe — on
their own portal, in the `{weeksBehind}`/`{amountOwed}` of any chase message (`lib/messages.ts:311-312`),
and on the organizer's attention list.

---

### A12. Is a given week inside a member's window — whose rows the SQL view counts at all — **RESOLVED**

**Implementations**

- `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:43-44` + `:64-66`
  ```
  FROM public.participations pt
  JOIN public.people per ON per.id = pt."personId"
  ```
  Confirmed by reading the whole view: there is no `pt."status"` predicate and no `participation_breaks`
  join anywhere. The only WHERE is the cycle scope at `:64-66`. **A CLOSED participation is a row in
  `member_progress`.**
- `app/actions/member.ts:414-417` — the `/me/group` read, no status filter client-side either
  ```
        .from("member_progress")
        .select("cycle_id, participation_id, name_amharic, name_english_first, weeks_paid, weeks_behind")
        .eq("cycle_id", cycle.id);
  ```
  Every row becomes a peer at `:452-458`, a denominator at `:459` and a candidate for `:460`.
- `lib/dashboard.ts:531` — the TypeScript rule
  ```
      if ((participation.breaks ?? []).some((b) => b.toWeek === null)) continue;
  ```
  A member with an open break leaves the behind list entirely.
- `app/actions/cycle-position.ts:239-243` — stopped members reported as their own cluster
  ```
        const closedAtWeek = effectiveFinishWeek({
          startWeek: p.startWeek,
          weeksCommitted: p.weeksCommitted,
          breaks: breaksOf(p),
        });
  ```

**Divergence proof.** Tsion: startWeek 1, weeksCommitted 20, $500/week, participation CLOSED at week 12
with break `{fromWeek 13, toWeek null}`; paid $6,000 (12 weeks). Today 2026-08-14; week 13 is dated
2026-08-09 so weeks 1-13 have all passed their 5-day window and week 14 (2026-08-16) has not.

`member_progress`: elapsed = 13 (weeks 1-13, all inside [1, 21), all with date+5 ≤ current_date); excused
= 0; floor(600000/50000) = 12; weeks_behind = greatest(0, 13 − 0 − 12) = **1** — and it grows by one every
week for the rest of the cycle. `components/member/member-group-list.tsx:186` renders
`<BehindPill count={m.weeksBehind} />` for her to all 26 other members; she is in `totalMembers`
(`app/actions/member.ts:459`) and excluded from `currentCount` (`:460`).

Meanwhile `lib/dashboard.ts:531` drops her from the organizer's behind list entirely and
`app/actions/cycle-position.ts:239` reports her as stopped at week 12, with
`lib/participation-close.ts:352-382` composing "Tsion stopped at week 12. Nothing further was expected
from them."

**Ruling.** Correct: `lib/dashboard.ts:531` / `app/actions/cycle-position.ts:239` — a member with an open
break stops accruing arrears at the week they stopped. Wrong:
`prisma/migrations/20260806020000_…/migration.sql:43-44` and `:59-61` (no participation status and no break
predicate, so a stopped member accrues a growing weeks_behind); `app/actions/member.ts:414-417` (reads
every row the view returns without filtering, so the stopped member reaches the peer list, totalMembers
and currentCount).

> §2.18: "1. **Early close (manual)** — the organizer knows at week 12 that someone will not continue. He
> marks them as no longer contributing in their profile; the system calculates the remaining weeks at
> their rate and closes their participation."
>
> §2.14's derived table: "| Weeks behind | weeks elapsed in their window − weeks credited |"
>
> §2.27: "2. **The window ends** — removed automatically. Their participation is complete."
>
> §2.18: "- **Closed members stay visible** — not removed from the cycle. They keep access to their own
> record and can see where they stopped. Dignity, and a useful record for them."

A closed participation's window has ended, so the weeks after it are not "weeks elapsed in their window",
and §2.18 has already converted the remainder into a balance rather than a running arrears. The visibility
half is settled by the same section.

**What a human sees.** A member who stopped is shown to every other member as falling one week further
behind every week, on the one screen §2.8 makes public — while her own `/me` renders the read-only "where
they stopped" statement saying nothing further was expected.

---

### A13. Has this week's payment window closed (the elapsed boundary) — **OPEN**

*(Ruling text at OPEN ruling 7. Evidence recorded here. The four TypeScript copies are separately
adjudicated EQUIVALENT as Part C row C11.)*

**Implementations**

- `lib/derived.ts:77-78` — `weekHasElapsed`
  ```
    const daysSinceWeekOpened = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
    return daysSinceWeekOpened >= windowDays;
  ```
  `windowDays` defaults to `PAYMENT_WINDOW_DAYS = 5` (`lib/derived.ts:13`). `utcDay` is the UTC calendar
  day (`lib/derived.ts:53-55`).
- `lib/derived.ts:194-195` — `paymentStatus`, character-identical arithmetic written out again two
  functions below the one that owns it
  ```
    const daysSinceWeekOpened = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
    const windowClosed = daysSinceWeekOpened >= windowDays;
  ```
- `lib/derived.ts:252` + `:257` — `manualLateAdvice`, third copy in the same file
  ```
    const days = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
  ```
- `app/actions/dashboard.ts:224` — an addition rather than a subtract-and-floor
  ```
          const closed = utcDay(today) >= utcDay(week.date) + PAYMENT_WINDOW_DAYS * MS_PER_DAY;
  ```
  Over a locally redeclared `MS_PER_DAY` (`:29`) and `utcDay` (`:30-32`). Drives `closedShortfalls` only.
- `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:62`
  ```
      AND current_date >= (w.date::date + 5)
  ```
  `current_date` is the date in the Postgres session's `TimeZone`. `weeks.date` is `TIMESTAMP(3)` —
  without time zone (`prisma/migrations/20260804172305_init/migration.sql:53`
  `    "date" TIMESTAMP(3) NOT NULL,`) — so `w.date::date` is a pure truncation equal to the UTC day, but
  the left-hand side is not.

**Divergence proof.** The four TypeScript copies are provably identical: `utcDay` returns
`Date.UTC(y,m,d)`, always an exact multiple of 86,400,000, so the difference of two `utcDay` values is an
exact multiple of `MS_PER_DAY`, the floor is exact, and `diff/MS_PER_DAY >= 5 ⟺ diff >= 5*MS_PER_DAY`.
Every `windowClosesDays` override in the repo was checked: the only non-default callers are
`app/admin/(protected)/cycle/position/week-dates.ts:159`, `:303` and `:308`, all inside the what-if
preview for changing a week's date — no money path passes anything but 5, so the SQL's bare literal 5
cannot diverge from `PAYMENT_WINDOW_DAYS` today.

The SQL can differ, **contingently**. If the deployed Postgres session TimeZone is America/New_York, then
between 00:00 and 04:00 UTC `current_date` is one day BEHIND `utcDay(new Date())`. Week 13 dated
2026-08-09: at 2026-08-14T01:00Z the TypeScript computes daysSince = 5 ≥ 5, so the week is elapsed and
reads LATE on `/me` and on the payments grid; the view computes current_date = 2026-08-13 < 2026-08-14, so
it is not elapsed and weeks_behind on `/me/group` is one lower. **This audit queries no database and could
not verify the deployed TimeZone**; Supabase's default is UTC, so this may never fire. It is recorded as a
ruling that is needed rather than as a live defect.

**What a human sees.** CONTINGENT on the deployed TimeZone. If it is not UTC, then for a window of hours
each day `/me` shows a week as LATE and counts it in the outstanding balance while `/me/group`'s
behind-count does not. If it is UTC, nothing changes and this row is a §5.10 duplication only.

---

### A14. Does this week COUNT AS DUE NOW (the gate behind weeks-behind and outstanding) — **RESOLVED**

**Implementations**

- `lib/derived.ts:113-114` — `weekCountsAsDue`
  ```
    if (args.markedLate && !args.isDeferred) return true;
    return weekHasElapsed(args);
  ```
  The calendar OR the organizer's own mark, with deferral outranking the mark.
- `lib/standing.ts:164-173` — `computeStanding`
  ```
    const elapsed = windowWeeks.filter((w) =>
      weekCountsAsDue({
        weekDate: w.date,
        today,
        markedLate: w.markedLate,
        // Deferral beats the mark (ruling, Aug 2026) — a deferred week is one he
        // has decided not to chase, so a mark on it does not pull it forward.
        isDeferred: w.isDeferred,
      }),
    );
  ```
  Feeds `/me`, the person page, messages, payments, cycle position, cycle close, waiting and collections.
  The mark reaches it as `markedLate: payment?.markedLateAt != null` at `app/actions/member.ts:250` and at
  every other call site.
- `prisma/migrations/20260806020000_…/migration.sql:52-63` — pure calendar
  ```
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS elapsed,
      -- ONLY a cycle-wide skip is excused. A personal deferral is still owed
      -- (Aug 2026 ruling) — it only stops the chasing, never the debt.
      count(*) FILTER (WHERE w."isSkipped") AS excused
    FROM public.weeks w
    WHERE w."cycleId" = pt."cycleId"
      AND w."weekNumber" >= pt."startWeek"
      AND w."weekNumber" <  pt."startWeek" + pt."weeksCommitted"
      AND current_date >= (w.date::date + 5)
  ) closed ON true
  ```
  The whole view was grepped: `payments.markedLateAt` is never read, so the organizer's own mark has no
  effect on `/me/group`. The excused term correctly matches `lib/derived.ts` (only `isSkipped`).
- `lib/dashboard.ts:551-558` — `memberAttention`, mark-aware and correct on deferral
  ```
      for (const r of rows) {
        // DEFERRAL BEATS THE MARK (ruling, Aug 2026) — the same test
        // `weekCountsAsDue` makes, kept identical here so the attention list and
        // computeStanding cannot disagree about who is behind.
        if (r.markedLate && r.isDeferred) continue;
        if (r.markedLate && r.weekNumber >= participation.startWeek && r.weekNumber <= finishWeek) {
          dueWeeks.add(r.weekNumber);
        }
      }
  ```
  Its calendar half is a week-NUMBER range (`:544-550`), not each row's own date — the separate OPEN row
  A15.
- `scripts/verify-member-privileges.mts:89` — mark-blind, and deferral-excusing at `:90-93`
  ```
    const closed = windowWeeks.filter((w) => utcDay(today) >= utcDay(w.date) + 5 * MS_PER_DAY);
  ```
  The only guard on this pair, and it cannot see the gap.

**Divergence proof.** Tsion: startWeek 1, weeksCommitted 20, $500/week, ACTIVE. Week 13 is dated
2026-08-09 and week 14 2026-08-16. Today 2026-08-14. She has paid exactly $6,500 = 13 weeks. On Monday
2026-08-10 she told the organizer week 14 is not coming and he marked it late by hand —
`payments.markedLateAt` set on her week-14 row, isDeferred false (a FUTURE mark, which §2.29 and
`lib/derived.ts:263-268` both permit with a warning).

`/me/group` (SQL): `closed.elapsed` counts weeks 1-13 (week 13's date + 5 = 2026-08-14 ≤ current_date;
week 14's = 2026-08-21 > current_date) = 13. excused = 0. floor(650000/50000) = 13. weeks_behind =
greatest(0, 13 − 0 − 13) = **0** → `components/member/member-group-list.tsx:186` renders the green
`<CurrentPill />` and `app/actions/member.ts:460` counts her in "current this week".

The TypeScript (`computeStanding`): elapsed = {weeks 1-13 by calendar} ∪ {week 14, because
`markedLate && !isDeferred`} = 14. credited = 13. skippedElapsed = 0. weeksBehind = max(0, 14 − 0 − 13) =
**1**.

Same member, same instant: 0 versus 1. `app/admin/(protected)/people/[id]/page.tsx:375-377` prints "Weeks
behind: 1 · needs catching up"; memberAttention agrees so `app/admin/(protected)/page.tsx:283` prints "1
behind · $500.00 owed"; a BEHIND_NOTICE fills `{weeksBehind}` with 1 (`lib/messages.ts:311` via
`lib/messaging-engine.ts:179`) — and the group page she opens next shows her a green Current pill.

**Ruling.** Correct: `lib/derived.ts:95-115` (`weekCountsAsDue`), applied at `lib/standing.ts:164` and
mirrored at `lib/dashboard.ts:551-558`. Wrong:
`prisma/migrations/20260806020000_…/migration.sql:52-63` (never reads `payments.markedLateAt`, so §2.29's
arithmetic effect cannot reach the `/me/group` path); `scripts/verify-member-privileges.mts:89` (the only
guard on this pair, and it is mark-blind too, so it cannot see the gap).

> §2.14, derived table: "| Late | unpaid **and** either the window has closed **or** the organizer marked
> it late himself (§2.29). Deferral outranks both. |"
>
> §2.29, effect 2 of five: "| 2 | **Arithmetic** | A mark cannot pull a not-yet-due deferred week forward,
> and the attention list applies the same test — so the list and the standing derivation cannot disagree.
> An *elapsed* deferred week still counts as owed: deferral has never excused the money. |"

**What a human sees.** A member the organizer has recorded as late is shown a green "Current" pill on the
group page and counted in "N/M current this week", while the chase message he is about to send her says
she is 1 week behind and owes $500.

---

### A15. Weeks elapsed in a member's own window (the count that is subtracted from) — **OPEN**

*(Ruling text at OPEN ruling 6. Evidence recorded here.)*

**Implementations**

- `lib/standing.ts:164` + `:192` — canonical, counts week ROWS against their OWN stored dates
  ```
      weeksElapsedInWindow: elapsed.length,
  ```
- `lib/commitment.ts:159-165` — `elapsedThroughWeek`, a single MAXIMUM for the whole cycle
  ```
    let last = 0;
    for (const w of weeks) {
      if (Number.isNaN(w.date.getTime())) continue;
      if (!weekHasElapsed({ weekDate: w.date, today, windowClosesDays })) continue;
      if (w.weekNumber > last) last = w.weekNumber;
    }
    return last;
  ```
  Then treated as a range bound by everything downstream.
- `lib/dashboard.ts:561` — counts week NUMBERS in the range built at `:544-550`
  ```
      const elapsedCount = dueWeeks.size;
  ```
  A week whose own date has not passed is counted if a LATER week's date has.
- `lib/dashboard.ts:156` and `:286` — the per-week elapsed stamp, the same range rule written twice in one
  file
  ```
          elapsed: w.weekNumber <= input.elapsedThroughWeek,
  ```
  Identical apart from indentation, same input, so they cannot differ from each other.
- `prisma/migrations/20260806020000_…/migration.sql:54` — row-by-row on each week's own date (predicate at
  `:58-62`)
  ```
      count(*) AS elapsed,
  ```
  The SAME shape as `lib/standing.ts`, and the opposite of `lib/dashboard.ts`'s range.

**Divergence proof.** The organizer corrects week 10's date because that week's draw actually ran a month
later: week 10 moves to 2026-10-04 while weeks 11, 12 and 13 keep 2026-07-26, 2026-08-02 and 2026-08-09.
The codebase knows this state exists — `app/admin/(protected)/cycle/position/week-dates.ts:212` is
`export function outOfSequenceWeeks(rows: readonly WeekDateRow[]): number[] {`. Today 2026-08-14, so
`elapsedThroughWeek` = 13. Abebe: startWeek 1, weeksCommitted 20, $500/week, has paid $4,500 = 9 weeks
(covering weeks 1-9 oldest-first).

`lib/dashboard.ts:544-561` — dueWeeks = {1..13}, elapsedCount 13; credited 9; behind = 13 − 0 − 9 = 4;
owed = 13×$500 − $4,500 = $2,000. `app/admin/(protected)/page.tsx:283` prints "Abebe · 4 behind ·
$2,000.00 owed".

`lib/standing.ts:164` — elapsed = rows whose own date + 5 has passed = weeks 1-9 and 11-13 = 12 (week 10
is dated 2026-10-04); credited 9; behind = 12 − 0 − 9 = 3; outstanding = 12×$500 − $4,500 = $1,500.
`app/admin/(protected)/people/[id]/page.tsx:376` prints "Weeks behind: 3" with $1,500 outstanding beside
it.

Same member, same session: 4 versus 3, and $2,000 versus $1,500. The week grid agrees with `standing.ts`,
so week 10's cell reads UNPAID-with-window-open while week 13 beside it reads LATE.

**Why OPEN.** `lib/commitment.ts:146-153` and the `20260806020000` migration header both argue per-week;
`lib/dashboard.ts:536-542`'s own comment claims `memberAttention` "cannot disagree with computeStanding"
while its calendar half is the range. §2.14 says only "| Weeks behind | weeks elapsed in their window −
weeks credited |" and never defines how elapsed is measured, so it does not settle it.

**What a human sees.** How many weeks behind, and how much owed, the organizer's attention list says a
member is, versus what that member's own profile page says on the same session.

---

### A16. Weeks behind — **RESOLVED**

**Implementations**

- `lib/derived.ts:138-147` — canonical
  ```
  export function weeksBehind(
    weeksElapsedInWindow: number,
    weeksCreditedCount: number,
    skippedCount: number,
  ): number {
    assertCount("weeksElapsedInWindow", weeksElapsedInWindow);
    assertCount("weeksCreditedCount", weeksCreditedCount);
    assertCount("skippedCount", skippedCount);
    return Math.max(0, weeksElapsedInWindow - skippedCount - weeksCreditedCount);
  }
  ```
  Applied at `lib/standing.ts:178` `  const behind = weeksBehind(elapsed.length, credited, skippedElapsed);`
  — elapsed from `weekCountsAsDue` (mark-aware), credited UNCAPPED.
- `prisma/migrations/20260806020000_…/migration.sql:37-42`
  ```
    greatest(
      0,
      coalesce(closed.elapsed, 0)
      - coalesce(closed.excused, 0)
      - floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount")
    )::int AS weeks_behind
  ```
  Same subtraction, same floor at zero, and its credited term is UNCAPPED here (the `least()` cap at
  `:33-36` applies only to `weeks_paid`) — so the arithmetic matches. What differs is what feeds
  `closed.elapsed`: no markedLateAt, no participation status, no breaks.
- `lib/dashboard.ts:566` — calls the canonical function
  ```
      const behind = weeksBehind(elapsedCount, credited, skippedCount);
  ```
  But with `elapsedCount` from its own week-number range (`:544-561`) and `skippedCount` from only the rows
  inside it (`:565`).
- `scripts/verify-member-privileges.mts:96` — a hand-written third copy
  ```
    const expectBehind = Math.max(0, closed.length - excused - credited);
  ```
  Its `excused` (`:90-93`) still counts personal deferrals — the SUPERSEDED rule.

**Divergence proof.** See row A14 for the full construction: Tsion, week 14 (dated 2026-08-16) marked late
by hand and unpaid, weeks 1-13 elapsed, $6,500 paid at $500/week, today 2026-08-14. `lib/derived.ts:138`
via `lib/standing.ts:178` → max(0, 14 − 0 − 13) = **1**. `migration.sql:37-42` → greatest(0, 13 − 0 − 13)
= **0**. The subtraction is identical in both engines; the divergence is entirely in the elapsed term, and
it is the organizer's own §2.29 mark the SQL cannot see.

**Ruling.** Correct: `lib/derived.ts:138-147` fed by `lib/standing.ts:164` (`weekCountsAsDue`). Wrong:
`prisma/migrations/20260806020000_…/migration.sql:52-63` (the elapsed term never reads
`payments.markedLateAt`); `lib/dashboard.ts:544-561` (the elapsed term is a week-number range against a
cycle-wide boundary rather than each row's own date — see row A15, which stays OPEN on that separate
question).

> §2.29 THE MANUAL LATE MARK — HIS OWN, AND DEFERRAL OUTRANKS IT: "| 2 | **Arithmetic** | A mark cannot
> pull a not-yet-due deferred week forward, and the attention list applies the same test — so the list and
> the standing derivation cannot disagree. An *elapsed* deferred week still counts as owed: deferral has
> never excused the money. |"

**What a human sees.** The behind-count on the group page, the amber "{n} behind" pill, the "N/M current
this week" header, and whether a BEHIND_NOTICE is even offered for that member — all one lower than every
organizer surface says.

---

### A17. On track / behind, and how many members are current — **RESOLVED**

**Implementations**

- `app/actions/member.ts:460` — the `/me/group` headline count, over EVERY `member_progress` row
  ```
          currentCount: all.filter((r) => r.weeks_behind === 0).length,
  ```
  Denominator at `:459` `        totalMembers: all.length,`.
- `components/member/member-group-list.tsx:82` and `:166`
  ```
    const viewerOnTrack = (viewer?.weeksBehind ?? 0) === 0;
  ```
  Repeated per peer at `:166` `                  const onTrack = m.weeksBehind === 0;`, both over the SQL
  figure; rendered at `:128` and `:186`.
- `lib/dashboard.ts:567` + `:582` — `memberAttention`
  ```
      if (behind === 0) continue;
  ```
  Paired with `:582` `    if (owed === 0) continue;`, so the organizer's list is behind-AND-owing.
- `lib/messages.ts:732` — the BEHIND_NOTICE applicability gate, over the TypeScript figure
  ```
          return state.weeksBehind > 0
  ```
- `app/actions/messages.ts:438` — the same test written again on the batch path
  ```
            ? loaded.facts.weeksBehind > 0
  ```

**Divergence proof.** Cycle of 27 participations, today 2026-08-14. Tsion is CLOSED (stopped at week 12,
break `{fromWeek 13, toWeek null}`, paid 12 weeks) and Selam is ACTIVE with week 14 marked late by hand and
unpaid, 13 weeks paid — the two constructions of rows A12 and A14. `member_progress` returns 27 rows.
Tsion's weeks_behind = 1 (13 elapsed − 12 credited, growing weekly); Selam's = 0. `/me/group` header:
`currentCount` excludes Tsion and includes Selam → "26/27 current this week", with the amber pill on Tsion.
The organizer's dashboard over the same cycle: Tsion is dropped at `lib/dashboard.ts:531` (open break) and
Selam IS in the attention list at 1 behind, $500 owed. **The group page names the one member the organizer
is NOT waiting on and clears the one he IS** — the exact inverse, on the one screen §2.8 makes public.

**Ruling.** Correct: `lib/dashboard.ts:531` + `:567`. Wrong: `app/actions/member.ts:459-460` (counts over
every `member_progress` row, so a stopped member is a false negative and a hand-marked member a false
positive); `components/member/member-group-list.tsx:82` and `:166` (read the SQL figure, so both pills
inherit both errors).

> §2.29: "| 2 | **Arithmetic** | A mark cannot pull a not-yet-due deferred week forward, and the attention
> list applies the same test — so the list and the standing derivation cannot disagree. An *elapsed*
> deferred week still counts as owed: deferral has never excused the money. |"

This settles the mark half outright. The stopped-member half inherits the ruling in row A12 (§2.18's early
close closing the participation, read with §2.14's "| Weeks behind | weeks elapsed in their window − weeks
credited |").

**What a human sees.** The "26/27 current this week" figure at the top of the one screen every member can
see, and which names carry the amber pill.

---
### A18. Is a given week inside a member's window — the full 22-site census (Pass 1 #2) — **OPEN**

*(Ruling text at OPEN ruling 2, jointly with row A11. This row is the census; A11 is the dashboard-internal
contradiction.)*

**Implementations.** One break-aware predicate; twenty-one flat-range restatements.

- `lib/participation-close.ts:120-124` — canonical, BREAK-AWARE
  ```
  export function inWindow(p: ClosableWindow, weekNumber: number): boolean {
    if (weekNumber < p.startWeek) return false;
    if (weekNumber > calculateFinishWeek(p.startWeek, p.weeksCommitted)) return false;
    return !inBreak(p.breaks, weekNumber);
  }
  ```
  `lib/dashboard.ts:14` `import { inWindow as inMemberWindow, type WindowBreak } from "./participation-close";`
  and `:245` `    const inWindow = inMemberWindow(participation, weekNumber);`.
- `app/actions/member.ts:241` — the member portal's own standing window
  ```
          .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
  ```
- `app/actions/payments.ts:53` — inside `loadMemberWindow` (`:29`), which the file's own comment at `:24-25`
  says feeds "preview, commit, and standing"
  ```
      .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
  ```
- `app/actions/payments-view.ts:63` — inside `standingFor` (`:49`), which `getPaymentsGrid` calls at `:108`
  ```
        .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
  ```
- `app/actions/payments-view.ts:255` — second copy in the same file, inside `getCatchUpWeeks` (`:235`)
  ```
        .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
  ```
  **Corrected:** an earlier draft labelled this "the week board". The week board no longer exists — the file
  says so at `:87-88` `// getWeekBoard (the retired "Record week" view) was removed with that view:`. This
  feeds `components/admin/week-action-panel.tsx:157` and the member profile's catch-up strip.
- `app/actions/waiting.ts:169`
  ```
            .filter((w) => w.weekNumber >= p.startWeek && w.weekNumber <= finishWeek)
  ```
- `app/actions/cycle-close.ts:70` — the close-time final position, the figure that becomes a ledger debt via
  `lib/cycle-close.ts:155`
  ```
          .filter((w) => w.weekNumber >= p.startWeek && w.weekNumber <= finishWeek)
  ```
- `app/actions/cycle-position.ts:178` — caller-bounded; truncates at an OPEN break but cannot see a CLOSED one
  ```
            .filter((w) => w.weekNumber >= p.startWeek && w.weekNumber <= throughWeek)
  ```
  Including the stopped-member call at `:259`
  `        balanceRecorded: standingFor(p, closedAtWeek).amountOutstanding,`.
- `lib/messaging-engine.ts:121` — every WhatsApp statement's standing
  ```
        .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
  ```
- `app/admin/(protected)/collections/page.tsx:112` — the winner's outstanding-balance offer
  ```
            .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
  ```
- `lib/rebuild.ts:39` — decides which weeks the replay allocates money ONTO, so money lands on break weeks
  ```
      .filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)
  ```
- `lib/wheel.ts:49` — **note added:** `:47` `    if (!owner || owner.status !== "ACTIVE") return false;`
  already removes a member with an OPEN break, so only a CLOSED break covering the CURRENT week reaches this
  line. Effectively guarded.
  ```
      return owner.startWeek <= input.currentWeek && input.currentWeek <= finishWeek;
  ```
- `lib/week-winners.ts:162-163` — the winner's own-week settlement amount
  ```
    const inWindow =
      input.weekNumber >= input.candidate.startWeek && input.weekNumber <= finishWeek;
  ```
- `lib/week-winners.ts:209` — `addWinnerRefusal`
  ```
    if (input.week.weekNumber < input.candidate.startWeek || input.week.weekNumber > finishWeek) {
  ```
- `lib/draw-settlement.ts:104` — the write path that settles the winner's week out of the payout
  ```
      const inWindow = weekNumber >= participation.startWeek && weekNumber <= finishWeek;
  ```
- `lib/participation-window.ts:47` — `windowConflicts`
  ```
    const outside = (w: number) => w < input.startWeek || w > finish;
  ```
- `lib/participation-window.ts:123` — `weekInWindowRefusal`, the server-side gate on week-scoped writes
  ```
    if (input.weekNumber >= input.startWeek && input.weekNumber <= finish) return null;
  ```
- `lib/messages.ts:281` — over a startWeek re-derived backwards at `:237`
  ```
      .filter((w) => w.weekNumber >= startWeek && w.weekNumber <= standing.finishWeek)
  ```
- `lib/payments-view.ts:217-218` — drives what each week EXPECTED to collect at `:225`
  ```
          if (week.weekNumber < member.startWeek) return { kind: "before-start" as const };
          if (week.weekNumber > member.finishWeek) return { kind: "after-finish" as const };
  ```
- `lib/dashboard.ts:556` — marked weeks only; `:531` makes the surrounding function OPEN-break-aware, so only
  closed-break holes leak through
  ```
        if (r.markedLate && r.weekNumber >= participation.startWeek && r.weekNumber <= finishWeek) {
  ```
- `app/admin/(protected)/cycle/page.tsx:43-44` — who contributes to this week's pot
  ```
          p.startWeek <= effectiveWeek &&
          effectiveWeek <= calculateFinishWeek(p.startWeek, p.weeksCommitted),
  ```

**Divergence proof.** Tizita: startWeek 1, weeksCommitted 20, weekly $500, status ACTIVE, ONE CLOSED break
covering weeks 6-8. Reachability traced in code: "stop contributing at week 5" writes
`app/actions/participation-close.ts:317-318` `          fromWeek: input.closingAtWeek + 1,` /
`          toWeek: null,` plus status CLOSED; "Reactivate from week 9" (reachable from
`components/admin/close-participation.tsx:150`
`        const result = await reactivateParticipation({ participationId });`) then writes `:480`
`        data: { toWeek: plan.fromWeek - 1, endedAt: new Date() },` and `:485`
`          status: "ACTIVE",`. Today is week 13, so weeks 6-8 have elapsed. Nothing is recorded on weeks 6-8.

- **BREAK-AWARE:** `inWindow(p, 7)` is false, so `lib/dashboard.ts:252`
  `    if (!inWindow || input.isSkipped) continue;` drops her from week 7's `expected` and
  `membersExpected`, and `app/admin/(protected)/cycle/position/week-dates.ts:108`
  `    if (!inWindow(participation, input.weekNumber)) continue;` skips her.
- **BREAK-UNAWARE:** `app/actions/member.ts:241` puts weeks 6, 7 and 8 in her standing window; all three are
  elapsed and unpaid, so `lib/standing.ts:178` and `:179` return weeksBehind +3 and amountOutstanding
  +$1,500.

So `/me` tells Tizita "3 weeks behind, $1,500 overdue", `lib/messaging-engine.ts:121` renders a
BEHIND_NOTICE saying the same, `app/actions/cycle-close.ts:70` feeds a $1,500 outstanding into
`lib/cycle-close.ts:155` `.filter((m) => m.outstanding > 0)` which writes it as a **permanent ledger DEBT**,
and `lib/rebuild.ts:39` will allocate her next payment into weeks 6-8 — while `/admin/this-week` expects
nothing from her for those weeks and the cycle-position shortfall excludes the same $1,500.

**What a human sees.** A reopened member is told by their own portal, and by a WhatsApp behind-notice, that
they owe $1,500 for weeks the organizer's dashboard does not expect a cent of — and at close that $1,500
becomes a permanent ledger debt on the person (§2.18).

---

### A19. Remainder still owed on one week (per-week remainder / tickable) — **RESOLVED**

**Implementations**

- `lib/week-picking.ts:43-46` — canonical
  ```
  export function remainingOn(week: PickableWeek): number {
    if (week.isSkipped) return 0;
    return Math.max(0, week.amountDue - week.amountPaid);
  }
  ```
  Deferred stays owed and tickable (`:38-39`). Skipped is the only zero. **Surface re-derived:** it is fed
  `PickableWeek.amountPaid`, which `components/admin/week-action-panel.tsx:168` maps from
  `amountPaid: w.amountAlreadyPaid,` (`getCatchUpWeeks` → STORED `Payment.amountPaid`), and
  `app/admin/(protected)/payments/patterns-view.tsx:53` maps from `          amountPaid: cell.storedPaid,`.
  So the canonical function is itself on the STORED basis.
- `lib/allocation.ts:91-92` — no clamp; guarded by the `<= 0` test
  ```
      const owed = week.amountDue - week.amountAlreadyPaid;
      if (owed <= 0) continue;
  ```
- `lib/week-selection.ts:21` — deferred deliberately stays selectable
  ```
    return !w.isSkipped && w.amountAlreadyPaid < w.amountDue;
  ```
- `lib/payments-view.ts:64` — `bulkCatchUpAmount`, SKIPPED excused at `:60`, deferred included
  ```
      total += Math.max(0, w.amountDue - w.amountAlreadyPaid);
  ```
  Live at `app/admin/(protected)/people/[id]/member-payments.tsx:97`
  `  const amount = bulkCatchUpAmount(selectedWeeks);`.
- `lib/settlement.ts:43`
  ```
    const shortfall = Math.max(0, input.amountDue - input.alreadyPaidOnWeek);
  ```
- `lib/settlement.ts:72` — the closest line-for-line restatement of `remainingOn` in the repo
  ```
    const owed = week.isSkipped ? 0 : Math.max(0, week.amountDue - week.amountAlreadyPaid);
  ```
- `lib/week-winners.ts:165-166`
  ```
    const remaining = input.candidate.weeklyAmount - (input.alreadyPaid ?? 0);
    return Math.max(0, remaining);
  ```
- `components/admin/week-action-panel.tsx:81` — STORED basis
  ```
    const remaining = Math.max(0, target.amountDue - target.amountAlreadyPaid);
  ```
  `app/admin/(protected)/payments/payments-members.tsx:95` supplies
  `      amountAlreadyPaid: entry.cell.storedPaid,`.
- `app/admin/(protected)/payments/payments-members.tsx:36` — **reaches a screen**
  ```
    const remaining = Math.max(0, cell.amountDue - cell.storedPaid);
  ```
  `:44-45` renders `, ${formatMoney(cell.storedPaid)} of ${formatMoney(cell.amountDue)}` +
  `(remaining > 0 ? ` (${formatMoney(remaining)} left)` : "")` into the cell's title, in the SAME sentence
  as `statusLabel(cell.status)` (`:37`), which is coverage-derived.
- `app/admin/(protected)/payments/payments-members.tsx:218` — reaches the button's own amount at `:277`
  ```
                ? Math.max(0, thisWeekCell.amountDue - thisWeekCell.storedPaid)
  ```
- `app/admin/(protected)/people/[id]/member-payments.tsx:377-378` — `lib/week-selection.ts:21` written out
  again character-for-character
  ```
              const selectable = !w.isSkipped && w.amountAlreadyPaid < w.amountDue;
              const remaining = Math.max(0, w.amountDue - w.amountAlreadyPaid);
  ```
- `app/actions/member.ts:293` — COVERAGE basis, deferred excluded; **not a remainder** — it yields a week
  number and date at `:352`, never an amount
  ```
        (w) => !w.isDeferred && w.coveredAtCurrentRate < w.amountDue,
  ```
- `app/actions/messages.ts:278` — same predicate for the PAYMENT_CONFIRMED preview's sample `weeksCovered`
  ```
            (w) => !w.isDeferred && w.coveredAtCurrentRate < w.amountDue,
  ```
- `lib/payments-view.ts:130` — **DEAD CODE**, removed from the live set
  ```
      if (m.isDeferred || m.amountPaidThisWeek >= m.amountDue) paid.push(m);
  ```
  `splitWeekRoster` is exported and imported at `app/actions/payments-view.ts:8` but never called: `app/`,
  `components/`, `lib/` and `scripts/` were grepped and the only non-test references are the definition and
  that unused import. The file records why, at `app/actions/payments-view.ts:87-91`. Kept as a §5.10 hazard.

**Divergence proof.** Two earlier proofs did **not** survive verification and are replaced.
(a) rested on `lib/payments-view.ts:130`, which is dead code. (b) — "Meheret paid 6 weeks at $250, her rate
moves to $500" — is REFUTED: every write that changes `weeklyAmount` on a participation holding money calls
the replay in the same transaction. `app/actions/edits.ts:531-541`
`      const after = await tx.participation.update({` … `          weeklyAmount: input.weeklyAmount,` …
`      await rebuildParticipationPayments(tx, input.participationId);` (unconditional), and the three
lucky-number reconciliations at `:811`, `:986`, `:1086`
(`            data: { weeklyAmount: reconciliation.impliedWeekly },`) each rebuild at `:813`, `:990`,
`:1088`. A skip-toggle rebuilds every participation in the cycle (`:1717-1724`). The replay zeroes every row
(`lib/rebuild.ts:53`) and re-allocates the events oldest-first at the NEW rate, the identical walk
`computeStanding` performs — so after a rate change stored per-week amounts EQUAL `coveredAtCurrentRate`.

**The proof that does hold is legacy placement,** which `lib/rebuild.ts:13-15` names itself: "Placement
follows the LAW — oldest debt first — so events recorded against" / "hand-placed weeks in the old app
re-derive to the lawful placement when" / "first edited." Concrete input: an IMPORTED member, weekly $500,
startWeek 1, whose old-app rows placed $500 on week 5 and left week 3 unpaid (the old grid let the organizer
pick the week by hand; `scripts/import-cycle.mts:232`
`        const payment = await tx.payment.create({` writes that placement straight through). Nothing has
been edited since, so no rebuild has run.

- COVERAGE (`lib/standing.ts:210` via `allocatePayment` oldest-first): week 3 covered $500, week 5 covered
  $0. Grid cell week 3 status = PAID; week 5 = LATE.
- STORED: week 3 = $0, week 5 = $500.

So `payments-members.tsx:36` renders, in one sentence for week 3, "Paid in full, $0.00 of $500.00 ($500.00
left)"; PaymentEntry offers week 3 as tickable at $500 (`components/admin/payment-entry.tsx:326`
``              ? `Week ${w.weekNumber} — ${formatMoney(remainingOn(w))} still owed` ``) on a week the grid
beside it calls PAID; and `bulkCatchUpAmount` bills $500 for it.

**Honesty limit.** This input is constructible and the codebase documents the condition, but this audit is
read-only and forbidden to query the database, so it could NOT be confirmed that any live cycle-1 member is
actually in that state.

**Ruling.** Correct: `lib/standing.ts:205` `coveredAtCurrentRate` (the §2.15 placement) is the basis;
`lib/week-picking.ts:43` is the correct SHAPE (deferred still owed, skipped zero) but must be fed coverage
rather than the stored row. Wrong: `payments-members.tsx:36` and `:218`, and
`components/admin/week-action-panel.tsx:81` (read the STORED per-week receipt while printing a
coverage-derived status label beside it); `app/actions/payments-view.ts:262`
`          amountAlreadyPaid: payment?.amountPaid ?? 0,` (feeds STORED into the canonical `remainingOn` and
into `bulkCatchUpAmount`).

> §2.15: "1. **Oldest unpaid weeks first**, waterfalling forward."
>
> §2.14: "The system stores **what actually happened**, and calculates everything else. Nothing that can be
> computed is ever stored, because stored values drift and computed values cannot."
>
> §2.14, derived table: "| Weeks credited | total money paid ÷ current weekly amount |"

**What a human sees.** On imported, never-since-edited weeks the grid tooltip and the "Record week N" button
quote a remainder the engine does not agree with, and PaymentEntry offers to collect money for a week the
grid says is already paid.

**Not carried forward.** An earlier claim that `app/actions/member.ts:293` and `app/actions/messages.ts:278`
are WRONG to skip deferred weeks is withdrawn. Those produce a week number, not a remainder, and the rules
do not settle whether an elapsed deferred week should be a member's own "next due" — §2.29 effect 2 says the
money is still owed, effect 3 says the week must never enter a chasing list, and a member's own
next-payment prompt sits between them. That sub-question is carried at OPEN ruling 9.

---

### A20. Who has paid / not paid for one week (the this-week grouping) — **RESOLVED**

**Implementations**

- `lib/dashboard.ts:341` — asks `paymentStatus` rather than re-implementing the ladder, but on the STORED
  amount
  ```
  export function weekMemberStatus(input: {
  ```
  **Corrected characterisation.** Its docstring at `:322-339` records the 13 August defect that came from
  not asking. But it is fed the STORED per-week receipt: `:365`
  `    const amountPaid = payment?.amountPaid ?? 0;` passed straight into `      status: paymentStatus({` at
  `:372-373`. So it lands on the STORED side of the basis fork, not the coverage side.
- `lib/dashboard.ts:257` — bare comparison on STORED cents
  ```
      if ((payment?.amountPaid ?? 0) >= participation.weeklyAmount) membersPaid++;
  ```
  Deferral branch at `:253`, skipped/window branch at `:252`. **Surface re-derived:** `membersPaid` renders
  at `app/admin/(protected)/page.tsx:200`
  `                {d.thisWeek.membersPaid} of {d.thisWeek.membersExpected} paid`, at
  `this-week/page.tsx:115`, and in `components/charts/collected-vs-expected-chart.tsx:329`.
- `app/admin/(protected)/cycle/position/week-dates.ts:111` and `:113`
  ```
      if ((row?.amountPaid ?? 0) >= participation.weeklyAmount) continue;
      // Already late by his own hand — the day is not what decides it (2.2).
      if (row?.markedLate) continue;
  ```
  **Surface re-derived:** the count reaches `week-dates.ts:318` `  const moved = input.row.membersAffectedByDate;`
  and prints at `:368` ``    moved > 0 ? ` — it decides this for ${people(moved)}` : "";``, rendered by
  `week-date-panel.tsx:260`.
- `lib/rebuild.ts:143` — subject is the STORED mark, not a displayed status
  ```
      .filter((s) => s.markedLate && s.paid >= participation.weeklyAmount && s.paymentId)
  ```
- `app/actions/edits.ts:1499` — server-side refusal of a manual late mark on a covered week
  ```
          if ((before?.amountPaid ?? 0) >= participation.weeklyAmount) {
  ```
- `lib/week-selection.ts:21` — the complement, deliberately deferral-blind
  ```
    return !w.isSkipped && w.amountAlreadyPaid < w.amountDue;
  ```
- `app/admin/(protected)/people/[id]/member-payments.tsx:377` — written out again rather than imported
  ```
              const selectable = !w.isSkipped && w.amountAlreadyPaid < w.amountDue;
  ```
- `lib/payments-view.ts:130` — DEAD CODE, removed from the live set (see row A19)
  ```
      if (m.isDeferred || m.amountPaidThisWeek >= m.amountDue) paid.push(m);
  ```
- `lib/chart.ts:193-197` — DEAD CODE
  ```
    if (input.isDeferred) return "deferred";
    if (input.amountPaid >= input.amountDue && input.amountDue > 0) return "paid";
  ```
  `consistencyState` is referenced nowhere outside `lib/chart.test.ts` — the whole tree was grepped. The
  member/admin consistency strip is fed by the MAPPING at `lib/chart.ts:230`
  `export function consistencyFromStatus(` (PAID→paid, DEFERRED→deferred, LATE→overdue), called once at
  `app/admin/(protected)/payments/payments-screen.tsx:184`. `lib/chart.ts:218-221` says so itself.

**Divergence proof — two live, one refuted.**

(a) **DEFERRAL vs THE MARK — survives.** Tizita, weekly $500, week 14 both DEFERRED and carrying a
`markedLateAt`. Reachability confirmed in code: `app/actions/edits.ts:1278`
`          isDeferred: input.isDeferred,` (the participation editor's week-row editor) writes the flag with
no `markedLateAt: null`, while the deferral control at `:1377-1379`
`        update: input.deferred` / `          ? { isDeferred: true, markedLateAt: null, markedLateNote: null }`
/ `          : { isDeferred: false },` does clear it. That is D-40 gap 1, already named in §6.4. Nothing is
recorded on week 14. `lib/derived.ts:191-192` — `  if (args.isDeferred) return "DEFERRED";` then
`  if (args.markedLate) return "LATE";` — so every status-driven screen reads week 14 as DEFERRED and still
owing $500, and `lib/derived.ts:113` `  if (args.markedLate && !args.isDeferred) return true;` keeps the
date as what decides her standing. But `week-dates.ts:113` `    if (row?.markedLate) continue;` drops her
from `membersAffectedByWeekDate`, so moving week 14's date tells the organizer "it decides this for 0
members" when she is one.

(b) **BASIS — survives, on legacy placement only.** Same imported member as row A19: hand-placed $500 on
week 5, week 3 left unpaid, weekly $500, no edit since. `lib/standing.ts:210` hands `paymentStatus` the
re-allocated 50000 for week 3 → "PAID", so the grid cell is PAID. `lib/dashboard.ts:257` compares the stored
0 against 50000 → she is not in `membersPaid` for week 3, and `lib/dashboard.ts:365`/`:372` hands the same
stored 0 to `paymentStatus` → "LATE". `/admin/this-week` lists her as LATE for week 3 while
`/admin/payments` shows the same week PAID.

(c) **REFUTED** — the earlier claim that "week 9 deferred, then $500 lands on it, so the member's
consistency strip shows a deferred dot on a paid week". `consistencyState` is dead; the strip maps from
`paymentStatus`, which returns PAID (`lib/derived.ts:190` sits above `:191`), and `consistencyFromStatus`
maps PAID→"paid". The strip is correct, and it is an ADMIN screen (`/admin/payments` Patterns), not a member
one.

**Ruling.** Correct: `lib/derived.ts:169` (`paymentStatus`), asked rather than re-implemented, AND fed
`lib/standing.ts:205`'s `coveredAtCurrentRate` rather than the stored row. Wrong:
`app/admin/(protected)/cycle/position/week-dates.ts:113` (lets the mark outrank deferral — exactly D-40 gap
2, already recorded in §6.4 as open); `lib/dashboard.ts:257` and `lib/dashboard.ts:365` (compare the STORED
per-week receipt rather than coverage). **Note this corrects an earlier framing:** `weekMemberStatus` asks
the right function but hands it the wrong number.

> §2.29: "**DEFERRAL OUTRANKS THE MARK.** This is the ruling, not an accident of ordering."
>
> §2.29, effects table row 2: "| 2 | **Arithmetic** | A mark cannot pull a not-yet-due deferred week forward,
> and the attention list applies the same test — so the list and the standing derivation cannot disagree. An
> *elapsed* deferred week still counts as owed: deferral has never excused the money. |"
>
> §6.4: "- **One site lets the mark outrank deferral** (D-40 gap 2, found 14 Aug 2026). The" / "  \"who is
> affected by changing this week's date\" count treats a marked-late member as" / "  settled and skips them
> without asking whether a deferral superseded the mark, so a" / "  member in the state gap 1 allows is
> under-counted."
>
> §2.15: "1. **Oldest unpaid weeks first**, waterfalling forward."

**What a human sees.** On any week whose imported placement was not oldest-first, `/admin/this-week` lists a
member as LATE for a week the payments grid calls PAID and drops them from the "N of M paid" count.
Separately, the organizer moving a week's date is told nobody is affected when a deferred-and-marked member
is. **Downgraded from an earlier draft:** the claim that a member's consistency strip contradicts the
receipts is withdrawn — that function has no caller.

---
### A21. Paid in / commitment total / still to save / surplus / progress — **OPEN**

*(Ruling text at OPEN ruling 8. Evidence recorded here.)*

**Implementations**

- `lib/contribution.ts:88-90` and `:103` — canonical, CENTS basis
  ```
    const commitmentTotal = input.weeklyAmount * input.weeksCommitted;
    const stillToSave = Math.max(0, commitmentTotal - paidIn);
    const surplus = Math.max(0, paidIn - commitmentTotal);
  ...
      progress: commitmentTotal > 0 ? Math.min(1, paidIn / commitmentTotal) : 0,
  ```
  Progress is a MONEY fraction: a part-paid week moves it. **Surface re-derived:**
  `components/member/saved-card.tsx:40` `        progress={c.progress}` and `:62`
  `            {formatMoney(c.stillToSave)}` — both rendered on `/me`.
- `lib/money.ts:78-82` — the shared, range-checked product the inline copies bypass
  ```
    const gross = weeklyAmount * weeksCommitted;
    if (!Number.isSafeInteger(gross)) {
      throw new RangeError(`gross overflows safe integer range: ${weeklyAmount} * ${weeksCommitted}`);
    }
  ```
- `lib/final-position.ts:135-137` — inline product, NOT floored
  ```
    const committed = input.weeklyAmount * input.weeksCommitted;
    const unpaid = committed - input.paidIn;
    if (unpaid <= 0) {
  ```
- `lib/dashboard.ts:481` and `:492` — the same product twice, eleven lines apart
  ```
          commitment: p.weeklyAmount * p.weeksCommitted,
  ```
- `lib/participation-removal.ts:100` — inline product, fee basis
  ```
    const gross = a.weeklyAmount * a.weeksCommitted;
  ```
- `app/actions/agreement.ts:127` — inline product, goes into the SIGNED document
  ```
      totalContribution: participation.weeklyAmount * participation.weeksCommitted,
  ```
  Sits directly beside three fields (`:128-130`) that DO come from the shared `feePreview`.
- `components/member/member-personal-summary.tsx:39-40` — WEEKS basis
  ```
    const pct = totalWeeks > 0 ? Math.min(Math.round((paidCount / totalWeeks) * 100), 100) : 0;
    const remainingWeeks = Math.max(0, totalWeeks - paidCount);
  ```
  **Re-derived:** fed from `app/me/page.tsx:259` `        paidCount={p.weeksCredited}` —
  `app/actions/member.ts:349`'s capped `weeksCredited`. A weeks fraction, not a money fraction.
- `app/admin/(protected)/people/people-directory.tsx:259` — WEEKS basis
  ```
                          width: `${Math.min(100, Math.round((p.weeksPaid / p.weeksCommitted) * 100))}%`,
  ```
- `app/admin/(protected)/waiting/waiting-view.tsx:471-472` — WEEKS basis, 0..1
  ```
    const progress =
      row.weeksCommitted > 0 ? Math.min(1, row.weeksPaid / row.weeksCommitted) : 0;
  ```

**Divergence proof.** No dependency on the stored/coverage question. Getahun: weekly $500, 20 weeks
committed, commitmentTotal $10,000. He has paid $9,750 — nineteen full weeks plus $250 sitting as a partial
on week 20. `app/actions/member.ts:343` returns `contribution` with `progress` = 975000/1000000 = 0.975,
`stillToSave` = $250, `surplus` = $0, rendered by `saved-card.tsx:40` and `:62`. The ring beside it on the
same page, `app/me/page.tsx:257-263`, is fed `paidCount={p.weeksCredited}` = min(19, 20) = 19 and
`totalWeeks={p.weeksCommitted}` = 20, so `member-personal-summary.tsx:39` computes **95%** and `:40` computes
`remainingWeeks` = 1. One screen, two completions: 97.5% of the money and 95% of the weeks, with "$250 still
to save" beside "1 week remaining" — and "1 week remaining" is $500 of weeks, not $250.

**Why OPEN.** The documented rules define weeks credited (§2.14) but never define "progress".

**What a human sees.** A member with any part-paid week sees two different completion figures on one portal
screen, and the weeks-based one under-states what they have saved by up to one weekly amount.

---

### A22. Total paid by a member (participation total / total contributed / paid in) — **EQUIVALENT**

**Implementations**

- `lib/contribution.ts:58` — canonical, RECEIPTS basis
  ```
  export function totalContributed(receipts: readonly ContributionReceipt[]): number {
  ```
  Arithmetic at `:62` `    total += r.amount;`, over `PaymentEvent` rows, with
  `    assertCents(`receipt[${i}] amount`, r.amount);` at `:61`.
- `app/actions/payments.ts:390` — WEEK-ROWS basis; feeds `computeStanding`
  ```
        totalPaid: participation.payments.reduce((sum, p) => sum + p.amountPaid, 0),
  ```
- `app/actions/member.ts:156` — RECEIPTS basis, the stopped member's own final statement, no cents assertion
  ```
        const paidIn = stopped.paymentEvents.reduce((sum, e) => sum + e.amount, 0);
  ```
- `app/admin/(protected)/people/[id]/page.tsx:159-162` — RECEIPTS basis, computed by Postgres
  ```
                await prisma.paymentEvent.aggregate({
                  where: { participationId: active.id },
                  _sum: { amount: true },
                })
  ```
  Gated on `active.status === "CLOSED"` (`:155`); feeds `finalPosition`.
- `app/actions/people.ts:91` — WEEK-ROWS basis, computed by Postgres
  ```
      const paid = await prisma.payment.groupBy({
  ```
  With `by: ["participationId"], _sum: { amountPaid: true }` at `:92-93`. **Correction to Pass 1's
  description:** this total is never displayed as money — it is consumed only at `:116`
  `hasEverPaid: (paidTotal.get(p.id) ?? 0) > 0,`, a boolean for the agreement gate. Its unfiltered scope is
  harmless because a Payment belongs to exactly one participation, which belongs to exactly one cycle.
- `lib/messaging-engine.ts:134` — WEEK-ROWS basis; every WhatsApp statement's `{totalPaid}`
  ```
      totalPaid: participation.payments.reduce((sum, p) => sum + p.amountPaid, 0),
  ```
- `app/actions/cycle-close.ts:83` — WEEK-ROWS basis; the archive's per-member figure
  ```
        totalPaid: p.payments.reduce((sum, pm) => sum + pm.amountPaid, 0),
  ```
- `prisma/migrations/20260806020000_…/migration.sql:46` — WEEK-ROWS basis, SQL; the view `/me/group` reads
  ```
    SELECT sum(p."amountPaid") AS total
  ```

**Why EQUIVALENT.** The two bases are held equal by four refusals, each re-read and confirmed verbatim:
(a) `lib/standing.ts:246` `  if (result.unallocated > 0) {` inside `planCommit`, so a receipt whose
allocation leaves a remainder is refused and the event's amount always equals the sum of the increments at
`app/actions/payments.ts:264` `            amountPaid: { increment: a.applied },`;
(b) `lib/rebuild.ts:114-115` `    if (result.unallocated > 0) {` / `      throw new Error(` after zeroing
every row at `:53` `  await tx.payment.updateMany({ where: { participationId }, data: { amountPaid: 0 } });`;
(c) `lib/draw-settlement.ts:115` `    if (plan.unabsorbed > 0) {` with the event at `:125`
`      const event = await tx.paymentEvent.create({` and the increment at `:140`
`          data: { amountPaid: { increment: deduction.deduct } },` in one transaction;
(d) `app/actions/edits.ts:2204` `        if (paymentsOnRemoved > 0 || drawsOnRemoved > 0) {` guarding the
week-delete cascade at `prisma/schema.prisma:319`
`  week            Week          @relation(fields: [weekId], references: [id], onDelete: Cascade)`.

Every remaining write to `Payment.amountPaid` and every `PaymentEvent` delete in the repo was enumerated:
the only other Payment writes are metadata upserts that set `amountPaid: 0` on creation
(`app/actions/edits.ts:1370`, `:1514`, `:1598` — deferral, late mark, note), and every `PaymentEvent` delete
(`edits.ts:510`, `:1228`, `draw-settlement.ts:205`, `:235`) is followed by a rebuild or a matching decrement
in the same transaction. **No input where the two bases differ could be constructed.**

**Worth recording.** The equality is an unnamed invariant with no database constraint and no test asserting
it, and `app/actions/payments.ts:243-244` openly calls `Payment.amountPaid` "a STORED aggregate cache of this
week's allocations" — a fourth stored-but-computable value §2.14 does not list beside `deferred` and
`markedLateAt`.

---

### A23. Weeks credited / weeks paid / weeks covered — **EQUIVALENT**

**Implementations**

- `lib/derived.ts:122` and `:127` — canonical, UNCAPPED
  ```
  export function weeksCredited(totalPaid: number, weeklyAmount: number): number {
  ...
    return Math.floor(totalPaid / weeklyAmount);
  ```
  Throws at `:124-126` if `weeklyAmount < 1`.
- `lib/contribution.ts:91-94` — CAPPED, receipts basis
  ```
    const weeksCovered =
      input.weeklyAmount > 0
        ? Math.min(Math.floor(paidIn / input.weeklyAmount), input.weeksCommitted)
        : 0;
  ```
- `app/actions/member.ts:207-210` — CAPPED, with its own divisor guard where `lib/derived.ts` throws
  ```
              weeksPaid: Math.min(
                Math.floor(paidIn / Math.max(1, stopped.weeklyAmount)),
                stopped.weeksCommitted,
              ),
  ```
- `app/actions/member.ts:349` — CAP only
  ```
            weeksCredited: Math.min(standing.weeksCredited, participation.weeksCommitted),
  ```
- `app/actions/cycle-close.ts:106` — CAP only
  ```
        weeksPaid: Math.min(standing.weeksCredited, p.weeksCommitted),
  ```
- `app/actions/waiting.ts:213` — CAP only, byte-identical
  ```
          weeksPaid: Math.min(standing.weeksCredited, p.weeksCommitted),
  ```
- `lib/messages.ts:218` — CAP only, on the messaging path
  ```
    const weeksPaid = Math.min(standing.weeksCredited, standing.weeksCommitted);
  ```
  `lib/messaging-engine.ts:178` hands `StandingFacts` the UNCAPPED figure
  (`    weeksCredited: standing.weeksCredited,`), so the cap lives only here on that path.
- `app/admin/(protected)/people/page.tsx:64` — UNCAPPED, and a third base
  ```
              weeksPaid: weekly > 0 ? Math.floor(p.contributedThisCycle / weekly) : 0,
  ```
  Divides the `PaymentEvent`-receipt total (`app/actions/people.ts:137`
  `          ? totalContributed(here.paymentEvents.map((e) => ({ amount: e.amount })))`) by the ACTIVE
  participation's weekly (`:60-63`).
- `app/admin/(protected)/payments/payments-members.tsx:256` and `payments-grid.tsx:357` — UNCAPPED admin
  surfaces
  ```
                      {row.weeksCredited} of {row.finishWeek - row.startWeek + 1} weeks
  ```
- `prisma/migrations/20260806020000_…/migration.sql:33-36` — CAPPED, SQL
  ```
    least(
      floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount"),
      pt."weeksCommitted"
    )::int AS weeks_paid,
  ```

**Why EQUIVALENT — and this is a downgrade from an earlier "OPEN / headline".** No divergence could be
constructed, and the reason was traced. **The cap can never bind.** `credited = floor(totalPaid /
weeklyAmount)`, and every write path bounds `totalPaid` by the window's own capacity:

- **Recording:** `app/actions/payments.ts:234-237` runs `planCommit`, which refuses outright —
  `lib/standing.ts:246-253` `if (result.unallocated > 0) { return { ok: false, error: `Only
  ${formatMoney(result.totalApplied)} fits in this member's remaining weeks. ...` }; }`.
- **Every terms change** (weeklyAmount, startWeek, weeksCommitted) runs `app/actions/edits.ts:541`
  `      await rebuildParticipationPayments(tx, input.participationId);` inside the same serializable
  transaction, and `lib/rebuild.ts:114-120` throws `Recalculation failed: the receipt of ... no longer fits
  this member's weeks. Adjust the receipts or the commitment first — nothing was changed.` So a rate cut or a
  shortened commitment that would push credited past committed is REFUSED, not absorbed.
- Rebuild also zeroes EVERY payment row first (`lib/rebuild.ts:53`) and refills only inside the window, so an
  earlier draft's premise — "a Payment row of $500 on a week that is no longer inside her window" — cannot
  survive any terms change that created it.
- The one increment outside those two paths, the winner-week settlement, is capped at the week's own
  remaining due: `lib/draw-settlement.ts:107`
  `    const amountDue = inWindow && !excused ? participation.weeklyAmount : 0;` with
  `lib/settlement.ts:72-73` `  const owed = week.isSkipped ? 0 : Math.max(0, week.amountDue -
  week.amountAlreadyPaid);` / `  const applied = Math.min(amount, owed);`.

So `min()`/`least()` never bite and all surfaces print the same integer. The third base at
`people/page.tsx:64` also agrees, because sum(`PaymentEvent.amount`) = sum(`Payment.amountPaid`) is held by
the same writers (row A22). The one genuine behavioural fork — `weeklyAmount` 0, where `lib/derived.ts:125`
throws, `lib/contribution.ts:94` returns 0, and `app/actions/member.ts:208` returns the CENT COUNT as a week
count — is unreachable: `lib/participation-rules.ts:20` refuses `    f.weeklyAmount < 1 ||` on every create
and update path.

**What remains** is a genuine §5.10 hazard — several separately written clamps, uncapped admin surfaces and
no shared helper — but it is a maintenance hazard, not a divergence. It becomes real the moment anything
writes money outside `planCommit`/`rebuild`, which the import scripts do.

---

### A24. Finish week (a member's own last week, inclusive) — **EQUIVALENT**

**Implementations**

- `lib/money.ts:113-117` — canonical
  ```
  export function calculateFinishWeek(startWeek: number, weeksCommitted: number): number {
    assertPositiveInt("startWeek", startWeek);
    assertPositiveInt("weeksCommitted", weeksCommitted);
    return startWeek + weeksCommitted - 1;
  }
  ```
- `lib/week-winners.ts:161` and `:208` — the same inline arithmetic twice in one file, no guards
  ```
    const finishWeek = input.candidate.startWeek + input.candidate.weeksCommitted - 1;
  ```
- `app/admin/(protected)/people/[id]/participation-editor.tsx:429` — computed inside the refusal sentence the
  organizer reads
  ```
            `Not saved. Week ${input.startWeek + input.weeksCommitted - 1} is past the cycle's ` +
  ```
- `app/admin/(protected)/people/[id]/participation-editor.tsx:448` — second copy in the same component
  ```
      const finishesAt = input.startWeek + input.weeksCommitted - 1;
  ```
  Drives "does this save lengthen the cycle" at `:449`
  `    const addsWeeks = finishesAt > participation.plannedWeeks;`.
- `prisma/migrations/20260806020000_…/migration.sql:61` — SQL, HALF-OPEN
  ```
      AND w."weekNumber" <  pt."startWeek" + pt."weeksCommitted"
  ```
- `scripts/verify-member-privileges.mts:78` — the script's replay of the same half-open bound
  ```
        AND w."weekNumber" < pt."startWeek" + pt."weeksCommitted"
  ```

**Why EQUIVALENT.** `startWeek + weeksCommitted - 1` is written identically at all five TypeScript sites, and
for integer `weekNumber`, `n <= s + c - 1` and `n < s + c` select exactly the same set, so the SQL half-open
form is the same window. The only behavioural fork is guards: `calculateFinishWeek` throws `RangeError` on a
non-positive input where the copies return `startWeek - 1` (an empty window). Both inputs are refused
upstream — `lib/participation-rules.ts:20` rejects `    f.weeklyAmount < 1 ||` and `:25-26` rejects
`  if (!Number.isSafeInteger(f.startWeek) || f.startWeek < 1) {` /
`    return "Start week can never be before week 1.";` — called by `validateParticipationFields` at
`app/actions/edits.ts:260` and `app/actions/participations.ts:262` and `:334`, i.e. every create and update
path. D-20 is recorded on the function itself at `lib/money.ts:111`.

**Correction to Pass 1.** It justified the footnote with "every write path clamps it at 1
(`lib/commitment.ts:48`)", which is wrong — `lib/commitment.ts:47-49` is `weeksToFinishWithGroup`, a UI
default used only by `add-member-wizard.tsx` and `participation-editor.tsx`. The real guard is
`lib/participation-rules.ts:31`
`if (!Number.isSafeInteger(f.weeksCommitted) || f.weeksCommitted < 1 || f.weeksCommitted > MAX_WEEKS) {`.
The conclusion is unchanged.

---

### A25. Money I paid in before I stopped, and what I received — **EQUIVALENT**

**Implementations**

- `app/actions/member.ts:156-160` — canonical, the member's own stopped record
  ```
        const paidIn = stopped.paymentEvents.reduce((sum, e) => sum + e.amount, 0);
        const received = stopped.luckyNumbers
          .flatMap((n) => n.payouts)
          .filter((po) => po.status === "COLLECTED")
          .reduce((sum, po) => sum + po.netAmount, 0);
  ```
- `lib/contribution.ts:58` — paid-in, with assertions
  ```
  export function totalContributed(receipts: readonly ContributionReceipt[]): number {
  ```
  `    total += r.amount;` at `:62`, preceded by `assertCents` at `:61`.
- `app/admin/(protected)/people/[id]/page.tsx:157-167` — both halves, admin side
  ```
            paidIn:
              (
                await prisma.paymentEvent.aggregate({
                  where: { participationId: active.id },
                  _sum: { amount: true },
                })
              )._sum.amount ?? 0,
            received: active.luckyNumbers
              .flatMap((n) => n.payouts)
              .filter((po) => po.status === "COLLECTED")
              .reduce((sum, po) => sum + po.netAmount, 0),
  ```
- `app/actions/participation-close.ts:137-140` — received
  ```
    const alreadyPaidOut = p.luckyNumbers
      .flatMap((n) => n.payouts)
      .filter((po) => po.status === "COLLECTED")
      .reduce((s, po) => s + po.netAmount, 0);
  ```
- `app/actions/cycle-close.ts:114-119` — received, nested reduce instead of flatMap
  ```
        receivedNet: p.luckyNumbers.reduce(
          (sum, n) =>
            sum +
            n.payouts
              .filter((po) => po.status === "COLLECTED")
              .reduce((s, po) => s + po.netAmount, 0),
  ```

**Why EQUIVALENT.** The paid-in half is Σ `PaymentEvent.amount` in all three places — one in memory, one in
Postgres — and the received half is the COLLECTED-only `netAmount` sum written four times with two spellings
that select the same rows. The only behavioural difference is that `lib/contribution.ts` asserts each receipt
is a non-negative safe integer before adding and the three reduces do not; a negative `PaymentEvent.amount`
would make the portal throw while the admin page quietly returned a smaller total, and `  amount          Int`
(`prisma/schema.prisma:333`) carries no CHECK to stop one. No app write path produces one, so the input could
not be constructed. Four copies of one rule is what §5.10 names.

---

### A26. Is there anything to chase this member about (the chasing gate) — **EQUIVALENT**

**Implementations**

- `lib/messages.ts:174-178` — canonical
  ```
  export function hasChaseableWeeks(
    weeks: readonly { status: string }[] | undefined,
  ): boolean {
    return (weeks ?? []).some((w) => w.status === "LATE");
  }
  ```
  Live at `lib/messages.ts:576` `    !hasChaseableWeeks(input.weeks)` inside the send gate.
- `lib/messages.ts:223-225` — the same predicate written out again, for `{lateWeeks}`
  ```
    const lateWeeks = (standing.weeks ?? [])
      .filter((w) => w.status === "LATE")
      .map((w) => w.weekNumber);
  ```
- `app/actions/messages.ts:435` — the batch path
  ```
        const lateWeeks = loaded.standing.weeks.filter((w) => w.status === "LATE");
  ```
  Used as `            ? lateWeeks.length > 0` at `:440`.
- `app/actions/member.ts:300` — a count rather than a boolean
  ```
      const lateCount = standing.weeks.filter((w) => w.status === "LATE").length;
  ```

**Why EQUIVALENT.** All four read the SAME derived field — `status` on a `StandingWeek` produced by
`lib/standing.ts:209-217`, which calls `paymentStatus` once per week — and apply the identical `=== "LATE"`
test. There is no second derivation of LATE here, only a second, third and fourth spelling of one filter;
they cannot disagree about any week they are both shown. The two message paths are shown weeks from
different loaders (`lib/messaging-engine.ts:121` and `app/actions/member.ts:241`) but those are the same
break-unaware window filter, so the sets match; if that window changes it changes for all of them together,
and that is row A18's question, not this one.

**Noted beside it, not a divergence:** `app/actions/messages.ts:438` gates BEHIND_NOTICE on
`          ? loaded.facts.weeksBehind > 0` and not on `lateWeeks`, which is deliberate — a member whose whole
shortfall sits on deferred weeks is behind and not chaseable, exactly as `lib/messages.ts:170-172` describes.
The *offer* half of that split is adjudicated as Part C row C8.

---
### A27. Payment status of one week (PAID / PARTIAL / LATE / UNPAID / DEFERRED / SKIPPED) — **RESOLVED**

**Implementations**

- `lib/derived.ts:169`, ladder at `:189-192` — canonical
  ```
  export function paymentStatus(args: {
  ...
    if (args.isSkipped) return "SKIPPED";
    if (args.amountPaid >= args.amountDue) return "PAID";
    if (args.isDeferred) return "DEFERRED";
    if (args.markedLate) return "LATE";
  ```
  Fed `coveredAtCurrentRate` on the standing path — `lib/standing.ts:210`
  `        amountPaid: coveredByWeek.get(w.weekNumber) ?? 0,`.
- `lib/dashboard.ts:365` and `:372-373` — the SAME function, STORED input
  ```
      const amountPaid = payment?.amountPaid ?? 0;
  ...
        status: paymentStatus({
          amountPaid,
  ```
  `weekMemberStatus` asks the one engine but feeds it the stored per-week receipt, so it answers on the
  opposite basis from the grid.
- `lib/dashboard.ts:257` — compares the STORED amount
  ```
      if ((payment?.amountPaid ?? 0) >= participation.weeklyAmount) membersPaid++;
  ```
- `app/admin/(protected)/cycle/position/week-dates.ts:111` and `:113`
  ```
      if ((row?.amountPaid ?? 0) >= participation.weeklyAmount) continue;
      // Already late by his own hand — the day is not what decides it (2.2).
      if (row?.markedLate) continue;
  ```
  The mark-outranks-deferral half is D-40 gap 2; the docstring at `:72-81` justifies the plain marked-late
  skip correctly and simply never considers the deferred-and-marked pair.
- `lib/chart.ts:186` and `:193-197` — a parallel five-state ladder, **DEAD CODE**
  ```
  export function consistencyState(input: {
  ...
    if (input.isDeferred) return "deferred";
    if (input.amountPaid >= input.amountDue && input.amountDue > 0) return "paid";
    if (!input.windowClosed) return input.amountPaid > 0 ? "partial" : "not-due";
    if (input.amountPaid > 0) return "partial";
    return "overdue";
  ```
  Quote verified; **no production caller.** Referenced only from `lib/chart.test.ts`. The strip is fed by
  `lib/chart.ts:230` `export function consistencyFromStatus(`, called at
  `app/admin/(protected)/payments/payments-screen.tsx:184`. Retained as a §5.10 hazard with footnote reach.
- `lib/payments-view.ts:130` — DEAD CODE (see row A19)
  ```
      if (m.isDeferred || m.amountPaidThisWeek >= m.amountDue) paid.push(m);
  ```

**Divergence proof — one survives as written, one with a new input, two refuted.**

(a) **REFUTED** — "week 16 marked late in the future reads LATE on `/admin` and not-due on the member's
strip". The strip never calls `consistencyState`; `consistencyFromStatus` maps `paymentStatus`'s "LATE" to
"overdue". No contradiction exists.

(b) **REFUTED** — "a deferred week that was then paid renders as a deferred dot". Same reason:
`paymentStatus` returns PAID (`lib/derived.ts:190` sits above `:191`) and `consistencyFromStatus` maps
PAID→"paid".

(c) **SURVIVES, with a corrected input.** The rate-change version is refuted (every `weeklyAmount` write
rebuilds — `app/actions/edits.ts:541`, `:813`, `:990`, `:1088`). The live version is legacy placement, which
`lib/rebuild.ts:13-15` names: an imported member, weekly $500, whose old-app rows put $500 on week 5 and
nothing on week 3, never edited since. For WEEK 3: `lib/standing.ts:210` hands `paymentStatus` the
re-allocated 50000 → "PAID", so the payments grid draws PAID and
`app/admin/(protected)/payments/payments-members.tsx:37` labels it "Paid in full" — beside "$0.00 of $500.00
($500.00 left)" from `:36`. `lib/dashboard.ts:365`/`:372` hands the SAME function the stored 0 → "LATE", and
`:257` leaves her out of `membersPaid`. Two screens, one week, opposite statuses.

(d) **ADDITIONAL, no legacy data needed:** a week both DEFERRED and `markedLateAt` (reachable via
`app/actions/edits.ts:1278`). `lib/derived.ts:191` returns DEFERRED everywhere, while
`week-dates.ts:113` treats the mark as settling it and drops the member.

**Ruling.** Correct: `lib/derived.ts:169`, fed `lib/standing.ts:205`'s `coveredAtCurrentRate` — the pairing
`lib/standing.ts:209-217` already uses. Wrong: `lib/dashboard.ts:365` and `:257` (ask, or restate, the right
ladder on the STORED per-week receipt instead of the coverage the §2.15 placement defines — **this corrects
an earlier verdict** that named `lib/dashboard.ts:341` as the model); `week-dates.ts:113` (lets the mark
outrank deferral, D-40 gap 2, §6.4).

> §2.14, derived table: "| Late | unpaid **and** either the window has closed **or** the organizer marked it
> late himself (§2.29). Deferral outranks both. |" and "| Status (paid / partial / not paid) | from the
> amount against the weekly amount |"
>
> §2.15: "1. **Oldest unpaid weeks first**, waterfalling forward."
>
> §2.14: "The system stores **what actually happened**, and calculates everything else. Nothing that can be
> computed is ever stored, because stored values drift and computed values cannot."
>
> §5.10: "### 5.10 TWO FUNCTIONS ANSWERING ONE QUESTION IS THE SAME DEFECT AS NONE"

**What a human sees.** On any week whose imported placement was not oldest-first, the payments grid says
PAID and `/admin/this-week` says LATE about the same member and week, and the grid's own tooltip contradicts
itself in one sentence. **Withdrawn:** every claim about the member's consistency strip — that ladder has no
caller, and the strip is an admin screen.

---

### A28. Effective finish week (where a stopped member's window actually ends) — **RESOLVED**

**Implementations**

- `lib/participation-close.ts:133-138` — canonical, from an OPEN break
  ```
  export function effectiveFinishWeek(p: ClosableWindow): number {
    const committed = calculateFinishWeek(p.startWeek, p.weeksCommitted);
    const open = (p.breaks ?? []).filter((b) => b.toWeek === null);
    if (open.length === 0) return committed;
    return Math.min(committed, Math.min(...open.map((b) => b.fromWeek - 1)));
  }
  ```
- `lib/participation-close.ts:169-170` — the THREE-TERM rule for a row with no break
  ```
    const lastCounted = p.closedAtWeek ?? p.lastWeekWithMoney ?? p.startWeek - 1;
    return { fromWeek: lastCounted + 1, toWeek: null };
  ```
  Its comment at `:151-155` states the rule: "So a closed participation with no recorded stopping week is
  read as having" / "stopped after their LAST PAYMENT — the fact 2.18 preserves about them" / "anyway".
  Reached through `windowBreaks` (`:179-189`), which `app/actions/dashboard.ts:105-133` and
  `app/actions/cycle-position.ts:118-133` call as `breaksOf`.
- `app/actions/participation-close.ts:453` — the same arithmetic, **MIDDLE TERM DROPPED**
  ```
              fromWeek: (p.closedAtWeek ?? p.startWeek - 1) + 1,
  ```
  Creates the missing break row during Reactivate. `lastWeekWithMoney` is simply absent, and the surrounding
  transaction never loads it.
- `app/actions/participation-close.ts:459` — derives the effective finish back out of the break's start
  ```
        const closedAtWeek = open.fromWeek - 1;
  ```
- `prisma/migrations/20260811020000_participation_breaks/migration.sql:42-49` — SQL backfill, the full three
  terms, matching `legacyBreak` and NOT the inline copy
  ```
    COALESCE(
      p."closedAtWeek",
      (SELECT MAX(w."weekNumber")
         FROM "payments" pay
         JOIN "weeks" w ON w."id" = pay."weekId"
        WHERE pay."participationId" = p."id" AND pay."amountPaid" > 0),
      p."startWeek" - 1
    ) + 1,
  ```

**Divergence proof.** The producing state is written TODAY, after the backfill ran:
`app/actions/participation-removal.ts:239` still writes
`          data: { status: "CLOSED", closedAtWeek: null },` and creates no break row.

Tsion: startWeek 1, weeksCommitted 20, $500/week, paid every week through week 12 ($6,000). Removed via
"keep their money records" → status CLOSED, closedAtWeek null, breaks []. Every READ path is correct:
`lib/participation-close.ts:169` derives lastCounted = null ?? 12 ?? 0 = 12, so `windowBreaks` yields
fromWeek 13 and `effectiveFinishWeek` is 12; `app/actions/dashboard.ts:117` and
`app/actions/cycle-position.ts:130` supply the `lastWeekWithMoney` = 12 those readers need.

She asks to come back; today 2026-08-14 and the organizer reactivates her from week 14 (reachable at
`components/admin/close-participation.tsx:150`). `app/actions/participation-close.ts:449`
`        p.breaks.find((b) => b.toWeek === null) ??` finds nothing, so `:453` creates a break with fromWeek
= (null ?? 1 − 1) + 1 = **1**. `:459` then computes `closedAtWeek` = **0**. `reactivatePlan` takes
`from = Math.max(input.fromWeek, input.closedAtWeek + 1, input.startWeek)` (`lib/participation-close.ts:479`)
= 14, and `:480` closes the break at `plan.fromWeek - 1` = 13 — **a break covering weeks 1 through 13**.

Result: weeks 1-12, which she PAID, are permanently outside her window. `lib/participation-close.ts:120`
returns false for every one of them, so `lib/dashboard.ts:245` stops expecting them and
`app/admin/(protected)/cycle/position/week-dates.ts:108` skips her for all of them, while her $6,000 of
contributions sits on weeks her own window says were never hers. The cycle's `shouldHaveCollected`
(`lib/cycle-position.ts:194`) drops by $6,000 with nothing removed from collected.

**Correction to an earlier draft's wording:** nothing on screen literally says "stopped at week 0". What the
organizer is shown is `lib/participation-close.ts:502-504` — "The 13 weeks they were away stay closed.
Nothing was expected from them then, so nothing is owed for them now" — a sentence that is false for the
twelve weeks she paid. The zero is recorded in the audit trail, at `app/actions/participation-close.ts:503`
`          closedAtWeek,` inside the `before` block.

**Ruling.** Correct: `lib/participation-close.ts:169` (`legacyBreak`), matched exactly by
`prisma/migrations/20260811020000_participation_breaks/migration.sql:42-49`. Wrong:
`app/actions/participation-close.ts:453` (drops the `lastWeekWithMoney` middle term — it should call
`windowBreaks`/`legacyBreak`, which is what every reader uses and what the migration backfilled);
`app/actions/participation-close.ts:459` (derives the effective finish from the break it just mis-created
rather than calling `effectiveFinishWeek`); `app/actions/participation-removal.ts:239` (the write that still
produces the closedAtWeek-null row, with no break row to describe it).

> §2.18: "- **The record of where they stopped is preserved** in the archive — last payment week, amount,
> and the resulting balance."
>
> §2.14: "The system stores **what actually happened**, and calculates everything else. Nothing that can be
> computed is ever stored, because stored values drift and computed values cannot."
>
> §5.10: "### 5.10 TWO FUNCTIONS ANSWERING ONE QUESTION IS THE SAME DEFECT AS NONE"

**What a human sees.** Reactivating a member who was closed with "keep their money records" tells the
organizer that the thirteen weeks she was away were never expected — including the twelve she paid — and
afterwards every expectation figure and her own window drop those twelve weeks. The cycle's "should have
come in" silently falls by everything that member ever paid, and the coverage verdict on the Cycle position
page reads as a surplus that is not there.

---

### A29. Written off / forgiven amount — **RESOLVED**

**Implementations**

- `lib/ledger.ts:92` — canonical refusal ladder
  ```
  export function forgivenessRefusal(input: {
  ```
  `balance <= 0` (`:96`), non-integer/<1 amount (`:97-99`), and `if (input.amount > input.balance)` at
  `:100` returning a raw-cents sentence at `:101`.
- `app/actions/ledger.ts:146-147` — re-performs the over-the-balance comparison from the raw inputs
  ```
                input.amount > owed
                  ? `That is more than the ${formatMoney(owed)} carried. Forgive ${formatMoney(owed)} or less.`
  ```
  This branch produces the sentence the organizer reads; the canonical's `refusal` is used only in the else
  arm at `:148`.
- `app/actions/ledger.ts:170` — post-write-off remainder, inline, for the audit summary
  ```
            `written off (was ${formatMoney(owed)}, now ${formatMoney(Math.max(0, owed - input.amount))}). ` +
  ```
- `app/actions/ledger.ts:173` — the identical expression a second time, three lines later
  ```
        return { error: null as string | null, remaining: Math.max(0, owed - input.amount) };
  ```
- `app/admin/(protected)/people/[id]/carried-balance.tsx:302` — client-side, from the rendered balance
  ```
                const left = Math.max(0, story.balance - cents);
  ```
  Computed BEFORE any server call. Feeds the confirmation body at `:315` and the success sentence at `:333`.
  `result.data.remaining` is never read on this path (the runner at `:98-121` takes only ok/error).

**Divergence proof.** `app/actions/ledger.ts:170` and `:173` are byte-identical expressions over the same
`owed` (read at `:141`) inside one serializable transaction — they cannot differ. The one that can differ is
the client, and it needs a stale snapshot, so the staleness window was checked: `carried-balance.tsx:115`
calls `router.refresh()` after every success and `member-payments.tsx:257` does the same, so two actions in
ONE tab cannot diverge. A second tab, a second session, or the concurrent case §4.2 finding 4 already records
("Concurrent carry deduction — two panels, same balance, both commit") can.

Tizita carries $2,000. The organizer has `/admin/people/<id>` open (`story.balance` = 200000) and $500 is
recorded against the balance from another session. He types $1,500 and confirms:

- `carried-balance.tsx:302` → left = max(0, 200000 − 150000) = 50000 → the dialog says "The balance goes from
  $2,000.00 to $500.00" and the success sentence at `:333` says "$1,500.00 of Tizita's balance written off —
  $500.00 still carried."
- `app/actions/ledger.ts:141` re-reads inside the transaction → owed = 150000 → `forgivenessRefusal` passes →
  the FORGIVEN entry is written for $1,500, the audit summary at `:170` records "was $1,500.00, now $0.00",
  and `:173` returns remaining = **0**.

The permanent record says the balance is cleared; the sentence he just read says $500 is still carried.

**Ruling.** Correct: `app/actions/ledger.ts:173` — the remainder computed inside the transaction from the
balance the write actually saw. Wrong: `carried-balance.tsx:302` — computes the remainder from a client
snapshot and prints it as the outcome sentence after the write, instead of rendering the server's
`result.data.remaining`.

> §2.23 FULL ORGANIZER CONTROL: "Every destructive or corrective action must have:" / "- a **confirmation**
> stating plainly what will happen and what it affects" / "- an **audit trail** recording what changed, from
> what to what, and when" / "- **derived figures recalculated immediately**, so a correction never leaves
> stale numbers"

**What a human sees.** After a write-off the organizer is told a balance figure that is not the one now
stored. A write-off has no undo (`app/actions/ledger.ts:105-112` says so), so he has no reason to check. It
takes a second tab or a concurrent session to reach — the same shape as the already-closed money finding 4.

---

### A30. Amount due for one week — **RESOLVED**

**Implementations**

- `lib/draw-settlement.ts:105-108` — canonical; only SKIPPED excuses
  ```
      // Only a SKIPPED week excuses the contribution. A DEFERRED week is still
      // owed (organizer ruling, Aug 2026), so the payout settles it like any other.
      const excused = draw.week.isSkipped;
      const amountDue = inWindow && !excused ? participation.weeklyAmount : 0;
  ```
- `lib/week-winners.ts:161-165` — same rule on deferral, by hand rather than through `calculateFinishWeek`
  ```
    const finishWeek = input.candidate.startWeek + input.candidate.weeksCommitted - 1;
    const inWindow =
      input.weekNumber >= input.candidate.startWeek && input.weekNumber <= finishWeek;
    if (!inWindow || input.weekIsSkipped) return 0;
    const remaining = input.candidate.weeklyAmount - (input.alreadyPaid ?? 0);
  ```
- `lib/payments-view.ts:222-225` — states the opposite rule to `lib/dashboard.ts` in a comment, on the same
  question
  ```
          received += mw.storedPaid;
          // Only a SKIPPED week is off the books. A DEFERRED week is still
          // owed, so it belongs in what the week EXPECTED to collect.
          if (!week.isSkipped && mw.status !== "SKIPPED") expected += mw.amountDue;
  ```
- `lib/dashboard.ts:253-255` — a DEFERRED week contributes nothing
  ```
      if (payment?.isDeferred) continue;
      assertCents("weeklyAmount", participation.weeklyAmount);
      expected += participation.weeklyAmount;
  ```
- `scripts/audit-position-figures.mts:233-234` — the by-hand check agrees with `lib/dashboard.ts`, not with
  the canonical
  ```
      if (pay?.isDeferred) continue;
      handShould += p.weeklyAmount;
  ```

**Divergence proof.** Member M, weeklyAmount $500, startWeek 1, weeksCommitted 20. Week 6 is DEFERRED for M
(`Payment.isDeferred` true, week 6 not cycle-skipped). M's lucky number is drawn for week 6.

- `lib/draw-settlement.ts:108` → inWindow true, excused = false → amountDue = 50000 →
  `planWinnerWeekSettlement` deducts $500 from M's payout and writes a PINNED receipt on week 6
  (`draw-settlement.ts:125-159`).
- `lib/dashboard.ts:253` → M's week-6 row is deferred → `continue` → M's $500 never enters week 6's
  `expected`, while `:250` counts the arriving $500 as `received` because the receipt test sits ABOVE the
  ladder.

Week 6 therefore reads collected-above-expected by exactly the deferred member's weekly. The same exclusion
runs on every deferred week, drawn or not, so `/admin/cycle/position`'s `shouldHaveCollected`
(`lib/cycle-position.ts:194`, over the same series) is short by every deferred week's weekly.
`scripts/audit-position-figures.mts:233` reproduces the dashboard's rule on both sides, so the Sunday check
agrees with the wrong side and passes.

**Ruling.** Correct: `lib/draw-settlement.ts:105-108`, with `lib/payments-view.ts:225` and
`lib/standing.ts:174-176` stating the same rule. Wrong: `lib/dashboard.ts:253` (drops a deferred member's
weekly from the week's expectation, which excuses the money rather than the chase);
`scripts/audit-position-figures.mts:233`.

> §2.29 THE MANUAL LATE MARK — DEFERRAL OUTRANKS IT, effect 2 (Arithmetic): "An *elapsed* deferred week still
> counts as owed: deferral has never excused the money."

**What a human sees.** A week in which a deferred member was drawn shows collected above expected on the
dashboard and the cash chart, and "what should have come in by now" on the cycle position page is short by
every deferred week's weekly amount. That figure is the organizer's statement of what he is owed, which is
why this stays headline.

---

### A31. Amount a ticked set of weeks is worth (selection total) — **EQUIVALENT**

**Implementations**

- `lib/week-picking.ts:63` — canonical
  ```
  export function amountForWeeks(
  ```
  Filters to `selected.has(w.weekNumber) && isPickable(w)` (`:68`) and sums `remainingOn(w)` (`:69`), which
  returns 0 for a skipped week and clamps at 0 (`:43-46`).
- `lib/payments-view.ts:57-64` — `bulkCatchUpAmount`
  ```
  export function bulkCatchUpAmount(weeks: readonly CatchUpWeek[]): number {
    let total = 0;
    for (const w of weeks) {
      if (w.isSkipped) continue;
      if (!Number.isSafeInteger(w.amountDue) || !Number.isSafeInteger(w.amountAlreadyPaid)) {
        throw new RangeError(`week ${w.weekNumber} amounts must be integer cents`);
      }
      total += Math.max(0, w.amountDue - w.amountAlreadyPaid);
  ```
- `lib/week-picking.ts:153` — `quickAmounts`' `make` over `owing`
  ```
        amount: take.reduce((s, w) => s + remainingOn(w), 0),
  ```
- `lib/week-picking.ts:163` — the "all owed" chip, a third reduce in the same function
  ```
        amount: owing.reduce((s, w) => s + remainingOn(w), 0),
  ```

**Why EQUIVALENT.** All four compute Σ max(0, amountDue − amountPaid) over the same weeks with skipped weeks
contributing 0: `remainingOn` (`lib/week-picking.ts:43-46`) returns 0 for a skipped week and clamps at zero,
which is exactly `if (w.isSkipped) continue;` plus `Math.max(0, …)`, and filtering fully-paid weeks out gives
the same sum as letting them contribute a clamped 0. The only behavioural difference is the failure mode on
non-integer cents, and every source is a Prisma `Int` column.

---

### A32. Weeks behind (Pass 1 #47 — the SQL view and its guard) — **RESOLVED**

**Implementations**

- `lib/derived.ts:138-146` — canonical
  ```
  export function weeksBehind(
    weeksElapsedInWindow: number,
    weeksCreditedCount: number,
    skippedCount: number,
  ): number {
    assertCount("weeksElapsedInWindow", weeksElapsedInWindow);
    assertCount("weeksCreditedCount", weeksCreditedCount);
    assertCount("skippedCount", skippedCount);
    return Math.max(0, weeksElapsedInWindow - skippedCount - weeksCreditedCount);
  ```
  Its `weeksElapsedInWindow` is supplied by `lib/standing.ts:164-173`, which counts a week as elapsed when
  `weekCountsAsDue` is true — the calendar OR the organizer's mark, deferral outranking the mark.
- `prisma/migrations/20260806020000_…/migration.sql:37-42` — the LIVE view
  ```
    greatest(
      0,
      coalesce(closed.elapsed, 0)
      - coalesce(closed.excused, 0)
      - floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount")
    )::int AS weeks_behind
  ```
  Verified line for line, including the anchors. This is the last of three migrations touching
  `member_progress` (`20260804230000`, `20260805150000`, `20260806020000`). Its `elapsed` (`:52-63`) is
  `current_date >= (w.date::date + 5)` only; the view never sees `markedLateAt`. Its `excused` (`:57`) is
  `count(*) FILTER (WHERE w."isSkipped")`, correctly excluding personal deferrals. The window length is a
  bare SQL literal 5.
- `scripts/verify-member-privileges.mts:96` — a hand-written third copy
  ```
    const expectBehind = Math.max(0, closed.length - excused - credited);
  ```
  Its `excused` at `:90-93` is `(row?.isDeferred ?? false) || w.isSkipped` — personal deferrals counted as
  excused, which neither the view nor `lib/derived.ts` does. Its raw-SQL side at `:74-75` makes the same
  mistake, and `:65` is a `$queryRawUnsafe` of its own copy — the script never SELECTs from
  `public.member_progress`, so the PASS line at `:108` is a claim about code it did not read.
- `scripts/elapsed-rule-impact.mts:215-220` — a faithful replay of the live view
  ```
      greatest(
        0,
        coalesce(closed.elapsed, 0)
        - coalesce(closed.excused, 0)
        - floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount")
      )::int AS weeks_behind
  ```
  `count(*) FILTER (WHERE w."isSkipped")` at `:229`, `PAYMENT_WINDOW_DAYS` interpolated at `:234` instead of
  the literal 5. It exists to report the SQL-vs-TypeScript disagreement.

**Divergence proof.** Member M, startWeek 1, weeksCommitted 20, weeklyAmount $500, has paid $1,000 (weeks 1
and 2). Today is the Tuesday of week 3: weeks 1 and 2 have closed their 5-day windows, week 3's is still
open. On Monday the member said week 3 was not coming, and the organizer marked week 3 LATE by hand
(`payments.markedLateAt` set, isDeferred false).

- `lib/standing.ts:164` → `weekCountsAsDue` is true for weeks 1, 2 AND 3 (`lib/derived.ts:113`,
  `if (args.markedLate && !args.isDeferred) return true;`) → elapsed.length = 3, credited = 2,
  skippedElapsed = 0 → **weeksBehind = 1**.
- `migration.sql:52-63` → `current_date >= (w.date::date + 5)` is false for week 3 → elapsed = 2, excused =
  0, floor(100000/50000) = 2 → **weeks_behind = 0**.

Consumer re-derived rather than taken from Pass 1: `app/actions/member.ts:413-417` queries `member_progress`
through the Supabase client and hands `weeks_behind` to `components/member/member-group-list.tsx`. So
`/me/group` says 0 while every organizer surface says 1.

**Second divergence, in the verification script.** Same member with no mark, but week 2 deferred and unpaid,
weeks 1-12 elapsed, nothing paid. `lib/derived.ts` and the live view both give 12 (deferral excuses nothing).
`scripts/verify-member-privileges.mts:90-96` gives 11, and its own raw SQL at `:74-75` gives 11 too — so both
sides of the comparison are wrong in the same direction and it prints PASS while the deployed view says 12.

**Ruling.** Correct: `lib/derived.ts:138` fed by `lib/standing.ts:164-173`. Wrong:
`prisma/migrations/20260806020000_…/migration.sql:37` (the live view has never been updated for D-40, 12 Aug
2026; it has no access to `markedLateAt`, so a hand-marked week is invisible to the member portal's group
page); `scripts/verify-member-privileges.mts:90-96` (counts personal deferrals as excused, contradicting both
the view it claims to verify and `lib/derived.ts`, and it verifies its own copy rather than
`public.member_progress`).

> §2.14 MONEY IS THE TRUTH, derived table: "| Late | unpaid **and** either the window has closed **or** the
> organizer marked it late himself (§2.29). Deferral outranks both. |"
>
> §2.29, effect 2: "A mark cannot pull a not-yet-due deferred week forward, and the attention list applies the
> same test — so the list and the standing derivation cannot disagree."

**What a human sees.** A member the organizer has just marked late reads "on track" on their own group page
while every organizer screen says they are a week behind. The verification script that exists to catch
exactly this disagreement reports PASS.

---

### A33. On track / behind flag, and how many are current (Pass 1 #49) — **RESOLVED**

**Implementations**

- `components/member/member-group-list.tsx:82` — the member's own group page
  ```
    const viewerOnTrack = (viewer?.weeksBehind ?? 0) === 0;
  ```
  Rendered at `:128` as a pill. `viewer.weeksBehind` is the SQL view's `weeks_behind`
  (`app/actions/member.ts:448`).
- `app/actions/member.ts:460` — the "N of M current" count, also from the view
  ```
          currentCount: all.filter((r) => r.weeks_behind === 0).length,
  ```
- `lib/messages.ts:732` — the applicability panel's BEHIND_NOTICE gate, over `computeStanding`
  ```
          return state.weeksBehind > 0
  ```
- `app/actions/messages.ts:438` — `prepareBatch`'s relevance filter, same figure
  ```
            ? loaded.facts.weeksBehind > 0
  ```
- `lib/dashboard.ts:567` — `memberAttention`'s own behind count
  ```
      if (behind === 0) continue;
  ```
  Built from `elapsedThroughWeek` plus manually marked weeks with deferral outranking the mark (`:551-559`).
  Paired with `if (owed === 0) continue;` at `:582`.

**Divergence proof.** The same member M as row A32: startWeek 1, weeksCommitted 20, weeklyAmount $500, paid
$1,000, today is the Tuesday of week 3, week 3 marked LATE by hand on Monday.

- `lib/messages.ts:732` → `state.weeksBehind` = 1 → BEHIND_NOTICE reads applicable and the organizer is
  offered the notice to send.
- `app/actions/messages.ts:438` → M is included in the batch.
- `lib/dashboard.ts:567` → behind = 1, and owed = `amountOutstanding` over the three due weeks = 150000 −
  100000 = 50000 > 0 (`:581-582`) → M appears on the dashboard's needs-attention list.
- `components/member/member-group-list.tsx:82` → `viewer.weeksBehind` = 0 (the view cannot see
  `markedLateAt`) → `viewerOnTrack` = true, and `app/actions/member.ts:460` counts M among the current
  members.

So on one day the platform offers to send M a behind notice while M's own portal shows them on track and
counts them in "N current".

**Ruling.** Correct: `lib/dashboard.ts:567` and `lib/messages.ts:732` — both read a behind count that honours
the mark and lets deferral outrank it. Wrong: `components/member/member-group-list.tsx:82` (reads the SQL
view's `weeks_behind`, which predates D-40); `app/actions/member.ts:460` (same source, so the "N current"
headline overcounts by every hand-marked member).

> §2.29 THE MANUAL LATE MARK, effect 2 (Arithmetic): "A mark cannot pull a not-yet-due deferred week forward,
> and the attention list applies the same test — so the list and the standing derivation cannot disagree."

**What a human sees.** A member can receive "You are behind by 1 week" while their own group page says they
are on track and includes them in the current count. One migration closes this and row A32 together — they
are the same root cause.

---
### A34. Final position of a stopped member (owed-to-them / they-owe / settled) — **OPEN**

*(Ruling text at OPEN ruling 5. Evidence recorded here.)*

**Implementations**

- `lib/final-position.ts:121` — canonical
  ```
    const drawn = input.received > 0;
  ```
  Undrawn → owed-to-them = max(0, paidIn − `feeOnReturn`) (`:125-126`); drawn → they-owe = committed − paidIn
  where committed = weeklyAmount × weeksCommitted (`:135-136`), tested with `if (unpaid <= 0)` at `:137`.
  Renders at `app/admin/(protected)/people/[id]/page.tsx:192` (`finalHeadline`),
  `components/admin/close-participation.tsx:264-270`, and the member's own portal via
  `app/actions/member.ts:220` — display path re-derived by search.
- `app/actions/cycle-position.ts:268-274` — re-implements the drawn test and the owed-to-them branch inline
  ```
          owedBack:
            alreadyPaidOut > 0
              ? 0
              : Math.max(
                  0,
                  paidInByThem -
                    feeOnReturn({
  ```
  The they-owe branch is not implemented at all — a drawn stopped member is reported through
  `shortfallToCover` (`:264`) and `balanceRecorded` (`:259`) instead.
- `lib/contribution.ts:88-89` — duplicates the committed-total multiplication and subtraction
  ```
    const commitmentTotal = input.weeklyAmount * input.weeksCommitted;
    const stillToSave = Math.max(0, commitmentTotal - paidIn);
  ```
  Floored at zero here; `lib/final-position.ts:136` leaves it signed.
- `scripts/verify-participation-close.mts:401-404` — a third inlined owed-to-them branch: no fee, no floor,
  drawn-ness by identity check
  ```
      owedBack:
        p.id === paidOutMember.id
          ? 0
          : p.payments.reduce((sum, pm) => sum + pm.amountPaid, 0),
  ```

**Divergence proof.** Stopped member S: weeklyAmount $500, startWeek 1, weeksCommitted 20, closed at week 12,
DRAWN at week 6 with a COLLECTED payout net $9,800. Week 7 is a cycle-wide SKIPPED week. S paid $5,500 —
weeks 1-6 and 8-12, eleven weeks at $500.

- `lib/final-position.ts:135-136` → drawn = true, committed = 50000 × 20 = $10,000, unpaid = $4,500 →
  direction "they-owe", **amount $4,500**, rendered on `/admin/people/<id>` and on S's own portal.
- `app/actions/cycle-position.ts` → owedBack = 0; `shortfallToCover` = `weeksLeavingExpectation(1, 20, 12)` ×
  50000 = 8 × $500 = $4,000; `balanceRecorded` = `standingFor(p, 12).amountOutstanding` = Σ non-skipped
  elapsed due ($5,500) − paid ($5,500) = $0. **Total accounted: $4,000.**

The $500 difference is the SKIPPED week 7: `final-position` charges S for it because `weeklyAmount ×
weeksCommitted` counts every week of the commitment, while the position page's arithmetic never charges a
week nobody owed (`lib/derived.ts:299`, `if (!week.isSkipped) due += week.amountDue;`).

**Why OPEN.** §2.30 fixes the FEE to weekly × weeks committed regardless of attendance and says nothing about
what a drawn member owes back; §2.18's "Unpaid means owed" presumes a week that was owed in the first place.
Every other derivation in the platform drops skipped weeks. Nothing in the document decides between them.

**What a human sees.** A member who stopped after taking the pot reads one outstanding figure on their portal
(`app/actions/member.ts:220`) and the organizer sees a different one on the position page, differing by one
weekly amount per skipped week. Both are presented as the final word on what they owe.

---

### A35. Archived per-member figures — weeks paid, capped at weeks committed — **EQUIVALENT**

**Implementations**

- `app/actions/cycle-close.ts:106`
  ```
        weeksPaid: Math.min(standing.weeksCredited, p.weeksCommitted),
  ```
  `standing.weeksCredited` = `weeksCredited(totalPaid, weeklyAmount)` where `totalPaid` is Σ
  `Payment.amountPaid` (`:83`).
- `lib/messages.ts:218` — the cap applied independently for the `{weeksPaid}` placeholder; drives
  `{weeksLeft}` at `:219`
  ```
    const weeksPaid = Math.min(standing.weeksCredited, standing.weeksCommitted);
  ```
- `app/actions/member.ts:207-210` — the stopped-member portal branch; divides `PaymentEvent` receipts and
  carries a `Math.max(1, …)` divisor guard `lib/derived.ts:122-127` does not have
  ```
              weeksPaid: Math.min(
                Math.floor(paidIn / Math.max(1, stopped.weeklyAmount)),
                stopped.weeksCommitted,
              ),
  ```
- `prisma/migrations/20260806020000_…/migration.sql:33-36` — SQL, from Σ `Payment.amountPaid` (`:45-49`)
  ```
    least(
      floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount"),
      pt."weeksCommitted"
    )::int AS weeks_paid
  ```

**Why EQUIVALENT.** This is the one weeks figure the SQL view gets right: `weeks_paid` has no elapsed term, so
the view's missing `markedLateAt` awareness cannot reach it. All four compute
`min(floor(paid ÷ weekly), weeksCommitted)`. Numeric division cast to int truncates toward zero exactly as
`Math.floor` does for non-negative money. The two bases — Σ `PaymentEvent.amount` and Σ `Payment.amountPaid`
— are held equal by `lib/rebuild.ts`, which zeroes every payment row (`:53`) and replays every receipt,
throwing rather than dropping money that no longer fits (`:94-100`, `:114-120`); every write path that could
break the equality calls it (all 13 call sites enumerated). The `Math.max(1, …)` divisor guard is the only
behavioural difference, and `Participation.weeklyAmount` is a required `Int` refused below 1 by
`lib/participation-rules.ts:20`.

---

### A36. Payment recorded against a carried balance, and what is left — **RESOLVED**

**Implementations**

- `app/actions/ledger.ts:81` — canonical; `owed` read inside the serializable transaction at `:55`
  ```
        return { error: null as string | null, remaining: Math.max(0, owed - input.amount) };
  ```
- `app/actions/ledger.ts:79` — the identical expression evaluated inline two lines earlier for the audit
  summary
  ```
          summary: `Ledger payment ${formatMoney(input.amount)} from ${person.nameEnglishFirst} — balance was ${formatMoney(owed)}, now ${formatMoney(Math.max(0, owed - input.amount))}`,
  ```
- `app/admin/(protected)/people/[id]/carried-balance.tsx:217` — client-side, before `recordLedgerPayment` is
  called
  ```
                const left = Math.max(0, story.balance - cents);
  ```
  Renders in the confirmation body (`:234`) and the success sentence (`:256`). The server's `remaining` is not
  read on this path.
- `app/admin/(protected)/people/[id]/member-payments.tsx:231` — a second client-side evaluation for the
  collections-side confirmation dialog
  ```
                            {formatMoney(Math.max(0, carriedBalance - cents))}
  ```
  This component DOES read the server figure for its success message — `result.data.remaining` at `:254` — so
  the dialog and the success sentence get their number from two different computations.

**Divergence proof.** Tizita carries $2,000. The organizer has `/admin/people/<id>` open (`story.balance` =
`carriedBalance` = 200000) and $500 has been recorded against the balance from another session. He types $800
and confirms.

- `carried-balance.tsx:217` → left = 120000 → the dialog says "Their balance goes from $2,000.00 to
  $1,200.00" and the success sentence at `:256` says "$800.00 recorded from Tizita by Zelle — $1,200.00 still
  carried."
- `app/actions/ledger.ts:55` re-reads inside the transaction → owed = 150000 → `:81` returns remaining =
  **70000**, and the audit entry at `:79` records "balance was $1,500.00, now $700.00".
- `member-payments.tsx`, for the same action, says **$1,200.00** in its dialog (`:231`) and **$700.00** in its
  success message (`:254`) — two figures in one flow.

Both components call `router.refresh()` on success (`carried-balance.tsx:115`, `member-payments.tsx:257`), so
two actions in one tab cannot diverge; the divergence needs a second tab or a concurrent session, which is
the shape §4.2 finding 4 already records for this exact balance.

**Ruling.** Correct: `app/actions/ledger.ts:81`. Wrong: `carried-balance.tsx:217` (prints a client-computed
remainder as the outcome and never reads `result.data.remaining`); `member-payments.tsx:231` (uses the client
figure in the confirmation and the server figure in the success message, so one flow states two different
balances).

> §2.23 FULL ORGANIZER CONTROL: "Every destructive or corrective action must have:" / "- a **confirmation**
> stating plainly what will happen and what it affects" / "- an **audit trail** recording what changed, from
> what to what, and when" / "- **derived figures recalculated immediately**, so a correction never leaves
> stale numbers"

§2.10 (save feedback) is about feedback existing; §2.23's "derived figures recalculated immediately, so a
correction never leaves stale numbers" is the rule this actually breaks.

**What a human sees.** After recording a payment against a carried balance the organizer is told what is left,
and the figure can be wrong — or two figures can appear in the same flow.

---

### A37. My weekly amount — **RESOLVED**

**Implementations**

- `app/actions/member.ts:339` — canonical; reads the stored column. Every derived money figure on the portal
  divides by this
  ```
            weeklyAmount: participation.weeklyAmount,
  ```
- `lib/lucky-numbers.ts:128` — `reconcileWeeklyAmount` reconstructs the weekly from the LuckyNumber amounts
  ```
    const impliedWeekly = input.numberAmounts.reduce((sum, a) => sum + a, 0);
  ```
  Reports the difference as `delta` (`:129`). Gates all three lucky-number write paths
  (`app/actions/edits.ts:799-815`, `:967-990`, `:1064-1088`), each of which rebuilds the receipts afterwards
  (`:813`, `:990`, `:1088`).
- `app/actions/edits.ts:534` — `updateParticipation`, read end to end from `:247` to `:570`: it loads
  `luckyNumbers: { include: { payouts: true } }` (`:271`) and uses them only for stranded winner plans, draws
  and payout settlement (`:291-523`). `reconcileWeeklyAmount` is never called and the numbers are never
  compared to the new weekly
  ```
            weeklyAmount: input.weeklyAmount,
  ```
- `app/admin/(protected)/people/[id]/participation-editor.tsx:1024` — the same summation inline in JSX, on the
  same screen as the weekly-amount input at `:665`, never compared to the stored weekly
  ```
                      props.luckyNumbers.reduce((s, n) => s + n.amount, 0),
  ```
- `scripts/verify-payout-invariants.mts:64` — a third copy of the sum, asserted against the stored weekly
  ```
        twoNumberMember.weeklyAmount === twoNumberMember.numbers.reduce((s, n) => s + n.amount, 0),
  ```

**Divergence proof.** The three lucky-number write paths all reconcile, so a number edit can never break the
invariant. `updateParticipation` can, and the control is on the same screen:
`participation-editor.tsx:665` renders
`<AmountInput value={weeklyDollars} … ariaLabel="Weekly amount in dollars" />` and `:352` sends it straight to
`updateParticipation`.

Bereket holds #2 at $250 and #22 at $250; `participation.weeklyAmount` = $500. The organizer raises the weekly
to $800 (§2.5: "Contribution changes between cycles because income changes") and saves. The numbers are
untouched.

- `app/actions/member.ts:339` → his portal says his weekly amount is $800, and `weeksCredited` divides his
  paid-in by 80000.
- `participation-editor.tsx:1024` → the same screen he just saved on says "2 numbers, together $500.00 a week."
- `lib/lucky-numbers.ts:128-129` → the next time either number is touched, impliedWeekly = $500, delta = −$300,
  and the reconcile pulls his weekly back to $500 (`edits.ts:809-812`) and re-allocates every receipt he has
  ever paid (`:813`).
- His payout is unaffected — it is grossed per lucky number at $250 × weeksCommitted each — so **he pays $800
  a week toward a pot sized at $500 a week.**

**Ruling.** Correct: `lib/lucky-numbers.ts:128` — the weekly IS the sum of the member's numbers, which is the
only way §2.30's two statements (gross from the weekly, and a payout per number of its own amount) can both
hold. Wrong: `app/actions/edits.ts:534` (writes `participation.weeklyAmount` with no reconciliation against
the LuckyNumber amounts, leaving the stored weekly and the numbers describing two different memberships);
`participation-editor.tsx:1024` (states the number-derived weekly beside the stored one on the same screen
without ever comparing them, so the contradiction is rendered and not flagged).

> §2.30 THE FEE IS FIXED BY THE COMMITMENT: "> gross = weekly amount × weeks **committed**  ·  fee = the
> cycle's fee percent × gross" and "**Per lucky number, never once on the pot.** Each number is its own payout
> of its own amount over its owner's committed weeks"

**What a human sees.** A member is billed a weekly amount their lucky numbers do not add up to: their portal,
the grid and every arrears figure use one number while the payout those numbers fund uses the other. The next
lucky-number edit reverses the rate change without saying so and re-allocates every receipt they have ever
paid.

---

### A38. Bulk catch-up amount for chosen weeks — **EQUIVALENT**

**Implementations**

- `lib/payments-view.ts:57-64` — clamps EACH week at zero
  ```
  export function bulkCatchUpAmount(weeks: readonly CatchUpWeek[]): number {
    let total = 0;
    for (const w of weeks) {
      if (w.isSkipped) continue;
      if (!Number.isSafeInteger(w.amountDue) || !Number.isSafeInteger(w.amountAlreadyPaid)) {
        throw new RangeError(`week ${w.weekNumber} amounts must be integer cents`);
      }
      total += Math.max(0, w.amountDue - w.amountAlreadyPaid);
  ```
- `lib/week-picking.ts:63` — same per-week clamp via `remainingOn` (`:69`, `:43-46`)
  ```
  export function amountForWeeks(
  ```
- `lib/derived.ts:286-302` — NETS across weeks, one clamp at the end
  ```
  export function amountOutstanding(
    weeks: readonly {
      amountDue: number;
      amountAlreadyPaid: number;
      isDeferred: boolean;
      isSkipped?: boolean;
    }[],
  ): number {
    let due = 0;
    let paid = 0;
    for (const [i, week] of weeks.entries()) {
      assertCents(`week[${i}] amountDue`, week.amountDue);
      assertCents(`week[${i}] amountAlreadyPaid`, week.amountAlreadyPaid);
      if (!week.isSkipped) due += week.amountDue;
      paid += week.amountAlreadyPaid;
    }
    return Math.max(0, due - paid);
  ```
  Its own doc (`:272-285`) says the netting is deliberate, to survive a rate decrease.

**Why EQUIVALENT — and this is the most consequential correction to an earlier draft.** That draft's proof
required a week row holding MORE than its `amountDue` (a week recorded at an old, higher rate surviving a rate
cut). **That state cannot exist.** Every writer of `Participation.weeklyAmount` calls
`rebuildParticipationPayments` inside the same transaction — `app/actions/edits.ts:534` then `:541`, and the
three lucky-number reconciles at `:811`/`:813`, `:986`/`:990`, `:1086`/`:1088` — and all 13 rebuild call sites
plus the skip toggle at `:1717-1723` (which rebuilds EVERY participation in the cycle) were enumerated.
`lib/rebuild.ts` zeroes every row (`:53`) and re-allocates through `allocatePayment`, which caps each week at
`amountDue − amountAlreadyPaid` and throws rather than leaving money unplaced (`:114-120`); the pinned path
caps identically (`:88-100`). No other path can write a week amount: `updatePaymentRow` explicitly refuses to
("The AMOUNT of a week row is derived from its allocated receipts", `app/actions/edits.ts:1248-1249`). With
`amountAlreadyPaid ≤ amountDue` on every row and no money on a skipped week, Σ max(0, due − paid) and
max(0, Σdue − Σpaid) are equal by arithmetic.

**Residual that could not be closed without the database** (which this audit is forbidden to query): a legacy
imported row from the old app carrying more than the member's current weekly. No in-app path produces one.

---

### A39. Marked late (the organizer's own stored decision) — **RESOLVED**

**Implementations**

- `app/actions/edits.ts:1506` — canonical: `setWeekLate`, the organizer's own set and clear, written at
  `:1507-1520` with the note
  ```
        const markedLateAt = input.late ? new Date() : null;
  ```
- `app/actions/edits.ts:1377-1379` — `setWeekDeferral` decides the mark's value itself: deferring clears it,
  per §2.29 effect 5
  ```
          update: input.deferred
            ? { isDeferred: true, markedLateAt: null, markedLateNote: null }
            : { isDeferred: false },
  ```
  Removing the deferral does not touch the mark.
- `app/actions/edits.ts:1278` — `updatePaymentRow` flips the SAME `isDeferred` column and makes the opposite
  decision about the mark: it leaves `markedLateAt` stored. **D-40 gap 1, named in §6.4**
  ```
            isDeferred: input.isDeferred,
  ```
- `lib/rebuild.ts:142-149` — a third writer, driven by money rather than an organizer action, and it only
  fires on weeks the money fully covers
  ```
    const covered = state
      .filter((s) => s.markedLate && s.paid >= participation.weeklyAmount && s.paymentId)
      .map((s) => s.paymentId!);
    if (covered.length > 0) {
      await tx.payment.updateMany({
        where: { id: { in: covered } },
        data: { markedLateAt: null, markedLateNote: null },
      });
  ```

**Divergence proof.** Member M, week 15, weekly $500, nothing paid. Monday: the organizer marks week 15 late
(`app/actions/edits.ts:1506` writes `markedLateAt` = Monday). Wednesday he learns of a death in the family and
defers week 15.

- Through the week action panel's deferral control → `:1377-1379` → isDeferred true AND `markedLateAt` null.
  Correct.
- Through the participation editor's week-row editor → `:1278` → isDeferred true, `markedLateAt` still Monday.
  `lib/rebuild.ts:142` does not clear it either: its filter requires `s.paid >= participation.weeklyAmount`,
  and M has paid nothing.

Every READ is correct today, because `lib/derived.ts:191-192` puts DEFERRED above LATE. Two months later the
deferral is removed (`:1379`, `{ isDeferred: false }`, which does not touch the mark). Week 15 instantly reads
LATE again on a timestamp nobody remembers setting, and `lib/standing.ts:164` pulls it into the elapsed count,
so M's `weeksBehind` and `amountOutstanding` rise with it.

The same stored state is mis-counted a second time: `app/admin/(protected)/cycle/position/week-dates.ts:113`,
`if (row?.markedLate) continue;` — the who-is-affected count skips a marked-late member without asking whether
a deferral superseded the mark (D-40 gap 2, §6.4). Both gaps are recorded in the ground truth itself, found 14
Aug 2026.

**Ruling.** Correct: `app/actions/edits.ts:1377-1379`. Wrong: `app/actions/edits.ts:1278` — `updatePaymentRow`
writes `isDeferred` without clearing `markedLateAt`/`markedLateNote`, so the second deferral path leaves the
exact contradiction §2.29 effect 5 exists to prevent.

> §2.29 THE MANUAL LATE MARK — DEFERRAL OUTRANKS IT, effect 5 (Clearing): "**Deferring a week clears an
> existing mark**, so removing the deferral months later cannot spring a forgotten mark back."

**What a human sees.** A member whose week was deferred through the participation editor has a late mark
sitting under the deferral. The day the organizer lifts the deferral the week flips to LATE, their weeks-behind
and outstanding rise, and the chasing statement becomes sendable — because of a decision he reversed months
earlier.

---

### A40. Start week (a member's first cycle week) — **EQUIVALENT**

**Implementations**

- `prisma/schema.prisma:187` — the stored fact
  ```
    startWeek      Int      @default(1)
  ```
- `app/admin/(protected)/cycle/add/add-member-wizard.tsx:99` — the wizard's proposal, and that proposal is what
  gets stored. Floored at 1, not clamped to plannedWeeks
  ```
    const defaultStartWeek = Math.max(1, currentWeek);
  ```
- `lib/messages.ts:237` — re-derives the start week BACKWARDS out of the finish week and the commitment length
  ```
    const startWeek = standing.finishWeek - standing.weeksCommitted + 1;
  ```
  This is the anchor every WhatsApp statement's member-relative week numbers are composed against (`:246`,
  `:256`, `:266`).

**Why EQUIVALENT — and the reason is worth stating because it is fragile rather than structural.**
`lib/messages.ts:237` inverts `calculateFinishWeek` exactly: `standing.finishWeek` is set by
`lib/standing.ts:113` as `calculateFinishWeek(input.startWeek, input.weeksCommitted)` = startWeek +
weeksCommitted − 1, so `finishWeek − weeksCommitted + 1` returns the stored startWeek for every input, and
`standing.weeksCommitted` is the same column both sides read. The wizard's `Math.max(1, currentWeek)` is a
proposal the organizer can change before it is stored, and §2.22's cap is enforced separately on
`weeksCommitted`. **The exposure** is that a member-facing composer derives its anchor by inverting a function
instead of reading the column.

---

### A41. A member's own week number (their week 1 is their start week) — **EQUIVALENT**

**Implementations**

- `lib/member-window.ts:25-35` — clamped: returns null outside the member's window
  ```
  export function ownWeekNumber(input: {
    /** The cycle's week number, as stored. */
    weekNumber: number;
    /** The cycle week their window opens on. */
    startWeek: number;
    weeksCommitted: number;
  }): number | null {
    const own = input.weekNumber - input.startWeek + 1;
    if (own < 1 || own > input.weeksCommitted) return null;
    return own;
  ```
  Its one caller is `app/actions/member.ts:358`, which maps `standing.weeks` — window weeks only.
- `lib/member-week-dates.ts:34-38` — same arithmetic, same function name, different module, **no clamp**
  ```
  export function ownWeekNumber(cycleWeek: number, startWeek: number): number {
    if (!Number.isSafeInteger(cycleWeek) || !Number.isSafeInteger(startWeek) || startWeek < 1) {
      throw new RangeError(`ownWeekNumber needs integers (cycleWeek ${cycleWeek}, startWeek ${startWeek})`);
    }
    return cycleWeek - startWeek + 1;
  ```
  Reached only through `lib/messages.ts:246`/`:256`/`:266` and `lib/member-week-dates.ts:175`.
- `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:159` — SUPERSEDED
  ```
      least(cw.week_no - pt."startWeek" + 1, pt."weeksCommitted")
  ```
  This view was replaced by `20260805150000` and again by `20260806020000`, whose `weeks_behind` (`:37-42`) has
  no such term. Dead code.

**Why EQUIVALENT — downgraded from an earlier RESOLVED after tracing the composer's inputs.** The unclamped
version can only be reached with a cycle week that has a STORED DATE in the composer's map, and that map is
built exclusively from `standing.weeks`: `lib/messages.ts:238-242` filters `standing.weeks` for a date, and
`lib/messaging-engine.ts:120-121` builds those weeks as
`participation.cycle.weeks.filter((w) => w.weekNumber >= participation.startWeek && w.weekNumber <= finishWeek)`.
Any other cycle week has no entry, so `resolveOwnWeeks` throws (`lib/member-week-dates.ts:170-173`) and
`myPhrase` returns the NO_VALUE sentinel, and `myFullLabel` returns NO_VALUE before it ever calls
`ownWeekNumber`. So "week 0" and "week 7 of your 6" are unreachable: every input the composer sees satisfies
startWeek ≤ w ≤ finishWeek, where the clamped and unclamped forms return the same number.
`app/actions/member.ts:353-362` maps the same window weeks. This stays a §5.10 trap — two exported functions
with one name answering one question, one of which cannot say "this week is not theirs" — but it is not a live
divergence, and the SQL copy is dead.

---

### A42. Percent of my weeks paid (the "You" ring), and weeks remaining — **EQUIVALENT**

**Implementations**

- `components/member/member-personal-summary.tsx:39` — canonical
  ```
    const pct = totalWeeks > 0 ? Math.min(Math.round((paidCount / totalWeeks) * 100), 100) : 0;
  ```
- `components/member/member-personal-summary.tsx:59` — the same formula against the animating count; `:66`
  `        setDisplayPct(pct);` lands it back on `pct`
  ```
          setDisplayPct(totalWeeks > 0 ? Math.min(Math.round((n / totalWeeks) * 100), 100) : 0);
  ```
- `components/member/member-group-list.tsx:84-85` — no rounding; the percent is used only as a bar width at
  `:141`, never printed, but the COUNT is printed in the accessible name at `:137`
  ```
    const viewerPct =
      viewer && viewerTotal ? Math.min((viewer.weeksPaid / viewerTotal) * 100, 100) : 0;
  ```
- `app/admin/(protected)/people/people-directory.tsx:259` — the 0/0 → NaN case cannot render: the block is
  inside `:235` `              {p.inActiveCycle && p.weeksCommitted > 0 && (`
  ```
                          width: `${Math.min(100, Math.round((p.weeksPaid / p.weeksCommitted) * 100))}%`,
  ```
- `app/admin/(protected)/waiting/waiting-view.tsx:471-472` — 0..1 fraction
  ```
    const progress =
      row.weeksCommitted > 0 ? Math.min(1, row.weeksPaid / row.weeksCommitted) : 0;
  ```
- `lib/messages.ts:219` — weeks remaining, the same subtraction as `member-personal-summary.tsx:40`
  ```
    const weeksLeft = Math.max(0, standing.weeksCommitted - weeksPaid);
  ```

**Why EQUIVALENT.** The numerators are three derivations of weeks paid — `computeStanding` capped
(`app/actions/member.ts:349`), the SQL view capped (`migration.sql:33-36`), and the directory's receipts
quotient uncapped (`app/admin/(protected)/people/page.tsx:64`) — and they agree for the reasons set out in row
A23 (the cap never binds) and row A22 (the two money bases are held equal). The remaining forks are cosmetic:
`member-group-list.tsx:85` omits `Math.round`, but its value only sizes a bar, so the difference is
sub-pixel; and the NaN hazard at `people-directory.tsx:259` is closed by the `p.weeksCommitted > 0` guard at
`:235`. The formula itself appears five times, which is what §5.10 names — and
`member-personal-summary.tsx:59` is the same expression twice inside one component.

---

### A43. Amount recorded on a week's row (stored per-week paid) — **EQUIVALENT**

**Implementations**

- `app/actions/payments.ts:249` and `:264` — canonical, the recording path
  ```
          const payment = await tx.payment.upsert({
  ...
              amountPaid: { increment: a.applied },
  ```
  Its own comment at `:243-247` names the regime: "Payment.amountPaid stays STORED as an aggregate cache of
  this" / "week's allocations, maintained ONLY inside this transaction, so it" / "can never drift from the
  events."
- `lib/rebuild.ts:53` and `:64` — the replay regime
  ```
    await tx.payment.updateMany({ where: { participationId }, data: { amountPaid: 0 } });
  ...
          data: { amountPaid: { increment: applied } },
  ```
  Zeroes EVERY row of the participation, then re-increments only rows inside start..finish (`:38-39`). Creates
  a missing row at `:67-75` with `          amountPaid: applied,`.
- `lib/draw-settlement.ts:140` and `:147` — the settlement regime; bypasses oldest-first by design, because
  the money is PINNED to the drawn week
  ```
            data: { amountPaid: { increment: deduction.deduct } },
  ...
              amountPaid: deduction.deduct,
  ```
- `lib/draw-settlement.ts:202` — reverse a draw
  ```
          data: { amountPaid: { decrement: allocation.amount } },
  ```
- `lib/draw-settlement.ts:232` — a separately written loop scoped to one payout
  ```
          data: { amountPaid: { decrement: allocation.amount } },
  ```
- `app/actions/edits.ts:1370`, `:1514`, `:1598` — metadata rows, always zero (**added by this pass; Pass 1's
  list was incomplete**)
  ```
            amountPaid: 0,
  ```
  Three upserts create a Payment row purely to carry a deferral flag, a late mark or a note; each sets
  `amountPaid` to 0 on create and never touches it on update, so they cannot move money.

**Why EQUIVALENT.** Every regime writes this column in the same transaction as a matching `PaymentEvent` and
`PaymentAllocation`, and every one refuses rather than writing a partial: `lib/rebuild.ts:114-115` and
`:94-100` throw, `lib/draw-settlement.ts:115-119` throws, and the recording path goes through `planCommit`
(`lib/standing.ts:246`). The two decrement paths delete the event they reverse in the same loop
(`lib/draw-settlement.ts:205` `    await tx.paymentEvent.delete({ where: { id: event.id } });` and `:235`).
`rebuild.ts:53`'s zeroing of rows OUTSIDE the window is safe for the total only because `:114-115` throws when
the money will not fit back inside. The remaining writers were enumerated this pass and only the three
zero-valued metadata upserts were found.

**Worth recording.** §2.14 says "Nothing that can be computed is ever stored, because stored values drift and
computed values cannot", and names exactly two stored decisions (`deferred`, `markedLateAt`) plus
`Payout.feeAmount`. This aggregate is a fourth stored-but-computable value, admitted in its own comment, held
true by write discipline in three files rather than by anything the database enforces — and row A19 shows it
has in fact drifted from the lawful placement on every imported week nobody has edited since.

---

### A44. Carry-deduction offer (balance, most deductible, suggested, net if applied) — **OPEN**

*(Ruling text at OPEN ruling 4. Evidence recorded here.)*

**Implementations**

- `lib/carry-balance.ts:104` and `:114` — `carryOffer`, over the person's live LEDGER balance
  ```
    const maxDeductible = Math.min(balance, payoutNet);
  ```
  `balance` is `:88` `const balance = Math.max(0, Math.trunc(input.ledgerBalance));`, sourced from
  `ledgerBalance(person.ledgerEntries)` at `app/actions/carry-deduction.ts:175`. `netIfApplied` at `:114` is
  `    netIfApplied: payoutNet - maxDeductible,`. Returns
  `{ kind: "none", reason: "They carry no balance." };` when balance is 0 (`:92-94`).
- `app/admin/(protected)/collections/collections-view.tsx:922` — the payout edit panel's own min(debt, net),
  over WEEK arrears
  ```
                  Offer: deduct {formatMoney(Math.min(p.outstanding, parseDollarsToCents(net) ?? p.netAmount))} from the net
  ```
  `p.outstanding` is declared at `:38-39` as
  `  /** Their derived outstanding, for the OFFER (2.18 — never automatic). */` / `  outstanding: number;` and
  populated at `app/admin/(protected)/collections/page.tsx:128`
  `      outstandingFor.set(participation.id, standing.amountOutstanding);` — this cycle's WEEK arrears from
  `computeStanding`, not the ledger balance. Both panels render on the SAME payout row: `CarryDeductionOffer`
  at `collections-view.tsx:825`, the amber box at `:909-925`.
- `app/admin/(protected)/collections/collections-view.tsx:917-918` — the apply half
  ```
                    const current = parseDollarsToCents(net) ?? p.netAmount;
                    setNet(String(Math.max(0, current - Math.min(p.outstanding, current)) / 100));
  ```
  Saved through `updatePayout({` at `:626` (`saveEdit`, `:595-640`), re-read end to end: it sends only
  payoutId/gross/fee/net/status/method/paidAt/notes and never passes `applyCarryDeduction` (whose only
  production call site is `app/actions/carry-deduction.ts:196`), so **no LedgerEntry and no PaymentEvent is
  written for the deducted arrears.**

**Divergence proof.** Bereket wins in week 14. Payout net $10,000. He carries NO balance from any past cycle
(ledger balance $0) but is behind $1,500 on weeks 11–13 of the running cycle. `carryOffer`
(`app/actions/carry-deduction.ts:175 → lib/carry-balance.ts:92-94`) returns
`{ kind: "none", reason: "They carry no balance." }`, and `components/admin/carry-deduction-offer.tsx:55-59`
sets state 'hidden' on `kind === "none"`, so that panel renders nothing. On the same row, the edit panel's
amber box (gated at `:909` on `p.status === "PENDING" && p.outstanding > 0`) renders
`Offer: deduct $1,500 from the net` and pressing it sets Net to $8,500, saved through `updatePayout`.
**Deducted: $0 vs $1,500 for the same member on the same screen.**

**What a human sees.** What the organizer is offered to keep back from cash crossing the table, and against
which debt. One path offers $0 and the other offers $1,500 for the same member in the same minute; only one of
them writes anything to the record.

---

### A45. Applied carry deduction (deducted, payout net after, balance after) — **RESOLVED**

**Implementations**

- `lib/carry-balance.ts:177-179` — `applyCarryDeduction`, documented at `:161` as "THE ONLY PLACE a payout is
  reduced by a carried balance."
  ```
        deducted: input.amount,
        netAfter: input.payoutNet - input.amount,
        balanceAfter: input.ledgerBalance - input.amount,
  ```
  Called at `app/actions/carry-deduction.ts:196-201` with `payoutNet: payout.netAmount,` read inside the
  transaction, and its `netAfter` written to the row at `:204-207`. `deductionRefusal` (`:142-147`) fences
  `amount > ledgerBalance` and `amount > payoutNet`.
- `components/admin/carry-deduction-offer.tsx:177` — "They receive …", reconstructing the payout net as
  `balance + netIfApplied` because `CarryOffer` carries no `payoutNet` field (`lib/carry-balance.ts:55-69`)
  ```
              <strong>{formatMoney(Math.max(0, offer.balance + offer.netIfApplied - (cents ?? 0)))}</strong>
  ```
  That reconstruction equals `payoutNet` **only when balance ≤ payoutNet**, since `maxDeductible` is
  `min(balance, payoutNet)`. It renders inside the `{ticked && (` block at `:158`.
- `components/admin/carry-deduction-offer.tsx:179` — "balance left", the same subtraction as `balanceAfter`,
  floored at zero here
  ```
              <strong>{formatMoney(Math.max(0, offer.balance - (cents ?? 0)))}</strong>
  ```

**Divergence proof.** Selam carries $5,000 (500,000c) from Cycle 1 and wins in Cycle 2 with a payout net of
$2,000 (200,000c). `carryOffer`: maxDeductible = min(500,000, 200,000) = 200,000; suggested = 200,000;
netIfApplied = 200,000 − 200,000 = 0. The panel pre-fills the amount on load
(`setDollars(String(offer.suggested / 100));` at `:65`), so once the box is ticked cents = 200,000 with no
typing. Line `:177` prints They receive = max(0, 500,000 + 0 − 200,000) = 300,000 → **"$3,000"**. The button is
enabled (`valid` at `:126` needs cents ≤ maxDeductible = 200,000). `applyCarryDeduction`, which is what
actually runs, returns netAfter = 200,000 − 200,000 = 0 → **the member receives $0**. Type $500 instead and the
panel says "$4,500" while the truth is $1,500. Line `:179` is unaffected: balanceAfter = 500,000 − 200,000 =
300,000 in both.

**Ruling.** Correct: `lib/carry-balance.ts:178`. Wrong: `components/admin/carry-deduction-offer.tsx:177`.

> §2.18 THE CARRIED BALANCE — PEOPLE, NOT CYCLES, OWE: "- **Winning while owing NEVER auto-deducts.** If
> someone wins $20,000 while owing $5,000, the organizer may still hand over the full $20,000. The system
> shows the balance and *offers* to deduct. The decision is human, always."

**What a human sees.** The sentence the organizer reads while deciding how much of a member's payout to keep
back. Whenever the carried balance exceeds the payout net, the panel overstates what the member walks away
with by exactly (balance − payoutNet) — $3,000 promised against $0 actually handed over in the proof. §2.18
makes this decision human and defines the offer as what the system shows him to decide on; the wrong figure is
shown at exactly the moment of decision and is corrected only afterwards, because the success message at
`:91-98` is built from the server's real `result.data.netAfter`.

---
### A46. Carried balance for a person (ledger balance) — **EQUIVALENT**

**Implementations**

- `lib/ledger.ts:23-29`
  ```
  export function ledgerBalance(entries: readonly LedgerEntryInput[]): number {
    const total = entries.reduce(
      (sum, e) => sum + (e.type === "DEBT" ? e.amount : -e.amount),
      0,
    );
    return Math.max(0, total);
  }
  ```
- `app/actions/ledger.ts:231` (with the two groupBy blocks at `:211-215` and `:218-222`)
  ```
          balance: Math.max(0, (d._sum.amount ?? 0) - (creditBy.get(d.personId) ?? 0)),
  ```
  Two Prisma aggregates, `where: { type: "DEBT" },` and `where: { type: { not: "DEBT" } },`, subtracted per
  person and floored. Rows are seeded from the DEBT aggregate only, then filtered by
  `.filter((b) => b.balance > 0);` at `:233`.
- `lib/ledger.ts:73-76` — `ledgerStory`'s own copy of the sign rule and the floor
  ```
      running += e.type === "DEBT" ? e.amount : -e.amount;
      // The displayed running total never goes below zero, for the same reason
      // the balance does not: a person cannot owe a negative amount.
      return { ...e, balanceAfter: Math.max(0, running) };
  ```
  `running` itself is never clamped, so the LAST `balanceAfter` equals `Math.max(0, Σ)` = `ledgerBalance` by
  construction; `ledgerStory` also calls `ledgerBalance` at `:80` for its own `balance` field.

**Why EQUIVALENT.** Schema citations re-checked and exact: `LedgerEntryType` has exactly three values
(`prisma/schema.prisma:644-654` — DEBT, PAYMENT, FORGIVEN) and the column is non-nullable
(`  type        LedgerEntryType` at `:504`), so `type: { not: "DEBT" }` is exactly the complement the ternary
takes as credits — the SQL split and the ternary partition the same set. Seeding from the DEBT aggregate loses
only people with credits and no debt, whose `ledgerBalance` would be `Math.max(0, negative)` = 0 and who are
dropped by the `balance > 0` filter either way. Three writings of one rule (§5.10), but no input separates
them.

---

### A47. Allocation of a payment, oldest-first (where the money lands) — **EQUIVALENT**

**Implementations**

- `lib/allocation.ts:88-94`
  ```
    for (const week of weeks) {
      if (remaining === 0) break;
      if (week.isSkipped) continue;
      const owed = week.amountDue - week.amountAlreadyPaid;
      if (owed <= 0) continue;
      const applied = Math.min(owed, remaining);
      remaining -= applied;
  ```
  Requires ascending weeks and throws otherwise (`:75-79`); `assertCents` on the amount (`:69`) throws on
  negative or non-integer.
- `lib/week-picking.ts:102-116` — `coverageForAmount`, the typing preview
  ```
    for (const week of [...weeks].sort((a, b) => a.weekNumber - b.weekNumber)) {
      if (left <= 0) break;
      const needs = remainingOn(week);
      // A skipped week is passed over entirely — nobody owes it, so money must
      // not stop there on its way to a week that IS owed.
      if (needs <= 0) continue;
      if (left >= needs) {
        fullWeeks.push(week.weekNumber);
        left -= needs;
      } else {
        partialWeek = week.weekNumber;
        partialAmount = left;
        left = 0;
      }
    }
  ```
  Sorts a copy rather than throwing; clamps the amount with `  let left = Math.max(0, amount);` (`:98`).

**Why EQUIVALENT.** Term by term: `week.isSkipped → continue` equals `remainingOn` returning 0 for a skipped
week (`lib/week-picking.ts:44` `  if (week.isSkipped) return 0;`) followed by `needs <= 0 → continue`;
`owed = due − paid; owed <= 0 → continue` equals `needs = Math.max(0, due − paid); needs <= 0 → continue`,
since both branches only act when the value is positive; `Math.min(owed, remaining)` fills the week when
remaining ≥ owed (the fullWeeks branch) and leaves the rest as one partial when it does not — and at most one
partial can occur in either, because remaining/left reaches 0 on that iteration and both then terminate. The
remaining differences produce an exception rather than a second number: `allocatePayment` throws on unordered
weeks and on a negative or fractional amount, where `coverageForAmount` sorts and clamps. The preview's only
caller passes `  const amount = parseDollarsToCents(dollars) ?? 0;`
(`components/admin/payment-entry.tsx:96`), and `parseDollarsToCents` (`lib/format.ts:25-32`) matches a regex
with no sign and returns a safe integer or null, so the clamp never fires either.

---

### A48. Next week due for a member — **OPEN**

*(Ruling text at OPEN ruling 9. Evidence recorded here.)*

**Implementations**

- `app/actions/member.ts:292-298` — two passes: first uncovered week at or after the current cycle week, then
  the oldest uncovered week as fallback
  ```
      const uncovered = standing.weeks.filter(
        (w) => !w.isDeferred && w.coveredAtCurrentRate < w.amountDue,
      );
      const nextDue =
        uncovered.find((w) => w.weekNumber >= Math.max(cycleWeek, participation.startWeek)) ??
        uncovered[0] ??
        null;
  ```
  `cycleWeek` here is `currentWeekNumber` off the cycle start date. Rendered on the member's own portal —
  re-derived by search: `app/actions/member.ts:352 → app/me/page.tsx:269` `        nextDue={p.nextDue}` →
  `components/member/member-payout-card.tsx:99` `            Next due: {formatDateUTC(nextDue.date)}`.
- `app/actions/messages.ts:276-279` — the same filter with no current-week pass and no fallback: the OLDEST
  uncovered week outright
  ```
        const firstUncovered =
          loaded.standing.weeks.find(
            (w) => !w.isDeferred && w.coveredAtCurrentRate < w.amountDue,
          ) ?? null;
  ```
  Feeds `        weeksCovered: [firstUncovered?.weekNumber ?? loaded.facts.currentCycleWeek],` (`:282`) for
  the PAYMENT_CONFIRMED **preview only**, labelled
  `      sampleNote = "Preview uses a sample receipt of one weekly amount.";` (`:284`). **Corrected from an
  earlier draft:** a real confirmation takes
  `          weeksCovered: data.allocations.map((a) => a.weekNumber),` from the actual allocation
  (`app/actions/payments.ts:332`), so a member's real message can never carry this figure.

**Divergence proof.** Bereket: startWeek 1, 20 weeks committed, $500/week, current cycle week 12. Total paid
$4,500, so `computeStanding` covers weeks 1–9 in full and weeks 10, 11, 12 are uncovered; none deferred.
`member.ts:295-298` → uncovered = [10,11,12,…20]; the `find` takes the first week ≥ max(12, 1) = 12 → nextDue
= **week 12**, and `member-payout-card.tsx:99` prints week 12's date on his own portal. `messages.ts:277-279`
→ firstUncovered = **week 10**, so the organizer's PAYMENT_CONFIRMED preview names week 10. Same standing
object, same minute.

**Why OPEN.** `EQUB_GROUND_TRUTH.md` never uses the phrase "next due" and fixes no label (re-checked by
search). §2.15 governs where money LANDS, which is the question `messages.ts` answers and answers correctly; it
does not say what a portal date labelled "Next due" must name.

**What a human sees.** The date a member reads on their own portal as "Next due". In the proof the member is
told week 12's date while the oldest week his money would actually clear is week 10. No amount changes; the
disagreement is confined to the portal date and an explicitly-labelled preview.

---

### A49. Preview coverage for a typed amount (full weeks, partial week, fits-nowhere) — **EQUIVALENT**

**Implementations**

- `lib/week-picking.ts:118` — the preview the payment grid fills squares from
  ```
    return { fullWeeks, partialWeek, partialAmount, unallocated: left };
  ```
  `coverage.unallocated === 0` is half of the Record button's enable gate at
  `components/admin/payment-entry.tsx:220`
  `  const canRecord = amount > 0 && coverage.unallocated === 0;`.
- `lib/allocation.ts:88-94` — the authority
  ```
    for (const week of weeks) {
      if (remaining === 0) break;
      if (week.isSkipped) continue;
      const owed = week.amountDue - week.amountAlreadyPaid;
      if (owed <= 0) continue;
      const applied = Math.min(owed, remaining);
      remaining -= applied;
  ```
  Reached at commit through `      const plan = planCommit(` (`app/actions/payments.ts:234`) and at preview
  through `    const result = allocatePayment(` (`:112`), both over
  `loaded.windowWeeks.map((w) => w.allocation)`.

**Why EQUIVALENT.** The walks are term-for-term the same (row A47). The two are also fed the same basis: the
client's `PickableWeek` list comes from `getCatchUpWeeks` (`app/actions/payments-view.ts:254-267`), which
filters on the member's window and sets `amountDue` from the weekly amount, `amountAlreadyPaid` from
`payment?.amountPaid ?? 0` and `isSkipped` from the week row — exactly what `loadMemberWindow` builds for the
engine at `app/actions/payments.ts:52-65`. The file's own comment (`lib/week-picking.ts:88-91`) states the
preview is not the authority and the engine wins; on the arithmetic there is nothing for the engine to win.

---

### A50. Pinned settlement coverage (the winner's own week) — **EQUIVALENT**

**Implementations**

- `lib/standing.ts:118-128` — caps at `amountDue` ALONE (nothing has been placed yet at this point), and any
  excess is silently returned to the fungible pool by `    Math.max(0, totalPaid - pinnedTotal),` at `:133`.
  Runs on every READ
  ```
    const pinnedApplied = new Map<number, number>();
    let pinnedTotal = 0;
    for (const w of windowWeeks) {
      const pinned = input.pinnedByWeek?.get(w.weekNumber) ?? 0;
      if (pinned <= 0 || w.isSkipped) continue;
      const applied = Math.min(pinned, w.amountDue);
      if (applied > 0) {
        pinnedApplied.set(w.weekNumber, applied);
        pinnedTotal += applied;
      }
    }
  ```
- `lib/settlement.ts:72-74` — `allocatePinned`: caps at `amountDue` MINUS what has already landed this replay,
  and REPORTS the excess
  ```
    const owed = week.isSkipped ? 0 : Math.max(0, week.amountDue - week.amountAlreadyPaid);
    const applied = Math.min(amount, owed);
    return { applied, unallocated: amount - applied };
  ```
  Its caller refuses on any excess: `lib/rebuild.ts:94-100` throws
  `Recalculation failed: the payout settlement of ${event.amount} cents no longer fits the week it settled…`.

**Why EQUIVALENT — cannot construct a reachable divergence.** The shape of the difference is real: feed both a
60,000c pinned settlement on a week now due 25,000c and standing returns applied 25,000 with 35,000 rejoining
the fungible pool to cover other weeks, while `allocatePinned` returns applied 25,000 and unallocated 35,000,
which rebuild turns into a rolled-back transaction. But every route that can create that state runs the replay
inside the same transaction and is therefore refused: `rebuildParticipationPayments` is called from
`app/actions/edits.ts:541`, `813`, `990`, `1088`, `1187`, `1229`, `1286`, `1381` and — for a skip toggle — from
the loop at `:1717-1723` that rebuilds every participation in the cycle. Settlement creation itself cannot
overshoot, because `planWinnerWeekSettlement` takes only `Math.max(0, amountDue − alreadyPaidOnWeek)` and
refuses with `plan.unabsorbed > 0` at `lib/draw-settlement.ts:115-120`.

**Residual.** The invariant is enforced by the writer, not by the reader: any pinned total that ever exceeds
its week's due — through `scripts/import-cycle.mts`, a hand SQL correction, or a future write path added
without a rebuild — is silently re-spread across other weeks by every screen while the next edit the organizer
attempts dies with "Recalculation failed". Two rules for one cap (§5.10), agreeing only because one of them
refuses everything the other would mis-handle.

---

### A51. Coverage of a week at the CURRENT rate (what the status ladder compares against) — **EQUIVALENT**

**Implementations**

- `lib/standing.ts:144-147` — `computeStanding`: pinned settlements placed first, then ONE fungible total
  (`Math.max(0, totalPaid - pinnedTotal)`, `:133`) re-allocated oldest-first in a single pass
  ```
    const coveredByWeek = new Map<number, number>(pinnedApplied);
    for (const a of effective.allocations) {
      coveredByWeek.set(a.weekNumber, (coveredByWeek.get(a.weekNumber) ?? 0) + a.applied);
    }
  ```
  Surfaced per week as `        coveredAtCurrentRate: coveredByWeek.get(w.weekNumber) ?? 0,` (`:205`) and it is
  what `paymentStatus` is fed (`:209-217`).
- `lib/rebuild.ts:83-84` (the loop at `:83-125`) — the replay: receipt by receipt in
  `paymentEvents: { orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }] },` order (`:32`), pinned events onto
  their own week via `allocatePinned` with `            amountAlreadyPaid: s.paid,` (`:90`), everything else
  oldest-first with earlier placements preserved in `s.paid` (`:105-113`)
  ```
    for (const event of participation.paymentEvents) {
      if (event.pinnedWeekId !== null) {
  ```
  WRITES the result into `Payment.amountPaid`, which is the `        amountPaid: w.storedPaid,` the same
  `StandingWeek` exposes at `lib/standing.ts:204`.

**Why EQUIVALENT.** For fungible money alone the two are identical: allocating a total oldest-first equals
allocating its parts oldest-first in any order, because the fill order is deterministic and each week's
capacity is fixed. The only asymmetry is ordering around pinned events — `computeStanding` places them first
regardless of `receivedAt`, the replay places them in `receivedAt` order. A receipt dated BEFORE the settlement
that would have taken the settled week does not produce a different coverage; it produces the throw at
`lib/rebuild.ts:94-100`. And it is not reachable from the UI: re-derived by search, the ONLY production caller
of `recordPayment` is `components/admin/payment-entry.tsx:226-232`, which passes participationId, amount,
method, idempotencyKey and notes and **no `paidAt`**, so
`      const receivedAt = explicitPaidAt ?? new Date();` (`app/actions/payments.ts:208`) is always later than
an existing settlement. Recording a backdated receipt does not reorder anything either, because
`recordPayment` allocates the new amount over the stored rows rather than replaying — only a later rebuild
replays, and it refuses inside its own transaction.

**Exposure.** `paidAt` on `recordPayment` is caller-supplied and unrestricted (`app/actions/payments.ts:172-178`);
the only thing keeping the two derivations in step is that no UI passes it.

---

### A52. Amount outstanding (owed right now) — **EQUIVALENT**

**Implementations**

- `lib/derived.ts:294-302` — `amountOutstanding`: NETTED across weeks, and money recorded on a SKIPPED week
  still counts toward `paid` while its due is excluded
  ```
    let due = 0;
    let paid = 0;
    for (const [i, week] of weeks.entries()) {
      assertCents(`week[${i}] amountDue`, week.amountDue);
      assertCents(`week[${i}] amountAlreadyPaid`, week.amountAlreadyPaid);
      if (!week.isSkipped) due += week.amountDue;
      paid += week.amountAlreadyPaid;
    }
    return Math.max(0, due - paid);
  ```
- `lib/payments-view.ts:64` — `bulkCatchUpAmount`: clamped PER WEEK, with `    if (w.isSkipped) continue;` at
  `:60` so money on a skipped week is ignored entirely rather than credited
  ```
      total += Math.max(0, w.amountDue - w.amountAlreadyPaid);
  ```

**Why EQUIVALENT on reachable data, though the two are written to disagree.** Netting differs from a per-week
clamp only when some week carries more money than it is due, and no write path can produce that:
`allocatePayment` applies `const applied = Math.min(owed, remaining);` (`lib/allocation.ts:93`),
`allocatePinned` applies `const applied = Math.min(amount, owed);` (`lib/settlement.ts:73`), and any change to
the weekly amount replays every receipt at the new rate through `rebuildParticipationPayments`
(`app/actions/edits.ts:541`). The skipped term differs only when a skipped week carries money, and toggling
`isSkipped` rebuilds every participation in the cycle (`app/actions/edits.ts:1717-1723`), which moves that
money off the skipped week or refuses the toggle. With `paid_i ≤ due_i` for every non-skipped week and 0 on
skipped weeks, Σdue − Σpaid = Σmax(0, due_i − paid_i) identically. **Break either invariant from outside the
app** — `scripts/import-cycle.mts`, a hand SQL fix — and the member page prints $0 outstanding beside a
catch-up button offering $250.

---

### A53. Members needing attention (the behind list) — **RESOLVED**

**Implementations**

- `lib/dashboard.ts:510` (derivation at `:543-581`)
  ```
  export function memberAttention(input: {
  ```
  Builds its own due set from a cycle-wide `elapsedThroughWeek` plus hand-marked weeks (`:543-559`), counts
  skipped weeks only from STORED payment rows —
  `    const skippedCount = elapsedRows.filter((r) => r.isSkipped).length;` (`:565`) — and constructs its
  outstanding input at `:575-579` with only `{ amountDue, amountAlreadyPaid, isDeferred }`, **no `isSkipped`
  field**. Its own doc at `:505-508` claims "Only SKIPPED weeks are excused" and that "this list cannot
  disagree with computeStanding or with the LATE markers beside it" (§5.5).
- `lib/standing.ts:96` (derivation at `:164-186`)
  ```
  export function computeStanding(input: {
  ```
  Decides due-ness per week from that week's OWN stored date through `weekCountsAsDue` (`:164-173`), counts
  skipped weeks from the WINDOW WEEKS —
  `  const skippedElapsed = elapsed.filter((w) => w.isSkipped).length;` (`:176`) — and passes `isSkipped` into
  `amountOutstanding` at `:184` `      isSkipped: w.isSkipped ?? false,`.

**Divergence proof.** Tigist: startWeek 1, 12 weeks committed, $500/week. Weeks 1–6 have elapsed. Week 4 is
cycle-wide SKIPPED and was skipped before anyone paid, so Tigist has no Payment row for it. She has paid
$2,500, which the engine places on weeks 1, 2, 3, 5, 6 (`allocatePayment` passes over skipped weeks at
`lib/allocation.ts:90`).

- `computeStanding`: elapsed = 6 window weeks, skippedElapsed = 1 (read off the week rows), credited = 5,
  `weeksBehind(6, 5, 1)` = max(0, 6 − 1 − 5) = **0** (`lib/derived.ts:146`); `amountOutstanding` receives
  `isSkipped` for week 4, so due = 5 × 50,000 = 250,000, paid = 250,000 → **$0**.
- `memberAttention`: dueWeeks = {1…6}, elapsedCount = 6; `elapsedRows` are the five stored rows, none flagged,
  so skippedCount = 0 and `weeksBehind(6, 5, 0)` = **1**; the `behind === 0` guard at `:567` is passed;
  `elapsedWindow` is six entries of amountDue 50,000 with no `isSkipped`, so `amountOutstanding` computes due =
  300,000 − paid 250,000 = **50,000** and the `owed === 0` guard at `:582` is passed.

`app/admin/(protected)/page.tsx:282-284` then renders "1 behind · $500.00 owed" beside Tigist's name; her own
page and the cycle position both say $0.

**Ruling.** Correct: `lib/standing.ts:96`. Wrong: `lib/dashboard.ts:510`.

> §2.29 THE MANUAL LATE MARK — HIS OWN, AND DEFERRAL OUTRANKS IT: "| 2 | **Arithmetic** | A mark cannot pull a
> not-yet-due deferred week forward, and the attention list applies the same test — so the list and the
> standing derivation cannot disagree. An *elapsed* deferred week still counts as owed: deferral has never
> excused the money. |"

**Rule replaced from an earlier draft**, which quoted §2.14's derived table, "| Weeks behind | weeks elapsed in
their window − weeks credited |" — read literally that has no skipped term at all and therefore argues FOR
`memberAttention` rather than against it. §2.29's arithmetic row is the only ground-truth text that binds these
two derivations to each other by name. **Reservation stated plainly:** its immediate subject is the mark, not
skipped weeks. It settles the question here because both implementations already agree on the RULE —
`memberAttention` passes a `skippedCount` term to `weeksBehind` and its own doc says "Only SKIPPED weeks are
excused" — and differ only in where they look for skipped-ness. This is a defect against a shared intent, not
a question of policy.

**What a human sees.** The dashboard's "needs attention" list names a member as behind and owing money that her
own screens say she does not owe.

---

### A54. Payments left / weeks still to pay (the count owed) — **EQUIVALENT**

**Implementations**

- `lib/messages.ts:218-219` — caps at `weeksCommitted` first, then subtracts
  ```
    const weeksPaid = Math.min(standing.weeksCredited, standing.weeksCommitted);
    const weeksLeft = Math.max(0, standing.weeksCommitted - weeksPaid);
  ```
  Surfaced as `    weeksLeft: String(weeksLeft),` (`:302`) and `    paymentsLeft: String(weeksLeft),` (`:310`).
  The cap lives only here on the messaging path — `lib/messaging-engine.ts:178` hands `StandingFacts` the
  uncapped `weeksCredited: standing.weeksCredited`.
- `components/member/member-personal-summary.tsx:40` — subtracts and floors client-side from props; the cap is
  left to whoever supplied `paidCount`
  ```
    const remainingWeeks = Math.max(0, totalWeeks - paidCount);
  ```
  Rendered at `:161` `            {remainingWeeks} week{remainingWeeks === 1 ? "" : "s"} remaining` and in the
  aria-label at `:118`.

**Why EQUIVALENT — the supplier does cap.** **Surface claim corrected from an earlier draft**, which said
`MemberPersonalSummary` has two call sites at `app/me/page.tsx:259` and `:267`. Re-derived by search, it has
exactly ONE (`app/me/page.tsx:257`, with `        paidCount={p.weeksCredited}` at `:259`); line `:267` is the
`paidCount` prop of a different component, `MemberPayoutCard`. That one call site passes `p.weeksCredited`,
which is set at `app/actions/member.ts:349` to
`          weeksCredited: Math.min(standing.weeksCredited, participation.weeksCommitted),`. So the portal
computes max(0, C − min(K, C)) and `lib/messages.ts` computes max(0, C − min(K, C)) — the identical expression.

**Fragility worth naming:** the cap and the subtraction live in different files on the portal path, so a second
call site passing an uncapped count would show a member a different "weeks remaining" from the one their
message states, and nothing in the component would refuse it.

---

### A55. Who the outstanding money is with (owedBy, per member) — **RESOLVED**

**Implementations**

- `app/actions/cycle-position.ts:205-207` — through `standingFor` (`:170-197`) → `computeStanding` over the
  member's full window, with `pinnedByWeek` supplied (`:192-196`) and `              isSkipped: w.isSkipped,`
  passed per week (`:188`)
  ```
        if (standing.amountOutstanding > 0) {
          owedBy.push({ participationId: p.id, name, amount: standing.amountOutstanding });
        }
  ```
- `lib/dashboard.ts:571-581` — builds the window itself from the cycle-wide elapsed boundary plus hand-marked
  weeks, with **no `isSkipped` field on any entry** and no pinned-settlement handling, and calls the
  `lib/derived.ts` primitive directly rather than going through `computeStanding`
  ```
      const rowsByWeek = new Map(elapsedRows.map((r) => [r.weekNumber, r]));
      const elapsedWindow = [];
      for (const n of [...dueWeeks].sort((a, b) => a - b)) {
        const row = rowsByWeek.get(n);
        elapsedWindow.push({
          amountDue: participation.weeklyAmount,
          amountAlreadyPaid: row?.amountPaid ?? 0,
          isDeferred: row?.isDeferred ?? false,
        });
      }
      const owed = amountOutstanding(elapsedWindow);
  ```

**Divergence proof.** Same member and state as row A53. Tigist, $500/week, weeks 1–6 elapsed, week 4 cycle-wide
SKIPPED with no Payment row for her, $2,500 paid and placed on weeks 1, 2, 3, 5, 6. `cycle-position.ts:205`:
`standing.amountOutstanding` = 250,000 due − 250,000 paid = 0, so she is NOT pushed onto `owedBy` and the
Collection section's "who owes" list omits her; `collectionPosition` also filters `m.amount > 0` at
`lib/cycle-position.ts:218`. `dashboard.ts:581`: `elapsedWindow` is six entries of 50,000 with no `isSkipped`,
so owed = 300,000 − 250,000 = **50,000** and the dashboard reports $500 owed by Tigist. The same cycle's
shortfall total therefore differs by $500 between `/admin` and `/admin/cycle/position`.

**Ruling.** Correct: `app/actions/cycle-position.ts:205`. Wrong: `lib/dashboard.ts:581`.

> §2.29 THE MANUAL LATE MARK — HIS OWN, AND DEFERRAL OUTRANKS IT: "| 2 | **Arithmetic** | A mark cannot pull a
> not-yet-due deferred week forward, and the attention list applies the same test — so the list and the
> standing derivation cannot disagree. An *elapsed* deferred week still counts as owed: deferral has never
> excused the money. |"

Rule replaced from an earlier draft for the same reason given in row A53, with the same stated reservation.

**What a human sees.** Whether a member appears on the dashboard's owed list at all, and the cycle's total
shortfall. In the proof the dashboard names Tigist for $500 and the position page's own owed list does not
contain her.

---

### A56. Outstanding carried to the person's ledger at cycle close (the closing DEBT entry) — **RESOLVED**

**Implementations**

- `lib/cycle-close.ts:154-162`
  ```
    return members
      .filter((m) => m.outstanding > 0)
      .map((m) => ({
        personId: m.personId,
        amount: m.outstanding,
        description:
          `${cycleName} closed — paid ${m.weeksPaid} of ${m.weeksCommitted} weeks` +
          `${m.lastPaymentWeek !== null ? ` (last payment week ${m.lastPaymentWeek})` : ""}, ` +
          `${formatMoney(m.outstanding)} unpaid`,
  ```
  `members` is `memberFinals(cycle, now)`, which maps `  return cycle.participations.map((p) => {` with **NO
  status filter** (`app/actions/cycle-close.ts:60`) over a window of
  `      .filter((w) => w.weekNumber >= p.startWeek && w.weekNumber <= finishWeek)` (`:70`) where finishWeek is
  `    const finishWeek = calculateFinishWeek(p.startWeek, p.weeksCommitted);` (`:61`). **Re-verified:**
  `loadCycleForClose`'s participations include (`app/actions/cycle-close.ts:36-48`) has no `where` clause and
  does not include `breaks` at all, so `memberFinals` is break-unaware by construction. Each row is written as a
  `LedgerEntry` at `app/actions/cycle-close.ts:349-353`.
- `app/actions/participation-close.ts:343-352` — the mid-cycle single-member close
  ```
        if (plan.balanceToRecord > 0) {
          const entry = await tx.ledgerEntry.create({
            data: {
              personId: p.personId,
              type: "DEBT",
              amount: plan.balanceToRecord,
              description:
                `${p.cycle.name} — stopped at week ${input.closingAtWeek}, ` +
                `${formatMoney(plan.balanceToRecord)} unpaid`,
              notes: closeReasonText(reason, note),
  ```
  `plan.balanceToRecord` is `Math.max(0, input.outstandingToDate)` (`lib/participation-close.ts:331`), derived
  by `describe()` over a window filtered by `inWindow` with the new open break folded in — weeks
  startWeek…closingAtWeek only. **Re-verified** at `app/actions/participation-close.ts:314-335`: the close
  writes a `ParticipationBreak` `          fromWeek: input.closingAtWeek + 1,` with `          toWeek: null,`
  and sets `          status: "CLOSED",` plus closedAtWeek, but the participation update touches only
  status/closedAtWeek/closeReason/closeNote/closedAt — **`weeksCommitted` is NOT changed.**

**Divergence proof.** Hana: startWeek 1, weeksCommitted 20, $500/week. She stops after week 12 having paid weeks
1–10 ($5,000). On 20 Aug the organizer closes her participation at closingAtWeek 12: `describe()` builds her
window as weeks 1–12 (`inWindow` with the break at 13→null), outstanding = 12 × 50,000 − 500,000 = 100,000, and
`app/actions/participation-close.ts:344` writes DEBT **$1,000** "Cycle 1 — stopped at week 12, $1,000 unpaid".

On 27 Sep `closeCycle` runs. `loadCycleForClose` selects participations with no status filter, so Hana is still
in `finals`; `memberFinals` uses finishWeek = `calculateFinishWeek(1, 20)` = 20 and never loads her break, so
her window is restored to weeks 1–20, all elapsed by the closing date, and outstanding = 20 × 50,000 − 500,000 =
500,000. `finalBalanceEntries` emits a SECOND entry and `app/actions/cycle-close.ts:349-353` writes DEBT
**$5,000** "Cycle 1 closed — paid 10 of 20 weeks (last payment week 10), $5,000 unpaid".

**Her ledger balance is now $6,000 for a member the platform's own early-close arithmetic put at $1,000.**

**Ruling.** Correct: `app/actions/participation-close.ts:343`. Wrong: `lib/cycle-close.ts:154`.

> §2.18 THE CARRIED BALANCE — PEOPLE, NOT CYCLES, OWE: "**A balance is created two ways:**" / "1. **Early close
> (manual)** — the organizer knows at week 12 that someone will not" / "   continue. He marks them as no longer
> contributing in their profile; the system" / "   calculates the remaining weeks at their rate and closes their
> participation." / "2. **Automatic at cycle end** — if nothing is done, at the final week the system computes"
> / "   every member's balance itself. Paid in full → $0. Behind → the amount."

The rule governs because route 2 is expressly the fallback for when route 1 was not taken — "**if nothing is
done**" — so a participation already closed under route 1 must not also receive route 2's entry.

**What a human sees.** A carried balance that outlives the cycle and the person's whole history with the group
(§2.18: "**The balance belongs to the person and survives cycle deletion.**"). Two DEBT rows for one debt, and
the second is computed over weeks the close deliberately stopped expecting. Also worth noting the wording gap
the two entries leave in the ledger story §2.18 asks for: the mid-cycle entry carries neither `weeksPaid` nor
`lastPaymentWeek`.

---
## A · VISIBLE (30 rows)

---

### V1. SHORTFALL 3 of 5 — `shortfallToCover` / `toCover`: the organizer's OWN hole after paying out a member who then stopped — **EQUIVALENT**

**Implementations**

- `lib/participation-close.ts:336` — canonical, inside `closePlan`
  ```
      shortfallToCover: input.alreadyPaidOut > 0 ? amountLeaving : 0,
  ```
  `amountLeaving = weeksLeavingExpectation({startWeek, weeksCommitted, closingAtWeek}) * input.weeklyAmount`
  (`:323-324`). `alreadyPaidOut` is supplied by `app/actions/participation-close.ts:137-140`, which filters
  `.filter((po) => po.status === "COLLECTED")`.
- `app/actions/cycle-position.ts:264` — inline copy for the position screen's stopped list
  ```
          shortfallToCover: alreadyPaidOut > 0 ? amountLeaving : 0,
  ```
  `closedAtWeek` = `effectiveFinishWeek(breaks)` (`:239-243`); amountLeaving = `weeksLeavingExpectation(...)` ×
  weeklyAmount (`:246-251`); `alreadyPaidOut` from the COLLECTED-only map at `:231-236`
  (`      if (p.status !== "COLLECTED" || !p.luckyNumber) continue;`).
- `app/actions/dashboard.ts:300` — third inline copy for the dashboard's stopped list
  ```
              shortfallToCover: paidOut > 0 ? amountLeaving : 0,
  ```
  Same `closedAtWeek = effectiveFinishWeek(breaks)` (`:275-279`), same `weeksLeavingExpectation` × weeklyAmount
  (`:286-291`), same COLLECTED-only filter (`:280-285`).
- `lib/cycle-position.ts:221` — pure roll-up, computes nothing new
  ```
      toCover: stoppedBy.reduce((s, m) => s + m.shortfallToCover, 0),
  ```

**Why EQUIVALENT — proof strengthened rather than accepted.** The two post-close sites both take
`closedAtWeek = effectiveFinishWeek(breaks)`; the close transaction writes the break at
`fromWeek: input.closingAtWeek + 1` (`app/actions/participation-close.ts:317`) and `effectiveFinishWeek`
returns the week before an open break, so `closedAtWeek` reproduces the `closingAtWeek` that `closePlan` used.
The edge an earlier draft did not test is also closed: if the organizer closes at a week PAST the committed
finish the two inputs genuinely differ — but `lib/participation-close.ts:192-199` is
`  const committed = calculateFinishWeek(p.startWeek, p.weeksCommitted);` /
`  return Math.max(0, committed - Math.min(committed, p.closingAtWeek));`, which returns 0 for both, so the
outputs still cannot differ. `alreadyPaidOut` is COLLECTED-only in all three. **No input exists on which they
diverge.**

Ranked `visible` because this is an organizer-only planning figure — money he must find, not money a member
owes. Surfaces re-derived: `components/admin/close-participation.tsx:225-226` and `:383-386`;
`app/admin/(protected)/page.tsx:334-336`; `app/admin/(protected)/cycle/position/page.tsx:272-275`. The name
`shortfallToCover` is already distinct and should stay distinct.

---

### V2. SHORTFALL 4 of 5 — `planWinnerWeekSettlement.shortfall`: what ONE member still owes on ONE week — **EQUIVALENT**

**Implementations**

- `lib/settlement.ts:43` — the winner's drawn week; NO skipped-week guard of its own, delegated to its caller
  as its doc at `:31-33` states
  ```
    const shortfall = Math.max(0, input.amountDue - input.alreadyPaidOnWeek);
  ```
  Sole production caller confirmed by grep across the repo excluding tests: `lib/draw-settlement.ts:110`.
- `lib/settlement.ts:72` — `allocatePinned`, the replay path, carries its own skipped-week zero
  ```
    const owed = week.isSkipped ? 0 : Math.max(0, week.amountDue - week.amountAlreadyPaid);
  ```
- `lib/week-picking.ts:45` — `remainingOn`, with the skipped zero at `:44`
  ```
    return Math.max(0, week.amountDue - week.amountPaid);
  ```
- `lib/payments-view.ts:64` — `bulkCatchUpAmount`, with its own skipped exclusion at `:60`
  ```
      total += Math.max(0, w.amountDue - w.amountAlreadyPaid);
  ```
- `lib/allocation.ts:91` — the allocation engine itself; unclamped but guarded on the next line and preceded by
  the skipped skip at `:90`
  ```
      const owed = week.amountDue - week.amountAlreadyPaid;
  ```
- `lib/draw-settlement.ts:108` — the caller that supplies `settlement.ts:43`'s skipped/out-of-window zero
  ```
      const amountDue = inWindow && !excused ? participation.weeklyAmount : 0;
  ```
  Its `inWindow` at `:104` is
  `    const inWindow = weekNumber >= participation.startWeek && weekNumber <= finishWeek;` — BREAK-UNAWARE,
  unlike `lib/participation-close.ts:120-124`.

**Why EQUIVALENT.** All are `max(0, due − paid)` with a skipped-week zero; the only structural difference is
WHERE the zero lives, and `settlement.ts:43`'s single production caller supplies it (verified by grepping
`planWinnerWeekSettlement` across `.ts`/`.tsx` excluding tests — the only hits are its own definition, its doc
comment, and `lib/draw-settlement.ts:24`/`:110`). It should be called `remainingOnWeek`, the name
`lib/week-picking.ts:43` already uses; calling it `shortfall` is what put it on this list.

**Visibility downgraded from headline to visible:** with no divergence, nothing reaches a screen differently —
the rank describes the divergence, not the quantity, which does move a real payout.

**One cross-boundary risk, recorded not resolved,** because it belongs to row A18: `lib/draw-settlement.ts:104`
does not consult `ParticipationBreak`, so a member holding a CLOSED (returned-from) break who is drawn on a
week inside it would have `amountDue` set to their full weekly and the settlement would deduct a week they do
not owe. **Reachability caveat added by this pass:** while a member is inside an open break their participation
is CLOSED and their numbers have left the pool, so this needs a draw dated into a break that was subsequently
closed — narrow, but not impossible given §2.23 lets the organizer edit draws and week dates.

---

### V3. Fee withheld when returning an undrawn member's money (`feeOnReturn`) — **RESOLVED**

**Implementations**

- `lib/final-position.ts:69` — PER LUCKY NUMBER
  ```
    return feePreview(input)?.fee ?? 0;
  ```
  `feePreview` re-splits the current weeklyAmount at the cycle unit (`lib/fee-preview.ts:79`) and sums a fee per
  number (`:102-104`). Not reduced by stopping early; the RETURN is floored at zero, never the fee —
  `lib/final-position.ts:126` `    const amount = Math.max(0, input.paidIn - fee);`.
- `lib/participation-removal.ts:100-101` — TOTAL-FIRST: one multiplication on the whole weekly, one rounding
  ```
    const gross = a.weeklyAmount * a.weeksCommitted;
    return calculateFee(Math.max(0, gross), a.feePercent);
  ```
  Answers the same question by the road `lib/final-position.ts:45-50` exists to avoid (that header verified
  verbatim: "// ONE DERIVATION. This computes through `feePreview`, which sums PER LUCKY / // NUMBER through
  the same `calculatePayout` the draw, the portal and the / // archive use.").
- `app/actions/cycle-position.ts:274-279` — a call, not a second implementation
  ```
                    feeOnReturn({
                      weeklyAmount: p.weeklyAmount,
                      weeksCommitted: p.weeksCommitted,
                      unitAmount: cycle.unitAmount,
                      feePercent: cycle.feePercent,
                    }),
  ```
  But the comment immediately above it, verified verbatim at `:265-267`, reads: "        // Money he is HOLDING
  that is theirs: what a member who was never / // drawn paid in. No fee is withheld — a fee is only ever taken
  from a / // payout and they never had one (lib/final-position.ts)." **The code four lines below subtracts the
  fee.** That sentence is the pre-D-41 reasoning §2.30 overturned, left sitting on top of the corrected code
  (§5.5).

**Divergence proof.** Cycle unit $123.45 (12,345c), member weekly $246.90 (24,690c) → two numbers of $123.45,
weeksCommitted 1, feePercent 2.5.

- PER NUMBER: gross 12,345c each, fee `Math.round(12345 × 250 / 10000)` = `Math.round(308.625)` = 309c each →
  `feeOnReturn` = **618c**.
- TOTAL-FIRST: gross 24,690c, fee `Math.round(24690 × 250 / 10000)` = `Math.round(617.25)` = **617c**.

One cent apart, and both figures are already pinned by test — `lib/fee-preview.test.ts:128`
`    expect(p.fee).toBe(618);` and `:130` `    expect(calculateFee(p.gross, 2.5)).toBe(617);` on exactly these
inputs. Constructible: `validateParticipationFields` (`lib/participation-rules.ts:17-35`) permits
weeksCommitted 1, and the unit and fee percent are organizer-set. At the live 2% on a $1,000 unit the two roads
meet, because each full-unit number's fee is an exact integer and at most one remainder number can be
fractional.

**Ruling.** Correct: `lib/final-position.ts:61-69`. Wrong: `lib/participation-removal.ts:100-101` (total-first
where the rule says per lucky number); `app/actions/cycle-position.ts:265-267` (the comment asserts no fee is
withheld, directly above code that withholds one — §5.5).

> §2.30: "**Per lucky number, never once on the pot.** Each number is its own payout of its own amount over its
> owner's committed weeks, and each pays its own fee — two numbers, two payouts, two fees. The arithmetic
> happens to agree with one combined payout; the *record* does not, and the record is what the archive keeps."
>
> §2.30, on the basis: "**What is recoverable is floored at what they paid in.** For a member who stopped
> undrawn, the money returned is `paid in − fee`, never below zero."

**What a human sees — downgraded from headline.** Re-derived by search: `feeOnReturn` reaches a member screen
(`lib/final-position.ts:180` via `app/actions/member.ts:220` → `/me`) and the organizer's cash position
(`app/actions/cycle-position.ts:274-279` → `owedBack` → `owedToStopped`); `feeAttributable` reaches only
`components/admin/remove-from-cycle.tsx:300` and the audit summary. On this divergence the member's figure is
the CORRECT one — the wrong figure appears only on the organizer's removal screen. Separately and regardless of
arithmetic: the comment governing the group's owed-back figure asserts that NO fee is withheld from a stopped,
undrawn member, which is the reading §2.30 was written to correct — anybody checking that figure against the
rule reads the comment, agrees with it, and moves on.

---

### V4. Fee attributable to a member being removed from a cycle (`feeAttributable`) — **RESOLVED**

**Implementations**

- `lib/participation-removal.ts:100-101` — total-first, off the participation's weekly amount, never off the
  lucky-number rows and never off a stored payout
  ```
    const gross = a.weeklyAmount * a.weeksCommitted;
    return calculateFee(Math.max(0, gross), a.feePercent);
  ```
  The `Math.max(0, gross)` clamp is dead: `lib/participation-rules.ts:17-35` already forces weeklyAmount ≥ 1 and
  weeksCommitted ≥ 1. **Note for the fix:** `ParticipationAttachments` (`lib/participation-removal.ts:34-60`)
  carries no `unitAmount` and its `numbers` entries carry no amount, so the per-number road needs plumbing
  before it can be taken.
- `lib/participation-removal.ts:86` — two claims, both false of the code below it
  ```
  /** The fee attributable to this member — 2% of what their payouts grossed. */
  ```
  The percent is not 2 — it is `a.feePercent`, read from the cycle. And it is not "what their payouts grossed"
  — it is the whole commitment, charged in full to a member who was never drawn and has no payouts at all
  (§5.5).
- `lib/final-position.ts:61-69` — the per-number answer to the same question
  ```
  export function feeOnReturn(input: {
    return feePreview(input)?.fee ?? 0;
  ```
  (`:61` is the signature line and `:69` the body line, quoted with the intervening parameter block elided.)

**Divergence proof.** Same construction as V3: unit $123.45, weekly $246.90, 1 week, 2.5% → `feeAttributable`
617c, `feeOnReturn` 618c. And the stored-fee case: a member drawn under a 2% cycle whose fee percent is later
corrected to 3% has "Fee attributable to them: $600.00" rendered for a payout whose stored `feeAmount` is $400.

**Surface re-derived by search, not from Pass 1:** `lib/participation-removal.ts:142`
``  lines.push(`Fee attributable to them, ${money(feeAttributable(a))}, comes out of the cycle total.`);`` and
`app/actions/participation-removal.ts:176` `        feeAttributable: feeAttributable(attachments),` →
`components/admin/remove-from-cycle.tsx:300`
`            <p>Fee attributable to them: {formatMoney(preview.feeAttributable)}.</p>`. Those two grep hits are
the ONLY renders in the repo. **Correction to an earlier draft:** the audit path is narrower than claimed. Line
142 sits inside `removeCompletely`, so the fee sentence enters the permanent audit entry
(`app/actions/participation-removal.ts:320-329`, `consequences.lines.join(" ")`) only on the "remove
completely" choice; `keepMoneyRecords` writes no fee line. The preview screen shows the figure on both choices.

**Ruling.** Correct: `lib/final-position.ts:61-69` (`feeOnReturn`) — the per-number derivation `feeAttributable`
should call. Wrong: `lib/participation-removal.ts:100-101`; `lib/participation-removal.ts:86` (the comment:
wrong percent, wrong basis).

> §2.30: "**Per lucky number, never once on the pot.** Each number is its own payout of its own amount over its
> owner's committed weeks, and each pays its own fee — two numbers, two payouts, two fees."

**What a human sees.** The figure on the destructive-removal confirmation, and — on the "remove completely"
choice only — the figure frozen into the audit entry that is the only surviving record of what the removal cost
the cycle.

---

### V5. Current week of the cycle (which week "now" is) — **OPEN**

*(Ruling text at OPEN ruling 11, jointly with row V30.)*

**Implementations**

- `lib/money.ts:162-168` — `currentWeekNumber`, a projection off `Cycle.startDate` on UTC calendar days
  ```
  export function currentWeekNumber(startDate: Date, today: Date): number {
    assertValidDate("startDate", startDate);
    assertValidDate("today", today);
    const dayDiff = Math.floor((utcDay(today) - utcDay(startDate)) / MS_PER_DAY);
    if (dayDiff < 0) return 0;
    return Math.floor(dayDiff / DAYS_PER_WEEK) + 1;
  }
  ```
  Callers RE-DERIVED by grep (Pass 1's Surfaces list was not used): `app/actions/member.ts:232`, `:440`,
  `:502`; `app/actions/payments-view.ts:105`; `app/actions/payments.ts:374`; `app/actions/dashboard.ts:88`;
  `app/actions/cycle-close.ts:57`; `app/admin/(protected)/cycle/page.tsx:33`;
  `app/admin/(protected)/collections/page.tsx:98`; `lib/messaging-engine.ts:110`; and one Pass 1 MISSED —
  `app/admin/(protected)/cycle/add/page.tsx:87`.
- `lib/commitment.ts:191-197` — `currentWeekFromRows`
  ```
    if (last === 0) return currentWeekNumber(input.cycleStartDate, input.today);
    // Past the last stored row the rhythm continues from that row, not from a
    // start date that may since have been corrected.
    const weeksSince = Math.floor(
      (input.today.getTime() - lastDate!.getTime()) / (7 * MS_PER_DAY),
    );
    return last + Math.max(0, weeksSince);
  ```
  Callers re-derived by grep: `app/actions/wheel.ts:110` (draw eligibility + the §2.27 warning list),
  `app/actions/waiting.ts:75`, `app/actions/cycle-position.ts:103`, `app/actions/participation-close.ts:89`,
  `:203`, `:441`.
- `app/admin/(protected)/cycle/page.tsx:39` — a third value
  ```
    const effectiveWeek = Math.max(1, week);
  ```
  Verified in place at `:39` against `const week = currentWeekNumber(cycle.startDate, new Date());` at `:33`.
  Before the cycle starts every other screen reads week 0; this page charges week 1's pot (`:42-45`).
- `lib/messages.ts:352` — **reclassified by this pass.** Not a rival clock: a documented deliberate clamp (the
  comment at `:343-351` states it, and §2.22's "Their portal shows *their* window, never the group's" governs
  it). Listed for completeness
  ```
      myCurrentWeek: myFullLabel(Math.min(standing.currentCycleWeek, standing.finishWeek)),
  ```
- `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:149` — SUPERSEDED
  ```
           greatest(0, floor((current_date - c."startDate"::date) / 7.0) + 1)::int AS week_no
  ```
  Confirmed superseded: every migration touching `member_progress` was grepped — `20260804230000`,
  `20260805150000`, `20260806020000` — and the last CREATE OR REPLACEs the same view object with no
  current-week term at all. This copy can no longer drift.

**Divergence proof — calendar corrected.** (An earlier draft's narrative said "two weeks" while its own dates
described a ONE-week shift; the dates and the result were right, the words were not.) Cycle 1: startDate Sunday
17 May 2026, week n dated 17 May + 7(n−1). The organizer postpones the week-8 draw by ONE week and shifts weeks
8-20 (§2.23 lets him), so week 12's stored date becomes 2026-08-09 and week 13's becomes 2026-08-16.
`Cycle.startDate` is untouched. Today is Friday 2026-08-14.

- `currentWeekNumber`: `utcDay(2026-08-14) − utcDay(2026-05-17)` = 89 days; `floor(89/7)+1` = **13**.
- `currentWeekFromRows`: highest ARRIVED row is week 12 (2026-08-09 ≤ today; week 13's 2026-08-16 has not);
  weeksSince = floor(5/7) = 0; result **12**.

Consequence chain, each surface re-derived: `payments-screen.tsx:101` renders "Week {data.currentCycleWeek}" =
Week 13 (fed `app/actions/payments-view.ts:105`) and `payments-members.tsx:285` highlights row 13 as `isNow`;
`payments-members.tsx:277` offers "Record week 13 · $X". Meanwhile `lib/wheel.ts:49` admits only owners with
`startWeek <= 12 <= finishWeek`. A member whose startWeek is 13 is billed for week 13 on the payments screen and
is not in the draw pool on the wheel.

**What a human sees.** Which week the payments screen calls "now", which week "Record week N" pre-fills, and who
the wheel will let him draw.

---

### V6. Weeks left in a member's window / at risk — **OPEN**

*(Ruling text at OPEN ruling 12, jointly with row V17.)*

**Implementations**

- `lib/wheel.ts:85-87` — ONE function, TWO clocks
  ```
      const finishWeek = calculateFinishWeek(p.startWeek, p.weeksCommitted);
      const weeksLeft = finishWeek - input.currentWeek;
      if (weeksLeft > input.weeksAhead) continue;
  ```
  `app/actions/dashboard.ts:372-387` feeds it `currentWeekNumber` with `weeksAhead: 3,` (`:387`);
  `app/actions/wheel.ts:215-220` feeds it `currentWeekFromRows` with `weeksAhead: WARNING_WEEKS_AHEAD,` where
  `app/actions/wheel.ts:36` is `const WARNING_WEEKS_AHEAD = 3;`. Both render:
  `app/admin/(protected)/page.tsx:62-68` and `:229-233` ("Windows ending undrawn (2.27)"), and
  `app/admin/wheel/setup/wheel-setup.tsx:463-469`.
- `app/actions/waiting.ts:202` — the same subtraction written again, over `currentWeekFromRows` (`:75`)
  ```
        const weeksLeft = finishWeek - currentWeek;
  ```
  Fed to `isAtRisk` at `:218`.
- `lib/waiting.ts:76-77` — `isAtRisk`, threshold 4 not 3
  ```
  export function isAtRisk(input: { weeksLeft: number }): boolean {
    return input.weeksLeft <= AT_RISK_WEEKS;
  ```
  `lib/waiting.ts:67` `export const AT_RISK_WEEKS = 4;`, justified at `:65` as " * is the organizer's own
  working margin: enough time to plan a draw for them." Rendered at
  `app/admin/(protected)/waiting/waiting-view.tsx:499` and `components/admin/waiting-summary.tsx:125`.

**Divergence proof — an earlier draft's proof was self-defeating and is replaced.** It set the two clocks one
week apart AND the two thresholds one week apart, and those cancel exactly: the dashboard warns iff
`finishWeek − D <= 3` (D ≥ F−3), and with W = D−1 the Waiting screen flags iff `finishWeek − (D−1) <= 4`, which
is also D ≥ F−3. Both fire on the same day; its own worked numbers show this.

**Two corrected, independent proofs.**

(a) **THRESHOLD, when the clocks agree** — the ordinary case, no date correction. Today 2026-08-14, both clocks
read 13. Meheret: startWeek 5, weeksCommitted 13 → finishWeek 17, undrawn, ACTIVE. Waiting: weeksLeft = 17 − 13
= 4; `isAtRisk(4 <= 4)` = true → the amber at-risk row (`waiting-view.tsx:499`) and +1 to `atRiskCount`
(`components/admin/waiting-summary.tsx:103`, "1 at risk"). Dashboard: 17 − 13 = 4 > 3 → she is NOT in
`undrawnWarnings`, and `app/admin/(protected)/page.tsx:62` renders nothing. **Same member, same instant,
flagged on one screen and absent from the other.**

(b) **CLOCK, at one identical threshold of 3** — the divergence the earlier draft missed entirely. Same
one-week postponement as V5 (dashboard clock 13, wheel clock 12). Meheret: startWeek 5, weeksCommitted 12 →
finishWeek 16, undrawn. Dashboard: 16 − 13 = 3 ≤ 3 → "Windows ending undrawn (2.27)" names her. Wheel setup:
16 − 12 = 4 > 3 → `wheel-setup.tsx:463` renders no warning block for her. **The SAME function, the SAME
threshold, two screens, opposite answers.**

**What a human sees.** Which undrawn members the organizer is warned about and on which week — the §2.27
safeguard against someone finishing the cycle without ever being drawn.

---

### V7. Effective finish week — where a stopped member's window ends — **RESOLVED**

Pass 1 listed this quantity twice (thematically, and again as `#36`). Both rows describe one defect and one
proof; they are adjudicated together at **row A28**, which carries the full implementation list, the Tsion
proof, the §2.18 quote and the surfaces. **Correct:** `lib/participation-close.ts:169`. **Wrong:**
`app/actions/participation-close.ts:453` and `:459`, `app/actions/participation-removal.ts:239`.

The one addition this second listing contributes is the organizer-facing consequence, which is `visible` rather
than headline: after reactivating a member who was removed with "keep their money records", the cycle's "should
have come in" silently drops by everything that member ever paid, and the coverage verdict on the Cycle
position page reads as a surplus that is not there.

---

### V8. Which members count as behind — **EQUIVALENT**

**Implementations**

- `lib/members-view.ts:60` — canonical
  ```
    if (filter === "behind") return row.outstanding > 0;
  ```
- `lib/cycle-close.ts:155` — `finalBalanceEntries`, decides who gets a DEBT ledger entry
  ```
      .filter((m) => m.outstanding > 0)
  ```
- `lib/cycle-close.ts:256`
  ```
        membersShort: input.members.filter((m) => m.outstanding > 0).length,
  ```
- `lib/cycle-position.ts:218` — callers already filter the same way
  (`app/actions/cycle-position.ts:205`), so the test runs twice on that path
  ```
      owedBy: [...input.owedBy].filter((m) => m.amount > 0).sort((a, b) => b.amount - a.amount),
  ```
- `app/actions/cycle-close.ts:295` — beside `lib/cycle-close.ts:256`, two counts of one population on one screen
  ```
          membersShort: finals.filter((m) => m.outstanding > 0).length,
  ```
- `lib/dashboard.ts:567` and `:582` — `memberAttention` requires BOTH
  ```
      if (behind === 0) continue;
  ...
      if (owed === 0) continue;
  ```
  `owed` computed at `:581` `    const owed = amountOutstanding(elapsedWindow);` from STORED per-week amounts
  (`        amountAlreadyPaid: row?.amountPaid ?? 0,` at `:577`).

**Why EQUIVALENT on membership.** Every site is `amount > 0` on an outstanding figure. The algebra was
re-derived rather than trusted: weeksBehind = max(0, elapsed − skipped − credited) with credited =
floor(totalPaid/weekly), and outstanding = Σ non-skipped elapsed amountDue − Σ elapsed covered. Because
allocation fills the oldest weeks first, behind = 0 implies totalPaid ≥ (elapsed − skipped) × weekly implies
coverage over the elapsed set is complete implies outstanding = 0, and the converse likewise. Paid-ahead, a
skipped week inside the elapsed set, a partial to the cent, and a pinned settlement on a future week (member
paid $0, wins week 15: both give 11 behind and $6,000 owed) were each tested — they reach zero together every
time.

**Corrected note for the amount, which belongs to row A55.** An earlier draft's amount divergence used a rate
change, and that is REFUTED — every write of `weeklyAmount` calls `rebuildParticipationPayments` in the same
transaction (`app/actions/edits.ts:541`, `:813`, `:990`, `:1088`). The amounts CAN still differ, but only when
stored money sits on a not-yet-elapsed week while an elapsed week is empty — reachable through imported
hand-placement (`lib/rebuild.ts:13-15`). Concrete: weeks 1-3 elapsed, week 4 not; stored week 4 = $500, weeks
1-3 = $0; weekly $500. `lib/dashboard.ts:577` sees $0 across weeks 1-3 → owed $1,500. `lib/standing.ts:182`
re-allocates the $500 onto week 1 → outstanding $1,000. Both put her on the behind list; the dashboard's
attention row says $1,500 and her profile says $1,000.

---

### V9. Weeks committed (a member's commitment length) — **EQUIVALENT**

**Implementations**

- `prisma/schema.prisma:188` — the stored fact
  ```
    weeksCommitted Int
  ```
- `lib/money.ts:126-130` — the CAP, not the value
  ```
  export function remainingWeeksInCycle(plannedWeeks: number, startWeek: number): number {
    assertPositiveInt("plannedWeeks", plannedWeeks);
    assertPositiveInt("startWeek", startWeek);
    return Math.max(0, plannedWeeks - startWeek + 1);
  }
  ```
- `lib/commitment.ts:47-49` — the OFFERED default, two clamps the primitive does not have
  ```
  export function weeksToFinishWithGroup(plannedWeeks: number, startWeek: number): number {
    return Math.max(1, remainingWeeksInCycle(plannedWeeks, Math.min(startWeek, plannedWeeks)));
  }
  ```
- `app/admin/(protected)/payments/payments-grid.tsx:352` — the inverse, at the surface; the identical expression
  repeats on `:353`
  ```
                          ? `${c.numbersLabel}: ${c.weeksCredited} of ${c.finishWeek - c.startWeek + 1} weeks paid`
  ```
- `app/admin/(protected)/payments/payments-grid.tsx:357`
  ```
                        {c.weeksCredited}/{c.finishWeek - c.startWeek + 1}
  ```
- `app/admin/(protected)/payments/payments-members.tsx:256`
  ```
                      {row.weeksCredited} of {row.finishWeek - row.startWeek + 1} weeks
  ```

**Why EQUIVALENT.** The three surface copies invert an identity: the `finishWeek` they read is set by
`app/actions/payments-view.ts:55`
`  const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);` and carried
through `lib/payments-view.ts:248` `      finishWeek: m.finishWeek,` unchanged, so
`finishWeek − startWeek + 1` is `weeksCommitted` by construction. They would stop agreeing the moment a caller
passed `effectiveFinishWeek` (`lib/participation-close.ts:133`) instead — which is exactly the break-aware
choice OPEN ruling 2 leaves open, and the reason these three inversions are worth deleting rather than leaving.
The `commitment.ts`/`money.ts` pair are different quantities (the offered default vs the raw remaining count)
and they do differ — plannedWeeks 20, startWeek 25: `remainingWeeksInCycle(20, 25)` = 0 and
`weeksToFinishWithGroup(20, 25)` = 1 — but no site uses the primitive raw as an offer, and a 0-week commitment
could not be saved anyway (`calculateFinishWeek` asserts weeksCommitted ≥ 1).

---

### V10. Last payment week — **EQUIVALENT**

**Implementations**

- `lib/standing.ts:199` — canonical: LAST ELEMENT, window-scoped
  ```
      lastPaymentWeek: paidRows.length > 0 ? paidRows[paidRows.length - 1].weekNumber : null,
  ```
  `paidRows` is `:188` `  const paidRows = windowWeeks.filter((w) => w.storedPaid > 0);`.
- `app/actions/dashboard.ts:112` and `:117` — MAXIMUM, all rows
  ```
        const paid = p.payments.filter((pm) => pm.amountPaid > 0).map((pm) => pm.week.weekNumber);
  ...
          lastWeekWithMoney: paid.length > 0 ? Math.max(...paid) : null,
  ```
- `app/actions/cycle-position.ts:125` and `:130` — the same, again
  ```
        const paid = p.payments.filter((pm) => pm.amountPaid > 0).map((pm) => pm.week.weekNumber);
  ...
          lastWeekWithMoney: paid.length > 0 ? Math.max(...paid) : null,
  ```
- `app/admin/(protected)/cycle/position/week-dates-data.ts:79` and `:84` — a third copy, whose own comment at
  `:75-77` says it must be "Identical to the position" / "action's, because it must be"
  ```
      const paid = p.payments.filter((pm) => pm.amountPaid > 0).map((pm) => pm.week.weekNumber);
  ...
        lastWeekWithMoney: paid.length > 0 ? Math.max(...paid) : null,
  ```

**Why EQUIVALENT.** The two are not even asked the same question: `standing.lastPaymentWeek` fills the messaging
token, while `lastWeekWithMoney` exists only to feed `lib/participation-close.ts:169`'s three-term fallback. The
last-element-versus-maximum difference cannot bite either way: `computeStanding` feeds every window week to
`allocatePayment` (`lib/standing.ts:132-143`), which refuses unordered input outright —
`lib/allocation.ts:75-79` `    if (week.weekNumber <= previousWeekNumber) {` / `      throw new RangeError(` —
so a standing object with out-of-order weeks cannot exist and the last element IS the maximum. The scope
difference (window rows vs every payment row) needs a paid row outside startWeek..finishWeek, and
`lib/rebuild.ts:53` zeroes every row and re-allocates only into the window, throwing at `:114-115` rather than
leaving money outside. The three `lastWeekWithMoney` copies are character-identical and none is imported —
§5.10, three times over, in three files whose own comments say they must not diverge.

---
### V11. Selected week (which week a screen is showing) — **OPEN**

*(Ruling text at OPEN ruling 17.)*

**Implementations**

- `app/actions/dashboard.ts:92-96` — two branches; falls back to the derived current week even when no row
  exists for it
  ```
      const requested = input?.weekNumber;
      const selectedWeek =
        requested !== undefined && cycle.weeks.some((w) => w.weekNumber === requested)
          ? requested
          : currentWeek;
  ```
  The downstream reads at `:345-356` then use `?? null` and `?? today` fallbacks, so an absent week renders as
  an empty breakdown rather than a refusal.
- `lib/week-focus.ts:36-40` — strict shape check, returns null; a repeated `?week` param resolves to the FIRST
  at `:31`. Called once, at `app/admin/(protected)/payments/page.tsx:35`
  ```
    if (!/^\d+$/.test(value)) return null;

    const week = Number(value);
    if (week < 1 || week > weeksInCycle) return null;
    return week;
  ```
- `app/admin/(protected)/this-week/page.tsx:50-53` — a second parse rule for the same param name;
  `Number.parseInt` accepts `"7abc"` where the regex does not
  ```
    const requested = Number.parseInt(week ?? "", 10);
    const result = await getDashboard(
      Number.isSafeInteger(requested) ? { weekNumber: requested } : undefined,
    );
  ```
- `app/me/schedule/page.tsx:39` — first week AT OR AFTER the cycle week, falling back to their first week; used
  only to pick the calendar's opening month (`:40`)
  ```
    const current = p.weeks.find((w) => w.weekNumber >= p.cycleWeek) ?? p.weeks[0];
  ```
- `lib/payments-view.ts:100-104` — **DEAD CODE**, removed from the live set
  ```
    if (requested !== undefined && weekNumbers.includes(requested)) return requested;
    if (weekNumbers.includes(cycleWeek)) return cycleWeek;
    const max = Math.max(...weekNumbers);
    if (cycleWeek > max) return max;
    return Math.min(...weekNumbers);
  ```
  `resolveTargetWeek` is imported at `app/actions/payments-view.ts:7` and never called; the file records at
  `:87-91` that the week board it served was deleted. **This is the single biggest correction to an earlier
  draft of this row.**

**Divergence proof — one survives, one refuted.**

(a) **MALFORMED PARAM — survives.** `?week=7abc`, pasted or produced by a stale link.
`app/admin/(protected)/this-week/page.tsx:50` computes `Number.parseInt("7abc", 10)` = 7,
`Number.isSafeInteger(7)` is true, so `getDashboard` is asked for week 7 and `app/actions/dashboard.ts:94`
finds it — `/admin/this-week` renders WEEK 7's money under a URL nobody meant, including its own `membersPaid`
and `shortfall`. The identical string on `/admin/payments` reaches `lib/week-focus.ts:36`, fails the regex and
returns null, so the screen shows every week unfocused.

(b) **PAST THE LAST ROW — refuted as written.** An earlier draft had the payments board opening on week 23 via
`lib/payments-view.ts:103`. That function is never called. Once the calendar reaches week 24 (20-week plan, 23
rows), `/admin/this-week` does render an empty week 24 — `selectedWeekTotals` is `series.find(...) ?? null` and
`selectedWeekMembers` gets `weekDate: … ?? today` — but `/admin/payments` does not show week 23's arrears in
its place: `app/admin/(protected)/payments/payments-members.tsx:215-216` simply finds no cell for week 24, so
the "Record week" button disappears and the grid shows all 23 rows as usual. The two screens are both empty
about week 24; they do not contradict each other.

**What a human sees.** A malformed `?week` silently changes which week's money `/admin/this-week` displays
while being ignored on `/admin/payments`; and once the cycle runs past its last generated week,
`/admin/this-week` renders that week as all-zero with nothing saying it has no row. Both organizer-only.

---

### V12. Cycle length (planned weeks) and the cycle's own finish — **RESOLVED**

**Implementations**

- `lib/commitment.ts:263` — answers the PLANNED finish only
  ```
  export function cycleFinishPreview(input: {
  ```
  `finishPreview(startWeek 1, weeksCommitted = plannedWeeks)` at `:269-275`, date resolved from the stored row
  for that week number. Never looks past `plannedWeeks`. Reaches a screen through `finishLine`
  (`lib/commitment.ts:287`) at `app/admin/(protected)/cycle/edit/cycle-edit-form.tsx:222` — re-derived by
  search this session.
- `app/actions/cycles.ts:109-110` — the REAL end: later of the planned finish date and the last stored week
  row's date
  ```
              const finalWeekDate =
                planned && lastRow ? (lastRow > planned ? lastRow : planned) : (planned ?? lastRow);
  ```
  Feeds `newCycleStartBounds`, whose `min` is that date (`lib/date-bounds.ts:110-113`), so it bounds the
  new-cycle start picker server-side.
- `app/admin/(protected)/cycles/new/page.tsx:53-58` — the same later-of-two rule rebuilt on the page instead of
  shared
  ```
      const finalWeekDate =
        lastRow && plannedFinish
          ? lastRow.date > plannedFinish
            ? lastRow.date
            : plannedFinish
          : (plannedFinish ?? lastRow?.date ?? null);
  ```
- `app/actions/cycle-close.ts:204-206` — a third rule: the LAST STORED ROW always wins, with an inline
  projection only when no rows exist. Never compares against the planned finish. Drives the close wait period
  ```
    const finalWeekDate =
      finalWeek?.date ??
      new Date(cycle.startDate.getTime() + (cycle.plannedWeeks - 1) * 7 * 86_400_000);
  ```
- `lib/member-history.ts:167-169` — archived cycle: sort the snapshot's week rows and take the last, falling
  back to `closedAt`. Same "last row wins" rule
  ```
    const lastWeek = parsed.weeks?.length
      ? [...parsed.weeks].sort((a, b) => a.weekNumber - b.weekNumber).at(-1)?.date
      : null;
  ```

**Divergence proof.** Live Cycle 1 2026: plannedWeeks = 20, startDate 17 May 2026, 23 week rows generated
(`EQUB_GROUND_TRUTH.md` §4, line 739). `cycleFinishPreview` returns finishWeek 20 with week 20's stored date
(17 May + 19×7 = 27 Sep 2026) and `finishLine` composes "Finishes week 20 — Sunday, September 27, 2026" on the
cycle edit screen (`cycle-edit-form.tsx:222` — re-derived, not taken from Pass 1). `app/actions/cycles.ts:109`,
`cycles/new/page.tsx:53`, `cycle-close.ts:204` and `member-history.ts:167` all return week 23's stored date (17
May + 22×7 = 18 Oct 2026). Same cycle, same instant, **two dates three weeks apart**: the cycle screen says the
cycle finishes 27 September while `newCycleStartBounds` (`lib/date-bounds.ts:113`,
`const min = activeEnd > today ? activeEnd : today;`) refuses a new-cycle start before 18 October and
`cycleCloseTiming` counts the wait from 18 October.

**Ruling.** **Both, by scope:** `lib/commitment.ts:263` is the correct answer for the PLAN and
`app/actions/cycles.ts:109` for the TRUTH — §2.7 requires both to exist. No wrong implementation.

> §2.7 PLANNED LENGTH vs ACTUAL LENGTH — TRACK BOTH: "A cycle is *planned* as 20 weeks. Reality may take 22 —
> someone joins late, a week is skipped, life happens. The system must:" / "- **Respect the plan:** 20 weeks was
> the commitment, and the organizer keeps control of it" / "- **Track the truth:** if it is actually running
> longer, show the real week"

**What a human sees.** The organizer reads "Finishes week 20 — Sunday, September 27, 2026" on the cycle
screens, then finds the cycle cannot be closed and the next cycle cannot be started until three weeks after
that date. Neither figure is wrong and §2.7 requires both, so nothing here is a defect; what is missing is a
sentence saying they answer different questions. **An earlier draft's entry listing
`app/actions/cycle-close.ts:204` as a wrong implementation is removed:** by its own admission it is not wrong
today, and it agrees with `cycles.ts:109` whenever week rows cover `plannedWeeks`
(`app/actions/edits.ts:2226-2231` grows them, `:2214` deletes only when shrinking). The fragility is real and
belongs in a note, not in a wrong-implementation list.

---

### V13. Winner's own-week contribution settled FROM the payout — **RESOLVED**

**Implementations**

- `lib/settlement.ts:43` — canonical
  ```
    const shortfall = Math.max(0, input.amountDue - input.alreadyPaidOnWeek);
  ```
  Subtracts what the week's stored row ALREADY holds, then waterfalls across the winner's payouts (`:46-53`) and
  reports what could not be absorbed as `unabsorbed` (`:54`).
- `lib/draw-settlement.ts:103-108` — the WRITE path, and it reads the real row
  ```
      const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
      const inWindow = weekNumber >= participation.startWeek && weekNumber <= finishWeek;
      // Only a SKIPPED week excuses the contribution. A DEFERRED week is still
      // owed (organizer ruling, Aug 2026), so the payout settles it like any other.
      const excused = draw.week.isSkipped;
      const amountDue = inWindow && !excused ? participation.weeklyAmount : 0;
  ```
  `alreadyPaidOnWeek: paymentRow?.amountPaid ?? 0` (`:112`); `if (plan.totalSettled === 0) continue;` (`:121`)
  — a week already covered settles nothing at all.
- `lib/week-winners.ts:161-166` — `settlementFor`, the PREVIEW. It CAN subtract what the week already holds,
  but only if the caller supplies `alreadyPaid`; it also never caps against the payout's net
  ```
    const finishWeek = input.candidate.startWeek + input.candidate.weeksCommitted - 1;
    const inWindow =
      input.weekNumber >= input.candidate.startWeek && input.weekNumber <= finishWeek;
    if (!inWindow || input.weekIsSkipped) return 0;
    const remaining = input.candidate.weeklyAmount - (input.alreadyPaid ?? 0);
    return Math.max(0, remaining);
  ```
- `components/admin/week-winner-editor.tsx:143` — **added by this pass** (an earlier draft had the function but
  not the call). The only add-winner call site, and it omits `alreadyPaid`
  ```
      const preview = addWinnerPreview({ week, candidate, feePercent });
  ```
  So `input.alreadyPaid ?? 0` makes the preview state the FULL weekly every time. The same omission at
  `:295-296` for the inline delta.
- `lib/settlement.ts:72` — `allocatePinned`, the replay path; line-for-line the same owed-then-cap
  ```
    const owed = week.isSkipped ? 0 : Math.max(0, week.amountDue - week.amountAlreadyPaid);
  ```
- `lib/standing.ts:121-123` — `computeStanding`'s placement of the settlement onto its week
  ```
      const pinned = input.pinnedByWeek?.get(w.weekNumber) ?? 0;
      if (pinned <= 0 || w.isSkipped) continue;
      const applied = Math.min(pinned, w.amountDue);
  ```

**Divergence proof — an earlier draft's proof was discarded and rebuilt.** The old proof (1-week commitment,
payout net $490 < $500 contribution) is real but rare, and its stated consequence was wrong:
`lib/draw-settlement.ts:117-118` formats `formatMoney(amountDue)`, so the refusal names the SAME $500 the
preview named — there is no fee-sized disagreement between the two sentences.

The reachable divergence is the omitted `alreadyPaid`, and §6.4 names the exact case: "**Week 6** holds only
Hana (#19) at $4,900 — her real partner needs adding via Collections → 'Add a winner to this week'."

Member P, weeklyAmount $500, weeksCommitted 20, cycle feePercent 2. Week 6 is long past and P has paid it in
full ($500 on that row). The organizer opens Collections → week 6 → add P.

- `components/admin/week-winner-editor.tsx:143` → `addWinnerPreview` with no `alreadyPaid` →
  `lib/week-winners.ts:165` → remaining = 50000 − 0 = 50000. `addWinnerPreview:284` → netAfterSettlement =
  980000 − 50000 = 930000. `previewSentences` (`lib/week-winners.ts:436`, `:452`) renders "This week's total
  goes from $4,900.00 to $14,200.00." and "P's week-6 contribution of $500.00 settles from the payout."
- The commit (`app/actions/week-winners.ts:249 → lib/draw-settlement.ts:110-121`) → amountDue = 50000,
  alreadyPaidOnWeek = 50000 → shortfall = 0 → `plan.totalSettled` = 0 → `continue`. **Nothing settles**, the
  payout net stays $9,800, and the week's real total becomes $14,700.

So the confirmation the organizer approves understates the week's payout total by $500 and asserts a settlement
that does not happen. Any partial payment on the target week produces the same error, scaled to what was paid.

**Ruling.** Correct: `lib/settlement.ts:43` fed by `lib/draw-settlement.ts:112` — the only route that reads what
the week's row already holds. Wrong: `components/admin/week-winner-editor.tsx:143` (calls `addWinnerPreview`
without `alreadyPaid`); `lib/week-winners.ts:161-166` (`settlementFor` also omits the payout-net cap the write
path enforces at `lib/draw-settlement.ts:115-120`, so on a one-week commitment the preview promises a
settlement the commit refuses outright).

> §2.23 FULL ORGANIZER CONTROL: "Every destructive or corrective action must have:" / "- a **confirmation**
> stating plainly what will happen and what it affects" / "- an **audit trail** recording what changed, from
> what to what, and when" / "- **derived figures recalculated immediately**, so a correction never leaves stale
> numbers"

**What a human sees.** On Collections → add a winner to this week, the confirmation names a settlement amount
and a new week total that the write does not produce. The money that actually moves is correct — the member is
not charged twice — so nothing a member sees changes; what is wrong is the figure the organizer approves. Rule
downgraded from §2.10 (which is satisfied: the refusal path does give a visible reason) to §2.23, which governs
the content of a confirmation.

---

### V14. Owed now vs eventually owed (the waiting list) — **EQUIVALENT**

**Implementations**

- `lib/waiting.ts:148` — canonical
  ```
      owedNow: input.awaitingPayment.reduce((s, r) => s + r.netAmount, 0),
  ```
  `awaitingPayment` is built at `app/actions/waiting.ts:81-86` from
  `prisma.payout.findMany({ where: { status: "PENDING", luckyNumber: { cycleId: cycle.id } } })` — drawless
  payouts included.
- `lib/dashboard.ts:62` — `cashPosition`; selected by `else` on a COLLECTED test (`:60-61`) rather than by a
  PENDING filter, and asserts each net is valid cents first (`:59`)
  ```
        committedPending += p.netAmount;
  ```
  Its payouts are cycle-scoped: `app/actions/dashboard.ts:69-70`,
  `prisma.payout.findMany({ where: { luckyNumber: { cycleId: cycle.id } } })` — re-derived this session.
- `app/admin/(protected)/collections/page.tsx:232` — filters to PENDING at `:230`, then reduces the nets
  ```
    const pendingTotal = pending.reduce((sum, p) => sum + p.netAmount, 0);
  ```
- `app/admin/(protected)/collections/collections-view.tsx:399-401` — same filter-and-sum, scoped to one draw
  group's card
  ```
                    const owed = group.payouts
                      .filter((p) => p.status === "PENDING")
                      .reduce((s, p) => s + p.netAmount, 0);
  ```
- `app/actions/cycle-close.ts:126-133` — per member rather than cycle-wide, and tests `!== "COLLECTED"`
  ```
        pendingNet: p.luckyNumbers.reduce(
          (sum, n) =>
            sum +
            n.payouts
              .filter((po) => po.status !== "COLLECTED")
              .reduce((s, po) => s + po.netAmount, 0),
          0,
        ),
  ```

**Why EQUIVALENT.** The `!== "COLLECTED"` / `else`-on-COLLECTED forms and the `=== "PENDING"` forms select the
identical row set because `PayoutStatus` has exactly two members — `prisma/schema.prisma:685-688`:
`enum PayoutStatus {` / `  PENDING` / `  COLLECTED` / `}` (those four lines re-read). Every site sums
`netAmount`, and the two scopes that could have differed were re-derived: the dashboard's payouts are filtered
to `luckyNumber: { cycleId: cycle.id }` (`app/actions/dashboard.ts:70`) exactly as the waiting screen's are, and
a PENDING payout with no draw is included on both sides.

---

### V15. Cash position per week (received, paid out, pending out, running held) — **OPEN**

*(Ruling text at OPEN ruling 13.)*

**Implementations**

- `lib/dashboard.ts:128` — `cashSeries`
  ```
      receivedBy.set(p.weekNumber, (receivedBy.get(p.weekNumber) ?? 0) + p.amountPaid);
  ```
  Payouts bucketed at `:138` — `const week = p.weekNumber ?? input.weeks[0]?.weekNumber ?? 1;` — a drawless
  payout is folded into the FIRST week deliberately (`:135-137`), so `cashSeries` and `cashPosition` agree on a
  total.
- `app/actions/cycle-close.ts:178-181` — the archive's per-week received
  ```
        received: cycle.participations.reduce(
          (sum, p) => sum + (p.payments.find((pm) => pm.weekId === w.id)?.amountPaid ?? 0),
          0,
        ),
  ```
  Its companion payout bucketing at `:156-158` files a payout with no draw under week 0 —
  `const weekNumber = po.drawId ? (…) : 0;` — and `archiveWeeks` returns `cycle.weeks.map(...)` (`:172`), where
  no row has weekNumber 0.
- `lib/payments-view.ts:222-225` — `buildPaymentGrid` accumulates per-week received/expected while walking the
  cells, after the window guards at `:217-221`
  ```
          received += mw.storedPaid;
          // Only a SKIPPED week is off the books. A DEFERRED week is still
          // owed, so it belongs in what the week EXPECTED to collect.
          if (!week.isSkipped && mw.status !== "SKIPPED") expected += mw.amountDue;
  ```
- `lib/dashboard.ts:250` — `weekReceipts`; counted BEFORE the window test at `:252`
  ```
        received += payment.amountPaid;
  ```
- `scripts/verify-cycle-close-money.mts:137-140` — re-implements the per-week attribution for the fixture
  ```
        received: participations.reduce(
          (s, p) => s + (p.payments.find((pm) => pm.weekId === w.id)?.amountPaid ?? 0),
          0,
        ),
  ```

**Divergence proof — real and reachable, with the CONSEQUENCE corrected.** Reachability: `Payout.drawId` is
nullable and its relation is `onDelete: SetNull` — `prisma/schema.prisma:444` `  drawId        String?` and
`:456` `  draw          Draw?         @relation(fields: [drawId], references: [id], onDelete: SetNull)`.
Deleting a draw leaves its payouts alive with `drawId` null, which is the shape `app/actions/cycle-close.ts:156`
codes for.

Take a PENDING payout of $9,800 net with `drawId` null.

- `lib/dashboard.ts:138` → week = `weeks[0].weekNumber` → the cash chart shows $9,800 as week 1's `pendingOut`,
  and the series reconciles with `cashPosition.committedPending`.
- `app/actions/cycle-close.ts:156-158` → `payoutRows` key 0 → `archiveWeeks` (`:172`) maps only real week rows,
  so it is in no archived week's draw block.

**What was removed:** the claim that "the archive contradicts itself: $9,800 in the totals, absent from every
week". The archive page (`app/admin/(protected)/cycles/[id]/archive/page.tsx`) was read end to end. It renders
four totals — received, paidOutNet, stillHeld, outstanding (`:54-63`) — and never renders `totals.pendingNet` or
a member's `awardedNet`/`pendingNet`. `stillHeld = received − paidOutNet` still carries the cash correctly. So
no rendered total disagrees with the week list; what happens is that the payout appears in the archive's
week-by-week Payouts column for a DRAWN pending payout (`:165-172`, "#3 Hana: $9,800.00 pending") and nowhere at
all for a drawless one.

**What a human sees.** On the live cash chart a payout with no draw appears as week 1's `pendingOut`; in a
closed cycle's archive the same payout appears in no week and nothing on the page names it. The archive's four
rendered totals stay correct, which is why this is OPEN rather than RESOLVED — an earlier draft's §2.9 quote was
aimed at a self-contradiction that does not render.

---

### V16. Paid ahead (money on weeks that have not happened) — **RESOLVED**

**Implementations**

- `lib/cycle-position.ts:226`
  ```
      paidAhead: ahead.reduce((s, w) => s + w.received, 0),
  ```
  `ahead` = series weeks with `weekNumber > currentWeek` (`:192`). The series is built at
  `app/actions/cycle-position.ts:157-162` over `counted` (`:134`), which is `cycle.participations.map(...)` —
  EVERY participation, ACTIVE and CLOSED, as the comment at `:110-115` states.
- `app/actions/cycle-position.ts:215-225` — inside `for (const p of active)` (`:201`), where `active` is
  `cycle.participations.filter((p) => p.status === "ACTIVE")` (`:108`) — **CLOSED participations excluded**
  ```
        const ahead = p.payments.filter(
          (pm) => pm.week.weekNumber > currentWeek && pm.amountPaid > 0,
        );
        if (ahead.length > 0) {
          aheadBy.push({
            participationId: p.id,
            name,
            amount: ahead.reduce((s, pm) => s + pm.amountPaid, 0),
            weeks: ahead.length,
          });
        }
  ```
- `scripts/audit-position-figures.mts:152-158` — same active-only filter; reproduces the app's list rather than
  checking it
  ```
      const ahead = p.payments.filter((pm) => pm.week.weekNumber > currentWeek && pm.amountPaid > 0);
      return {
        participationId: p.id,
        name: p.person.nameEnglishFirst,
        amount: ahead.reduce((s, pm) => s + pm.amountPaid, 0),
        weeks: ahead.length,
      };
  ```
- `scripts/audit-position-figures.mts:252-254` — by-hand total over ALL participations, asserted equal to
  `position.paidAhead` at `:255`, so this check agrees with the headline and cannot see the list's omission
  ```
  const handAhead = flatPayments
    .filter((p) => p.weekNumber > currentWeek)
    .reduce((s, p) => s + p.amountPaid, 0);
  ```
- `scripts/diagnose-paid-ahead.mts:92-93` — the diagnostic deliberately states both boundaries
  ```
  const countedAhead = rows.filter((r) => r.weekNumber > elapsed);
  const genuinelyAhead = rows.filter((r) => r.weekNumber > currentWeek);
  ```

**Divergence proof.** Member S stopped at week 12 (`Participation.status` CLOSED) with $1,000 sitting on weeks
14 and 15; the cycle's `currentWeek` is 13. Reachability was checked rather than assumed: `lib/rebuild.ts:35-39`
builds its replay state from `startWeek … calculateFinishWeek(startWeek, weeksCommitted)` — the WHOLE
commitment, not the week they stopped at — so a member who paid ahead and then stopped keeps that money on
weeks 14 and 15 after every rebuild. Nothing in participation-close narrows the window used for allocation.

- `lib/cycle-position.ts:226` → the series includes S, so weeks 14 and 15 carry S's $1,000 → `paidAhead`
  includes it.
- `app/actions/cycle-position.ts:215` → S is not in `active`, so `aheadBy` has no row for S.

On `/admin/cycle/position` the paid-ahead headline exceeds the sum of the members named beneath it by $1,000,
and the same figure feeds `cashOnHand`'s `paidEarly` (`app/actions/cycle-position.ts:303`), so `/admin/cash`
inherits it. The Sunday check catches half of this and which half was confirmed:
`scripts/audit-position-figures.mts:256-267` compares a member COUNT built over ALL participations against
`position.aheadBy.length`, so `npm run check:position` exits non-zero — but the money assertion at `:252-255`
sums all participations on both sides and passes.

**Ruling.** Correct: `lib/cycle-position.ts:226` — a stopped member's money is still money the group holds for
weeks that have not happened. Wrong: `app/actions/cycle-position.ts:215` (loops `active` only, so a closed
member's paid-ahead money has no name against it and the list cannot reconcile to the headline);
`scripts/audit-position-figures.mts:152`.

> §2.18 THE CARRIED BALANCE — PEOPLE, NOT CYCLES, OWE: "- **Closed members stay visible** — not removed from the
> cycle. They keep access to their own record and can see where they stopped. Dignity, and a useful record for
> them."

**What a human sees.** On the cycle position page the paid-ahead headline is larger than the sum of the members
named under it, with nothing on screen accounting for the gap. `npm run check:position` does fail on the member
count, so the organizer is not left with no signal at all — but the failure names a count, not the money.

---

### V17. Weeks left in a member's window / at risk (Pass 1 #51) — **OPEN**

Pass 1 listed this quantity twice. Both rows describe one pair of divergences — a threshold split (3 vs 4) and a
clock split — and are adjudicated together at **row V6** and **OPEN ruling 12**, which carry the verbatim lines
for `lib/wheel.ts:86-87`, `app/actions/waiting.ts:202` and `lib/waiting.ts:77`, both corrected proofs, and the
options.

The one addition this second listing contributes: the two `undrawnWindowWarnings` call sites are
`app/actions/dashboard.ts:387` (`weeksAhead: 3`, over `currentWeekNumber` from `app/actions/dashboard.ts:88`)
and `app/actions/wheel.ts:215-220` (`weeksAhead: WARNING_WEEKS_AHEAD`, `app/actions/wheel.ts:36`
`const WARNING_WEEKS_AHEAD = 3;`, over `currentWeekFromRows` from `app/actions/wheel.ts:110`) — so the constant
is written twice as well as the clock being chosen twice. §2.27's own words on why this matters: "**Why the
warning is not optional:** everyone in an Equb receives exactly once. A member whose window closes undrawn has
paid in and received nothing."

---

### V18. Total outstanding at close, and how many members are short — **EQUIVALENT**

**Implementations**

- `app/actions/cycle-close.ts:294-295` — the pre-close review, over `memberFinals` (`:56-137`), whose
  `outstanding` is `standing.amountOutstanding` (`:107`)
  ```
          totalOutstanding: finals.reduce((sum, m) => sum + m.outstanding, 0),
          membersShort: finals.filter((m) => m.outstanding > 0).length,
  ```
- `lib/cycle-close.ts:240` — `buildArchiveData` recomputes the whole-cycle total over the same `MemberFinal[]`
  ```
    const outstanding = input.members.reduce((sum, m) => sum + m.outstanding, 0);
  ```
- `lib/cycle-close.ts:256` — the short-member count recomputed inside `buildArchiveData`
  ```
        membersShort: input.members.filter((m) => m.outstanding > 0).length,
  ```
- `scripts/deferral-impact.mts:214-215` — accumulates the same whole-cycle total twice, before and after a
  simulated rule change
  ```
    cycleOwedNow += now.amountOutstanding;
    cycleOwedNew += next.amountOutstanding;
  ```

**Why EQUIVALENT.** `app/actions/cycle-close.ts:294` and `lib/cycle-close.ts:240` reduce the SAME array —
`closeCycle` builds `finals` once with `memberFinals` and passes it to `buildArchiveData` as `members`
(`app/actions/cycle-close.ts:356-364`, read in full) — so the two reduces see identical values and Σ is Σ. The
same holds for the two `outstanding > 0` counts. `scripts/deferral-impact.mts` accumulates the same per-member
figure deliberately over two hypothetical rule sets. Duplicated arithmetic, not divergent arithmetic.

---

### V19. Archive totals at close (received, paid out net, pending net, still held, outstanding) — **EQUIVALENT**

**Implementations**

- `lib/cycle-close.ts:234-238` — canonical; `stillHeld = received − paidOutNet` (`:254`)
  ```
    const received = input.weeks.reduce((sum, w) => sum + w.received, 0);
    // COLLECTED only. A pending payout is money the group is STILL HOLDING, not
    // money it has paid out — counting it as paid out is what made the archive
    // disagree with its own payout rows.
    const paidOutNet = input.members.reduce((sum, m) => sum + m.receivedNet, 0);
  ```
- `app/actions/cycle-close.ts:114-121` — the per-member status splits the archive totals are built from;
  `awardedNet` at `:122` (no filter), `pendingNet` at `:126` (`status !== "COLLECTED"`). Safe only because
  `PayoutStatus` has exactly two members (`prisma/schema.prisma:685-688`)
  ```
        receivedNet: p.luckyNumbers.reduce(
          (sum, n) =>
            sum +
            n.payouts
              .filter((po) => po.status === "COLLECTED")
              .reduce((s, po) => s + po.netAmount, 0),
          0,
        ),
  ```
- `app/actions/cycle-close.ts:260-261`, `:293` — the pre-close REVIEW computes the same headlines a different way
  ```
      const received = finals.reduce((sum, m) => sum + m.totalPaid, 0);
      const paidOut = cycle.participations.reduce(
  ```
  `stillHeld` at `:293` as `received - paidOut`.
- `scripts/verify-cycle-close-money.mts:108-112` — re-implements all three per-member status splits plus the
  per-week received (`:137-140`) to drive `buildArchiveData` in the fixture
  ```
      receivedNet: p.luckyNumbers.reduce(
        (s, n) =>
          s + n.payouts.filter((po) => po.status === "COLLECTED").reduce((x, po) => x + po.netAmount, 0),
        0,
      ),
  ```

**Why EQUIVALENT — downgraded from an earlier OPEN, because no divergence can be constructed and the brief says
EQUIVALENT is then the honest answer.** The two `received` routes are both Σ `Payment.amountPaid` over the same
rows: `lib/cycle-close.ts:234` sums archived weeks, each built at `app/actions/cycle-close.ts:178-181` as Σ over
`cycle.participations` of that week's row; `app/actions/cycle-close.ts:260` sums `standing.totalPaid`, which
`memberFinals` supplies at `:83` as `p.payments.reduce((sum, pm) => sum + pm.amountPaid, 0)`. They differ only
if a participation carries a payment row on a week outside `cycle.weeks`, and no writer can create one (every
path allocates over `participation.cycle.weeks`, and deleting a Week cascades its payments).

**The concern survives as a note rather than a finding:** two independent queries produce the figure the
organizer approves and the figure frozen into the archive, and nothing in code or tests pins them to each other.

---
### V20. Whether the manual late mark may be applied to this week (and what to say) — **RESOLVED**

**Implementations**

- `lib/derived.ts:238` — `manualLateAdvice`: four cases, two of them blocking — deferred (`:255`, checked
  FIRST), already-late (`:257-262`), future (`:263-268`), current (`:269`). Nothing about money
  ```
  export function manualLateAdvice(args: {
  ```
- `app/actions/edits.ts:1499-1502` — a FIFTH case decided at the write, separately from the four advice kinds
  ```
          if ((before?.amountPaid ?? 0) >= participation.weeklyAmount) {
            throw new Error(
              `Week ${input.weekNumber} is already paid in full. Money is the truth — there is nothing to mark late.`,
            );
          }
  ```
- `components/admin/week-action-panel.tsx:404-417` — **added by this pass**, so the claim about the control is
  quoted rather than asserted
  ```
            {detail && !detail.weekIsSkipped &&
              (detail.markedLate || detail.lateAdvice.kind !== "already-late") && (
                <button
                  type="button"
                  onClick={toggleMarkedLate}
  ```
  The button renders whenever the week is not skipped and the advice is not "already-late", and its `disabled`
  at `:417` covers only busy and the DEFERRED case — **never the paid case**.
- `lib/rebuild.ts:143` — the same money-beats-the-mark comparison a third time, as the automatic clearing rule
  after a replay
  ```
      .filter((s) => s.markedLate && s.paid >= participation.weeklyAmount && s.paymentId)
  ```

**Divergence proof.** Member M, week 14, weekly $500, week 14's row carries $500 (fully paid). Today is the
Tuesday of week 14 — the window is open.

- `lib/derived.ts:238` → not deferred, days = 2 < 5, days ≥ 0 → `{ kind: "current", message: null }`.
  `app/actions/payments-view.ts:208-213` sends that to the browser;
  `components/admin/week-action-panel.tsx:404-405` renders the button, `:417` leaves it enabled, and `:419-424`
  gives it the title "Mark this week late now, without waiting for its window to close".
- `app/actions/edits.ts:1499` → 50000 ≥ 50000 → throws "Week 14 is already paid in full. Money is the truth —
  there is nothing to mark late."

An earlier draft's second proof (stored `amountPaid` vs replayed `s.paid` disagreeing after a rate change) is
**dropped**: it cannot be constructed, because every path that changes the weekly, the window or a receipt calls
`rebuildParticipationPayments` in the same transaction, and rebuild refuses to leave a receipt unallocated
(`lib/rebuild.ts:114-120`), so at rest the stored amount IS the replayed amount.

**Ruling.** Correct: `app/actions/edits.ts:1499` — the refusal is exactly what §2.29 requires, and it is
server-side as §2.29 effect 4 demands. Wrong: `lib/derived.ts:238` — `manualLateAdvice` returns four cases where
the rule has five; because the money case is not one of them, the panel offers an enabled control on a
fully-paid week and only the write refuses.

> §2.29 THE MANUAL LATE MARK: "**Money still wins.** A week that gets paid reads PAID whatever the mark says,
> and the payment path clears the mark on any week the money fully covers. Marking a week that is already paid
> in full is refused outright: *\"Money is the truth — there is nothing to mark late.\"*"

**What a human sees.** On a week already paid in full the week action panel shows an enabled "Mark late" button
with an encouraging tooltip; pressing it produces a hard error. No money figure differs on any screen — the
write is refused, so nothing is mis-stated — which is why this is `visible` rather than headline. §2.29 disabled
rather than hid the deferred case "because a control that vanishes leaves him hunting for something he used
yesterday"; the paid case gets neither the disable nor the reason.

---

### V21. Undo-draw consequences (total net removed, collected net un-recorded, settlements reopened) — **EQUIVALENT**

**Implementations**

- `lib/undo-draw.ts:46-48` — canonical; `collected` = payouts filtered to COLLECTED (`:42`); `highStakes` =
  `collected.length > 0` (`:54`); reopening settlements listed per lucky number with their amounts (`:50-53`)
  ```
      totalNet: input.payouts.reduce((sum, p) => sum + p.netAmount, 0),
      collectedCount: collected.length,
      collectedNet: collected.reduce((sum, p) => sum + p.netAmount, 0),
  ```
- `lib/manual-payout.ts:104-106` — `weekChoice` computes the same three "what disappears" figures for the
  REPLACE path with its own reduce and filters
  ```
    const totalNet = week.payouts.reduce((s, p) => s + p.netAmount, 0);
    const collected = week.payouts.filter((p) => p.status === "COLLECTED");
    const settled = week.payouts.filter((p) => p.settlementAmount > 0);
  ```
- `app/actions/manual-payout.ts:315-316` — inside the transaction, the replace path recomputes from freshly read
  rows rather than calling `undoDrawConsequences`
  ```
            totalNet: existing.payouts.reduce((s, p) => s + p.netAmount, 0),
            collectedCount: existing.payouts.filter((p) => p.status === "COLLECTED").length,
  ```

**Why EQUIVALENT on the figures.** All three compute Σ `netAmount` over the same payout set and count the same
COLLECTED subset; the third re-reads the rows inside the serializable transaction, which can only differ from
the preview if another session changed the draw in between — in which case the transaction's number is the true
one.

**The real difference is what is REPORTED,** and it is a §2.23 confirmation-completeness question, not an
arithmetic divergence: `lib/undo-draw.ts:50-53` lists each reopening settlement as `{ number, amount }` while
`lib/manual-payout.ts` reports reopening weeks as a bare week-number list, so the replace-path confirmation
names the weeks that become owed again without naming how much.

---

### V22. Difference vs the books, coverage, and the verdict — **OPEN**

*(Ruling text at OPEN ruling 14.)*

**Implementations**

- `lib/cycle-position.ts:382` (difference) and `:388-390` (coverage) — `positionVerdict`
  ```
    const difference = input.actual - input.cash.shouldBeHolding;
  ```
  Coverage at `:388-390` is `  const holdingForOthers =` /
  `    input.cash.paidEarly + input.cash.drawnNotHandedOut + input.cash.owedToStopped;` /
  `  const coverage = input.actual - holdingForOthers;`. Compares the COUNTED reading against money that belongs
  to other people, and includes `owedToStopped`. Its own doc at `:371-373` names coverage "the 'am I using
  other people's money' question".
- `app/admin/(protected)/cycle/position/page.tsx:78` — the nav dot for the "What you should hold" section
  ```
      holdingLessThanOwed: h.shouldBeHolding < h.paidEarly + h.drawnNotHandedOut,
  ```
  (`sections.ts:90` `attention: input.holdingLessThanOwed,`, whose comment at `:87-89` says holding less than
  other people's money "IS the 'using someone else's money' signal — the question the screen exists to
  answer".) Compares the BOOKS (`cashOnHand.shouldBeHolding` = collected − handedOut,
  `lib/cycle-position.ts:323`) rather than the counted reading, and OMITS `owedToStopped`, which `cashOnHand`
  does populate (`app/actions/cycle-position.ts:306` `owedToStopped: collection.owedBackToStopped,`).
- `app/actions/cycle-position.ts:367` — **NOT a divergent implementation; corrected from Pass 1's framing**
  ```
            differenceVsExpectedToday: r.totalAmount - holding.shouldBeHolding,
  ```
  Character-for-character the same expression as `difference`, applied to each historical reading, and the field
  name plus the comment at `:357-359` ("honest about being a comparison rather than a re-derivation of that
  week's books") say exactly that. Listed for completeness; it produces no second answer.

**Divergence proof.** Cycle position on 13 Aug: collected $10,000, handed out $6,000 → `cashOnHand.shouldBeHolding`
= $4,000 (`lib/cycle-position.ts:323`). `paidEarly` = $1,000, `drawnNotHandedOut` = $2,000,
`owedBackToStopped` = $1,500 (one stopped, never-drawn member — `app/actions/cycle-position.ts:268-280`
populates `owedBack` for exactly this case). Latest cash reading = $4,000.

- `positionVerdict`: `holdingForOthers` = 1,000+2,000+1,500 = $4,500; coverage = 4,000 − 4,500 = **−$500** → kind
  'short', shortBy $500, and the page prints that sentence at `page.tsx:108`.
- `page.tsx:78`: 4,000 < 1,000+2,000 = 3,000 → **FALSE**, so the "What you should hold" section carries no dot.

Second, independent divergence on the same line: with `owedToStopped` = 0, `paidEarly` $1,000,
`drawnNotHandedOut` $2,000, books $4,000 but the counted reading only $2,000, coverage = 2,000 − 3,000 = −$1,000
short while `page.tsx:78` evaluates 4,000 < 3,000 = FALSE.

**What a human sees.** Which nav section on `/admin/cycle/position` carries the attention dot. **Corrected from
Pass 1:** the platform is NOT silent in the proof — `sections.ts:96` puts a dot on "What you hold" whenever
`verdictKind` is 'short', and the "short by $500" sentence renders at `page.tsx:108`. What is wrong is that the
section built to answer "am I using other people's money" answers it with a different, weaker test than the
verdict two tabs along.

---

### V23. Amount of one receipt applied to one week (allocation audit row) — **EQUIVALENT**

**Implementations**

- `app/actions/payments.ts:270-272` — `a.applied` comes from `planCommit → allocatePayment` (`:234-241`).
  Fungible cash: oldest-first across the window
  ```
          await tx.paymentAllocation.create({
            data: { eventId: event.id, paymentId: payment.id, amount: a.applied },
          });
  ```
- `lib/draw-settlement.ts:153-155` — `deduction.deduct` comes from `planWinnerWeekSettlement` (`:110-114`), whose
  per-week figure is `lib/settlement.ts:43` with `alreadyPaidOnWeek` read as
  `      alreadyPaidOnWeek: paymentRow?.amountPaid ?? 0,` (`:112`). Pinned to the drawn week; the event carries
  `          pinnedWeekId: draw.weekId,` (`:133`)
  ```
        await tx.paymentAllocation.create({
          data: { eventId: event.id, paymentId, amount: deduction.deduct },
        });
  ```

**Why EQUIVALENT.** The two never see the same receipt: one writes the rows for a `PaymentEvent` with
`pinnedWeekId` null, the other only for events it creates with `pinnedWeekId` set, and the replay honours the
same split — `lib/rebuild.ts:84` `    if (event.pinnedWeekId !== null) {` sends pinned events to
`allocatePinned` (`:88`) and everything else to `allocatePayment` (`:105`). The caps agree too:
`planWinnerWeekSettlement` takes `Math.max(0, amountDue − alreadyPaidOnWeek)` and `allocatePinned` takes
`Math.max(0, week.amountDue - week.amountAlreadyPaid)` (`lib/settlement.ts:72`), so a settlement written by one
is re-derived identically by the other. No receipt on which the two produce different per-week slices could be
constructed.

---

### V24. Weeks remaining in the cycle (from today) — **OPEN**

*(Ruling text at OPEN ruling 15.)*

**Implementations**

- `app/actions/dashboard.ts:253` — EXCLUSIVE of the week in progress
  ```
          weeksRemaining: Math.max(0, cycle.plannedWeeks - currentWeek),
  ```
  `currentWeek` here is `    const currentWeek = currentWeekNumber(cycle.startDate, today);` (`:88`). Rendered on
  the admin dashboard header — RE-DERIVED by search: `app/admin/(protected)/page.tsx:51` and `:128`, both
  `            {d.weeksRemaining} week{d.weeksRemaining === 1 ? "" : "s"} remaining`.
- `lib/money.ts:129` — INCLUSIVE of the joining week
  ```
    return Math.max(0, plannedWeeks - startWeek + 1);
  ```
  RE-DERIVED by search: it is the commitment cap (`lib/participation-rules.ts:46` `validateCommitmentCap`,
  `lib/commitment.ts:321` `commitmentCap`) and the offered DEFAULT (`lib/commitment.ts:48`
  `weeksToFinishWithGroup`), surfaced at `app/admin/(protected)/cycle/add/add-member-wizard.tsx:102`/`:140`/
  `:147`/`:243` and `app/admin/(protected)/people/[id]/participation-editor.tsx:300`/`:307`/`:330`/`:703`.

**Divergence proof.** Cycle 1: plannedWeeks 20, currentWeek 15. `app/actions/dashboard.ts:253` → max(0, 20 − 15)
= **5**, so the dashboard header reads "5 weeks remaining". The add-member wizard opens with the default start
week set from the same `currentWeekNumber`, and `lib/money.ts:129` with startWeek 15 → max(0, 20 − 15 + 1) =
**6**, so it pre-fills and caps the commitment at 6 weeks. Five and six, on the same day, for what a reader hears
as the same fact.

**What a human sees.** The week count in the admin dashboard header, against the maximum weeks the add-member
screen offers and defaults to on the same day. No money moves — `weeksRemaining` is display-only, passed straight
through `lib/presentation.ts:54` and never fed to a cap — but it is the figure the organizer plans the draw
schedule against.

---

### V25. Actual cycle length (how many week rows really exist) — **EQUIVALENT**

**Implementations**

- `lib/participation-rules.ts:117-120` — `pruneOrphanOverrideWeeks`; combined with the plan at `:123`
  `  const keepThrough = Math.max(cycle.plannedWeeks, deepestFinish);` to decide which trailing weeks belong to
  nobody
  ```
    const deepestFinish = participations.reduce(
      (max, p) => Math.max(max, calculateFinishWeek(p.startWeek, p.weeksCommitted)),
      0,
    );
  ```
- `app/actions/edits.ts:2200-2203` — `updateCycle`'s shrink guard; compared against the PROPOSED `plannedWeeks`
  at `:2208` (`        if (overlapping > 0 && deepestFinish > input.plannedWeeks) {`) to refuse
  ```
          const deepestFinish = participations.reduce(
            (max, p) => Math.max(max, calculateFinishWeek(p.startWeek, p.weeksCommitted)),
            0,
          );
  ```

**Why EQUIVALENT.** Character for character the same reduce over the same seed, and the queries behind them
select the same rows: both take every participation of the cycle with no status filter and read only `startWeek`
and `weeksCommitted` (`lib/participation-rules.ts:113-116` and `app/actions/edits.ts:2196-2199`, both
`select: { startWeek: true, weeksCommitted: true }`), and both fold through the same `calculateFinishWeek`. The
two differ only in what they do with the answer — one keeps weeks, one refuses a shrink — which is a use, not a
second derivation.

---

### V26. Days waiting for a pending payout / longest wait — **OPEN**

*(Ruling text at OPEN ruling 16.)*

**Implementations**

- `lib/waiting.ts:70-73` — raw instants
  ```
  export function daysBetween(from: Date, to: Date): number {
    const ms = to.getTime() - from.getTime();
    return Math.max(0, Math.floor(ms / 86_400_000));
  }
  ```
  Used at `app/actions/waiting.ts:123` —
  `      daysWaiting: p.draw ? daysBetween(p.draw.drawnAt, today) : null,` — for the waiting list's pending-payout
  wait and its "Waiting longest" sort (`lib/waiting.ts:113-115`). Surfaces RE-DERIVED:
  `app/admin/(protected)/waiting/waiting-view.tsx:301`/`:356`/`:360` and
  `components/admin/waiting-summary.tsx:77`.
- `lib/dashboard.ts:467-468` — `standingIssues`' local helper; truncates BOTH instants to their UTC calendar day
  first
  ```
      const days = (from: Date) =>
        Math.max(0, Math.floor((utcDay(input.today) - utcDay(from)) / MS_PER_DAY));
  ```
  Feeds `daysWaiting` on the unsigned row (`:482`
  `        daysWaiting: p.agreementRequiredAt ? days(p.agreementRequiredAt) : null,`) and the never-paid row
  (`:493`). Surface RE-DERIVED: `app/admin/(protected)/page.tsx:308` renders
  ``agreement not signed${m.daysWaiting !== null ? ` · ${m.daysWaiting}d` : ""}``.

**Divergence proof.** Two facts stamped at the same instant, 2026-08-12T23:00:00Z — a draw's `drawnAt` and a
member's `agreementRequiredAt`. Read at 2026-08-13T01:00:00Z. `lib/waiting.ts:70` →
`floor(7,200,000 / 86,400,000)` = **0**, so the waiting list says the payout has been outstanding 0 days.
`lib/dashboard.ts:467` → `utcDay(13 Aug) − utcDay(12 Aug)` = 86,400,000, floor(1) = **1**, so the dashboard prints
"· 1d" beside that member. Two hours of real elapsed time, reported as 0 and as 1.

**What a human sees.** The day count beside a pending payout on the waiting list, against the day count beside an
unsigned or never-paid member on the dashboard. Off by one across any UTC midnight.

---

### V27. Cash reading / counted cash (what he actually holds) — **EQUIVALENT**

**Implementations**

- `app/actions/cycle-position.ts:409` — `recordCashReading`'s refusal: the two lines must be the total, or nothing
  is saved. A validation, not a derivation
  ```
      if (bank !== null && onHand !== null && bank + onHand !== input.totalAmount) {
  ```
- `app/admin/(protected)/cycle/position/cash-reading-panel.tsx:105-107` — derives the submitted total from the two
  parsed dollar fields when the split is in use
  ```
    const derivedTotal =
      split && bankCents !== null && cashCents !== null ? bankCents + cashCents : null;
    const totalCents = split ? derivedTotal : parseDollarsToCents(total);
  ```

**Why EQUIVALENT.** The panel submits `        totalAmount: totalCents,` /
`        bankAmount: split ? bankCents : null,` / `        cashAmount: split ? cashCents : null,` (`:150-152`).
When split is false both line fields go over as null and the server's check at `:409` is short-circuited; when
split is true `totalCents` IS `derivedTotal`, which is exactly `bankCents + cashCents`, so
`bank + onHand !== input.totalAmount` is false by construction. Integer cents throughout —
`parseDollarsToCents` returns a safe integer or null (`lib/format.ts:25-32`) — so there is no rounding for the two
to disagree over. The server-side check is a genuine guard for any other caller, not a second answer.

---

### V28. Closing statement text for a member — **OPEN**

*(Ruling text at OPEN ruling 18.)*

**Implementations**

- `lib/cycle-close.ts:175-186` — `closingStatementText`, frozen into the archive as each member's statement at
  `lib/cycle-close.ts:248`
  ```
    if (m.outstanding === 0 && m.weeksPaid >= m.weeksCommitted) {
      return `You completed all ${m.weeksCommitted} weeks. Balance $0.`;
    }
    if (m.outstanding === 0) {
      return `You paid ${m.weeksPaid} of ${m.weeksCommitted}. Balance $0.`;
    }
    return (
      `You paid ${m.weeksPaid} of ${m.weeksCommitted}.` +
      (m.lastPaymentWeek !== null ? ` Last payment week ${m.lastPaymentWeek}.` : "") +
      ` Outstanding ${formatMoney(m.outstanding)}.`
    );
  ```
  **Surface RE-DERIVED by search:** `statement` is rendered ONLY on the organizer's archive page
  (`app/admin/(protected)/cycles/[id]/archive/page.tsx:120`) and its CSV export (`export-button.tsx:40`). **No
  member surface reads it.**
- `lib/member-history.ts:90-103` — `closingLine`; branches on `outstanding`, then on `pendingNet`; `weeksPaid` and
  `weeksCommitted` play no part
  ```
    if (input.outstanding > 0) {
      return (
        `${money(input.outstanding)} outstanding — what was left unpaid when ${input.cycleName} ` +
        `closed. It moved to your carried balance, which is the same money, not a second debt.`
      );
    }
    if (input.pendingNet > 0) {
      return (
        `Complete — nothing owed. ${money(input.pendingNet)} of your payout had not been handed ` +
        `over when the cycle closed; speak to the organizer if you have not received it.`
      );
    }
    return "$0 outstanding — complete.";
  ```
  Built from the same archived member row (`lib/member-history.ts:188-192`) and rendered on the member's own
  past-cycle card — RE-DERIVED by search: `components/member/past-cycle-card.tsx:87` (settled) and `:91` (short).

**Divergence proof.** A 20-week cycle where week 7 is cycle-wide SKIPPED. Almaz commits 20 weeks at $500 and pays
19 weeks' worth ($9,500). `computeStanding`: 20 elapsed, 1 skipped → due 950,000, paid 950,000 → outstanding 0;
`weeksCredited` = 19, so `memberFinals` gives `weeksPaid` = min(19, 20) = 19. `closingStatementText` → "You paid
19 of 20. Balance $0." on the organizer's archive page. `closingLine` → "$0 outstanding — complete." on her portal
card. (An earlier draft's override example — join at week 15 with weeksCommitted 20 — reaches the same collision
but requires the cycle to be closed while 14 of her week rows are still in the future, so this skipped-week case
is the reachable one.)

**What a human sees — downgraded on two counts.** First, RESOLVED → OPEN: §2.18's exemplars ("You completed all
20 weeks. Balance $0." / "You paid 12 of 20. Last payment week 12. Outstanding $2,000.") govern the closing
STATEMENT, which `closingStatementText` follows exactly; they are adjacent to a portal balance sentence that
answers a narrower question and carries a fact the statement does not. Second, headline → visible: no figure
differs, only wording, and an earlier claim that these are "two surfaces a member reads" is wrong — the statement
is organizer-only, the member's sent closing statement is a separate WhatsApp template, and the portal card prints
the week count directly above the sentence.

---

### V29. Refusals that fence where balance money may land — **EQUIVALENT**

**Implementations**

- `lib/cycle-close.ts:62-66` (and `closedParticipationRefusal` at `:91-104`) — the enforcement pair
  ```
  export function frozenCycleRefusal(cycle: {
    name: string;
    status: "DRAFT" | "ACTIVE" | "CLOSED";
  }): string | null {
    if (cycle.status !== "CLOSED") return null;
  ```
  `closedParticipationRefusal`'s own gate is `  if (p.status === "ACTIVE") return null;` at `:96` — **corrected
  from Pass 1, which cited `:92`.** Both sentences point the organizer at §2.19's ledger route.
- `lib/participation-close.ts:227-235` — `closeRefusal`'s own ladder, for the preview sentence
  ```
    if (c.cycleStatus === "CLOSED") {
      return (
        `${c.cycleName} is closed. Its books are final, and every carried balance ` +
        `in it was already worked out from these exact receipts.`
      );
    }
    if (c.participationStatus === "CLOSED") {
      return `${c.memberName} is already closed in ${c.cycleName}.`;
    }
  ```
  Called at `app/actions/participation-close.ts:280-293` immediately before the enforcement call
  `      const frozen = frozenCycleRefusal(p.cycle);` at `:299`.

**Why EQUIVALENT on WHICH states are refused.** Both ladders key on the same two enum values and nothing else:
cycle status CLOSED (`!== "CLOSED" → null` versus `=== "CLOSED" → refuse`, complementary over
DRAFT | ACTIVE | CLOSED) and participation status CLOSED (`=== "ACTIVE" → null` versus `=== "CLOSED" → refuse`,
complementary over ACTIVE | CLOSED). There is no state where one fences and the other does not, and no ordering
effect either, because `closeRefusal` runs first at `:293` and throws before `frozenCycleRefusal` is reached at
`:299`.

**The divergence is confined to wording, and it costs one thing:** `closeRefusal`'s closed-cycle sentence omits
the §2.19 instruction — "Record this money against their ledger balance on the member's page instead (2.19)" —
that `frozenCycleRefusal` carries, so on the one path where `closeRefusal` wins the organizer is told no without
being told where.

---

### V30. The current cycle week (Pass 1 #107) — **OPEN**

Pass 1 listed this quantity twice. It is one ruling, adjudicated at **row V5** and **OPEN ruling 11**, which carry
the verbatim lines for `lib/money.ts:162-168` and `lib/commitment.ts:194-197`, the corrected one-week
postponement proof, and the options.

Two things this second listing contributes.

**(a) The split is enforced by a test, and written down nowhere in the law.**
`lib/week-date-authority.test.ts:167-178` whitelists exactly ten display-only `currentWeekNumber` call sites —
`cycle-close.ts`, `dashboard.ts`, `member.ts`, `payments-view.ts`, `payments.ts`, `collections/page.tsx`,
`cycle/add/page.tsx`, `cycle/page.tsx`, `messaging-engine.ts`, `commitment.ts` — and fails on any eleventh;
`:158-201` asserts that "no MONEY path derives its clock from `cycle.startDate`", and `:195-201` asserts that
`lib/standing.ts` and `lib/dashboard.ts` never mention `currentWeekNumber` at all.

**(b) Pass 1's third "implementation" is removed.** `app/actions/cycle-position.ts:216`
(`        (pm) => pm.week.weekNumber > currentWeek && pm.amountPaid > 0,`) is a CONSUMER of the clock, not a
second derivation of it — listing it as an implementation is exactly the error the evidence rule exists to
prevent. `paidAhead` has only one implementation, which uses the stored-row clock deliberately (the comment at
`cycle-position.ts:98-102` says so and names the guard test). Downgraded from headline to visible accordingly:
what actually differs is the week number in two page headers on the same day — 13 on `/admin`, 12 on
`/admin/cycle/position` (`page.tsx:102`
`          {d.cycleName} · week {d.currentWeek} of {d.plannedWeeks}`). Pass 1's title for this quantity,
"computed for the member and never shown", is wrong.

---

## A · INTERNAL (3 rows)

---

### I1. Money that fits nowhere (unallocated / commit refusal) — **EQUIVALENT**

**Implementations**

- `lib/allocation.ts:103-107` — the engine; skips skipped weeks and weeks with `owed <= 0`
  ```
    return {
      allocations,
      totalApplied: amountReceived - remaining,
      unallocated: remaining,
    };
  ```
- `lib/week-picking.ts:118` — `coverageForAmount`'s own walk (`:98-116`), which names the engine as authoritative
  in its own comment (`:88-91`). Drives the client commit gate
  ```
    return { fullWeeks, partialWeek, partialAmount, unallocated: left };
  ```
- `lib/settlement.ts:54` — a waterfall across PAYOUTS, not weeks — a different domain
  ```
    return { perPayout, totalSettled: shortfall - remaining, unabsorbed: remaining };
  ```
- `lib/settlement.ts:74` — one PINNED week only; its leftover is settlement money that no longer fits the week it
  settled
  ```
    return { applied, unallocated: amount - applied };
  ```

**Why EQUIVALENT.** The input sets were re-checked, not the functions alone. The client's week list
(`app/actions/payments-view.ts:253-267`) and the server's (`app/actions/payments.ts:50-65`) are built from the
same query with the same window (`weekNumber >= startWeek && weekNumber <= finishWeek`), the same
`amountAlreadyPaid: payment?.amountPaid ?? 0` and the same ascending order — both were read. Over that identical
list the two walks are step-for-step the same. The two settlement leftovers answer the same English question over
different inputs and share no common input. The only asymmetry is a stale client snapshot, which the server
re-reads and refuses (`lib/rebuild.ts:114-120`).

---

### I2. Elapsed through week (the cycle-wide money boundary) — **EQUIVALENT**

**Implementations**

- `lib/commitment.ts:154` / `:159-165` — canonical: the max weekNumber among rows whose OWN stored date has passed
  its payment window, skipping invalid dates
  ```
  export function elapsedThroughWeek(
  ```
- `lib/cycle-position.ts:186-187` — re-derived from the series' already-stamped `elapsed` flag
  ```
    const elapsed = input.series.filter((w) => w.elapsed);
    const elapsedThrough = elapsed.reduce((max, w) => Math.max(max, w.weekNumber), 0);
  ```
  **Quote corrected from Pass 1**, which quoted
  `const elapsedThrough = input.weeks.filter((w) => w.elapsed).map((w) => w.weekNumber);` — that line appears
  NOWHERE in this file or the repo. Used only as a fallback at `:188`
  `  const currentWeek = input.currentWeek ?? elapsedThrough;` — and `app/actions/cycle-position.ts:103` always
  supplies `currentWeek`, so the fallback is dead on that path.
- `scripts/elapsed-rule-impact.mts:73-74` — computed per MEMBER over their window weeks, a deliberately different
  scope for the simulation
  ```
    const elapsedNumbers = windowWeeks.filter((w) => elapsedByStoredDate(w.date)).map((w) => w.weekNumber);
    const rulingCycleWeek = elapsedNumbers.length > 0 ? Math.max(...elapsedNumbers) : 0;
  ```
- `scripts/elapsed-rule-impact.mts:106` — takes the LAST ROW of the filtered array rather than the maximum week
  number, so it depends on row order where the canonical does not; the query orders by weekNumber ascending, so
  the two coincide
  ```
  const lastElapsed = cycle.weeks.filter((w) => elapsedByStoredDate(w.date)).at(-1) ?? null;
  ```

**Why EQUIVALENT.** `lib/cycle-position.ts:187` is not an independent derivation: in `app/actions/cycle-position.ts`
the boundary is computed once by the canonical at `:143`
(`const elapsed = elapsedThroughWeek(cycle.weeks, today);`), passed into `receiptsByWeek` at `:161`, stamped per
row as `weekNumber <= elapsed` (`lib/dashboard.ts:286`), and then recovered as the maximum of the stamped rows
over the same week set. The maximum of {n : n ≤ E} over a non-empty week set is E, and when nothing has elapsed
both are 0. A §5.10 duplicate that cannot produce a different number — and on the live path it is not even read.

---

### I3. Skipped (cycle-wide week nobody owed) — **EQUIVALENT**

**Implementations**

- `prisma/schema.prisma:171` — the stored column on Week; everywhere else in the tree this is read, not derived
  ```
    isSkipped  Boolean  @default(false)
  ```
- `app/admin/(protected)/payments/patterns-view.tsx:54` — derives the flag back out of the grid cell's
  already-derived `PaymentStatusValue`, to build the `PickableWeek` list handed to PaymentEntry
  ```
            isSkipped: cell.status === "SKIPPED",
  ```

**Why EQUIVALENT.** `paymentStatus` tests `isSkipped` first and unconditionally — `lib/derived.ts:189`
`  if (args.isSkipped) return "SKIPPED";` sits above every other branch, including PAID at `:190` — so
`status === "SKIPPED"` is true exactly when `Week.isSkipped` is true, for every member and every amount.

**Worth recording:** the sibling line `:55` (`          isDeferred: cell.status === "DEFERRED",`) is NOT
equivalent — `paymentStatus` puts PAID above DEFERRED (`:190-191`), so a deferred week paid in full comes back
with `isDeferred` false — but nothing downstream reads it: `remainingOn` and `isPickable`
(`lib/week-picking.ts:43-51`) ignore `isDeferred` entirely, and a fully-paid week has remainder 0 either way. That
trap is carried in full at row F14.

---
## A · FOOTNOTE (14 rows)

Nothing in this group can reach a screen differently. Several were **downgraded from higher ranks** on the
principle that the rank describes the divergence, not the quantity: an EQUIVALENT row has no divergence, so none
can be displayed.

---

### F1. Fee, projected (one lucky number) — the percent arithmetic itself — **EQUIVALENT**

**Implementations**

- `lib/money.ts:95-96` — the only fee arithmetic in the application
  ```
    const basisPoints = Math.round(feePercent * 100);
    return Math.round((gross * basisPoints) / 10_000);
  ```
  Integer basis points; percents to 2 decimal places; half-cent ties round up. Every fee in the product reaches
  this function — the six "fees" differ in the GROSS they hand it and in whether the caller reads a stored fee
  instead, never in the percent arithmetic.
- `lib/wheel.ts:542` — a call, not a second implementation; its gross is `lib/wheel.ts:538`
  ```
    const fee = calculateFee(gross, input.cycle.feePercent);
  ```
- `scripts/lib/production-fixture.mts:228` — `[script]` float percent instead of integer basis points
  ```
          const fee = Math.round((gross * FEE_PERCENT) / 100);
  ```
  `FEE_PERCENT` is a module constant (`scripts/lib/production-fixture.mts:32` `export const FEE_PERCENT = 2;`)
  and is the same value the fixture writes onto the cycle at `:94` `      feePercent: FEE_PERCENT,`.

**Why EQUIVALENT.** For every integer g in range, `Math.round((g*2)/100)` and `Math.round((g*200)/10_000)` are
the same double: `g*2` and `g*200` are both exact (`g*200` stays exact below 2^53), and each division is the
correctly-rounded IEEE-754 result of the same exact rational g/50, so `Math.round` sees an identical value
including at .5 ties. The two roads could only part on a fractional percent, and `FEE_PERCENT` is the integer 2
and is the same number the fixture stores on the cycle.

---

### F2. Fee estimate, kept out of the cash position (`feeEstimate`) — **EQUIVALENT**

**Implementations**

- `lib/cycle-position.ts:338-340` — pass-through plus one addition
  ```
      soFar: input.onHandedOut,
      ifRemainingPayoutsComplete: input.onDrawn,
      total: input.onHandedOut + input.onDrawn,
  ```
- `app/actions/cycle-position.ts:312-317` — reads the STORED `Payout.feeAmount`, which is what §2.30 requires
  ```
        onHandedOut: payouts
          .filter((p) => p.status === "COLLECTED")
          .reduce((s, p) => s + p.feeAmount, 0),
        onDrawn: payouts
          .filter((p) => p.status === "PENDING")
          .reduce((s, p) => s + p.feeAmount, 0),
  ```
  Payout set verified: `app/actions/cycle-position.ts:86`
  `      where: { luckyNumber: { cycleId: cycle.id } },`.
- `scripts/audit-position-figures.mts:211-212` — `[script]` same set (`:54`), same column, same filters
  ```
    onHandedOut: payouts.filter((p) => p.status === "COLLECTED").reduce((s, p) => s + p.feeAmount, 0),
    onDrawn: payouts.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.feeAmount, 0),
  ```
- `scripts/verify-cycle-position.mts:172-173` — `[script]` identical again (`:53`)
  ```
    onHandedOut: payouts.filter((p) => p.status === "COLLECTED").reduce((s, p) => s + p.feeAmount, 0),
    onDrawn: payouts.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.feeAmount, 0),
  ```

**Why EQUIVALENT.** The status filters are exhaustive and disjoint — `prisma/schema.prisma:685-688` declares
`enum PayoutStatus {` / `  PENDING` / `  COLLECTED` / `}` and nothing else — so the two filters partition every
payout row; all three sites query the same set by the same cycle predicate and sum the same stored column. No
input can separate them. **Downgraded from visible to footnote.**

**Two couplings worth keeping.** Because this is built on the stored fee, everything in row A7 flows into it, and
after a fee-percent correction the estimate correctly keeps reporting the old fee while the projections around it
move. And it is deliberately excluded from the coverage verdict — `lib/cycle-position.ts:385-387`, verified
verbatim: "  // cash in his hand today and both have to come out of it later. The FEE is / // deliberately absent
— it is an estimate, and a question about whether he / // can meet what he owes must not lean on one."

---

### F3. Structural cycle fee projection vs the roster projection's `totalFees` — **EQUIVALENT**

**Implementations**

- `lib/projection.ts:105-106`, `:110`, `:115` — STRUCTURAL: N slots × the unit, before anyone joins
  ```
    const weeklyPot = override ?? calculateGross(unitAmount, plannedWeeks);
    const cycleTotal = calculateGross(weeklyPot, plannedWeeks);
      weeklyFee: calculateFee(weeklyPot, feePercent),
      totalFees: calculateFee(cycleTotal, feePercent),
  ```
  `totalFees` is charged on the whole cycle gross and is deliberately NOT `weeklyFee × weeks` — `:112-114` says so
  and is right, since each rounds to the cent.
- `lib/projection.ts:129`, `:132`, `:134` — ROSTER: the pot is the sum of real members' weeklies and total fees is
  the sum of per-member fees, each rounded separately
  ```
    const weeklyPot = input.members.reduce((sum, m) => sum + m.weeklyAmount, 0);
      weeklyFee: calculateFee(weeklyPot, input.feePercent),
      totalFees: perMember.reduce((sum, m) => sum + m.fee, 0),
  ```
- `app/admin/(protected)/cycles/new/new-cycle-form.tsx:390` and `:399` — the weeks × unit multiplication written
  out twice more, as hint and placeholder for the OVERRIDE field
  ```
                    ? `Structure says ${formatMoney(weeks * unitAmount)}/week (${weeks} × ${formatMoney(unitAmount)}). Leave empty to use it.`
                    weeksValid && unitAmount !== null ? String((weeks * unitAmount) / 100) : "20000"
  ```
  Ignoring the override is correct — the hint's job is to show what the override would replace. Equals
  `calculateGross(unitAmount, plannedWeeks)` exactly for plain integers, dropping only the overflow guard.

**Why EQUIVALENT — downgraded from RESOLVED, and from visible to footnote.** **The rule check failed an earlier
draft:** the §1 sentence it quoted ("An Equb is an Ethiopian rotating savings group: members contribute weekly,
one member receives the pot each week, everyone receives exactly once per cycle.") IS verbatim at
`EQUB_GROUND_TRUTH.md:35-36`, but it defines what an equb is and settles nothing about which projection a screen
should call — a merely adjacent rule. That draft also listed NO wrong implementation and said "Nothing changes
today", which is not a resolution. **The honest reading: these are two different quantities, not two
implementations of one, and no figure a human sees can differ.** Callers re-derived by search:
`cycleFeeProjection` is called at exactly one place, `new-cycle-form.tsx:94` (the planning screen, where no roster
exists); `cycleProjection` at exactly one, `cycle-edit-form.tsx:78` (the live cycle's own members). No third
caller exists, so the two never meet on one screen.

**The risk note stands:** the separation is held only by which component imports which function —
`lib/projection.ts:14-16` records that conflating them once produced a wrong screen ("// A planning screen must
never use the second: a roster is an assumption, and / // presenting an assumption as a projection told the
organizer that a longer / // cycle was worth the same as a short one.") — and there is no guard preventing a
future screen from importing the wrong one.

---

### F4. Payout net, projected (gross − fee, before any draw) — **EQUIVALENT**

**Implementations**

- `lib/money.ts:100-106` — the only projected-net derivation in the application, and the only place that refuses a
  fee larger than the gross
  ```
  export function calculateNet(gross: number, fee: number): number {
    if (fee > gross) {
      throw new RangeError(`fee (${fee}) must not exceed gross (${gross})`);
    }
    return gross - fee;
  ```
  (The two `assertCents` lines at `:101-102` are elided; every quoted line appears.)
- `lib/wheel.ts:543` — the single call site every projection reaches — draw, portal, waiting list, manual payout,
  agreement, messages, fee preview
  ```
    return { luckyNumberId: input.luckyNumber.id, gross, fee, net: calculateNet(gross, fee) };
  ```
- `lib/settlement.ts:115` — the terms-settlement path uses the same function for the new entitlement
  ```
    const newNet = calculateNet(newGross, newFee);
  ```
  `lib/settlement.ts:119` `  const netPerWeek = (input.newWeeklyAmount * (10_000 - basisPoints)) / 10_000;` is a
  fractional-week divisor, not a net — correctly excluded.

**Why EQUIVALENT.** One function, two call sites. **Downgraded from headline to footnote.**

**Recorded for one asymmetry that matters to row A10:** this function is the only place in the codebase that
refuses `fee > gross`, and it guards a value that is never persisted. The value that IS persisted,
`Payout.netAmount`, passes through no such check — `app/actions/edits.ts:1908-1916` validates gross, fee and net
only as independent non-negative integers, so the database can hold a triple this function would throw on.

---

### F5. Manual payout preview totals (gross, fee, net across the chosen numbers) — **EQUIVALENT**

**Implementations**

- `lib/manual-payout.ts:220-222` — **DEAD IN THE APPLICATION**
  ```
      totalGross: lines.reduce((s, l) => s + l.gross, 0),
      totalFee: lines.reduce((s, l) => s + l.fee, 0),
      totalNet: lines.reduce((s, l) => s + l.net, 0),
  ```
  Re-derived by search: `manualPayoutPreview` appears only at `lib/manual-payout.ts:208` (its definition) and
  `lib/manual-payout.test.ts:4`, `:221`, `:224`, `:253`. No application caller. Its input type also declares two
  parameters it never reads — `:210` `  weeksCommitted: number;` and `:211` `  feePercent: number;` — while all
  the arithmetic arrives through the injected `calculate` at `:215`. The signature advertises ownership of a fee
  derivation the function does not perform (§5.10).
- `app/admin/(protected)/people/[id]/assign-payout.tsx:154-157` — the LIVE one; sums the ticked subset in the
  client over per-number figures the server built with `calculatePayout` at `app/actions/manual-payout.ts:154-158`
  ```
    const totals = selected.reduce(
      (acc, n) => ({ gross: acc.gross + n.gross, fee: acc.fee + n.fee, net: acc.net + n.net }),
      { gross: 0, fee: 0, net: 0 },
    );
  ```
- `app/actions/manual-payout.ts:518` — the write path re-sums the rows it just created — net only, from the create
  results rather than from the preview lines
  ```
          totalNet: payouts.reduce((s, p) => s + p.netAmount, 0),
  ```

**Why EQUIVALENT.** The dead module cannot reach a screen; the client reduce and the server re-sum both aggregate
lines produced by the same `calculatePayout` call over the same lucky numbers and the same `weeksCommitted`, and
both are read before any settlement has touched the rows — `settleWinnerWeeks` runs at
`app/actions/manual-payout.ts:482` `      const settlements = await settleWinnerWeeks(tx, draw.id);`, which
decrements the database rows while `:518` sums the in-memory create results, so both totals describe the
pre-settlement net. **Downgraded from visible to footnote.** Recorded because §5.10 is exactly this shape: a
second function answering the question, kept alive only by its own tests, carrying two required parameters that
prove nothing reads them.

---

### F6. The signed agreement's `{totalContribution}` against its own `{payoutGross}` — **EQUIVALENT**

**Implementations**

- `app/actions/agreement.ts:127` — total-first, inline, off the participation's weekly amount
  ```
      totalContribution: participation.weeklyAmount * participation.weeksCommitted,
  ```
- `app/actions/agreement.ts:128-130` — the three fields on the very next lines come from `feePreview`
  (`app/actions/agreement.ts:76`) — the per-lucky-number sum over a re-split of the same weekly amount
  ```
      payoutGross: preview.gross,
      feeAmount: preview.fee,
      payoutNet: preview.net,
  ```

**Why EQUIVALENT — worth stating as a proof rather than an assumption, because the two numbers sit in the same
signed document.** `lib/agreement.ts:67` renders `{totalContribution}` ("I agree to pay {weeklyAmount} every week
for {weeksCommitted} … That is {totalContribution} in total.") and `:70` renders `{payoutGross}` ("When my number
is drawn I receive {payoutGross}, less the management fee of {feeAmount} — {payoutNet} in my hand.").
`splitIntoLuckyNumbers`' outputs sum back to the weekly exactly (`lib/money.ts:67-69`, pinned by
`lib/money.test.ts:40-45`), so Σ(aᵢ × weeks) = weeklyAmount × weeks in integer arithmetic with no rounding
anywhere — unlike the FEE, which rounds per number and genuinely can drift. **The document cannot quote a gross
that disagrees with its own total contribution.** Downgraded from headline to footnote: an EQUIVALENT row has no
divergence, and the earlier "headline" rated the document rather than the divergence.

**Note the shared exposure:** BOTH are built from `Participation.weeklyAmount`, so both move together when the
weekly is edited while the member's portal — built from the stored lucky-number rows — does not (row A8). The
agreement stays internally consistent and jointly wrong.

---

### F7. Finish week (Pass 1 listed this quantity twice) — **EQUIVALENT**

Adjudicated in full at **row A24**: `lib/money.ts:113-117` canonical; `lib/week-winners.ts:161` and `:208`;
`participation-editor.tsx:429` and `:448`; the SQL half-open bound at
`prisma/migrations/20260806020000_…/migration.sql:61` and `scripts/verify-member-privileges.mts:78`. For integer
`weekNumber`, `n <= s + c - 1` and `n < s + c` select the same set. The only fork is guards, and both bad inputs
are refused by `lib/participation-rules.ts:25-31` on every create and update path.

---

### F8. Elapsed through week (Pass 1 listed this quantity twice) — **EQUIVALENT**

Adjudicated in full at **row I2**: `lib/commitment.ts:159-165` canonical; `lib/cycle-position.ts:186-187` re-derives
the boundary from a flag the canonical's own output set, so the round trip returns the same integer for every
input — including 0 — and on the live path the fallback is never read because
`app/actions/cycle-position.ts:103` always supplies `currentWeek`. **Pass 1's quote for `lib/cycle-position.ts`
was wrong and is corrected there.**

---

### F9. Weeks credited / weeks paid — capped or uncapped on screen (Pass 1 listed this twice) — **EQUIVALENT**

Adjudicated in full at **row A23**, including the downgrade from an earlier "OPEN / headline". The cap can never
bind, because `planCommit` refuses any receipt with a remainder (`lib/standing.ts:246-253`) and every terms change
replays through `lib/rebuild.ts`, which throws rather than absorbing surplus (`:114-120`). Five separately written
clamps, one uncapped admin surface, no shared helper: a §5.10 maintenance hazard, not a divergence. It becomes
real the moment anything writes money outside `planCommit`/`rebuild`, which the import scripts do.

---

### F10. Weeks credited — receipts basis vs week-rows basis — **EQUIVALENT**

**Implementations**

- `lib/contribution.ts:91-94` — `weeksCovered`, from `PaymentEvent` receipts
  ```
    const weeksCovered =
      input.weeklyAmount > 0
        ? Math.min(Math.floor(paidIn / input.weeklyAmount), input.weeksCommitted)
        : 0;
  ```
  `paidIn` = `totalContributed` over `PaymentEvent` rows (`lib/contribution.ts:87`). Reaches `/me` through
  `app/actions/member.ts:343-348`.
- `lib/derived.ts:127` — `weeksCredited`, from Σ `Payment.amountPaid`
  ```
    return Math.floor(totalPaid / weeklyAmount);
  ```
  `totalPaid` is `app/actions/member.ts:254`
  `      totalPaid: participation.payments.reduce((sum, p) => sum + p.amountPaid, 0),`. Reaches the SAME `/me`
  response at `:349`.
- `app/actions/member.ts:207-210` — the stopped branch, receipts basis, with a `Math.max(1, …)` divisor guard the
  shared function does not have (`lib/derived.ts:124-126` throws instead)
  ```
              weeksPaid: Math.min(
                Math.floor(paidIn / Math.max(1, stopped.weeklyAmount)),
                stopped.weeksCommitted,
              ),
  ```

**Why EQUIVALENT.** The two bases are held in step by every writer, each read and checked: `lib/rebuild.ts:52-53`
zeroes every Payment row and re-applies the receipts, THROWING rather than dropping money when an event no longer
fits (`:94-99` for pinned, `:114-120` for ordinary); `lib/draw-settlement.ts:199-205` and `:229-235` both decrement
`Payment.amountPaid` by each allocation and delete the `PaymentEvent` in the same loop; and
`app/actions/payments.ts:234-237` refuses through `planCommit` any amount the window cannot absorb, so every event
is fully allocated and Σ(allocations) = Σ(events) = Σ(`Payment.amountPaid`). It is an invariant maintained by three
writers rather than by construction, and **nothing asserts it**.

**Correction to Pass 1:** it recorded "weeklyAmount = 0 (DB-reachable — no CHECK constraint exists)" as the
residual risk. `lib/participation-rules.ts:19-21` refuses `weeklyAmount < 1` on every create and update path
(`validateParticipationFields`, called at `app/actions/edits.ts:260` and `app/actions/participations.ts:262` and
`:334`), so the divisor-guard difference is not app-reachable either.

---

### F11. Weeks paid and weeks behind as the database computes them, and the guard on it — **RESOLVED**

**Implementations**

- `prisma/migrations/20260806020000_…/migration.sql:55-57` — the LIVE excused rule (Pass 1 cited `:56-57`; the
  comment starts at `:55`)
  ```
      -- ONLY a cycle-wide skip is excused. A personal deferral is still owed
      -- (Aug 2026 ruling) — it only stops the chasing, never the debt.
      count(*) FILTER (WHERE w."isSkipped") AS excused
  ```
  Correct, and matches `lib/standing.ts:176`
  `  const skippedElapsed = elapsed.filter((w) => w.isSkipped).length;`. This is the divergence the
  `20260806020000` migration closed.
- `scripts/verify-member-privileges.mts:74-75` — the guard's SQL copy, still excusing personal deferrals — the
  SUPERSEDED `20260805150000` rule, verbatim. And it never SELECTs from `public.member_progress`: it runs its own
  copy with `$queryRawUnsafe` (`:65`)
  ```
        count(*) FILTER (WHERE w."isSkipped" OR EXISTS (
          SELECT 1 FROM public.payments p2 WHERE p2."weekId" = w.id AND p2."participationId" = pt.id AND p2."isDeferred")) AS excused
  ```
- `scripts/verify-member-privileges.mts:90-93` — the guard's TypeScript copy, excusing deferrals too, so the script
  compares two copies of the same superseded rule against each other
  ```
    const excused = closed.filter((w) => {
      const row = pt.payments.find((p) => p.weekId === w.id) ?? null;
      return (row?.isDeferred ?? false) || w.isSkipped;
    }).length;
  ```
- `scripts/verify-member-privileges.mts:81` — the guard's row scope; the real view has no status filter, so the
  guard cannot see the closed-participation defect either
  ```
    WHERE pt."cycleId" = '${cycle.id}' AND pt.status = 'ACTIVE'
  ```
- `scripts/elapsed-rule-impact.mts:213` — a third hand copy of the view's arithmetic, also run with
  `$queryRawUnsafe` (`:208`) rather than selecting from the view; the file says why at `:205-206`
  ```
      least(floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount"), pt."weeksCommitted")::int
  ```
  **Quote corrected from Pass 1**, which rendered this dropping a space and merging line `:214`
  (`      AS weeks_paid,`) onto it.

**Divergence proof.** The deferral axis is now EQUIVALENT between the live view and `lib/derived.ts` — both excuse
only `isSkipped`. What is NOT equivalent is **the guard**. Run `scripts/verify-member-privileges.mts` today against
a cycle containing Tsion (week 14 marked late, unpaid, weeks 1-13 elapsed, $6,500 paid at $500): the script's own
SQL at `:65-82` computes closed = 13, excused = 0, credited = 13 → expectBehind 0; its own TypeScript at `:89-96`
computes the same → expectBehind 0; **it prints 0 mismatches** — while the live view says 0 and the app says 1.
The one thing checking the SQL-vs-TypeScript pair compares two copies of the wrong rule to each other and can
never fail on the defect it exists to catch. Its ACTIVE-only scope at `:81` blinds it to the closed-participation
defect (row A12) in the same breath.

**Ruling.** Correct: `prisma/migrations/20260806020000_…/migration.sql:55-57` — only a cycle-wide skip is excused.
Wrong: `scripts/verify-member-privileges.mts:74-75` and `:90-93`; `:65` (replays its own SQL instead of selecting
from `public.member_progress`, so a change to the view is invisible to it); `:81` (scopes to `status = 'ACTIVE'`,
which the view does not).

> §2.14 MONEY IS THE TRUTH — EVERYTHING ELSE IS DERIVED: "**Stored:** the money received (amount, date, method),
> and the organizer's own two decisions about a week — `deferred` (excuse the chase; the money is still owed) and
> the **manual late mark** (`markedLateAt` with an optional note, added 12 Aug 2026 — §2.29)."

**What a human sees.** Nothing on any screen — but **this is why the divergences in rows A14, A16, A17, A32 and
A33 survived**: the file whose whole job is to prove the SQL view and the TypeScript agree carries its own private
copy of both sides, written to a rule neither of them uses any more. §5.4: "Exemptions are prose; verify them."

---

### F12. Deferred (the organizer's other stored decision) — **EQUIVALENT**

**Implementations**

- `app/actions/edits.ts:1365` — canonical writer, `setWeekDeferral`
  ```
        await tx.payment.upsert({
  ```
  `update: input.deferred ? { isDeferred: true, markedLateAt: null, markedLateNote: null } : { isDeferred: false }`
  (`:1377-1379`).
- `app/admin/(protected)/payments/patterns-view.tsx:55` — re-derives the boolean from the derived cell STATUS
  rather than the stored column
  ```
            isDeferred: cell.status === "DEFERRED",
  ```
  Because PAID beats DEFERRED in `lib/derived.ts:190-191`, a deferred week that is fully covered comes back false.
- `app/admin/(protected)/payments/payments-grid.tsx:88` — same re-derivation for the grid's `WeekActionPanel`
  target
  ```
        isDeferred: cell.status === "DEFERRED",
  ```
- `app/admin/(protected)/payments/payments-members.tsx:96` — same re-derivation for the members list
  ```
        isDeferred: entry.cell.status === "DEFERRED",
  ```

**Why EQUIVALENT — the three re-derived values are dead, verified independently.** `PickableWeek.isDeferred`
(`lib/week-picking.ts:39`) is declared and never read: `lib/week-picking.ts` was read end to end and the field
appears only in the type. `WeekTarget.isDeferred` (`components/admin/week-action-panel.tsx:49`) is likewise never
read — the only `isDeferred` reads in that file are `:170` (which maps the SERVER's `getCatchUpWeeks` rows, not the
target), `:302`, `:395` and `:441`, all on `detail`, which is fetched from the stored column
(`app/actions/payments-view.ts:201`). So a deferred-and-fully-covered week produces a wrong boolean in three
places and **no screen can show it.**

**It stays a live trap:** the moment anything reads either field, a covered deferred week reads as not deferred.

---

### F13. What the group owes a stopped, never-drawn member (`owedBack`) — **RESOLVED**

**Implementations**

- `app/actions/cycle-position.ts:268-280` — canonical for the position page; fee withheld, floored at zero
  ```
          owedBack:
            alreadyPaidOut > 0
              ? 0
              : Math.max(
                  0,
                  paidInByThem -
                    feeOnReturn({
                      weeklyAmount: p.weeklyAmount,
                      weeksCommitted: p.weeksCommitted,
                      unitAmount: cycle.unitAmount,
                      feePercent: cycle.feePercent,
                    }),
                ),
  ```
  `alreadyPaidOut` is the sum of COLLECTED payout nets (`:231-236`); `paidInByThem` sums `Payment.amountPaid`
  (`:245`). Consumed at `lib/cycle-position.ts:222` and reported to `/admin/cash` through
  `app/actions/cycle-position.ts:306`.
- `lib/final-position.ts:125-126` — same arithmetic from receipts
  ```
      const fee = feeOnReturn(input);
      const amount = Math.max(0, input.paidIn - fee);
  ```
- `scripts/audit-position-figures.mts:191-194` — no fee subtracted and no floor
  ```
      owedBack:
        alreadyPaidOut > 0
          ? 0
          : p.payments.reduce((sum, pm) => sum + pm.amountPaid, 0),
  ```
- `scripts/verify-participation-close.mts:401-404` — a third arithmetic under the same field name: no fee, no
  floor, and the drawn test is an identity check against one fixture member rather than a payout query
  ```
      owedBack:
        p.id === paidOutMember.id
          ? 0
          : p.payments.reduce((sum, pm) => sum + pm.amountPaid, 0),
  ```

**Divergence proof.** Stopped member Hana, never drawn, weeklyAmount $500, weeksCommitted 20, cycle unitAmount
$500 and feePercent 2. She paid in $6,000 before stopping at week 12. `feeOnReturn` = 2% of (500 × 20) = $200.

- `app/actions/cycle-position.ts:268` → owedBack = max(0, 600000 − 20000) = **$5,800**.
- `lib/final-position.ts:126` → direction "owed-to-them", amount **$5,800**. Agrees.
- `scripts/audit-position-figures.mts:194` → **$6,000**, and `scripts/verify-participation-close.mts:404` →
  **$6,000**.

**But where those two script values go was traced, and an earlier draft's consequence does not hold.** `owedBack`
is consumed only by `lib/cycle-position.ts:222` (`owedBackToStopped`), and every reference to
`owedBackToStopped` was grepped: the only consumer anywhere is `app/actions/cycle-position.ts:306`.
`scripts/audit-position-figures.mts` never prints or asserts it — its `cashOnHand` call at `:204-209` omits
`owedToStopped` entirely, and none of its `record(...)` checks name it. So both scripts compute a
$200-per-member-wrong figure and **discard it**. `npm run check:position` does NOT state a different owed-back
than the page; it states nothing.

**Ruling.** Correct: `app/actions/cycle-position.ts:268` (and `lib/final-position.ts:126`). Wrong:
`scripts/audit-position-figures.mts:191-194`; `scripts/verify-participation-close.mts:401-404`.

> §2.30 THE FEE IS FIXED BY THE COMMITMENT, NOT BY ATTENDANCE: "**What is recoverable is floored at what they paid
> in.** For a member who stopped undrawn, the money returned is `paid in − fee`, never below zero."

**What a human sees.** Nothing today, which is why this is downgraded from `visible` to footnote. The two scripts
compute owed-back by an arithmetic §2.30 rules out, then throw the value away: it reaches no printed check, no
assertion and no screen. **It matters as a trap** — the day either script starts reporting `owedBackToStopped`, or
the audit script is copied into a screen, it will disagree with `/admin/cycle/position` by the withheld fee per
stopped undrawn member.

---

### F14. Consistency state per week, and longest overdue run — **EQUIVALENT**

**Implementations**

- `lib/chart.ts:230-232` — a pure mapping over the status `computeStanding` already derived; the only production
  route is `app/admin/(protected)/payments/payments-screen.tsx:184`
  ```
  export function consistencyFromStatus(
    status: "PAID" | "PARTIAL" | "DEFERRED" | "SKIPPED" | "UNPAID" | "LATE",
  ): ConsistencyState {
  ```
- `lib/chart.ts:186-197` — a second, independent derivation from raw cents
  ```
  export function consistencyState(input: {
    amountDue: number;
    amountPaid: number;
    isDeferred: boolean;
    /** The payment window has closed — from the calendar, never a stored flag. */
    windowClosed: boolean;
  }): ConsistencyState {
    if (input.isDeferred) return "deferred";
    if (input.amountPaid >= input.amountDue && input.amountDue > 0) return "paid";
    if (!input.windowClosed) return input.amountPaid > 0 ? "partial" : "not-due";
    if (input.amountPaid > 0) return "partial";
    return "overdue";
  ```
  Puts DEFERRED above PAID (the ladder in `lib/derived.ts:189-197` puts PAID above DEFERRED); has no `isSkipped`
  input and no `markedLate` input; takes `windowClosed` as an argument the caller must decide.

**Why EQUIVALENT — it cannot reach any screen.** Re-derived by search over the whole tree: `consistencyState`'s
only references outside its own definition are `lib/chart.test.ts:6` and `:179-206`. Every production caller of the
strip goes through `consistencyFromStatus` or through `longestOverdueRun`
(`components/charts/consistency-strip.tsx:131`), and `longestOverdueRun` has no second implementation anywhere.

**Recorded because the divergences are real and would be live the moment anyone imports it:** a deferred week paid
in full returns "deferred" here and "paid" through the status route; a skipped week with the window closed returns
"overdue" here and "not-due" through the status route; and an unpaid week the organizer marked late before its
window closed returns "not-due" here and "overdue" through the status route. Strictly this is *unreachable* rather
than *provably identical* — it is filed EQUIVALENT because no input can move a screen.

---
> **End of Part A.** 103 rows: 47 EQUIVALENT, 36 RESOLVED, 20 OPEN.

---

# Part B — Label vs math

**31 sweep findings, 29 distinct labels** — the cash page's "Expected by now" and "Short" cards were each found
twice, with different worked numbers; those pairs are merged and both proofs kept.

This set was **derived independently in this pass**, not taken from Pass 1. Every entry quotes the label
verbatim, quotes the math verbatim, states what the label promises and what the code computes, gives a concrete
failure case, and names the route re-derived by reading the route files and their rendered components.

Verdicts: **WRONG** — the label states something the math does not compute. **MISLEADING** — the math is
defensible but the words oversell or misname it. **MATCHES** — checked and cleared, kept in the record with the
refutation.

---

## B · WRONG (9 distinct labels, 11 sweep findings)

---

### B1. "They receive  −  Fee (2%)  =  They get" — **WRONG** · headline

**Label** — `components/admin/payout-equation.tsx:56-60` (visible equation) and `:72-75` (sr-only sentence):
screen-reader copy reads "$5,000.00 gross, minus a 2% fee of $100.00, leaves $4,650.00 for the member."

**Math** — `app/admin/(protected)/people/[id]/page.tsx:315-333` (`payoutTotals`), values fed at `:633-641`; net
decremented at `lib/draw-settlement.ts:156-159`, which `app/actions/wheel.ts:706` calls immediately after the
payout rows are created at `:691-701`:
```
            net: acc.net + (recorded?.netAmount ?? projected.net),      [people/[id]/page.tsx:327]
await tx.payout.update({ where: { id: deduction.payoutId }, data: { netAmount: { decrement: deduction.deduct } } });
                                                                        [lib/draw-settlement.ts:156-159]
              netAmount: payout.net,                                    [wheel.ts:697]
      const settlements = await settleWinnerWeeks(tx, draw.id);         [wheel.ts:706]
```

**Promises** an identity the reader can check on screen: gross minus the management fee equals the net handed
over. The "−" and "=" are drawn deliberately — the component's own comment at `:10` says "It is now the
arithmetic itself, written out: gross MINUS fee EQUALS net."

**Computes** three independently-sourced stored fields, where `netAmount` has ALREADY been decremented by the
winner's own-week contribution. Ordering verified: `wheel.ts` writes `netAmount = gross − fee` at `:697`, then
calls `settleWinnerWeeks` at `:706`, which decrements it. So once a payout is drawn and settled, net =
gross − fee − settlement.

**Failure case.** Member at $250/week committed to 20 weeks, one lucky number of $250, cycle fee 2%. Payout
created gross $5,000, fee $100, net $4,900; the draw then settles their own week-N $250 contribution,
decrementing `netAmount` to $4,650. `/admin/people/<id>?tab=payout` renders: THEY RECEIVE $5,000.00 − FEE (2%)
$100.00 = THEY GET $4,650.00. **$5,000 − $100 = $4,900, not $4,650.** The screen-reader sentence states outright
"leaves $4,650.00 for the member", which is arithmetically false. The organizer checking his cut reads the $350
gap as a fee of 7%, not 2% — contradicting §2.30's "gross = weekly amount × weeks committed · fee = the cycle's
fee percent × gross".

**Mitigation checked and rejected.** The honest caption exists (`page.tsx:754-757`, "Net is what actually crosses
the table — a win-week contribution settled from the payout is already deducted") and renders under exactly the
condition that produces the imbalance (`active.luckyNumbers.some((n) => n.payouts.length > 0)`, `:753`) — but it
sits at the FOOT of a different Card, below the equation card and below the Carried-balance card that renders
between them at `:643-680`. It is not beside the equation, and it does not repair the sr-only sentence, which is
read aloud as a complete false statement of arithmetic with no caption in earshot.

**Route.** `/admin/people/[id]?tab=payout` — re-derived by reading the tab switch at `page.tsx:620` and the render
at `:632-642`. **Correction to the sweep's original surface claim:** `/admin/participations/[id]` does reach this
person page (`app/admin/(protected)/participations/[id]/page.tsx` redirects to `/admin/people/${personId}`), but
it lands on the DEFAULT tab, not `?tab=payout` — the payout tab needs one more click.

---

### B2. "All paid up" — **WRONG** · headline

**Label** — `components/member/member-payout-card.tsx:102`.

**Math** — `app/actions/member.ts:292-298`, passed as `nextDue` at `app/me/page.tsx:269`, rendered by the ternary
at `member-payout-card.tsx:97-103`:
```
const uncovered = standing.weeks.filter(
      (w) => !w.isDeferred && w.coveredAtCurrentRate < w.amountDue,
    );
```

**Promises** that nothing is outstanding — every week this member owes is covered, so there is no next payment.

**Computes** `nextDue === null`, i.e. there is no not-fully-covered week that is ALSO not deferred. Deferred weeks
are stripped out of the candidate list before the null test, and a deferred week is still owed.
`lib/derived.ts:19-20` verbatim: " *   DEFERRED — one person's week. Still owed, just not chased (organizer" /
" *              ruling, Aug 2026). Its only effect is that the week never". `amountOutstanding` counts deferred
weeks by design — `lib/derived.ts:299-300`: `if (!week.isSkipped) due += week.amountDue;` /
`paid += week.amountAlreadyPaid;`. So when every remaining uncovered week is deferred, the candidate list empties
and the card prints the all-clear while the balance is non-zero.

**Failure case.** Member M, $500/wk, 10 committed weeks, own weeks 1-10. Paid $4,500, which allocates oldest-first
over weeks 1-9 (`lib/standing.ts:132-147`). Week 10 is unpaid, the organizer deferred it
(`app/actions/edits.ts:1366-1372` writes `isDeferred`), and week 10's date passed 6 days ago. `uncovered` before
the filter = [week 10]; after `!w.isDeferred` = []; `nextDue` = null → MemberPayoutCard prints **"All paid up"** —
directly beside its own left-hand text "9 of 10 weeks paid" (`member-payout-card.tsx:93-96`, paidCount =
weeksCredited = floor(450000/50000) = 9). On the SAME page SavedCard prints "$500 overdue — weeks that have closed
without payment" (week 10 is elapsed, so `weekCountsAsDue` is true and `amountOutstanding` = 10×$500 − $4,500 =
$500) and WeekStampList prints week 10 as "Deferred" with the sub-line "still owed, not chased"
(`components/member/week-stamp-list.tsx:28`, `:36`). **Three statements, one screen, two contradicting the third.**

> §2.29 effect 2: "| 2 | **Arithmetic** | A mark cannot pull a not-yet-due deferred week forward, and the
> attention list applies the same test — so the list and the standing derivation cannot disagree. An *elapsed*
> deferred week still counts as owed: deferral has never excused the money. |"

**Route.** `/me` — bottom-right of the "Your lucky number(s)" card. Re-derived: `app/me/page.tsx:265-270` renders
`MemberPayoutCard` with `nextDue={p.nextDue}`.

---

### B3. "You paid in $6,000. You were not drawn. $5,800 is owed to you after the $200 fee" — **WRONG** · headline

**Label** — `lib/final-position.ts:178-181`, rendered at `app/me/page.tsx:135` under the heading "Where this
leaves you" (`app/me/page.tsx:132`).

**Math** — `lib/final-position.ts:121`, fed by `app/actions/member.ts:157-160` and `:176-184`:
```
const drawn = input.received > 0;
```

**Promises** that you never won the pot, so the group is holding your money and will give it back, less the fee.

**Computes** `drawn` from COLLECTED payout cash only. `app/actions/member.ts:157-160` verbatim:
`const received = stopped.luckyNumbers` / `.flatMap((n) => n.payouts)` /
`.filter((po) => po.status === "COLLECTED")` / `.reduce((sum, po) => sum + po.netAmount, 0);`. A member whose
number came up but whose payout is still PENDING has `received === 0`, so `finalPosition` takes the `!drawn`
branch, charges `feeOnReturn` on the whole commitment a SECOND time (the payout's `netAmount` already had the fee
withheld by `lib/wheel.ts:542-543`), and reports the group as owing them their contributions back.

**Failure case.** Tsion: $500/wk, cycle unit $500, 20 weeks committed, fee 2%. `splitIntoLuckyNumbers(50000, 50000)`
= [50000], so one number #7. It is drawn in week 8; `calculatePayout` gives gross $10,000, fee $200, net $9,800;
`settleWinnerWeeks` then decrements the payout by her week-8 contribution (`lib/draw-settlement.ts:108`
`const amountDue = inWindow && !excused ? participation.weeklyAmount : 0;` and `:156-159`) leaving `netAmount`
$9,300, status PENDING. She stops at week 12 having paid $5,500 cash plus the $500 settlement receipt = paidIn
$6,000 (paymentEvents summed at `app/actions/member.ts:156`). `received` = $0 because nothing is COLLECTED.
`finalPosition`: drawn=false, fee=$200, amount=$5,800, direction "owed-to-them". The panel renders in EMERALD
(`app/me/page.tsx:125`) reading "$5,800 is owed to you after the $200 fee". **The truth is the opposite
direction:** she is owed a $9,300 payout and owes $10,000 − $6,000 = $4,000 of contributions. Worse, in the SAME
render, `app/me/page.tsx:108` reads "You were drawn" — because `st.drawn` is non-null via
`received > 0 || drawnWeek !== null` (`app/actions/member.ts:215`) — with the value "August 2, 2026 — $0"
(`:110-114`). **One card, "You were drawn" and "You were not drawn."**

> §2.30: "In the other direction — a member who took the pot and stopped short — no fee is charged again, because
> it was already withheld from the payout they received."

**Route.** `/me` for a member whose participation is CLOSED inside a still-ACTIVE cycle — the "Where this leaves
you" panel. Re-derived: the branch is gated on `!participation && result.data.stopped` (`app/me/page.tsx:57`), and
`stopped` comes from `stoppedRecord`'s query
`where: { personId, status: "CLOSED", cycle: { status: "ACTIVE" } }` (`app/actions/member.ts:89`).

---

### B4. "Your payout  /  $18,600  /  you have received it" — **WRONG** · headline

**Label** — `components/member/saved-card.tsx:73` (dt), `:76` (value), `:79` (sub).

**Math** — `app/me/page.tsx:237-238`:
```
const payoutReceived = p.numbers.some((n) => n.payoutStatus === "COLLECTED");
```

**Promises** that the figure above it is money that has already reached you.

**Computes** `.some(...)` — TRUE as soon as ANY ONE of the member's lucky numbers has a COLLECTED payout, while the
figure above it (`app/me/page.tsx:237` `const payoutNet = p.numbers.reduce((sum, n) => sum + n.netAmount, 0);`)
sums EVERY number, including numbers not yet drawn whose `netAmount` is still the projection from
`calculatePayout` (`app/actions/member.ts:283`: `netAmount: payout?.netAmount ?? projected.net,`).

**Failure case — arithmetic CORRECTED from the sweep.** Member with $1,000/wk at a $500 unit holds two numbers —
`lib/money.ts:55-70`, `splitIntoLuckyNumbers(100000, 50000)` = [50000, 50000] — 20 weeks, fee 2%. Each number
projects gross $10,000, fee $200, net $9,800. #7 is drawn in week 5 and COLLECTED. The settlement deducts the
member's FULL weekly contribution, not the number's share: `lib/draw-settlement.ts:108` verbatim
`const amountDue = inWindow && !excused ? participation.weeklyAmount : 0;` — so **$1,000, not $500**, comes out of
#7's payout, leaving `netAmount` $8,800 (the sweep said $9,300 here; that was wrong). #12 is still in the draw, so
its `netAmount` falls back to the projection, $9,800. `payoutNet` = $8,800 + $9,800 = $18,600; `payoutReceived` =
true. The card reads "Your payout $18,600 — you have received it". **They have received $8,800.** Overstated by
$9,800, and phrased as a completed fact.

**Route.** `/me` — right-hand cell of the two-column list on the savings card. Re-derived:
`app/me/page.tsx:250-255` passes `payoutNet` and `payoutReceived` into `SavedCard`.

---

### B5. "{weeksPaid} weeks paid  +  {count} behind" (peer rows), and "{currentCount}/{totalMembers} current this week" — **WRONG** · headline

**Label** — `components/member/member-group-list.tsx:183` (peer weeks paid), `:39` via `:186` (behind pill), `:102`
(the ratio) and `:105` (its caption).

**Math** — `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:43` and `:59-61`;
counts assembled at `app/actions/member.ts:459-460`:
```
FROM public.participations pt
```

**Promises** the people currently in the cycle, and how many of them are keeping up this week.

**Computes** over EVERY participation in the cycle with no `status` filter, bounding each member's window purely by
`AND w."weekNumber" <  pt."startWeek" + pt."weeksCommitted"` (`migration.sql:61`) — it never consults
`participations.closedAtWeek` (`prisma/schema.prisma:210`) or the `participation_breaks` table
(`prisma/schema.prisma:260-276`). A member who stopped keeps accruing behind-weeks forever and stays in the
denominator. The admin side deliberately narrows stopped members through `windowBreaks`
(`app/actions/dashboard.ts:105-127`) and `lib/participation-close.ts:120-124`
`export function inWindow(p: ClosableWindow, weekNumber: number)`; the member side does not.

**Failure case — arithmetic TIGHTENED from the sweep.** 27-member cycle. Tsion, $500/wk, 20 committed weeks, stops
at week 10 having paid $5,000. Her own `/me` reads, verbatim from `app/me/page.tsx:70-71`: "You stopped part-way
through. This is where you left it — nothing here is a bill," / "and nothing further is expected from you."
Meanwhile the view gives `weeks_paid` = least(floor(500000/50000), 20) = 10 and `weeks_behind` = greatest(0,
elapsed − 0 − 10). During cycle week 20 nineteen weeks have passed their date+5, so every peer's `/me/group` shows
her row as "10 weeks paid" with an amber "**9 behind**" pill; once week 20's own window closes it becomes "10
behind" (the sweep gave 10 at cycle week 20 — off by one). She is also in the denominator forever, so the header
ratio can never exceed 26/27 under the caption "current this week". And because `getGroupProgress` resolves `mine`
only for an ACTIVE participation (`app/actions/member.ts:408-411`), her own `participation_id` never matches, so
the self-filter at `:432` does not exclude her — **she opens `/me/group` and reads her own name in the peer list
under an amber arrears pill, on the same day her home screen tells her nothing is expected.**

**Route.** `/me/group` — peer list rows and the emerald ratio in the page header. Re-derived from
`app/me/group/page.tsx:30-37` and `app/actions/member.ts:452-460`.

---

### B6. "$0 outstanding — complete.  You owed nothing when this cycle ended." — **WRONG** · headline

**Label** — `lib/member-history.ts:102` (closing sentence) + `components/member/past-cycle-card.tsx:88` (the
appended clause), rendered on the green panel at `past-cycle-card.tsx:78-93`.

**Math** — `app/actions/cycle-close.ts:107` (frozen into the archive) via `lib/standing.ts:179-186`:
```
outstanding: standing.amountOutstanding,
```

**Promises** that at the moment this cycle ended you owed nothing. A final, permanent statement of account — the
member's only copy (`lib/member-history.ts:2-6`).

**Computes** `amountOutstanding` over ELAPSED weeks only, evaluated at the instant the organizer pressed close
(`lib/standing.ts:179-186` passes `elapsed`, not the whole window). A week whose date has passed but whose 5-day
payment window has not yet closed contributes nothing, and the same figure decides whether a carried-balance DEBT
entry is written at all — `lib/cycle-close.ts:154-155` verbatim: `return members` /
`.filter((m) => m.outstanding > 0)`.

**Failure case — with a PRECONDITION the sweep omitted.** The defect requires `closingWaitDays < PAYMENT_WINDOW_DAYS`
(5). `closeCycle` enforces the wait inside the transaction — `app/actions/cycle-close.ts:335-336` verbatim:
`const timing = await cycleCloseTiming(cycle, now);` / `if (timing.state === "too-soon") return { error: timing.reason };`
— and the DEFAULT wait is pinned equal to the payment window (`lib/settings.test.ts:32` asserts
`SETTING_DEFAULTS.closingWaitDays === PAYMENT_WINDOW_DAYS`), so **at the default this cannot happen**. But the wait
is organizer-settable 0–90 and 0 is explicitly blessed: `app/actions/settings.ts:189-192` verbatim "Zero is a
legitimate value — the organizer may decide the money is all in" / "and close the same day — so this is one of the
few numeric settings where" / "the floor is 0 rather than 1."

With wait 0: 20-week cycle, last week dated Sunday 9 Aug 2026, closed Monday 10 Aug. Member M, $500/wk, 20 weeks,
paid $9,500. Week 20's window closes 14 Aug, so `weekHasElapsed` is false for it: outstanding = 19×$500 − $9,500 =
**$0**. The archive freezes weeksPaid 19, weeksCommitted 20, outstanding 0. `/me/history` renders "You paid in
$9,500 / 19 of 20 weeks" in one cell and, in the green panel directly below, "$0 outstanding — complete. You owed
nothing when this cycle ended." `finalBalanceEntries` writes no DEBT row, so the $500 never appears as a carried
balance either.

> §2.18: "2. **Automatic at cycle end** — if nothing is done, at the final week the system computes every member's
> balance itself. Paid in full → $0. Behind → the amount."

This reports $0 for a member who is behind, permanently and in writing.

**Route.** `/me/history` (`app/me/history/page.tsx:119-122`) and `/me` for a member not in a cycle
(`app/me/page.tsx:185`), both rendering the same `PastCycleCard`.

---

### B7. "Expected by now  —  across the weeks that have elapsed" — **WRONG** · visible

*(The sweep found this card twice, with different worked numbers; both are kept.)*

**Label** — `app/admin/(protected)/cash/page.tsx:240`.

**Math** — `app/admin/(protected)/cash/page.tsx:62`; series built in `app/actions/dashboard.ts:161-167` from every
row of `cycle.weeks`:
```
  const expectedTotal = d.series.reduce((s, w) => s + w.expected, 0);
```

**Promises** the cumulative expectation of the weeks that have closed — what should be in hand by today. Both the
label ("by now") and the sub ("weeks that have elapsed") name the elapsed subset.

**Computes** the sum of `expected` over EVERY week the cycle has, future weeks included. `series` re-derived:
`app/actions/dashboard.ts:161-167` builds it from
`weeks: cycle.weeks.map((w) => ({ weekNumber: w.weekNumber, isSkipped: w.isSkipped })),` — every stored week row,
no filter. Each row carries an `elapsed` boolean stamped for exactly this purpose (`lib/dashboard.ts:286`
`elapsed: w.weekNumber <= input.elapsedThroughWeek,`), documented at `lib/dashboard.ts:209-216` as existing so two
screens cannot disagree about whether a week has closed. **The reduce never reads it.** Contrast
`lib/cycle-position.ts:186` and `:194`, which do it correctly:
`const elapsed = input.series.filter((w) => w.elapsed);` then
`const shouldHaveCollected = elapsed.reduce((s, w) => s + w.expected, 0);`

**Failure case (a).** 20-week / $6,750-a-week cycle in week 13 with 12 weeks elapsed. The honest figure is 12 ×
$6,750 = $81,000. The card shows **$135,000** labelled "Expected by now · across the weeks that have elapsed" — a
67% overstatement of the group's obligation to date, sitting immediately beside the derived "Short" card that
inherits the same error. On the last week of the cycle the two agree, so the defect is invisible exactly when
nobody is looking and maximal at the start (week 1: $6,750 genuinely expected, card says $135,000).

**Failure case (b).** 20-week cycle, 27 members at $500/wk = $13,500 per week. It is week 3 and every member is
fully current, so `d.position.totalReceived` = 3 × $13,500 = $40,500. `weekReceipts` computes a full $13,500 of
`expected` for weeks 4 through 20 as well, because `inMemberWindow` is true for them and nothing consults
`elapsed`. The card reads "Expected by now **$270,000** — across the weeks that have elapsed". The elapsed weeks
asked for $40,500. Overstated by $229,500 on a card whose caption names the elapsed weeks.

**Route.** `/admin/cash?view=received` — left stat card. Re-derived from the view switch at `cash/page.tsx:132` and
`ReceivedView` (`cash/page.tsx:228-247`). Also the landing for the old `/admin/received` route, verified:
`app/admin/(protected)/received/page.tsx` is `redirect("/admin/cash?view=received")`.

---

### B8. "Short  —  still to collect for elapsed weeks" — **WRONG** · visible

*(Found twice in the sweep; both worked numbers kept.)*

**Label** — `app/admin/(protected)/cash/page.tsx:241-246` (Received tab).

**Math** — `app/admin/(protected)/cash/page.tsx:62-63`; inputs from `app/actions/dashboard.ts:161-167` (series over
ALL `cycle.weeks`) and `lib/dashboard.ts:50-54` + `:66`:
```
  const expectedTotal = d.series.reduce((s, w) => s + w.expected, 0);
  const shortfall = Math.max(0, expectedTotal - d.position.totalReceived);
```

**Promises** money owed for weeks whose payment window has already closed — arrears the organizer should be chasing
right now.

**Computes** the whole cycle's remaining commitment. The entire file was re-read: there is no
`.filter(w => w.elapsed)` anywhere in `cash/page.tsx`, and `d.series` is `receiptsByWeek` over
`cycle.weeks.map(...)` — every week row the cycle has, future ones included. `d.position.totalReceived` is every
cent ever received across the cycle (`lib/dashboard.ts:51-54`, `totalReceived += p.amountPaid` over all payments).
The result is total-commitment-minus-everything-paid — a savings-progress figure, not an arrears figure.

**Failure case (a).** 20-week cycle, 27 members totalling $6,750/week, currently in week 13 with weeks 1–12 elapsed
and every member fully current, $81,000 received. expectedTotal = 20 × $6,750 = $135,000; shortfall = $135,000 −
$81,000 = **$54,000**. `/admin/cash?view=received` shows "Short $54,000.00 — still to collect for elapsed weeks"
with the emphasis border on (`emphasis={shortfall > 0}`, `:245`), while `/admin/cycle/position?section=collection`
for the same instant shows "Outstanding $0.00 — nothing is owed for elapsed weeks" (its shortfall IS
elapsed-filtered, `lib/cycle-position.ts:186`/`:194`) and the dashboard chart says "All in · closed weeks are fully
collected". **Nobody owes anything and the cash screen reports a $54,000 shortfall.**

**Failure case (b).** Same 20-week, 27-member, $500/wk cycle at week 3 with every member fully current:
expectedTotal $270,000 − totalReceived $40,500 = **Short $229,500**, printed under the caption "still to collect for
elapsed weeks", with the emphasis styling at `cash/page.tsx:245` rendering it as an alarm. The correct arrears
figure is $0 — and the card is only capable of printing $0 in week 20, at which point the alternative caption "the
group is fully current" (`cash/page.tsx:244`) finally becomes reachable.

**Route.** `/admin/cash?view=received` — right stat card.

---

### B9. "You have paid in $11,000, which is 100% of your commitment — 20 of 20 weeks, and you are paid ahead." — **WRONG** · footnote

**Label** — `components/member/savings-arc.tsx:108-113`, specifically the clause at `:111` (screen-reader text).

**Math** — `components/member/savings-arc.tsx:49` against `lib/contribution.ts:103`:
```
const ahead = progress > 1;
```

**Promises** that a screen-reader user who has overpaid is told so — this `<p>` is explicitly the chart
(`savings-arc.tsx:107` verbatim: `{/* The ring is decoration to a screen reader; this is the chart. */}`) for a
ring that is `aria-hidden`.

**Computes** something that is never true. `progress` arrives already capped — `lib/contribution.ts:103` verbatim:
`progress: commitmentTotal > 0 ? Math.min(1, paidIn / commitmentTotal) : 0,` — so `progress > 1` is unreachable and
the ", and you are paid ahead" clause cannot render on any screen. The call graph was re-derived: grep for
`SavingsArc` across all `.tsx` returns exactly three hits (its own declaration at `savings-arc.tsx:31`, the import
at `saved-card.tsx:1`, and the single use at `saved-card.tsx:38`), and that use passes `progress={c.progress}` —
the capped value. There is no second call site with an uncapped progress. The overpayment is announced only by the
separate surplus line at `saved-card.tsx:48-53`.

**Failure case.** Member M, $500/wk, 20 weeks ($10,000 commitment), has paid $11,000. `contribution.progress` =
min(1, 1.1) = 1. `ahead` = false. The accessible description of the ring reads "… which is 100% of your commitment
— 20 of 20 weeks." and stops. **The clause written to cover exactly this case is dead code.**

**Route.** `/me` — screen-reader-only description of the savings ring inside `SavedCard`.

---
## B · MISLEADING (15)

---

### B10. "Short — never came in for that week / still to come in for this week / the week is fully collected" — **MISLEADING** · headline

**Label** — `app/admin/(protected)/this-week/page.tsx:119-131`.

**Math** — `this-week/page.tsx:121`; `totals` = `d.selectedWeekTotals` (`page.tsx:66`), set at
`app/actions/dashboard.ts:345` from the `series` built by `lib/dashboard.ts` `receiptsByWeek` → `weekReceipts:242-267`:
```
            cents={Math.max(0, totals.expected - totals.received)}
```

**Promises** money that never arrived for this week — what the members who did not pay still owe for it. "never
came in for that week" is a claim that nobody is short.

**Computes** week-level expectation minus ALL cash landing on that week's rows, netted across members. `received`
accumulates every member's payment for the week unconditionally (`lib/dashboard.ts:248-251`,
`if (payment) { assertCents(...); received += payment.amountPaid; }`) BEFORE the two `continue`s that remove a
member from `expected` (`:252-253`). Any member whose money is counted in `received` while their expectation is
dropped acts as an overpayment that cancels a different member's genuine debt.

**Failure case.** Week 7, ten members at $250/week. The organizer defers Almaz's week 7 (excuses the chase); she
pays the $250 anyway — nothing in `app/actions/payments.ts` clears `isDeferred`, whose only appearance there is the
pass-through read at `:64`,
`return { week, payment, allocation, isDeferred: payment?.isDeferred ?? false };`, under a comment at `:62-63`
stating "money lands on a deferred week like any other". Bereket pays nothing. Then expected = 9 × $250 = $2,250
(Almaz skipped by `if (payment?.isDeferred) continue;`) and received = Almaz $250 + eight others $2,000 = $2,250.
The card renders "Short $0.00 — the week is fully collected", emphasis off, while further down the SAME page
Bereket sits in the LATE bucket reading "$0.00 of $250.00" (`this-week/page.tsx:205-210`).

**Correction to the sweep, verified against `lib/derived.ts:189-192`:** Almaz does NOT appear under "Deferred"
carrying "not chased, still owed" — `paymentStatus` puts PAID above DEFERRED
(`if (args.amountPaid >= args.amountDue) return "PAID"; if (args.isDeferred) return "DEFERRED";`), so a deferred
member who pays in full reads PAID. **The contradiction is sharper for the correction:** the PAID bucket lists NINE
names directly beneath a Received sub that says "8 of 9 members paid".

A second, deferral-free route stands as stated: a member whose weekly amount was reduced from $500 to $250 keeps
stored $500 Payment rows on earlier weeks (§2.14's rate-change case) while `expected` uses the current $250, and
the $250 surplus silently covers another member's missing $250.

**Route.** `/admin/this-week` (and `/admin/this-week?week=N` for any week via the picker — re-derived from the
`?week=` parse at `page.tsx:49-53` and the WeekPicker at `:94-101`).

---

### B11. "Expected — from members in their window" — **MISLEADING** · headline

**Label** — `app/admin/(protected)/this-week/page.tsx:107-111`.

**Math** — `lib/dashboard.ts:242-258` (`weekReceipts`), reached via `app/actions/dashboard.ts:161-167` → `:345`:
```
    if (!inWindow || input.isSkipped) continue;
    if (payment?.isDeferred) continue;
    assertCents("weeklyAmount", participation.weeklyAmount);
    expected += participation.weeklyAmount;
```

**Promises** what the week asks for from every member whose commitment covers it. The sub names exactly one
exclusion — being outside your window.

**Computes** in-window members MINUS deferred ones. The second `continue` silently drops a member who is in their
window and, per §2.14/§2.29, still owes the money. The platform's other week-expectation builder follows the rule
instead: `lib/payments-view.ts:225` — `if (!week.isSkipped && mw.status !== "SKIPPED") expected += mw.amountDue;` —
under the comment at `:223-224` "Only a SKIPPED week is off the books. A DEFERRED week is still owed, so it belongs
in what the week EXPECTED to collect." Two functions answering one question (§5.10), and this screen's sub does not
disclose which answer it took.

**Failure case.** Week 7, ten members at $250, one deferral (Almaz). `/admin/this-week` shows "Expected $2,250.00 —
from members in their window" although ten members are in their window and $2,500 is owed. Switch to
`/admin/payments` (Grid view) and week 7's "Received / expected" column — header verified verbatim at
`payments-grid.tsx:203-205` — reads "$2,250.00 / $2,500.00". **Two admin screens print a different "expected" for
the same week, and the smaller one is the number the Short card subtracts from.** Checked for a caveat beside the
label and found none: the DEFERRED bucket lower on the page carries only `STATUS_LABELS.DEFERRED.meaning`, "not
chased, still owed" (`lib/status-labels.ts:72`), which describes the member's status and says nothing about the
card having dropped them from Expected.

**Route.** `/admin/this-week` — cross-checked against `/admin/payments` Grid view, both re-derived by reading the
route files and their rendered components.

---

### B12. "{membersPaid} of {membersExpected} members paid" — **MISLEADING** · headline

**Label** — `app/admin/(protected)/this-week/page.tsx:112-118` (the Received card's sub), rendered e.g. "8 of 9
members paid".

**Math** — `lib/dashboard.ts:252-257`:
```
    if (payment?.isDeferred) continue;
    …
    membersExpected++;
    if ((payment?.amountPaid ?? 0) >= participation.weeklyAmount) membersPaid++;
```

**Promises** a headcount of who has settled this week against who owes it — the roll-call the organizer reads
before chasing.

**Computes** both halves excluding deferred members, because the `continue` at `:253` fires before
`membersExpected++` at `:256` and before the `membersPaid++` test at `:257`. A deferred member is not in the
denominator even though they are in their window and still owe (§2.29 effect 2); and if they DO pay, their payment
is not in the numerator either, so a week can show fewer people paid than actually paid.

**Failure case.** Week 7, ten members in window, Almaz deferred and paying $250 anyway, Bereket unpaid. The card
reads "8 of 9 members paid". Nine of the ten actually paid, and ten owe. **Correction to the sweep**, verified
against `lib/derived.ts:190-191` and the bucket filter at `this-week/page.tsx:156`: the buckets below do NOT total
eleven row-slots. Almaz reads PAID (money beats deferral), so the page renders PAID with 9 rows and LATE with 1
row — **ten rows, against a denominator of 9, with the PAID bucket's own count chip showing 9
(`page.tsx:164-166`) one card below a sub that says only 8 paid.**

**Route.** `/admin/this-week`.

---

### B13. "{money} overdue across closed weeks" / "All in — closed weeks are fully collected" — **MISLEADING** · headline

**Label** — `components/charts/collected-vs-expected-chart.tsx:95-106`, the figcaption headline of the "Collected vs
expected" chart.

**Math** — `collected-vs-expected-chart.tsx:72-75`; the series is `lib/dashboard.ts` `receiptsByWeek` via
`app/actions/dashboard.ts:161-167`, passed at `app/admin/(protected)/page.tsx:400`:
```
  const closed = weeks.filter((w) => w.elapsed);
  const closedExpected = closed.reduce((s, w) => s + w.expected, 0);
  const closedReceived = closed.reduce((s, w) => s + w.received, 0);
  const behind = Math.max(0, closedExpected - closedReceived);
```

**Promises** total arrears across every closed week — the dashboard's headline answer to "how far behind is the
group". "All in" asserts that nobody owes anything for a closed week.

**Computes** sum-of-expected minus sum-of-received over closed weeks, netted across all members and all weeks at
once. Correctly restricted to elapsed weeks (unlike B7/B8), but a surplus on any week or member cancels a genuine
debt elsewhere, because `received` counts money from members whose expectation was dropped
(`lib/dashboard.ts:248-253`) and `expected` uses the CURRENT weekly amount against receipts stored at an older
rate. The chart's own footnote at `:337-339` discloses half of this — "Expected counts only members whose
commitment covers the week, and drops anyone whose week was deferred or skipped" — but says nothing about that
dropped member's money still being counted in Received, **which is the half that produces the false zero.**

**Failure case.** Weeks 1–12 closed, ten members at $250. Almaz's week 7 is deferred and she paid it anyway;
Bereket never paid week 7. Week 7 expected = $2,250 and received = $2,250; every other closed week balances, so
closedExpected = closedReceived = $29,750 and the dashboard chart headline reads "All in — closed weeks are fully
collected" in emerald (`:98`, `:101`, `:104`). Bereket is $250 overdue on a closed week; the red "Closed short" dot
for week 7 also does not draw, because it too tests `w.elapsed && w.expected > 0 && w.received < w.expected`
(`:188`). Verified that the same $250 DOES surface elsewhere on the same page: `memberAttention`
(`lib/dashboard.ts:543-588`) gives Bereket dueWeeks 1–12, credited 11, behind 1, owed $250, and
`app/admin/(protected)/page.tsx:227`/`:272` renders him under "Needs you". **One dashboard says the group is
all-in while, higher on the same screen, it lists a member as $250 behind.**

**Route.** `/admin` — the Collected vs expected chart, rendered at `app/admin/(protected)/page.tsx:400`.

---

### B14. "Perfect record" — **MISLEADING** · headline

**Label** — `components/member/member-personal-summary.tsx:166`.

**Math** — `app/actions/member.ts:300`, passed as `lateCount` at `app/me/page.tsx:260`:
```
const lateCount = standing.weeks.filter((w) => w.status === "LATE").length;
```

**Promises** a history: you have never been late. Printed in emerald as the reward line beside "{n} weeks
remaining".

**Computes** a snapshot of how many weeks read LATE RIGHT NOW. `lib/derived.ts:189-192` verbatim:
`if (args.isSkipped) return "SKIPPED";` / `if (args.amountPaid >= args.amountDue) return "PAID";` /
`if (args.isDeferred) return "DEFERRED";` / `if (args.markedLate) return "LATE";`. PAID is returned the moment a
week is covered — money beats the calendar and beats the organizer's mark — and DEFERRED is returned before LATE is
ever reached. So both a paid-eventually week and an unpaid-but-deferred week score zero. **The count itself is
CORRECT under the law** (§2.29 effect 1: "| 1 | **Status** | The week reads `DEFERRED`, never `LATE`. |"); it is
the word "record" that oversells a snapshot as a history.

**Failure case — two independent routes.** (a) Member M pays every one of their 10 weeks three weeks after each
window closed. Today all 10 are covered, so `paymentStatus` returns PAID for all 10, lateCount = 0, and the card
prints "Perfect record". **They have never once paid on time.** (b) Member D, $500/wk, 10 weeks; weeks 1-5 have
elapsed, are unpaid, and the organizer deferred all five. Each reads DEFERRED, so lateCount = 0 → "Perfect record"
in emerald (`member-personal-summary.tsx:164-167`), sitting directly above a SavedCard reading "$2,500 overdue"
(elapsed weeks 1-5 all count as due, so `amountOutstanding` = 5×$500) and a ring reading 0%.

**Route.** `/me` — the "You" hero card, supporting line under the ring. Re-derived: `app/me/page.tsx:257-263`
renders `MemberPersonalSummary` with `lateCount={p.lateCount}`.

---

### B15. "$9,300 when drawn, after the fee" — **MISLEADING** · headline

**Label** — `components/member/member-payout-card.tsx:42`.

**Math** — `member-payout-card.tsx:30`, fed by `app/actions/member.ts:283`, whose stored value was reduced by
`lib/draw-settlement.ts:156-159`:
```
const totalNet = numbers.reduce((sum, n) => sum + n.netAmount, 0);
```

**Promises** gross minus the management fee — the reader can check it: 2% of $10,000 is $200, so $9,800. The member
agreement they signed states the same figure (§2.30).

**Computes**, once a draw has happened, the stored `Payout` row: `app/actions/member.ts:283` verbatim
`netAmount: payout?.netAmount ?? projected.net,` prefers it, and that row has ALREADY been decremented by the
winner's-week settlement — `lib/draw-settlement.ts:156-159` verbatim: `await tx.payout.update({` /
`where: { id: deduction.payoutId },` / `data: { netAmount: { decrement: deduction.deduct } },` / `});`. So the
figure is gross − fee − the week they won, presented under a label naming only the fee.

**Failure case.** Member M, $500/wk, one number #7, 20 weeks, fee 2%. Before the draw the card reads "$9,800 when
drawn, after the fee" — correct. Week 8's draw settles their $500 week-8 contribution out of the payout (amountDue
= weeklyAmount = $500 for a single-number member). The card now reads "$9,300 when drawn, after the fee". **Nothing
on the member's screen names the missing $500;** the status pill beside it says only "Won August 2, 2026 · payout
on its way" (`member-payout-card.tsx:80`). The label attributes the whole $700 gap to a fee that §2.30's signed
agreement text tells the member is $200: "> The fee is {feeAmount}, which is {feePercent} of what I am entitled to."

**Route.** `/me` — sub-line of the "Your lucky number(s)" card. Re-derived: `app/me/page.tsx:265-270` passes
`numbers={p.numbers}`.

---

### B16. "$500 overdue — weeks that have closed without payment. Everything else above is still ahead of you, not owed." — **MISLEADING** · headline

**Label** — `components/member/saved-card.tsx:88-89`.

**Math** — `lib/standing.ts:164-186` (the elapsed set feeding `amountOutstanding`) → `lib/derived.ts:113`; delivered
as `contribution.overdue` at `app/actions/member.ts:347`:
```
if (args.markedLate && !args.isDeferred) return true;
```

**Promises** weeks whose payment window has CLOSED. A calendar claim the member can check against their own diary.

**Computes** `amountOutstanding` over the set of weeks that COUNT AS DUE, which is the calendar boundary OR the
organizer's manual mark. `lib/standing.ts:164-173` filters `windowWeeks` through `weekCountsAsDue`, and
`lib/derived.ts:113` returns true for a marked, non-deferred week whatever the date.

**Failure case.** Member M, $500/wk, own weeks 1-10. Weeks 1 and 2 have closed and are paid ($1,000). Week 3 opened
on Sunday; on Monday the member tells the organizer it is not coming, and he marks week 3 late by hand
(`app/actions/edits.ts:1510-1518` writes `markedLateAt`). On Tuesday the member opens `/me`:
`PAYMENT_WINDOW_DAYS` is 5 (`lib/derived.ts:13`) and only 2 days have elapsed, so week 3's window has **NOT**
closed — yet elapsed = {1,2,3}, `amountOutstanding` = 3×$500 − $1,000 = $500, and the card reads "$500 overdue —
weeks that have closed without payment". **No week has closed without payment.** The NUMBER is correct under §2.14
("| Late | unpaid **and** either the window has closed **or** the organizer marked it late himself (§2.29).
Deferral outranks both. |") — it is the sentence naming the calendar as the sole reason that is false.

**Route.** `/me` — the amber strip at the foot of the savings card, rendered only when `c.overdue > 0`
(`saved-card.tsx:86`).

---

### B17. "Still to save  /  $8,000  /  over the rest of your weeks" — **MISLEADING** · headline

**Label** — `components/member/saved-card.tsx:59` (dt), `:62` (value), `:67` (sub).

**Math** — `lib/contribution.ts:89`, called at `app/actions/member.ts:343-348`:
```
const stillToSave = Math.max(0, commitmentTotal - paidIn);
```

**Promises** money spread across the weeks you have LEFT — explicitly not a debt. The file header
(`lib/contribution.ts:9-10`) calls it "STILL TO SAVE the rest of their commitment. NOT a debt".

**Computes** the whole unpaid remainder of the commitment, with no regard to which weeks have elapsed. Every cent
of `overdue` is inside this figure, so the two boxes on the card overlap silently.

**Failure case — co-occurring sentence CORRECTED from the sweep.** Member M, $500/wk, 20 committed weeks =
$10,000. They are in week 7 of their window; weeks 1-6 have closed and they have paid $2,000. paidIn = $2,000,
overdue = 6×$500 − $2,000 = $1,000, stillToSave = $10,000 − $2,000 = $8,000. The card reads "Still to save $8,000 /
over the rest of your weeks". Their remaining un-elapsed weeks are 14 × $500 = $7,000; **$1,000 of the $8,000
belongs to weeks already gone.** The sweep quoted the emerald branch at `saved-card.tsx:96` ("still to save, not
money you owe") as the co-occurring claim — that is wrong, because that branch only renders when
`c.overdue === 0` (`saved-card.tsx:86`). The sentence that ACTUALLY renders alongside is the amber strip at
`saved-card.tsx:89`, verbatim: "have closed without payment. Everything else above is still ahead of you, not
owed." With overdue $1,000 inside stillToSave $8,000, that is false by exactly $1,000.

**Route.** `/me` — left-hand cell of the two-column list on the savings card.

---

### B18. "Current" (green pill with a tick) / "{count} behind" — **MISLEADING** · headline

**Label** — `components/member/member-group-list.tsx:31` (CurrentPill text) and `:39` (BehindPill text), chosen at
`:128` for the viewer's own row and at `:186` for every peer row.

**Math** — `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:62` (SQL view
`weeks_behind`) versus `lib/standing.ts:164-173` + `lib/derived.ts:113` (TypeScript):
```
AND current_date >= (w.date::date + 5)
```

**Promises** the member's own standing — you are up to date / you are N weeks behind — stated to them and to every
peer.

**Computes**, in SQL, a week as owed ONLY when its stored date is 5+ days old. The whole elapsed predicate is the
three lines at `migration.sql:60-62` — `AND w."weekNumber" >= pt."startWeek"` /
`AND w."weekNumber" <  pt."startWeek" + pt."weeksCommitted"` / `AND current_date >= (w.date::date + 5)` — and
nothing in the file references `payments.markedLateAt`. The TypeScript engine every other member surface uses
counts the organizer's manual mark as due-now: `lib/derived.ts:113` verbatim
`if (args.markedLate && !args.isDeferred) return true;`. **Two engines, one question** — the defect §5.10 names
verbatim: "### 5.10 TWO FUNCTIONS ANSWERING ONE QUESTION IS THE SAME DEFECT AS NONE". Confirmed that this
migration is the LAST redefinition of the view (grep over `prisma/migrations` returns only `20260804230000`,
`20260805150000` and this one, and this one is newest).

**Failure case.** Member M, $500/wk, own weeks 1-10, paid $1,000 (weeks 1 and 2, both closed). Week 3 opened
Sunday; the organizer marks it late by hand on Monday. On Tuesday: `/me` shows week 3 with a red "Late" badge
(`paymentStatus` returns LATE at `lib/derived.ts:192`) and the savings card shows "$500 overdue"; `/me/group` shows
the same member the emerald "**Current**" pill, because the view computes weeks_behind = greatest(0, 2 − 0 − 2) = 0
while `computeStanding` gives weeksBehind = max(0, 3 − 0 − 2) = 1. **Two member-facing routes, same minute,
opposite verdicts on the same person.** The verdict stays MISLEADING rather than WRONG because the pill does
faithfully report its own math; the defect is that the math uses a superseded rule.

> §2.29 effect 2: "A mark cannot pull a not-yet-due deferred week forward, and the attention list applies the same
> test — so the list and the standing derivation cannot disagree."

**Route.** `/me/group` — the pinned viewer row and every peer row. Re-derived: `app/me/group/page.tsx:30-37` passes
`d.viewer` and `d.peers` straight from `getGroupProgress`, which reads `supabase.from("member_progress")` at
`app/actions/member.ts:414-417`.

---

### B19. "Carried balance / $2,000 / … it is the same money the cycle below ended with — not an extra charge." — **MISLEADING** · headline

**Label** — `app/me/history/page.tsx:60` (heading), `:63` (figure), `:66-67` (the claim).

**Math** — `app/actions/member-history.ts:114` → `lib/ledger.ts:23-29`:
```
(sum, e) => sum + (e.type === "DEBT" ? e.amount : -e.amount),
```

**Promises** that this exact figure is the closing balance of the cycle whose card is printed immediately below.

**Computes** the signed sum of EVERY `LedgerEntry` belonging to the person, across every cycle they have ever been
in, net of payments and write-offs, floored at zero. The query is person-scoped only —
`app/actions/member-history.ts:104-107` verbatim: `const entries = await prisma.ledgerEntry.findMany({` /
`where: { personId: person.id },` / `orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],` / `});`. It is
person-scoped by design (§2.18: "The balance belongs to the person and survives cycle deletion.").

**Failure case — sources CORRECTED from the sweep.** Member M finished Cycle 1 owing $1,200 and Cycle 2 owing $800.
Two DEBT entries; balance = $2,000. Archives are ordered `closedAt desc` (`app/actions/member-history.ts:64`), so
the card immediately below is Cycle 2 reading "$800 outstanding — what was left unpaid when Cycle 2 closed"
(`lib/member-history.ts:91-93`). **The member is told a $2,000 figure is the same money as an $800 figure eight
lines down.** The sweep named only two DEBT writers; there are more — `app/actions/cycle-close.ts:350` (cycle
close), `app/actions/participation-close.ts:344` (early close), and `app/actions/edits.ts:422` and `:442`
(terms-change settlements after a payout) — so the figure can also include money that never belonged to any cycle's
closing balance at all. Kept at MISLEADING rather than WRONG because the "Where it came from" list inside the same
amber panel (`app/me/history/page.tsx:70-106`) does itemise every entry with its running total directly beneath the
sentence.

**Route.** `/me/history` — the amber panel at the top, rendered when `carried.balance > 0`
(`app/me/history/page.tsx:51`). A shorter, non-identity-claiming variant appears at `app/me/page.tsx:169-176`
("Still owed from a finished cycle. Tap to see where it came from."), which does not make this claim.

---

### B20. "Outstanding — nothing is owed for elapsed weeks / {n} members owe it" — **MISLEADING** · visible

**Label** — `app/admin/(protected)/cycle/position/page.tsx:139-148`.

**Math** — `lib/cycle-position.ts:209` and `:217` (shortfall); the member list beside it comes from a different
derivation — `app/actions/cycle-position.ts:199-207` via `computeStanding` (`lib/standing.ts:164-186`):
```
  const gap = Math.max(0, shouldHaveCollected - collected);
  …
    shortfall: Math.max(0, gap - Math.min(willNotArrive, gap)),
```

**Promises** the money the listed members owe for elapsed weeks — the amount and the people presented as one fact
("{n} members owe it", and the panel rendered directly below on the same section is headed "Who the outstanding
money is with", `position/page.tsx:220-225`).

**Computes** a cycle-wide NET of week-level aggregates: Σ elapsed-week expected − Σ elapsed-week received
(`lib/cycle-position.ts:194-195`), then reduced by stopped members' recorded balances. The member list beside it is
Σ per-member `computeStanding().amountOutstanding`, which allocates each member's own money to their own weeks
(`lib/standing.ts:179-186`). Two different derivations of one question (§5.10), not constrained to agree: one
member's surplus-on-a-week cancels another member's debt in the headline figure but never in the list.

**Failure case.** Weeks 1–5 elapsed, ten members at $250. Almaz's week 5 is deferred and she pays it anyway;
Bereket does not pay week 5. Week 5: expected $2,250 (Almaz dropped by `lib/dashboard.ts:253`), received $2,250
(her money still counted at `:248-251`); weeks 1–4 balance exactly. So shouldHaveCollected = collected = $12,250,
gap = 0, shortfall = **$0**. Bereket's `computeStanding` still returns `amountOutstanding` = $250, so `owedBy` =
[Bereket]. The page renders the StatCard "Outstanding $0.00 — nothing is owed for elapsed weeks", the header
sentence "…Nothing is outstanding." (`lib/cycle-position.ts:466`, fed to the page at `:108`), AND, immediately
beneath, the card "Who the outstanding money is with" listing **Bereket at $250.00**. The section nav also shows
"Collection 1" with no attention dot, because the dot reads
`attention: input.shortfall > 0 || input.toCover > 0` (`sections.ts:76`) while the count reads
`count: input.owedByCount || undefined` (`:73`) — the two halves of one nav item disagreeing about the same member.

**Route.** `/admin/cycle/position?section=collection` — re-derived from `parsePositionSection`
(`sections.ts:34-39`) and the `section === "collection"` guards at `position/page.tsx:120` and `:220`.

---

### B21. "Short" (By-week table column header) — **MISLEADING** · visible

**Label** — `app/admin/(protected)/cash/page.tsx:261` (`<Th align="right">Short</Th>`), card header at `:251`
("By week — what each week brought in against what it asked for").

**Math** — `cash/page.tsx:266`, rendered at `:283-293` in red when > 0; the row set is `d.series`, every cycle week
(`app/actions/dashboard.ts:161-167`):
```
                  const gap = Math.max(0, w.expected - w.received);
```

**Promises** what that week failed to collect. The red/semibold treatment
(`gap > 0 ? "!text-red-700 font-semibold dark:!text-red-400"`, `:288`) states it is a problem.

**Computes** expected − received for EVERY week in the cycle with no elapsed filter and no still-open marker, so
every future week — which has an expectation and no receipts — is printed as a red shortfall. `w.elapsed` is
available on every row and is never read anywhere in this table. The dashboard chart that renders the same series
exists specifically to prevent this: `components/charts/collected-vs-expected-chart.tsx:8-12` — "The part that
carries the meaning is the DIVIDER … Without it this week always looks like a shortfall, which is the exact false
alarm the stored-week-date rule exists to prevent." This table has no divider and no "still open" text.

**Failure case.** 20-week cycle at $6,750/week, currently week 13, everyone fully current.
`/admin/cash?view=received`'s "By week" table prints rows 14 through 20 each showing "$6,750.00" in red under
"Short" — **$47,250 of invented arrears** — plus week 13 in red for whatever has not yet arrived inside its
still-open window. On day one of a cycle the whole table is red. The same page's chart of the identical series
(`collected-vs-expected-chart.tsx:337-342`) prints the sentence "Weeks right of the divider are still open, so
nothing there is overdue yet"; the table carries no such line.

**Route.** `/admin/cash?view=received`.

---

### B22. "Awaiting their turn — will eventually receive {money}" (and per row "when drawn · {gross} gross") — **MISLEADING** · visible

**Label** — `app/admin/(protected)/waiting/waiting-view.tsx:135-144` (StatCard) and `:522-528` (row); mirrored on the
dashboard at `components/admin/waiting-summary.tsx:99-104`.

**Math** — `app/actions/waiting.ts:186-210` (per-member sum of `calculatePayout`), `lib/wheel.ts:538-543`, totalled
at `lib/waiting.ts:151`:
```
        netAmount: money.net,                                    [app/actions/waiting.ts:210]
  const gross = input.luckyNumber.amount * input.participation.weeksCommitted;   [lib/wheel.ts:538]
  return { luckyNumberId: input.luckyNumber.id, gross, fee, net: calculateNet(gross, fee) };   [lib/wheel.ts:543]
      eventualTotal: input.awaitingTurn.reduce((s, r) => s + r.netAmount, 0),    [lib/waiting.ts:151]
```

**Promises** the cash that will actually cross the table to these members when their number comes up. The type's own
doc says "What they would receive if drawn today, across all their numbers" (`lib/waiting.ts:47-48`).

**Computes** gross − fee only. It omits the winner's-own-week settlement that the draw will deduct from `netAmount`
(`lib/draw-settlement.ts:156-159`), so every undrawn member's projection is overstated by their weekly amount
whenever the week they are drawn on is not already paid. The neighbouring "Owed now" figure IS post-settlement (it
reads stored `Payout.netAmount`), so the two columns of the same screen are measured differently;
`lib/waiting.ts:30` documents the difference for the other group — "Already reduced by the winner's own-week
settlement — what they receive."

**Failure case — strengthened on verification.** 13 undrawn members, each $250/week × 20 weeks, 2% fee. Each row
shows $4,900 "when drawn" and the card sub reads "will eventually receive $63,700.00". When each is drawn on a week
they have not yet paid, $250 is settled from the payout and they receive $4,650 — total $60,450. The screen
overstates by $3,250, and each individual row by $250. **The disclosure exists on the SAME screen for the other
group** — the awaiting-payment row prints `{formatMoney(row.grossAmount)} gross · {formatMoney(row.feeAmount)} fee`
plus, at `waiting-view.tsx:371-373`, `` · ${formatMoney(row.settlementAmount)} settled their week`` — while the
awaiting-turn row at `:526-528` prints only "when drawn · {gross} gross". One list on the page names the settlement
and the list directly beneath it does not, with no note saying why the two are measured differently. The same
overstated `eventualTotal` is on the dashboard via `WaitingSummary`.

**Route.** `/admin/waiting` (both filters — re-derived from the `showTurn`/`showOwed` switches at
`waiting-view.tsx:97-98`), and the "Who is waiting" card on `/admin`.

---

### B23. "Elapsed / planned" (rendered e.g. "14 / 20 weeks") — **MISLEADING** · visible

**Label** — `app/admin/(protected)/cycle/page.tsx:63-70`.

**Math** — `cycle/page.tsx:33` and `:68`:
```
  const week = currentWeekNumber(cycle.startDate, new Date());
  …
              {Math.min(week, cycle.plannedWeeks)} / {cycle.plannedWeeks} weeks
```

**Promises** how many of the cycle's weeks are finished.

**Computes** the week number the cycle is currently IN, projected off the editable cycle start date and capped at
`plannedWeeks`. It counts the week now in progress as elapsed, and it never consults the stored week rows. The
platform's own definition of the word is different and stricter, and it is printed on a sibling screen:
`app/admin/(protected)/cycle/position/page.tsx:123-125` reads "Elapsed means the week's own payment window has
closed — not a week number counted off the start date." The helper that implements it is `lib/derived.ts:68-79`
`weekHasElapsed`, requiring `daysSinceWeekOpened >= windowDays`; `lib/commitment.ts:154-166` `elapsedThroughWeek`
walks each week's OWN stored date. `lib/money.ts:162-167` is by contrast
`Math.floor(dayDiff / DAYS_PER_WEEK) + 1`.

**Failure case.** Cycle start 2026-05-10 (Sunday), read on Monday 2026-08-10. `currentWeekNumber` = 14, so
`/admin/cycle` prints "14 / 20 weeks" under "Elapsed / planned". Week 14's payment window is still open, so
`elapsedThroughWeek` = 13 and `/admin/cycle/position` prints "Should have come in — every week through week 13" for
the same instant, under a heading that defines elapsed as window-closed. The organizer counting weeks remaining
reads two different clocks one click apart.

**Strengthened on verification (§5.4 — an exempt entry is a claim about the code).**
`lib/week-date-authority.test.ts:167-178` lists this exact file in its DISPLAY_ONLY allow-map with the stated
reason "the cycle header's 'Week N of M'". That reason covers the `Current week` cell at `:57-61` and nothing else
— the same `week` value also drives this "Elapsed / planned" cell at `:68` and `effectiveWeek`/`weeklyPot` at
`:39-46`. **The guard passes on a file whose exemption describes one of its three uses.**

**Two corrections to the sweep:** (a) the claim that this is "the count everything money-side is measured against"
is withdrawn — no arrears, outstanding or expected figure anywhere reads it, and
`lib/week-date-authority.test.ts:195-201` pins that `lib/standing.ts` and `lib/dashboard.ts` never mention
`currentWeekNumber` at all; (b) the adjacent "Current week — Week 14 of 20" cell (`:53-62`) is a partial
mitigation, since it shows the reader that 14 is the running week — which is why this is MISLEADING rather than
WRONG.

**Route.** `/admin/cycle`.

---

### B24. "Short / $0 / the week is fully collected" — **MISLEADING** · visible

**Label** — `app/admin/(protected)/this-week/page.tsx:120` (label), `:124` (the "fully collected" sub; alternatives
at `:126` and `:127`).

**Math** — `this-week/page.tsx:121`, fed by `lib/dashboard.ts:242-258` via `getDashboard`'s `selectedWeekTotals`
(`app/actions/dashboard.ts:345`):
```
cents={Math.max(0, totals.expected - totals.received)}
```

**Promises** what never came in for this week — the gap owed by the people who did not pay.

**Computes** expected minus ALL cash sitting on that week's rows. `lib/dashboard.ts:248-251` verbatim:
`if (payment) {` / `assertCents(`week ${weekNumber} amountPaid`, payment.amountPaid);` /
`received += payment.amountPaid;` / `}` — and only AFTERWARDS come the two exclusions at `:252-253`:
`if (!inWindow || input.isSkipped) continue;` / `if (payment?.isDeferred) continue;`. So money from a member who is
not expected still cancels a member who is.

**Failure case — a route that needs no deferral.** Cycle week 12, 27 members at $500/wk. Tsion committed to 20
weeks and paid $6,000 up front, which allocates oldest-first onto weeks 1-12, writing a $500 Payment row on each.
The organizer then closes her at week 10; closing does NOT re-allocate (there is no `rebuildParticipationPayments`
call in `app/actions/participation-close.ts`, and `lib/participation-close.ts:427-428` promises "Everything
${plan.memberName} paid stays exactly as recorded"), so her week-12 row still holds $500 while `windowBreaks` puts
week 12 outside her window (`inWindow` returns false via `inBreak`). Meron is in window and has paid nothing for
week 12. expected = 26 × $500 = $13,000 (Tsion excluded at `:252`). received = 25 × $500 + Tsion's $500 = $13,000.
**Short = $0 and the sub reads "the week is fully collected". Meron's $500 never came in.** The middle card beside
it does say "25 of 26 members paid" (`this-week/page.tsx:115`), which is why this stays MISLEADING rather than
WRONG — but the money figure itself is wrong by $500. The same masking occurs whenever a DEFERRED member's row
carries money, since deferral never stops allocation (`lib/standing.ts:139-140`: "Only a skipped week is passed
over — deferred money is still owed.").

**Route.** `/admin/this-week` — third stat card in the header row (rendered when `totals` is non-null,
`this-week/page.tsx:105`).

---

## B · MATCHES (5) — checked and cleared

---

### B25. "Gone out in total — handed out plus still promised" — **MATCHES** · visible

**Label** — `app/admin/(protected)/collections/page.tsx:267-272`.

**Math** — `collections/page.tsx:229-232` and `:269`:
```
  const collectedTotal = collected.reduce((sum, p) => sum + p.netAmount, 0);
  const pendingTotal = pending.reduce((sum, p) => sum + p.netAmount, 0);
  …
          cents={collectedTotal + pendingTotal}
```

**Promises**, read on the headline alone, money that has left the organizer's hands; read as the card actually
renders — label, figure, sub — the sum of what has been handed over and what is still promised.

**Computes** `collectedTotal + pendingTotal`. Which is exactly what the sub says it is.

**Downgraded — no failure case survives.** The stated caveat is not a footnote; it is the card's own `sub` prop,
rendered by `components/ui/stat-card.tsx:74`
(`{sub && <p className="mt-1.5 text-xs text-gray-600 …">{sub}</p>}`) directly beneath the figure inside the same
card, and it names the composition verbatim: "handed out plus still promised". This is the same slot this audit
treats as part of the label everywhere else (B10, B11, B12, B16, B20 all read the sub as the promise), so it
cannot be counted as label text when it convicts and as fine print when it acquits. The two constituent cards —
"Collected" ($44,100) and "Still owed" ($9,800) — render immediately to its left in the same grid (`:250-266`), so
the decomposition is on screen beside the total. The page header three lines above also states the settlement rule
outright (`:243-246`). The `lib/cycle-position.ts:299-303` paragraph the sweep quoted governs
`cashOnHand.shouldBeHolding`, a different figure on a different screen that must not SUBTRACT pending payouts;
this card subtracts nothing. **A reader who reads the card is told exactly what the number is.** The headline noun
"gone out" is loose wording, not a math-label mismatch.

**Route.** `/admin/collections`.

---

### B26. "This week's pot" — **MATCHES** · visible

**Label** — `app/admin/(protected)/cycle/page.tsx:79-88`.

**Math** — `cycle/page.tsx:33`, `:39-46`:
```
  const weeklyPot = activeParticipations
    .filter(
      (p) =>
        p.startWeek <= effectiveWeek &&
        effectiveWeek <= calculateFinishWeek(p.startWeek, p.weeksCommitted),
    )
    .reduce((sum, p) => sum + p.weeklyAmount, 0);
```

**Promises** what this week's committed members add up to — the pot for the week the page says the cycle is in.

**Computes** Σ weeklyAmount of ACTIVE participations whose commitment window covers that week. Which is what the
label says.

**Downgraded — every route in the sweep's failure case fails on verification.** (1) The claim that
`/admin/this-week` reads the stored week rows while this page projects is FALSE: `app/actions/dashboard.ts:88` is
`const currentWeek = currentWeekNumber(cycle.startDate, today);` and `selectedWeek` defaults to it at `:93-96`, so
`/admin/this-week` uses the SAME projected clock by default. The two screens cannot disagree about which week is
"this" one unless the organizer hand-picks a week. (2) The `calculateFinishWeek`-instead-of-`effectiveFinishWeek`
gap cannot bite here: `effectiveFinishWeek` differs only when an OPEN break exists
(`lib/participation-close.ts:133-138`), and an open break is written only by `closeParticipation`, which sets
`status: "CLOSED"` in the same transaction (`app/actions/participation-close.ts:314-330`) — and this filter takes
ACTIVE rows only. The one construction that puts an ACTIVE member inside a hole is `reactivateParticipation` with a
future `fromWeek`, and the only caller in the product passes no `fromWeek` at all
(`components/admin/close-participation.tsx:150`, `reactivateParticipation({ participationId })`). (3) The deferral
difference is real but points the other way: including deferred members is the treatment §2.29 effect 2 requires,
so this figure is right and `/admin/this-week`'s "Expected" is the one at fault — already reported as B11. (4) The
skipped-week route is not organizer-reachable: `app/actions/edits.ts:1636-1639` records that "There is no skip
control on any screen and there must not be one".

What remains is that the week meant is the projected one — the same defect as B23 — and the week is named three
cells to the left in the same `<dl>` ("Current week — Week 14 of 20", `:53-62`). **Label matches math.**

**Route.** `/admin/cycle`.

---

### B27. "Next due: {date}" — **MATCHES** · headline

**Label** — `components/member/member-payout-card.tsx:99`.

**Math** — `app/actions/member.ts:295-298`:
```
uncovered.find((w) => w.weekNumber >= Math.max(cycleWeek, participation.startWeek)) ??
```

**Promises** the next date on which a payment falls due.

**Computes** exactly that: the first uncovered non-deferred week at or after the current calendar week, falling back
to the oldest uncovered week when the whole window has passed. The label is terse but accurate — it says "next",
not "nothing is due before this".

**Downgraded from MISLEADING on re-examination.** The sweep's failure case (member 4 weeks behind at cycle week 10;
uncovered = [6..20]; `find` picks week 10) reproduces exactly as described, but it does not make the LABEL wrong:
weeks 6-9 are already due, not "next", and the arrears are stated on the same page in the amber strip at
`saved-card.tsx:88-89` ("$2,000 overdue — weeks that have closed without payment"), with the same card's own left
half reading "5 of 20 weeks paid" (`member-payout-card.tsx:93-96`). The §2.15 point (the next dollar pays week 6) is
true but the label makes no claim about which week a payment serves. **A genuinely wrong variant was tested and
REFUTED:** a SKIPPED week has `coveredAtCurrentRate` 0 < `amountDue` and `isDeferred` false, so it WOULD enter
`uncovered` and could be shown as "Next due" for a week nobody owes — but it is unreachable, because
`app/actions/edits.ts:1636-1642` states verbatim "`isSkipped` IS OPTIONAL NOW. There is no skip control on any
screen and there must not be one — docs/CYCLE_POSITION_SPEC.md PART 2 removed the concept from the UI on purpose",
and no caller passes it. **No constructible input makes this label misdescribe its math.** The separate question of
which week "Next due" *should* name is OPEN ruling 9 — a naming ruling, not a label-versus-math defect.

**Route.** `/me` — bottom-right of the "Your lucky number(s)" card.

---

### B28. "Paid in / $6,000 / 12 of 20 weeks" — **MATCHES** · headline

**Label** — `components/member/savings-arc.tsx:97` (label), `:100` (figure), `:103` (sub).

**Math** — `lib/contribution.ts:87` and `:91-94`, called at `app/actions/member.ts:343-348`:
```
const paidIn = totalContributed(input.receipts);
```

**Promises** every cent received from you, and how many weeks of your commitment it covers.

**Computes** the sum of every `PaymentEvent` on the participation — including payout-settlement receipts, which
`lib/draw-settlement.ts:2-3` records as "a PaymentEvent (a receipt — the member effectively paid that week from
their payout)". `weeksCovered` = min(floor(paidIn / weeklyAmount), weeksCommitted). The parallel figure eight
inches down, `{displayCount ?? paidCount}/{totalWeeks} wks` (`member-personal-summary.tsx:152`), divides
`standing.totalPaid` = sum of `Payment.amountPaid` by the same rate. **The two sources are held equal by
construction:** `recordPayment` refuses any amount the window cannot absorb (`app/actions/payments.ts:234-238`,
`const plan = planCommit(` … `if (!plan.ok) throw new Error(plan.error);`), `rebuildParticipationPayments` throws
rather than drop a cent (`lib/rebuild.ts:114-120`), settlement writes both sides in one transaction
(`lib/draw-settlement.ts:125-159`), and no action anywhere in `app/actions` writes `Payment.amountPaid` outside that
engine (grep for `amountPaid:` across `app/actions` returns only reads, zero-init upserts for
defer/mark-late/notes, and the payment engine itself).

**No failure case is constructible.** Worth recording: the select comment at `app/actions/member.ts:118-120` reads
verbatim "// EVERY receipt: their total contributed is the sum of these (2.14)." / "// The pinned subset (payout
settlements, which stay on their drawn" / "// week and are never fungible) is filtered out of this list in code."
**It is NOT filtered out** — `app/actions/member.ts:344` passes every event unfiltered, and the only filter on that
list (`:256-257`) selects pinned events IN, for the `pinnedByWeek` map. The comment describes a filter that does not
exist, and following it would break the agreement between the two week-counts on this page. §5.5: "A COMMENT CAN BE
THE BUG'S BEST CAMOUFLAGE".

**Route.** `/me` — the savings ring inside `SavedCard`, the page's headline figure.

---

### B29. "You paid in / $9,500 / 19 of 20 weeks" — **MATCHES** · headline

**Label** — `components/member/past-cycle-card.tsx:45` (dt), `:48` (figure), `:51` (sub).

**Math** — `app/actions/cycle-close.ts:135` and `:106`, frozen into the archive and read back at
`lib/member-history.ts:181-183`:
```
totalPaid: standing.totalPaid,
```

**Promises** what you actually paid into this finished cycle, and how many weeks of your commitment that covered.

**Computes** `standing.totalPaid` = sum of `Payment.amountPaid` at close, and `weeksPaid` =
`min(standing.weeksCredited, weeksCommitted)` (`app/actions/cycle-close.ts:106` verbatim
`weeksPaid: Math.min(standing.weeksCredited, p.weeksCommitted),`). Both are frozen at close into one JSON blob and
read back verbatim by `lib/member-history.ts:182-183`, so the member's card and the organizer's archive page render
the same two numbers by construction. The week count divides by the CURRENT rate, which after a mid-cycle rate
change gives a figure different from the number of weeks money physically landed on — but **that is the law, not a
defect**: §2.14 verbatim "| Weeks credited | total money paid ÷ current weekly amount |".

**No failure case is constructible.** Both figures come from the same frozen row, and no divergence between the
member's copy and the organizer's is reachable. (The card's third figure, the closing balance, is a separate finding
— B6 — because `outstanding` is derived on a different window from these two.)

**Route.** `/me/history` and `/me` (not-in-cycle branch) — left cell of the `PastCycleCard`.

---

> **End of Part B.** 29 distinct labels from 31 sweep findings: 9 WRONG, 15 MISLEADING, 5 MATCHES.

---
# Part C — Deferral, window and late

The agreement check across `expected`, `received`, `shortfall`, weeks-behind and outstanding, run as one pass so
that a divergence in one figure is traced into the others rather than reported twice. **12 rows: 9 RESOLVED, 2
EQUIVALENT, 1 OPEN.**

---

### C1. What one week EXPECTED to collect — is a DEFERRED member's weekly amount in it? — **RESOLVED**

**Implementations**

- `lib/payments-view.ts:225` — **COUNTS** the deferred week
  ```
          if (!week.isSkipped && mw.status !== "SKIPPED") expected += mw.amountDue;
  ```
  Its comment at `:223-224` states the rule: "Only a SKIPPED week is off the books. A DEFERRED week is still owed,
  so it belongs in what the week EXPECTED to collect." Deferral arrives as the derived status DEFERRED, which is not
  SKIPPED, so `amountDue` is added. **Correct on the deferral question only** — Pass 1 #53 also records that its
  window test at `:217-221` uses a precomputed `finishWeek`, knows nothing about `ParticipationBreak`, and treats a
  missing payment row as after-finish. Naming it right here is a ruling about deferral, not a clean bill.
- `lib/dashboard.ts:253` — **DROPS** the deferred member
  ```
      if (payment?.isDeferred) continue;
  ```
  Before `expected += participation.weeklyAmount;` (`:255`), before `membersExpected++` (`:256`) and before the
  `membersPaid` test (`:257`). The `continue` sits one line below the skipped/window test at `:252`, so deferral is
  treated identically to a cycle-wide skip — the one thing §2.29 says it is not. Its own type comment at `:202-203`
  asserts the behaviour as correct: "only members whose window covers the week, minus deferred/excused members."
- `app/admin/(protected)/cycle/page.tsx:40` — **added by this pass** (Pass 1 #53 lists it; the sweep omitted it). A
  THIRD answer for one week's expectation, computed inline
  ```
    const weeklyPot = activeParticipations
  ```
  The statement spans `:41-46`:
  `.filter((p) => p.startWeek <= effectiveWeek && effectiveWeek <= calculateFinishWeek(p.startWeek, p.weeksCommitted)).reduce((sum, p) => sum + p.weeklyAmount, 0)`.
  No deferral term, no `isSkipped` term, no `ParticipationBreak` test. Rendered as "This week's pot" at
  `cycle/page.tsx:85` (grep `weeklyPot` gives `:40` and `:85` only). It agrees with the grid against `weekReceipts`
  on deferral, and disagrees with BOTH on a skipped week and on a member on a break.
- `lib/cycle-position.ts:194` — consumer, not a fourth implementation: it sums `lib/dashboard.ts`'s `expected`, so
  the position page's "Should have come in" and its Outstanding StatCard (via `:209` and `:217`) inherit the
  deferred-excluding figure
  ```
    const shouldHaveCollected = elapsed.reduce((s, w) => s + w.expected, 0);
  ```
- `app/actions/cycle-position.ts:206` — the list rendered directly beneath that StatCard, built from
  `computeStanding`, where deferred weeks DO count (`lib/derived.ts:299` excuses only `isSkipped`)
  ```
          owedBy.push({ participationId: p.id, name, amount: standing.amountOutstanding });
  ```
  The two figures are presented as the same money and are not.

**Divergence proof.** Two members, $500/week, startWeek 1, 20 weeks committed. Weeks 1–3 all have closed payment
windows. Member A paid all three ($1,500). Member B paid weeks 1–2 ($1,000); week 3 has `amountPaid` 0 and
`isDeferred` true.

**Week 3, two answers:** `buildPaymentGrid` gives expected = $1,000 (A $500 + B $500), received $500;
`weekReceipts` gives expected = $500, received $500, shortfall $0, membersExpected 1, membersPaid 1.

**Whole cycle:** shouldHaveCollected = $1,000 + $1,000 + $500 = $2,500, collected = $2,500, gap 0, willNotArrive 0,
so shortfall = **$0** and `/admin/cycle/position` renders the Outstanding StatCard as $0 with the sub-line "nothing
is owed for elapsed weeks" (`page.tsx:139-148`, re-derived and read). The card immediately below it, "Who the
outstanding money is with" (`page.tsx:220-242`, rendered because `owedBy.length > 0`), lists **Member B at $500** —
`computeStanding` gives B elapsed = {1,2,3}, due 3×$500, covered $1,000, outstanding $500. **$0 and $500 for the
same money, on the same screen, six lines apart.**

**Ruling.** Correct: `lib/payments-view.ts:225`. Wrong: `lib/dashboard.ts:253` (the `continue` must not fire on
`isDeferred`; only the cycle-wide skip at `:252` may excuse a member from a week's expectation);
`app/admin/(protected)/cycle/page.tsx:40-46` (right on deferral by accident — it has no deferral term at all — but
it counts a SKIPPED week's money and ignores `ParticipationBreak`, so it should call `weekReceipts` rather than sum
inline).

> §2.18: "**Unpaid means owed.** A week stops being owed only when it is marked paid. Nothing else clears it."
>
> §2.29, effects table row 2: "| 2 | **Arithmetic** | A mark cannot pull a not-yet-due deferred week forward, and
> the attention list applies the same test — so the list and the standing derivation cannot disagree. An *elapsed*
> deferred week still counts as owed: deferral has never excused the money. |"

**What a human sees.** The organizer's collection figures understate the debt by exactly the deferred amount,
everywhere `weekReceipts` feeds them. **Surfaces re-derived by grepping `expected|shortfall|membersExpected` and
opening each file:** `/admin` "Expected … · received" (`page.tsx:208` — the sweep said `:212`; corrected) and the
"$X overdue" pills (`page.tsx:380`); `/admin/this-week`'s Expected tile (`page.tsx:109`) and Short tile (`:121`);
`/admin/cash` "Expected by now" (`page.tsx:62`, `:240`) and "still to collect for elapsed weeks" (`:63`);
`/admin/cycle/position` "Should have come in" and "Outstanding"; the Collected-vs-expected chart's closed-week
headline (`collected-vs-expected-chart.tsx:72-75`). The payments grid shows the other, larger number for the same
week (`payments-grid.tsx:332`), and `/admin/cycle` shows a third (`cycle/page.tsx:85`).

**Separate defect noted while re-deriving,** already in Pass 1 #41 and not caused by deferral: `cash/page.tsx:62`
sums EVERY series week, including weeks that have not happened, under a card labelled "across the weeks that have
elapsed" (row A4, finding B7). Fixing `lib/dashboard.ts:253` raises every deferral-affected figure and makes it
equal the sum of the member rows beneath it. **Decide C12 first — one `continue` controls both the money and the
headcount.**

---

### C2. A member's WEEKS BEHIND — does the organizer's manual late mark pull a not-yet-elapsed week into the count? — **RESOLVED**

**Implementations**

- `lib/derived.ts:113` — the mark makes the week count as due now unless it is deferred
  ```
    if (args.markedLate && !args.isDeferred) return true;
  ```
  This is `weekCountsAsDue`, the predicate `lib/standing.ts:164-173` filters the elapsed set with, so the mark
  enters `weeksElapsedInWindow` → `weeksBehind` → `amountOutstanding`.
- `lib/standing.ts:164` — the TypeScript standing
  ```
    const elapsed = windowWeeks.filter((w) =>
  ```
  `weekCountsAsDue` per week, passing `markedLate` (`:168`) and `isDeferred` (`:171`).
- `prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:62` — the live view's ONLY
  elapsed test, pure calendar
  ```
      AND current_date >= (w.date::date + 5)
  ```
  The whole 69-line migration was read: **the string `markedLate` does not appear in it at all**, so its
  `weeks_behind` (`:37-42`) cannot see a hand-marked week. Confirmed live: it is the LAST of the three
  `CREATE OR REPLACE` statements for this view (`grep -l member_progress` over `prisma/migrations` returns exactly
  three files; `20260806020000` sorts last, and no later migration — including `20260812020000_manual_late_mark`,
  which ADDED the column — touches the view).

**Divergence proof.** Member M, startWeek 1, weeksCommitted 20, weeklyAmount 50,000 cents ($500). Weeks 1–3 dated in
the past with closed windows and fully paid: totalPaid $1,500. Week 4's stored date is TODAY (0 days elapsed, window
open), `amountPaid` 0, `isDeferred` false, and the organizer set `markedLateAt` on it this morning (permitted:
`manualLateAdvice` returns kind "current" for days=0, and `edits.ts:1499` does not refuse because amountPaid 0 <
$500).

- **TypeScript:** elapsed = {1,2,3} by calendar + {4} by `lib/derived.ts:113` = 4; credited = floor(150000/50000) =
  3; weeksBehind = max(0, 4 − 0 − 3) = **1**; week 4's status is LATE (`lib/derived.ts:192`) so lateCount = 1.
- **SQL:** the LATERAL at `:52-63` counts only weeks satisfying `current_date >= w.date + 5`, i.e. weeks 1–3, so
  elapsed = 3, excused = 0, floor(total/weekly) = 3, weeks_behind = greatest(0, 3 − 0 − 3) = **0** — and M is
  counted in `currentCount` (`app/actions/member.ts:460`).

**One member, same instant: "1 late" on `/me`, "Current" pill and 0 behind on `/me/group`.**

**Ruling.** Correct: `lib/standing.ts:164`. Wrong:
`prisma/migrations/20260806020000_…/migration.sql:62` — the view's elapsed count is calendar-only and never reads
`markedLateAt`, so `weeks_behind` (`:37`) contradicts the TypeScript weeks-behind for the same member at the same
instant.

> §2.14, the derived-values table: "| Late | unpaid **and** either the window has closed **or** the organizer marked
> it late himself (§2.29). Deferral outranks both. |"
>
> §2.29, effects table row 2: "| 2 | **Arithmetic** | A mark cannot pull a not-yet-due deferred week forward, and
> the attention list applies the same test — so the list and the standing derivation cannot disagree. An *elapsed*
> deferred week still counts as owed: deferral has never excused the money. |"

**What a human sees — and one sweep claim is corrected.** `weeksBehind` was grepped across `components/member/` and
`app/me/`: it appears ONLY in `member-group-list.tsx` (`:82`, `:128`, `:166`, `:186`). `getMyPortal` returns
`standing.weeksBehind` (`app/actions/member.ts:350`) but **`/me` never renders it** — `app/me/page.tsx` passes only
`lateCount={p.lateCount}` at `:260`. So "On `/me` the member reads … weeksBehind 1" is false. What is true: on `/me`
the member reads "1 late" (`member-personal-summary.tsx:164`, `:170`); on `/me/group` the SAME member gets the
CurrentPill instead of the BehindPill (`member-group-list.tsx:128`) and is inside the "N/M current this week"
headline (`:102`) that every peer is also looking at (`:186`). The TypeScript `weeksBehind` does reach members by a
second route, re-derived: it is the `{weeksBehind}` message placeholder (`lib/messages.ts:311`, registered at
`:394`), so a BEHIND_NOTICE can state 1 to the same member whose group page says 0. Teaching the view about
`markedLateAt` moves the member out of "current" on the group page and drops the group's current-count by one.

---

### C3. `member_progress` `excused` — is a PERSONAL deferral excused, or only a cycle-wide skip? — **EQUIVALENT**

**Implementations**

- `prisma/migrations/20260806020000_…/migration.sql:57` — the live view; only the cycle-wide skip is excused
  ```
      count(*) FILTER (WHERE w."isSkipped") AS excused
  ```
  The comment above it at `:55-56` says so — "ONLY a cycle-wide skip is excused. A personal deferral is still owed
  (Aug 2026 ruling) — it only stops the chasing, never the debt." — and unlike the comments in C1 this one describes
  what the line actually does.
- `lib/standing.ts:176` — the TypeScript side of the same subtraction, fed to
  `weeksBehind(elapsed.length, credited, skippedElapsed)` at `:178`
  ```
    const skippedElapsed = elapsed.filter((w) => w.isSkipped).length;
  ```
  Filters on `isSkipped` alone; `isDeferred` is not consulted.
- `prisma/migrations/20260805150000_member_column_privileges_and_progress_fix/migration.sql:93` — **SUPERSEDED**;
  the predecessor view's excused filter (`:88-95`) is
  `WHERE w."isSkipped" OR EXISTS (… AND p2."isDeferred")` — it DOES excuse a personal deferral
  ```
            AND p2."isDeferred"
  ```
- `prisma/migrations/20260804230000_auth_identity_settings_and_rls_policies/migration.sql:176` — **SUPERSEDED**, and
  differs twice over: it excuses deferrals AND bounds by the projected current week (`:177`
  `AND w."weekNumber" <= cw.week_no`) with no start-week floor at all
  ```
      AND (p."isDeferred" OR w."isSkipped")
  ```
- `scripts/verify-member-privileges.mts:74-75` — **added by this pass** (Pass 1 #23 records it; the sweep omitted
  it). The script that exists to VERIFY `member_progress` carries its own SQL copy — and that copy still excuses
  personal deferrals, i.e. the SUPERSEDED rule
  ```
        count(*) FILTER (WHERE w."isSkipped" OR EXISTS (
  ```
  Worse, its TypeScript comparison side does the same at `:90-93`
  (`return (row?.isDeferred ?? false) || w.isSkipped;`), so it compares its own superseded SQL against its own
  superseded TypeScript and passes without ever querying the live view. A §5.4-shaped exemption: the verification
  asserts a rule the platform no longer implements. **Footnote reach — a script reaches no screen — but it means no
  automated check would catch this row regressing.** Adjudicated in full at row F11.

**Why EQUIVALENT.** Both live implementations subtract exactly the set { weeks in the elapsed set with `isSkipped`
true } and nothing else; neither reads `isDeferred`, so for any input they remove the same weeks. The two earlier
migrations do behave differently, but all three statements are
`CREATE OR REPLACE VIEW public.member_progress`, `20260806020000` sorts last by timestamp, and no later migration
redefines it (verified by listing `prisma/migrations` and grepping) — so in a tree migrated in order they are dead
definitions no query can reach. **The live view's real disagreement with the TypeScript is the elapsed set itself,
not the excused term: row C2.**

---

### C4. WHICH WEEKS form a member's elapsed/due set — week rows with their flags, or an integer range plus whatever payment rows exist? — **RESOLVED**

**Implementations**

- `lib/standing.ts:164` — per-WEEK-ROW: filters the member's existing week rows, asking `weekCountsAsDue` of each
  row's own stored date
  ```
    const elapsed = windowWeeks.filter((w) =>
  ```
  The skipped subtraction at `:176` and the `isSkipped` flag passed into `amountOutstanding` at `:184` both come
  from the WEEK row, so they are present whether or not a payment row exists.
- `lib/dashboard.ts:546` — `memberAttention` builds `dueWeeks` as a CONTIGUOUS INTEGER RANGE (`:544-550`) from
  startWeek to a single cycle-wide boundary. No week row is consulted at all
  ```
        n <= Math.min(input.elapsedThroughWeek, finishWeek);
  ```
- `lib/dashboard.ts:565` — **the reachable half**
  ```
      const skippedCount = elapsedRows.filter((r) => r.isSkipped).length;
  ```
  `elapsedRows` is `rows.filter((r) => dueWeeks.has(r.weekNumber))` at `:564`, where `rows` are PAYMENT rows. A
  member with no payment row for a cycle-wide skipped week contributes nothing to `skippedCount`, so the skip is
  never subtracted from their behind-count. `computeStanding` counts the same skip off the WEEK row and does
  subtract it. Pass 1 #90 names this defect explicitly.
- `lib/dashboard.ts:578` — the LAST field of the object literal at `:575-579`, which is
  `{ amountDue, amountAlreadyPaid, isDeferred }` and carries **NO `isSkipped`**
  ```
          isDeferred: row?.isDeferred ?? false,
  ```
  `amountOutstanding`'s skipped exclusion (`lib/derived.ts:299` `if (!week.isSkipped) due += week.amountDue;`)
  therefore cannot fire on this path: `undefined` is falsy, so every week in the range is charged. Note the shape
  §5.5 warns about, inverted: `isDeferred` is a REQUIRED field on `amountOutstanding`'s input type
  (`lib/derived.ts:290`) that the function body never reads, while `isSkipped` — the one it does read — is optional
  and is the one omitted here.
- `lib/commitment.ts:162` — `elapsedThroughWeek`, the single boundary `memberAttention` is handed: the MAXIMUM week
  number whose own date has elapsed, so one late-dated week anywhere below that maximum is swallowed by the range
  ```
      if (!weekHasElapsed({ weekDate: w.date, today, windowClosesDays })) continue;
  ```

**Divergence proof — an earlier sweep proof was arithmetically wrong and is replaced.** (Its out-of-sequence example
claimed `computeStanding` gives outstanding $0; it does not — `allocatePayment` waterfalls oldest-first over the
WHOLE window including the future-dated week 5, so $3,500 covers weeks 1–7 and `amountOutstanding` over the elapsed
set {1,2,3,4,6,7,8} is 7×$500 − $3,000 = $500, the same $500 `memberAttention` reports. Only the behind-count
diverged there, 0 vs 1, and only on legacy out-of-sequence data, since `app/actions/edits.ts:1692-1706` now bounds
every week date against its neighbours on write.)

**The reachable proof, needing no legacy data.** Cycle with weeks 1–10, $500/week. The organizer marks WEEK 3
SKIPPED cycle-wide (ordinary UI). Member M, startWeek 1, 10 weeks, has paid $1,500 in three receipts;
`allocatePayment` passes over the skipped week (`lib/standing.ts:140`), so the money lands on weeks 1, 2 and 4 and
**NO payment row exists for week 3** — rebuild only creates a row where money is applied (`lib/rebuild.ts:67-77`).
Weeks 1–4 have closed windows, so `elapsedThroughWeek` = 4.

- **computeStanding:** elapsed = {1,2,3,4}; skippedElapsed = 1 (from the week row); credited = 3; weeksBehind =
  max(0, 4 − 1 − 3) = **0**; `amountOutstanding` = (3×$500 due, week 3 excluded by `isSkipped`) − $1,500 = **$0**.
- **memberAttention:** dueWeeks = {1,2,3,4}; `elapsedRows` = the payment rows for weeks 1, 2, 4 only, so
  `skippedCount` = 0; behind = max(0, 4 − 0 − 3) = **1**, which passes the `if (behind === 0) continue` at `:567`;
  owed = `amountOutstanding` over four weeks with no `isSkipped` = 4×$500 − $1,500 = **$500**, which passes
  `if (owed === 0) continue` at `:582`.

The dashboard attention list prints "M — 1 week behind, $500" for a member whose own profile and grid column both
say 0 and $0, **on a week the organizer himself declared nobody owes.**

**Ruling.** Correct: `lib/standing.ts:164`. Wrong: `lib/dashboard.ts:544-550` (the range must be the same
per-week-row `weekCountsAsDue` filter `computeStanding` applies); `lib/dashboard.ts:565` (`skippedCount` must be
counted off the WEEK rows); `lib/dashboard.ts:575-579` (the object must carry `isSkipped`, or
`amountOutstanding`'s skipped exclusion is dead on this path).

> §2.29, effects table row 2: "| 2 | **Arithmetic** | A mark cannot pull a not-yet-due deferred week forward, and
> the attention list applies the same test — so the list and the standing derivation cannot disagree. An *elapsed*
> deferred week still counts as owed: deferral has never excused the money. |"
>
> §2.14, the derived-values table: "| Weeks behind | weeks elapsed in their window − weeks credited |"

**What a human sees.** The dashboard attention list (rendered on `/admin`, fed by
`app/actions/dashboard.ts:181-187` — re-derived) names a member and an amount that the member's own profile
(`app/admin/(protected)/people/[id]/page.tsx:585`) and the payments grid column
(`app/actions/payments-view.ts:116`) both say is zero. It is the exact contradiction §2.29 row 2 forbids by name,
and it fires on every member who has no payment row for a skipped week — which is every member who never had money
land on it. The out-of-sequence-date variant is the same defect through a second door and is now write-guarded, so
it survives only in imported or legacy rows; that is why `outOfSequenceWeeks` (`week-dates.ts:212`) and its
dashboard dot (`cycle/position/page.tsx:85`) exist. Fixing `lib/dashboard.ts:565` and `:575-579` costs one flag on
the payment shape and one field on the object literal.

---

### C5. "Should have come in" / collection Outstanding versus the per-member outstanding printed under it — a manually marked week whose window is still OPEN — **RESOLVED**

**Implementations**

- `lib/dashboard.ts:286` — the elapsed stamp on each week of the series. Pure calendar
  ```
        elapsed: w.weekNumber <= input.elapsedThroughWeek,
  ```
  **Correction to the sweep**, which claimed "`receiptsByWeek` never receives `markedLate` at all" — that is false.
  `DashboardPayment` carries `markedLate` (`lib/dashboard.ts:197`, with a comment at `:191-196` insisting the
  command centre "must not tell him a member is fine on a week he personally marked late an hour ago"), and
  `app/actions/dashboard.ts:135` sets it. **`weekReceipts` RECEIVES the mark and NEVER READS IT** — the whole
  function, `:220-268`, was read and `markedLate` does not appear in the body. That is §5.5 in its purest form: a
  field whose doc comment states the rule, on a function that ignores it.
- `lib/cycle-position.ts:217` — the Outstanding StatCard's number, derived from shouldHaveCollected − collected
  (`:194`, `:195`, `:209`). Mark-blind by inheritance, since `lib/cycle-position.ts:186` selects on the flag stamped
  at `lib/dashboard.ts:286`
  ```
      shortfall: Math.max(0, gap - Math.min(willNotArrive, gap)),
  ```
- `lib/derived.ts:113` — the other engine, reached by `app/actions/cycle-position.ts:206` through `computeStanding`:
  the marked week IS due, so its money is in `standing.amountOutstanding` and therefore in `owedBy` on the very same
  page
  ```
    if (args.markedLate && !args.isDeferred) return true;
  ```

**Divergence proof.** One member M, $500/week, startWeek 1, 3 weeks committed. Weeks 1 and 2 have closed windows and
are paid in full ($1,000). Week 3's stored date is today — 0 days elapsed, window open — `amountPaid` 0,
`isDeferred` false, and the organizer marks it late after M phones to say the money is not coming. The mark is
accepted: `manualLateAdvice` returns kind "current" (days = 0, neither ≥ 5 nor < 0, `lib/derived.ts:257`/`:263`) so
`edits.ts:1492` does not throw, and amountPaid 0 < $500 so `edits.ts:1499` does not either. `elapsedThroughWeek` = 2.

- **COLLECTION:** series weeks 1 and 2 carry `elapsed` true, week 3 false; shouldHaveCollected = $1,000, collected =
  $1,000, gap 0, shortfall **$0** → the StatCard at `cycle/position/page.tsx:139-148` renders "Outstanding $0" with
  the sub-line "nothing is owed for elapsed weeks".
- **STANDING:** elapsed = {1,2} by calendar + {3} by `lib/derived.ts:113` = 3; covered = $1,000 on weeks 1–2;
  `amountOutstanding` = 3×$500 − $1,000 = **$500** → `owedBy` = [{M, $500}] → the card at `page.tsx:220-242` renders
  "Who the outstanding money is with — M $500".

**Same page, same render, $0 above $500.**

**Ruling.** Correct: `lib/derived.ts:113`. Wrong: `lib/dashboard.ts:286` / `lib/cycle-position.ts:194` — the
elapsed-week expectation is built from a calendar-only per-WEEK boundary and cannot see a week the organizer marked
late for one MEMBER, so the total contradicts the member rows it is supposed to be the sum of.

> §2.14, the derived-values table: "| Late | unpaid **and** either the window has closed **or** the organizer marked
> it late himself (§2.29). Deferral outranks both. |"

**What a human sees.** `/admin/cycle/position` tells the organizer nothing is owed and then names who owes $500. The
same split runs through `/admin` (`thisWeek.expected` and the `closedShortfalls` list at
`app/actions/dashboard.ts:221-227` both miss the marked week while the attention list carries it — `memberAttention`
DOES honour the mark, at `lib/dashboard.ts:556`) and `/admin/cash` ("still to collect for elapsed weeks" misses it).
Making the expectation mark-aware requires per-MEMBER due-ness inside a per-WEEK figure — `weekReceipts` would have
to test each member's own row rather than the week's single elapsed stamp — but WHICH figure is right is not a
choice: §2.14 says the marked week is late, and `lib/derived.ts:113` already treats it as due everywhere else.

---

### C6. Deferring a week CLEARS an existing manual late mark (the stored `markedLateAt`) — **RESOLVED**

**Implementations**

- `app/actions/edits.ts:1506` — the canonical writer, `setWeekLate`, the only action whose subject is the mark. Its
  upsert writes `markedLateAt` and `markedLateNote` at `:1507-1520`
  ```
        const markedLateAt = input.late ? new Date() : null;
  ```
- `app/actions/edits.ts:1378` — `setWeekDeferral`, the grid/week-panel path. Obeys §2.29 effect 5: deferring nulls
  the mark and its note in the same upsert
  ```
            ? { isDeferred: true, markedLateAt: null, markedLateNote: null }
  ```
  The comment at `:1373-1376` states the reason correctly. Its `false` branch at `:1379` is
  `{ isDeferred: false }` — un-deferring deliberately does NOT restore anything, which is the point.
- `app/actions/edits.ts:1278` — `updatePaymentRow`, the member-profile week-row editor path (reached from
  `participation-editor.tsx:1628` and `:1649`, both confirmed to pass a possibly-changed `isDeferred`). Writes
  `isDeferred` inside a data block (`:1277-1282`) naming method, paidAt and notes and NOT `markedLateAt`
  ```
            isDeferred: input.isDeferred,
  ```
  Its own comment at `:1271-1272` says it "flips isDeferred — the same money-affecting change setWeekDeferral is
  guarded for", and then does not make the same clear. **Definitional caveat owed:** this is an OMISSION, not a
  competing computation — Pass 1 explicitly dropped this exact line from quantity #48 for that reason ("a second
  writer, not a second computation"). It is retained here because §6.4 records it as a rule violation in its own
  right (D-40 gap 1), not because it computes anything.
- `lib/rebuild.ts:143` — the third writer of the column — money-driven, not decision-driven. Clears the mark only on
  weeks the replayed receipts FULLY cover (write at `:146-149`), so it can never rescue a deferred-and-unpaid week.
  It runs on this very path: `updatePaymentRow` calls `rebuildParticipationPayments` whenever `isDeferred` changes
  (`edits.ts:1285-1287`), and on an unpaid week it clears nothing
  ```
      .filter((s) => s.markedLate && s.paid >= participation.weeklyAmount && s.paymentId)
  ```

**Divergence proof.** Member M, week 9, $500/week, week 9's stored date is today (window OPEN, 0 days elapsed),
`amountPaid` 0.

**Step 1:** the organizer marks week 9 late from the grid — `markedLateAt` is set and a Payment row is created if
none existed (`edits.ts:1507-1520`), which also guarantees the profile editor has a `paymentId` to act on
(`participation-editor.tsx:1628` requires `w.paymentId`).

**Step 2:** circumstances change; he opens M's profile and ticks Defer on the week-9 row, which calls
`updatePaymentRow`, not `setWeekDeferral`. The stored row is now `isDeferred` = true AND `markedLateAt` ≠ null — a
state the grid path can never produce, and the only route to it, since `setWeekLate` refuses a deferred week
server-side (`edits.ts:1486-1494`) and `setWeekDeferral` clears the mark. `rebuildParticipationPayments` fires
(`edits.ts:1286`) and clears nothing, because `:143` requires the money to cover the week.

Reads stay correct: `paymentStatus` returns DEFERRED (`:191` precedes `:192`) and `weekCountsAsDue` short-circuits
at `:113`, so weeksBehind = 0 and `amountOutstanding` excludes week 9.

**Step 3:** weeks later he removes the deferral — BY EITHER PATH, since `setWeekDeferral`'s false branch
(`edits.ts:1379`, `{ isDeferred: false }`) clears nothing either. `isDeferred` goes false, `markedLateAt` is STILL
set, and **in that instant** `lib/derived.ts:113` returns true and `:192` returns LATE: weeksBehind rises by 1 and
`amountOutstanding` rises by $500, from a mark nobody re-applied.

**Ruling.** Correct: `app/actions/edits.ts:1378`. Wrong: `app/actions/edits.ts:1277-1282` — `updatePaymentRow` must
apply the same `markedLateAt: null, markedLateNote: null` when `input.isDeferred` flips to true.

> §2.29, effects table row 5: "| 5 | **Clearing** | **Deferring a week clears an existing mark**, so removing the
> deferral months later cannot spring a forgotten mark back. |"
>
> §2.29 preamble: "So the mark does not apply to a deferred week at all — **across all five effects**, the same five
> `docs/DOMAIN_RULES.md` §5 lists:"

**What a human sees — visibility UPGRADED from an earlier "internal".** "Internal" means an intermediate value
CORRECTED before display; this one is not corrected, only SUPPRESSED while the deferral stands, and then displayed
uncorrected. Today nothing is mis-stated — exactly as §6.4 records: "Every READ still shows DEFERRED correctly, so
nothing is mis-stated today". What changes is the day the deferral is lifted: an unannounced +1 week behind and
+$500 outstanding on the attention list, on `/admin/cycle/position`, in the `{weeksBehind}` and
`{amountOutstanding}` message placeholders, and on the member's own portal — sourced from a decision the organizer
made and superseded weeks earlier. **A member-visible wrong number is headline whenever it lands.** This is §6.4's
D-40 gap 1, and it is one field on one write.

---

### C7. How many members a WEEK'S DATE decides (`membersAffectedByDate`) — does a stale mark on a deferred week exclude that member? — **RESOLVED**

**Implementations**

- `lib/derived.ts:113` — the rule: on a DEFERRED week the mark is not consulted at all, so the week's own date is
  what decides whether it becomes due — the member IS affected by the date
  ```
    if (args.markedLate && !args.isDeferred) return true;
  ```
- `app/admin/(protected)/cycle/position/week-dates.ts:113` — excludes anyone marked late, with no deferral term
  ```
      if (row?.markedLate) continue;
  ```
  **Proven, not assumed:** `isDeferred` was grepped across the whole file — it occurs exactly once, at `:78`, inside
  the function's own doc comment, and nowhere in the body (`:91-117`). The mark outranks deferral here, the reverse
  of `lib/derived.ts:113`. The comment at `:112` states the reasoning for a non-deferred week and never asks the
  deferred question — and the doc comment at `:70-81` sets out both directions of the `membersShort`/affected split
  in detail while omitting this one case.

**Divergence proof.** Reachable only from the C6 state, exactly as §6.4 says — and there is no other route:
`setWeekLate` refuses a deferred week server-side (`edits.ts:1486-1494`) and `setWeekDeferral` clears the mark
(`edits.ts:1378`), so `updatePaymentRow` is the sole producer.

Member M, week 7, $500/week, `amountPaid` 0, week 7 dated 3 days ago (window still open,
`PAYMENT_WINDOW_DAYS` = 5). Stored row: `markedLateAt` set on Monday, then `isDeferred` flipped true through
`updatePaymentRow`, which left the mark.

- **PANEL:** `membersAffectedByWeekDate` — M passes the window test (`:108`) and the money test (amountPaid 0 <
  $500, `:111`), then `:113` sees `markedLate` and `continue`s, so affected = **0**.
- **TRUTH:** for M, `weekCountsAsDue({markedLate: true, isDeferred: true})` short-circuits at `lib/derived.ts:113`
  and falls through to `weekHasElapsed`, so week 7 becomes due — and M's `weeksBehind` and `amountOutstanding` move
  — precisely when its date crosses the 5-day boundary. Moving week 7 five days earlier makes M 1 week behind and
  $500 outstanding.

**Ruling.** Correct: `lib/derived.ts:113`. Wrong: `app/admin/(protected)/cycle/position/week-dates.ts:113` — the
mark exclusion must be `if (row?.markedLate && !row?.isDeferred) continue;`, so a deferral supersedes the mark here
as it does in `weekCountsAsDue`.

> §2.29: "So the mark does not apply to a deferred week at all — **across all five effects**, the same five
> `docs/DOMAIN_RULES.md` §5 lists:"
>
> §2.29, effects table row 2: "| 2 | **Arithmetic** | A mark cannot pull a not-yet-due deferred week forward, and
> the attention list applies the same test — so the list and the standing derivation cannot disagree. An *elapsed*
> deferred week still counts as owed: deferral has never excused the money. |"

**What a human sees — worse than the sweep said, and re-derived.** There is no "0 members affected" label anywhere:
`membersAffectedByDate` was grepped repo-wide, and its only consumer is `describeWeekDateChange`
(`week-dates.ts:318` `const moved = input.row.membersAffectedByDate;`), called from `week-date-panel.tsx:260`. When
`moved === 0` and the elapsed flag flips, the panel prints an explicit assertion, `week-dates.ts:385-387` verbatim:
`` `${receiptsStay} Week ${week} ${willBeElapsed ? "starts" : "stops"} counting as ` + `elapsed, but that decides
nothing for anybody: every member whose window covers ` + `it has either paid it or been marked late by hand
already.` `` So the organizer is not shown a wrong count to interpret — **he is TOLD, in a sentence whose own
comment at `:381-384` calls the alternative "the old false promise inverted", that the edit decides nothing for
anybody, while one member's arrears move by a full week.** No member sees it. This is §6.4's D-40 gap 2, whose text
— "treats a marked-late member as settled and skips them without asking whether a deferral superseded the mark" —
this reading confirms exactly, including its note that no fixture puts BOTH conditions on ONE member
(`week-dates.test.ts:283` tests "the plain and the deferred, and drops the marked" as separate members).

---

### C8. WHICH MEMBERS MAY BE CHASED — the applicability offer versus the send gate — **RESOLVED**

**Implementations**

- `lib/messages.ts:177` — `hasChaseableWeeks`, **THE GATE**. Consulted at `:576` inside `sendDecision` for every key
  in `CHASING_MESSAGE_KEYS` (`:63` = BEHIND_NOTICE and LATE_NOTICE), and enforced on the send path itself
  (`lib/messaging-engine.ts:239-248`). Deferral-aware by construction, since `computeStanding` never returns LATE
  for a deferred week
  ```
    return (weeks ?? []).some((w) => w.status === "LATE");
  ```
- `lib/messages.ts:753` — `applicableTypes`, LATE_NOTICE branch — the per-member offer. Asks the OUTSTANDING
  AMOUNT, which counts deferred weeks (`lib/derived.ts:299` excuses only `isSkipped`). **Deferral-blind.** Fed from
  the same `computeStanding` the gate reads: `app/actions/member-messaging.ts:179` passes
  `loaded?.standing.amountOutstanding ?? 0`
  ```
          return state.amountOutstanding > 0
  ```
- `lib/messages.ts:732` — `applicableTypes`, BEHIND_NOTICE branch — same panel, fed from
  `loaded?.standing.weeksBehind ?? 0` (`member-messaging.ts:178`). Asks weeks-behind, which also counts deferred
  weeks (`lib/standing.ts:176` subtracts only skipped). **Deferral-blind**
  ```
          return state.weeksBehind > 0
  ```
- `app/actions/messages.ts:440` — `prepareBatch`, LATE_NOTICE relevance, from
  `const lateWeeks = loaded.standing.weeks.filter((w) => w.status === "LATE");` at `:435`. **Agrees with the gate**
  — a fourth writing of the same predicate that happens to be right (Pass 1 #21 records a fifth at
  `lib/messages.ts:223-225`, which also agrees). §5.10's shape even where nothing is wrong
  ```
              ? lateWeeks.length > 0
  ```
- `app/actions/messages.ts:438` — `prepareBatch`, BEHIND_NOTICE relevance. Deferral-blind, and the row is then
  **PRE-TICKED** at `:469` (`checked: blocked === null && key !== "WHATSAPP_WELCOME"`, where `blocked` covers only
  noMessages and a missing phone — confirmed at `:446-450`)
  ```
            ? loaded.facts.weeksBehind > 0
  ```

**Divergence proof.** Member M, $500/week, startWeek 1, 10 weeks. Weeks 1–2 closed and paid ($1,000); week 3's
window closed 6 days ago with `amountPaid` 0 and `isDeferred` true; weeks 4–10 not yet reached. `computeStanding`:
allocation puts the $1,000 on weeks 1–2, so week 3's `coveredAtCurrentRate` is 0 and its status is DEFERRED
(`lib/derived.ts:191` fires before `:196` can return LATE) — lateWeeks = []. `amountOutstanding` over elapsed
{1,2,3} = 3×$500 − $1,000 = $500; weeksBehind = 3 − 0 − 2 = 1.

**Three answers:**
(a) M's profile message panel (rendered at `people/[id]/page.tsx:224` and `/admin/messages` `page.tsx:114`, both
re-derived) offers LATE_NOTICE as `applicable: true, reason: null`, because $500 > 0 (`lib/messages.ts:753`), and
BEHIND_NOTICE as applicable: true because 1 > 0 (`:732`).
(b) The `/admin/messages` LATE_NOTICE batch drops M entirely (`app/actions/messages.ts:440` sees an empty
lateWeeks), while the BEHIND_NOTICE batch lists M and **pre-ticks the row** (`:438`, `:469`).
(c) Pressing send on either produces `SendOutcome` SKIPPED with the reason from `lib/messages.ts:583` — "Nothing to
chase — their unpaid week is deferred. The money is still owed and every statement says so; they are simply not
chased for it."

**One member, one instant: offered on one screen, absent from another, refused by the server on both.**

**Ruling.** Correct: `lib/messages.ts:177`. Wrong: `lib/messages.ts:753` (the LATE_NOTICE offer must ask
`hasChaseableWeeks`, not `amountOutstanding > 0`); `lib/messages.ts:732` and `app/actions/messages.ts:438` (the
BEHIND_NOTICE offer/relevance must ask the same gate, or say on the row that the send will be refused).

> §2.29, effects table row 3: "| 3 | **Messages** | The week never enters the late-week list, so no chasing
> statement can name it. The chasing gate reads only the derived status; it never looks at the mark. |"
>
> §5.10: "### 5.10 TWO FUNCTIONS ANSWERING ONE QUESTION IS THE SAME DEFECT AS NONE"

**What a human sees.** No money figure moves and no member receives anything wrong — the gate holds at
`lib/messaging-engine.ts:239-248`, which is the half of §2.29 effect 3 that matters. What changes is the
organizer's screen: a green, unqualified "send the late notice" control on the member's profile that the server
then refuses, and a pre-ticked BEHIND_NOTICE row in a batch whose header reads verbatim "Members currently behind by
at least one week." (`app/actions/messages.ts:482`, re-derived by grep). Routing all three through
`hasChaseableWeeks` removes the deferred member from both offers and turns the refusal sentence into the panel's
`reason` field, which is where §2.10's unmistakable feedback wants it.

---

### C9. Paid-versus-owing for one member-week (the week roster's two lists) — a deferred member filed as PAID — **RESOLVED**

**Implementations**

- `lib/payments-view.ts:130` — a raw two-term test with no week date, no today, no mark and no derived status;
  deferral is forced into the PAID list. The doc comment at `:121` says so: "Deferred members are settled — they are
  excused, never chased."
  ```
      if (m.isDeferred || m.amountPaidThisWeek >= m.amountDue) paid.push(m);
  ```
- `lib/derived.ts:191` — `paymentStatus`, the one engine, reached for the same member-week by `lib/dashboard.ts`
  `weekMemberStatus`. PAID is tested first at `:190` and DEFERRED is its own value below it — a deferred, unpaid
  week is never PAID
  ```
    if (args.isDeferred) return "DEFERRED";
  ```
- `lib/dashboard.ts:253` — a third answer for the same member-week: the deferred member is in neither
  `membersPaid` nor `membersExpected`
  ```
      if (payment?.isDeferred) continue;
  ```

**Divergence proof.** One member M, week 5, `amountDue` $500, `amountPaidThisWeek` 0, `isDeferred` true, week 5's
window closed. `splitWeekRoster` returns owing = [] and paid = [M] — **M counted among those who have paid $500 they
have not paid.** `paymentStatus` for the same member-week returns "DEFERRED", and `weekReceipts` returns membersPaid
0, membersExpected 0. Three functions, three answers, one member-week.

**Ruling.** Correct: `lib/derived.ts:191`. Wrong: `lib/payments-view.ts:130` — a deferred member is not settled; the
test must be `m.amountPaidThisWeek >= m.amountDue` alone, with deferral shown as its own state.

> §2.18: "**Unpaid means owed.** A week stops being owed only when it is marked paid. Nothing else clears it."

**What a human sees — nothing, CONFIRMED rather than assumed.** `splitWeekRoster` was grepped across the repo: the
only call sites are `lib/payments-view.test.ts:170`, `:182` and `:191`. It is imported at
`app/actions/payments-view.ts:8` and never invoked; the comment at `app/actions/payments-view.ts:87-91` records why,
verbatim: "getWeekBoard (the retired \"Record week\" view) was removed with that view … Its pure helpers
(resolveTargetWeek, splitWeekRoster, redactWeekBoard) remain in lib/ with their tests." (`lib/presentation.ts:178`
`redactWeekBoard` is dead for the same reason — same grep.) **Recorded because it is a wrong rule sitting in `lib/`
with a passing test pinning it, one import statement away from being live again.** For contrast, the two LIVE
duplicates of the same still-owed comparison — `lib/week-selection.ts:21` and
`app/admin/(protected)/people/[id]/member-payments.tsx:377`, both
`!isSkipped && amountAlreadyPaid < amountDue` — deliberately keep a deferred week selectable, which is the correct
rule; they are duplication (§5.10) but not divergence.

---

### C10. One week's dot state in the consistency strip — DEFERRED tested above PAID — **RESOLVED**

**Implementations**

- `lib/chart.ts:193` — `consistencyState`. Deferral is the FIRST test, above the paid comparison at `:194`, and the
  function has no `isSkipped` input and no `markedLate` input; `windowClosed` (`:191`) is supplied by the caller
  rather than derived from the week's date
  ```
    if (input.isDeferred) return "deferred";
  ```
- `lib/derived.ts:190` — `paymentStatus`. PAID is tested ABOVE the deferral test at `:191` — the opposite order —
  because money is the truth. `lib/derived.ts:154-158` spells the ordering out as the ruling it is
  ```
    if (args.amountPaid >= args.amountDue) return "PAID";
  ```
- `lib/chart.ts:230` — the path that is actually live: a pure MAPPING from the already-derived
  `PaymentStatusValue` (DEFERRED → "deferred" at `:238-239`), so it inherits `paymentStatus`'s ordering rather than
  re-deciding it. Its comment at `:218-223` says the second derivation exists only "for callers holding raw amounts"
  ```
  export function consistencyFromStatus(
  ```

**Divergence proof.** One week: `amountDue` $500, `amountPaid` $500 (fully covered), `isDeferred` true — reachable,
and the two routes were verified: deferred weeks stay tickable and stay allocatable, since
`lib/week-picking.ts:44-45` (`if (week.isSkipped) return 0;` / `return Math.max(0, week.amountDue -
week.amountPaid);`) and `lib/week-selection.ts:21`
(`return !w.isSkipped && w.amountAlreadyPaid < w.amountDue;`) both exclude only `isSkipped`, and
`lib/standing.ts:140` passes only `isSkipped` to the allocator. `consistencyState` returns "deferred" (`:193` fires
before `:194`). `paymentStatus` returns "PAID" (`:190` fires before `:191`), and `consistencyFromStatus` maps that
to "paid". **The same fully-paid week draws as a deferred dot on one derivation and a paid dot on the other**, and
`longestOverdueRun` counts neither.

**Ruling.** Correct: `lib/derived.ts:190`. Wrong: `lib/chart.ts:193` — the deferral test must sit below the paid
comparison, as `paymentStatus` orders it.

> §2.14 (heading): "### 2.14 MONEY IS THE TRUTH — EVERYTHING ELSE IS DERIVED"
>
> §2.29: "**Money still wins.** A week that gets paid reads PAID whatever the mark says, and the payment path clears
> the mark on any week the money fully covers."

**What a human sees — nothing, CONFIRMED.** `consistencyState` was grepped repo-wide: outside its definition at
`lib/chart.ts:186` and a doc reference at `:218`, every hit is in `lib/chart.test.ts`. The live strip imports
`consistencyFromStatus` only — `app/admin/(protected)/payments/payments-screen.tsx:6` and `:184` — and feeds it
statuses already derived by `computeStanding`, so the deployed path has exactly one opinion about lateness.
**Recorded because the dead ladder is the same shape as the `splitWeekRoster` one:** a contradicting rule kept alive
by its own tests (`chart.test.ts:191-192` pins "deferred" as intended, §5.6).

---

### C11. Has this week's payment window CLOSED — the four APP-LEVEL TypeScript copies — **EQUIVALENT**

**Implementations**

- `lib/derived.ts:77` — `weekHasElapsed`, the canonical, returning `daysSinceWeekOpened >= windowDays` at `:78`
  ```
    const daysSinceWeekOpened = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
  ```
- `lib/derived.ts:194` — `paymentStatus`'s inline copy, character-identical to `:77`, tested as
  `const windowClosed = daysSinceWeekOpened >= windowDays;` at `:195`. Two functions below the one it could have
  called
  ```
    const daysSinceWeekOpened = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
  ```
- `lib/derived.ts:252` — `manualLateAdvice`'s copy, a third in one file, tested as `if (days >= windowDays) {` at
  `:257` and again as `if (days < 0) {` at `:263` for the future case
  ```
    const days = Math.floor((utcDay(args.today) - utcDay(args.weekDate)) / MS_PER_DAY);
  ```
- `app/actions/dashboard.ts:224` — `closedShortfalls`, written as an addition on the week's day rather than a
  subtraction-and-floor, over a locally redeclared `MS_PER_DAY` (`:29`) and `utcDay` (`:30-32`) whose bodies were
  compared against `lib/derived.ts:6` and `:53-54` — identical
  ```
          const closed = utcDay(today) >= utcDay(week.date) + PAYMENT_WINDOW_DAYS * MS_PER_DAY;
  ```

**Why EQUIVALENT — the one place in Part C where the duplication is provably harmless.** All four `utcDay`
implementations return `Date.UTC(y, m, d)`, an exact integer multiple of `MS_PER_DAY = 86_400_000` for every
representable date. Therefore `(utcDay(today) − utcDay(weekDate))` is always an exact multiple of `MS_PER_DAY`, the
division is exact, and `Math.floor` is the identity: `Math.floor((A − B) / MS) >= W` and `A >= B + W × MS` are the
same predicate for every input, including negative differences (a future week: −1 ≥ 5 is false, and
A ≥ B + 5×MS is false). Only three of the four accept a `windowClosesDays` override, but `windowClosesDays:` was
grepped repo-wide outside tests and the only non-default passers are in `week-dates.ts` (`:159`, `:303`, `:308`),
which are not among these four; every one of these four reads the same `PAYMENT_WINDOW_DAYS = 5`
(`lib/derived.ts:13`; `app/actions/dashboard.ts:15` imports it). **No input can separate them.**

**Scope stated explicitly.** Pass 1 #6 lists nine also-implemented sites, not three. The five excluded here are two
SQL copies and four script copies. The SQL fifth — `20260806020000/migration.sql:62` — uses `current_date`, the
server timezone's day rather than a UTC day, and a bare literal 5; it is row A13 and **OPEN ruling 7**, and it could
not be closed because this audit queries no database. `scripts/verify-member-privileges.mts:79` and `:89` use a bare
literal 5 on both the SQL and the TypeScript side, so they track nothing if the constant moves; a script reaches no
screen, so footnote.

---

### C12. "N of M members paid" for one week (`membersExpected` / `membersPaid`) — does a DEFERRED member belong in it? — **OPEN**

*(Ruling text at OPEN ruling 3. **Decide before C1's money fix ships — one `continue` controls both.**)*

**Implementations**

- `lib/dashboard.ts:256` — reached only after `if (payment?.isDeferred) continue;` at `:253`, so a deferred member is
  in NEITHER the denominator here nor the numerator at `:257` — internally consistent, and **smaller than the number
  of people who owe the week**
  ```
      membersExpected++;
  ```
- `lib/dashboard.ts:257` — the numerator, behind the same `continue`
  ```
      if ((payment?.amountPaid ?? 0) >= participation.weeklyAmount) membersPaid++;
  ```
- `lib/payments-view.ts:225` — the grid's parallel figure counts the deferred member's money, so its implied
  headcount for the same week is one larger. The grid renders no headcount of its own
  (`payments-grid.tsx:332` prints money only), which is why this half of the split has never been forced to a
  decision
  ```
          if (!week.isSkipped && mw.status !== "SKIPPED") expected += mw.amountDue;
  ```
- `app/admin/(protected)/cycle/position/week-date-panel.tsx:190` — **not an implementation; a footnote in the UI**
  ```
            `if (payment?.isDeferred) continue;` BEFORE `membersExpected++`, so a
  ```
  Inside the JSX comment at `:186-192`, which quotes `lib/dashboard.ts:253` and explains to the reader that "a
  deferred member is missing from the denominator and the numerator alike", then leaves it standing. The comment
  block goes on (`:194-200`) to record that the SAME column is also blind to the manual late mark, which is row C5's
  defect stated on screen and equally left standing. **The screen apologising for the count twice rather than the
  count being right is the tell that this is an unmade decision, not a bug.**

**Divergence proof.** Week 12, seven in-window members at $500 each; one of them, B, has week 12 deferred and unpaid;
the other six have paid. Week 12's payment window has closed and the organizer is viewing it through
`/admin/this-week`'s week selector, which honours a chosen past week (`app/actions/dashboard.ts:92-96`, re-read).
`weekReceipts` returns expected $3,000, received $3,000, shortfall $0, membersExpected 6, membersPaid 6 — the page
reads "Expected $3,000 · 6 of 6 members paid · short $0" (`this-week/page.tsx:109`, `:115`, `:121`).
`buildPaymentGrid` returns expected $3,500 for the same week, so `payments-grid.tsx:332` renders "$3,000 / $3,500".
`computeStanding` puts B's $500 in their outstanding, since week 12 is elapsed and `lib/derived.ts:299` excuses only
`isSkipped`. **So the same week is simultaneously "6 of 6 paid, nothing short" and "$500 of its money is outstanding
and B owes it".**

**Why OPEN.** The money half is settled by C1. The headcount half is not: §2.29's five effects name status,
arithmetic, messages, the control and clearing — no headcount — and `docs/DOMAIN_RULES.md` §5's table answers
exactly two columns, "Chased? No" and "Counts toward what they owe? Yes". **A count of people is neither.**

**What a human sees.** Whichever way this is ruled, C1's money fix changes `/admin`, `/admin/cash`,
`/admin/this-week`, `/admin/cycle/position` and the collected-vs-expected chart. This row decides only whether the
headcount beside those figures moves with them.

---

> **End of Part C.** 12 rows: 9 RESOLVED, 2 EQUIVALENT, 1 OPEN.

---
# What Pass 2 could not settle

## 1. Things the evidence ran out on

**The deployed Postgres session `TimeZone`.** This audit queries no database. `member_progress`'s elapsed test is
`current_date >= (w.date::date + 5)` (`20260806020000/migration.sql:62`), where `current_date` is the date in the
session's timezone while every TypeScript copy is hard-UTC. Whether that produces a real one-day divergence depends
on a value that costs one `SHOW TimeZone;` to read and that this pass was forbidden to read. Recorded as **OPEN
ruling 7** and row A13, explicitly as a ruling that is *needed* rather than a defect that is *proven*. Supabase's
default is UTC, so it may never fire.

**Whether any live cycle-1 member is on legacy hand-placed data.** Rows A19, A20 and A27 turn on imported weeks
whose old-app placement was not oldest-first and which nobody has edited since. The condition is documented in the
code (`lib/rebuild.ts:13-15`) and the write path that produces it is real (`scripts/import-cycle.mts:232`), and the
divergence is fully constructible on paper — but confirming that a real member is in that state requires reading
rows. **Not done.** The rows say so.

**Whether a legacy imported row carries more than its member's current weekly.** Rows A38 and A52 are EQUIVALENT
*on every state the app can produce*, and the proof enumerates every writer. A row written outside the app —
`scripts/import-cycle.mts`, a hand SQL correction — would break the netting-versus-per-week-clamp equality and make
a member page print $0 outstanding beside a catch-up button offering $250. Unverifiable without the database.

**One reachability question left narrow rather than closed.** Row V2: a member holding a CLOSED break who is drawn
on a week inside that break would have `amountDue` set to their full weekly by `lib/draw-settlement.ts:104`, which
does not consult `ParticipationBreak`. While a break is OPEN the participation is CLOSED and its numbers have left
the pool, so this needs a draw dated into a break that was subsequently closed. §2.23 lets the organizer edit draws
and week dates, so it is not impossible — but no ordinary flow produces it, and it is recorded rather than ranked.

## 2. Eighteen rulings that are Oli's, not the auditor's

The full list is at the top of this document. They are not gaps in the evidence — every one carries verbatim source
for both implementations and a concrete input on which they differ. They are gaps in the **law**: `EQUB_GROUND_TRUTH.md`
does not answer them, and inventing an answer would have been worse than recording the question. Three of them
(rulings 1, 3, 4) block work that is otherwise ready: the deferral money fix cannot ship until the headcount half is
decided, and both carry-deduction paths need one classification before either can be corrected.

Two rulings rest on documents that describe rather than legislate, and both say so in place: **ruling 2** (the break
hole) leans on §4.1, which is the CURRENT STATE build-status table, not §2 law; **ruling 11** (the current-week
clock) leans on a guard test, `lib/week-date-authority.test.ts`, that enforces a split written down nowhere in the
ground truth. In both cases the code's own comments are unambiguous about intent, and in both cases §2 pulls the
other way. That is exactly the shape §5.8 names: "THE GAP IS USUALLY A RULE WITH NO OWNER."

## 3. What this pass did NOT use, stated plainly

**Pass 1's "Surfaces:" lists were not used anywhere.** They were never re-verified, and Pass 1 said so. Every claim
in this document about where a number is displayed was **re-derived in this pass** by searching the tree and opening
each file, and the rows say so at the point of claim. That re-derivation corrected Pass 1 in at least nine places,
including:

- `currentWeekNumber` has an eleventh caller Pass 1 missed (`app/admin/(protected)/cycle/add/page.tsx:87`) — row V5.
- `currentWeekFromRows` is rendered on screen (`cycle/position/page.tsx:102`), contradicting Pass 1's title
  "computed for the member and never shown" — row V30.
- `MemberPersonalSummary` has ONE call site, not two — row A54.
- `statement` (the closing statement) is organizer-only; no member surface reads it — row V28.
- `/me` never renders `weeksBehind`; it renders `lateCount` — row C2.
- `membersAffectedByDate` has no "0 members affected" label; it has a sentence asserting the edit decides nothing —
  row C7.
- `PayoutEquation` is used at `people/[id]/page.tsx:633`, which Pass 1 called the import — row A9.
- The removal fee sentence enters the audit entry only on "remove completely" — row V4.
- `app/admin/(protected)/participations/[id]` lands on the default tab, not `?tab=payout` — finding B1.

**Pass 1's Part B "Other implementations" lines were not used.** They are marked SUPERSEDED and contain known false
positives.

**Part B's label set is this pass's own.** It was derived by reading route files and their rendered components, not
inherited.

## 4. Claims withdrawn during verification

An audit that only adds findings is not auditing itself. These were asserted in earlier drafts of this work and are
**refuted** here, with the refutation kept in the row rather than the claim quietly deleted:

| Withdrawn claim | Why it fails | Row |
|---|---|---|
| A rate change leaves stored week amounts disagreeing with coverage | Every `weeklyAmount` write calls `rebuildParticipationPayments` in the same transaction (`edits.ts:541`, `:813`, `:990`, `:1088`) | A19, A27, A38, V8 |
| `splitWeekRoster` files deferred members as paid on a live screen | No production caller; the view it served was deleted | A19, C9 |
| The member consistency strip contradicts the receipts | `consistencyState` has no caller; the strip maps from `paymentStatus`, and it is an admin screen | A20, A27, C10 |
| A deferred member who pays appears under "Deferred — still owed" | `paymentStatus` puts PAID above DEFERRED; she reads PAID, and the PAID bucket shows 9 under a sub saying 8 | B10, B12 |
| The at-risk threshold and the clock together produce a divergence | They cancel exactly; two independent proofs were built instead | V6 |
| The archive contradicts its own totals over a drawless payout | The archive page never renders `pendingNet`; `stillHeld` stays correct | V15 |
| The add-winner refusal names a fee-sized different amount | `draw-settlement.ts:117-118` formats the same `amountDue` the preview named | V13 |
| "Gone out in total" is a label/math mismatch | The `sub` names the composition verbatim, and this audit treats `sub` as label everywhere else | B25 |
| "This week's pot" disagrees with `/admin/this-week` | Both default to the same projected clock; the break gap cannot bite on ACTIVE rows | B26 |
| "Next due" misdescribes its math | The label says "next", not "nothing is due before this"; the SKIPPED variant is unreachable | B27 |
| A payout net of $9,300 after a two-number settlement | The settlement deducts the member's FULL weekly, not the number's share — $8,800 | B4 |
| `weeksCredited` can exceed `weeksCommitted`, so the caps matter | `planCommit` and `rebuild` both refuse; every clamp is a no-op | A23, F9 |
| `weeklyAmount` 0 is DB-reachable, so the divisor guards diverge | `lib/participation-rules.ts:20` refuses it on every create and update path | F10 |
| Pass 1's quote for `lib/cycle-position.ts`'s elapsed-through line | That line appears nowhere in the file or the repo; corrected | I2, F8 |
| Two DEBT-writing paths | There are four (`cycle-close.ts:350`, `participation-close.ts:344`, `edits.ts:422`, `:442`) | B19 |

## 5. One structural observation, recorded because it explains the shape of this report

Five of the RESOLVED rows are defects **the platform's own verification cannot see**, because the checking script
carries its own copy of the rule it is checking:

- `scripts/audit-position-figures.mts:233` reproduces `lib/dashboard.ts:253`'s deferral drop by hand, so
  `npm run check:position` agrees with rows A2 and A30 by construction (rows A2, A5, A30).
- `scripts/verify-member-privileges.mts:65` runs its own `$queryRawUnsafe` copy instead of selecting from
  `public.member_progress`, `:74-75` and `:90-93` both implement the SUPERSEDED deferral rule, and `:81` scopes to
  `status = 'ACTIVE'` where the view does not — so it compares two copies of a rule neither engine uses and prints
  PASS (rows A14, A16, A32, F11).
- `scripts/audit-position-figures.mts:191-194` and `scripts/verify-participation-close.mts:401-404` compute
  `owedBack` without the fee §2.30 requires, then discard the value (row F13).
- `lib/fee-preview.test.ts:99-112` models the member portal by re-splitting the weekly, so it passes precisely
  because it reproduces the defect it was written to catch (row A8).
- `lib/week-date-authority.test.ts:167-178` exempts `cycle/page.tsx` with a reason that describes one of that file's
  three uses of the value (finding B23).

§5.4: "AN EXEMPT ENTRY IS A CLAIM ABOUT THE CODE… Exemptions are prose; verify them." §5.7: "A TEST CAN PASS FOR THE
WRONG REASON." Both are load-bearing here: the divergences in this report are not obscure, and the reason they
survived is that the things watching for them were built from the same misunderstanding.

---

*Pass 2 ends here. No build plan is included — sequencing belongs to `docs/ONE_TRUTH_ENGINE.md` §5, not to this
file.*

