# Financial Audit — Pass 3: Cross-Surface Agreement and Test Coverage

**Read-only.** No code, schema, or database was changed. No database was queried; every
divergence below is proven by constructing the member state from source, and each one is
flagged for whether it has ever been observed live.

Pass 1 catalogued. Pass 2 judged correctness. Pass 3 asks the two questions that close the
map:

- **(a)** Does the same quantity shown on two surfaces actually tie, or can it differ?
- **(b)** Does a test exist that would have caught the divergence?

## The evidence rule

Every claim carries a verbatim line. A claim about what a screen shows quotes the render
line, not the function behind it. Where I could not establish something, it says so.

Pass 2 is the authority on which implementation is canonical; this pass does not re-open
those rulings, it asks whether the surfaces agree and whether anything tests that.

---

# PART 0 — RE-VERIFICATION OF THE SURFACES LISTS

Pass 1's `Surfaces:` lists were never re-verified, and Pass 1 said so at the point of
claim: *"**Surfaces** — where the figure reaches a human. These are what Pass 3 will
check"* (`docs/AUDIT_PASS_1.md:237`). Pass 2 refused to use them at all, stating
*"**Pass 1's "Surfaces:" lists were not used anywhere.** They were never re-verified, and
Pass 1 said so"* (`docs/AUDIT_PASS_2.md`, §3 of *What Pass 2 could not settle*), and
corrected them in nine named places.

This part re-derives them under one strict rule.

## The rule applied

> A **surface** is a place that RENDERS a money or standing value into output a member or
> organizer reads. It is proven by the render line itself.

Rejected, explicitly:

- **Not a render site** — a `.ts`, `.sql` or `.prisma` file. These compute, store or pass;
  none can render. (The one carve-out is below.)
- **Prop pass-through** — `paidCount={p.weeksCredited}`. The value is handed to a child;
  the render happens in the child, and counting both double-counts one surface.
- **Declaration, hook, comment** — `const remaining = …`, `useMemo(…)`, `{/* … */}`.
- **No money or standing value in rendered position** — a `<span className=…>` wrapper, a
  closing tag, a bare label with no figure beside it.

One carve-out: **an approved WhatsApp template body is a surface.** It is fixed text
rendered to a member's phone (`lib/whatsapp-templates.ts`). It is marked
`SURFACE(MESSAGE)` and kept separate from screens throughout.

Standing values count, not only money: Pass 1's scope is *"a member's position in the
cycle (current week, finish week, weeks credited, weeks behind, status)"*
(`docs/AUDIT_PASS_1.md:24-26`), so a rendered status word is a surface. A bar's pixel
width encoding a percentage is **not** — it renders no readable figure.

## Result

| | Count |
|---|---:|
| Raw surface citations in Pass 1 | **819** |
| Distinct `file:line` after dedupe | **622** |
| Pass 1 catalogue entries carrying a `Surfaces:` list | 137 |
| **Survived** (mechanical adjudication) | **295** |
| **Rejected** | **327** |

**Every one of the 622 cited lines resolves.** No missing file, no line number past the end
of its file. Pass 1's citations are accurate as *locations* and wrong as *classifications*
— it recorded where a value was touched, not where it was shown.

Rejections by reason:

| Reason | Count |
|---|---:|
| No money/standing value in rendered position | 135 |
| Not a render site (`.ts` / `.sql` — computation, action, pass-through) | 128 |
| Declaration or comment | 32 |
| Prop pass-through (the render is in the child) | 32 |
| **Total rejected** | **327** |

Survivors by kind: JSX interpolation 248, display attribute (`title`, `aria-label`, `sub`,
`value`, `label`) 35, literal JSX text 8, message template body 4.

**128 of the rejections are whole files that cannot render anything** — 40 distinct
`.ts`/`.sql` files cited as surfaces, including `lib/derived.ts`, `lib/standing.ts`,
`lib/presentation.ts`, `lib/messaging-engine.ts`, `lib/status-labels.ts`, and eleven
`app/actions/*` server actions.

## Honesty about this number

The adjudication is mechanical, so I hand-checked it. A deterministic 42-item sample
spread across the largest surviving bucket (JSX interpolation, 248 rows) found **3 false
positives** — 7%:

- `components/admin/fee-calculator.tsx:42` — `: feePreview({ weeklyAmount, … });` is the
  else-branch of a declaration, not output.
- `components/member/past-cycle-card.tsx:77` — `{/* The closing balance, worded … */}` is a
  comment.
- `components/member/saved-card.tsx:67` — renders prose conditioned on a figure, but no
  figure.

The two small buckets are worse: of the 8 "literal JSX text" survivors, ~6 are object
literal properties in data assembly (`app/me/page.tsx:210` `status: w.status,`), and of
the 35 display attributes, ~5 are bare labels with no value (`label="Short"`).

> **Corrected estimate: ~265–270 genuine surfaces.** So **roughly 57% of Pass 1's surface
> citations are not surfaces**, ±3 points. The mechanical 295 is an upper bound.

**Parts A–C below use only claims I opened and read by hand** — the member portal files in
full, plus every render line quoted. The 295 figure measures the scale of Pass 1's
inflation; it does not carry any finding.

---

# PART A — CROSS-SURFACE AGREEMENT

Ranked by whether a **member** sees the disagreement.

## A1 — WEEKS BEHIND: three implementations, three surfaces, one member · MEMBER-VISIBLE

The headline, and it is worse than one pair — the quantity has three live implementations
and all three are rendered.

**Surface 1 — the member, and their peers.** `components/member/member-group-list.tsx:128`:

```tsx
{viewerOnTrack ? <CurrentPill /> : <BehindPill count={viewer.weeksBehind} />}
```

and for every other member, `:186`:

```tsx
{onTrack ? <CurrentPill /> : <BehindPill count={m.weeksBehind} />}
```

Fed from the SQL view — `app/actions/member.ts:449` `weeksBehind: viewer.weeks_behind,`
and `:457` for peers.

**Surface 2 — the organizer, member profile.**
`app/admin/(protected)/people/[id]/page.tsx:376`:

```tsx
value: `${standing.data.weeksBehind}`,
```

Fed from `computeStanding` (`lib/standing.ts:178`).

**Surface 3 — the organizer, command centre.** `app/admin/(protected)/page.tsx:283`:

```tsx
{m.weeksBehind} behind · {formatMoney(m.amountOwed)} owed
```

Fed from `memberAttention` (`lib/dashboard.ts:566`), which builds its own due-week set.

### Cause

**TypeScript counts a manually marked week as due immediately** —
`lib/derived.ts:113`:

```ts
if (args.markedLate && !args.isDeferred) return true;
```

**The SQL view has never been taught the mark.** Its only due test is the calendar, at
`prisma/migrations/20260806020000_member_progress_stored_date_elapsed/migration.sql:53`:

```sql
AND current_date >= (w.date::date + 5)
```

A grep for `markedLateAt` in that migration returns nothing.

**And `memberAttention` uses a third basis** — a cycle-wide high-water mark rather than each
week's own stored date (`lib/dashboard.ts:544-550`):

```ts
for (let n = participation.startWeek; n <= Math.min(input.elapsedThroughWeek, finishWeek); n++) {
  dueWeeks.add(n);
}
```

It also counts skipped weeks only from **existing payment rows** (`lib/dashboard.ts:564`
`const skippedCount = elapsedRows.filter((r) => r.isSkipped).length;`), where
`computeStanding` counts them from the week rows (`lib/standing.ts:176`). A member with no
payment row for a skipped week is counted as behind by one on the command centre and not
on their profile.

### A member state where they differ

Markos, weekly $500. The organizer marks week 13 late on Monday because Markos said it is
not coming; week 13's window has not closed.

- **Admin profile:** the mark makes week 13 count as due → **1 behind**.
- **`/me/group`:** `current_date >= date + 5` is false → **0 behind** → Markos and every
  peer see the **Current** pill.

The organizer is chasing a member whose own screen tells him, and everyone else, that he is
current.

**Never observed live.** Must be confirmed on real screens after the build.

## A2 — THE PER-WEEK FIGURE: coverage on the member's screen, the stored receipt on the organizer's · MEMBER-VISIBLE

**Member.** `components/member/week-stamp-list.tsx:254` and `:257`:

```tsx
{formatMoney(w.amountPaid)}
…
of {formatMoney(w.amountDue)}
```

`w.amountPaid` here is **not** the stored receipt. `app/actions/member.ts:377`:

```ts
amountPaid: w.coveredAtCurrentRate,
```

with the comment above it: *"A member must be able to read down their own list and see
$500, $500, $500 and trust the total."*

**Organizer.** The payments grid reads the stored figure — `lib/payments-view.ts:229`
`storedPaid: mw.storedPaid,`, rendered through `payments-members.tsx:44`:

```tsx
`, ${formatMoney(cell.storedPaid)} of ${formatMoney(cell.amountDue)}` +
```

Same week, same member: the member sees what their money **covers** at the current rate;
the organizer sees what was **recorded on the row**. Pass 2 names this its third root cause
and states the two can only separate on legacy imported rows today — *"Only legacy imported
rows can separate them today, but nothing pins the invariant"* — which is precisely the
point for Part B.

**Never observed live.** Requires a legacy imported row or a mid-cycle rate change.

## A3 — "AM I ON TRACK?" IS ANSWERED BY TWO DIFFERENT QUANTITIES · MEMBER-VISIBLE

This is not two implementations of one number. It is two **different numbers** answering
one question on two screens of the same portal.

**`/me`** renders a LATE COUNT — `components/member/member-personal-summary.tsx:170`:

```tsx
{lateCount} late
```

fed by `app/me/page.tsx:260` `lateCount={p.lateCount}` ← `app/actions/member.ts:300`:

```ts
const lateCount = standing.weeks.filter((w) => w.status === "LATE").length;
```

**`/me/group`** renders WEEKS BEHIND (A1 above).

These are different quantities. `lateCount` counts weeks whose status is LATE — which
excludes DEFERRED and, per the ladder, excludes a part-paid week whose window is still
open. `weeksBehind` is elapsed − skipped − credited, and **deferred weeks are not
subtracted** (`lib/derived.ts:146`; ground truth 2.14: *"Deferred weeks are NOT
subtracted — the money is still owed"*).

**Member state:** a member with two deferred, elapsed, unpaid weeks and nothing else wrong.
`/me` says **0 late**. `/me/group` says **2 behind**. Both are correct under their own
definition; the member has no way to know they are different questions.

### A correction to the brief

The task described this pair as *"/me shows weeksBehind from the TS derivation … while
/me/group shows it from the SQL view."* **`/me` does not render `weeksBehind`.** It is
carried in the payload (`app/actions/member.ts:299` `weeksBehind: standing.weeksBehind,`)
and never reaches a render line. Pass 2 found this first and recorded it — *"`/me` never
renders `weeksBehind`; it renders `lateCount` — row C2"* — and Part 0 confirms it at line
level: Pass 1's surfaces list cited `app/me/page.tsx:260` for "Weeks behind", and line 260
is `lateCount={p.lateCount}`.

The divergence is real. Its shape is definitional, not two copies of one formula, and that
makes it harder to fix, not easier.

## A4 — `/me/group` COUNTS STOPPED MEMBERS · MEMBER-VISIBLE

`components/member/member-group-list.tsx:102`:

```tsx
{currentCount}/{totalMembers}
```

fed by `app/actions/member.ts:455-456`:

```ts
totalMembers: all.length,
currentCount: all.filter((r) => r.weeks_behind === 0).length,
```

`all` is every row of the view. **The view filters neither participation status nor
breaks** — a grep for `status` and `participation_breaks` across
`…_member_progress_stored_date_elapsed/migration.sql` returns **0**, while
`prisma/schema.prisma:189` defines `status ParticipationStatus @default(ACTIVE)` and
`:275` maps the `participation_breaks` table.

So a member who stopped at week 12 stays in the group list, their `weeks_behind` keeps
growing every week they are away, and they sit in the denominator of "N of M current"
forever. TypeScript excludes those weeks (`lib/participation-close.ts`, `inMemberWindow`),
so the organizer's screens do not count them.

**Never observed live.** Needs a stopped participation in the current cycle.

## A5 — THIS-WEEK SHORT vs THE MEMBERS' OWN OUTSTANDING · ORGANIZER-ONLY

The known bug, stated here as a surface pair. `receiptsByWeek` accumulates `received` for
**every** participation before the window gate (`lib/dashboard.ts:248-252`), and
`shortfall` is a group subtraction with no per-member cap (`:264`). The per-member figures
beside it are capped correctly (`:257`).

Rendered as Short/received on `/admin/this-week`; the same members' individual outstanding
is rendered on `app/admin/(protected)/page.tsx:283` (`{formatMoney(m.amountOwed)} owed`)
and on each profile (`people/[id]/page.tsx:361`). One member out of window overpaying makes
the group figure disagree with the sum of the individual ones.

**Observed live** — this is the bug the organizer found by eye.

## A6 — THE CONFIRMATION MESSAGE vs THE GRID · MEMBER-VISIBLE (MESSAGE)

`lib/whatsapp-templates.ts:176` is a surface:

```
"Hi {{1}}, we received {{2}} for your Equb — recorded on your week(s) {{3}}. You have now paid {{4}} of your {{5}} weeks. Thank you."
```

`{{3}}` is `myWeeksCovered`, built from week numbers alone (`app/actions/payments.ts:332`),
so a week left part-paid is named as covered. The grid on the organizer's screen shows the
same week with money still owed (`payments-members.tsx:44`, quoted in A2).

**Observed live** — Markos.

## VERIFIED TO AGREE — recorded because a clean result is a result

**Weeks paid, `/me` vs `/me/group`.** I expected this to diverge with A1 and it does not.

- TS: `app/actions/member.ts:349` `weeksCredited: Math.min(standing.weeksCredited, participation.weeksCommitted)`,
  over `:254` `totalPaid: participation.payments.reduce((sum, p) => sum + p.amountPaid, 0)`.
- SQL: `least(floor(coalesce(paid.total, 0)::numeric / pt."weeklyAmount"), pt."weeksCommitted")::int`
  over `sum(p."amountPaid") … WHERE p."participationId" = pt.id`.

Same formula, same input, same cap. Rendered at `member-personal-summary.tsx:152` and
`member-group-list.tsx:124`. **They cannot differ.** The view's defect is confined to
`weeks_behind` and to its row population, not to `weeks_paid`.

---

# PART B — TEST COVERAGE OF THE FINDINGS

For each divergence: does a test assert the correct behaviour, or force the surfaces to
agree? **No tests were written.** This is the list the build writes against (2.24).

## B0 — The two shipped bugs: why 2430 tests passed

**The Short bug — `weekReceipts` has three dedicated tests and none can fail on it.**
`lib/dashboard.test.ts:87-112` asserts `shortfall` twice:

```ts
expect(week5.shortfall).toBe(0);
…
expect(week12.shortfall).toBe(50_000);
```

In every case the payers are **in window at the week under test** (`pay("a", 5, 25_000)`,
`pay("a", 12, 25_000)`). The defect needs a payer **outside** their window with money on
that week. No fixture in the file constructs one. Ground truth §5.1 — *"A FIXTURE THAT DOES
NOT RESEMBLE PRODUCTION HIDES THE BUG IT WAS WRITTEN TO CATCH"* — verbatim.

**The Markos bug — the test pins the defect as intended.** `lib/messages.test.ts:168`:

```ts
const text = renderMessage("PAYMENT_CONFIRMED", CURRENT_MEMBER, {
  amountReceived: 75_000,
  weeksCovered: [4, 5, 6],
});
…
expect(text).toContain("your week(s) 4–6 (Jun 7 – Jun 21)");
```

`weeksCovered` is hand-written as three whole weeks. The extras type has no field for a
remainder (`lib/messages.ts:152-155`), so the test **cannot** express a partial. §5.6 — *"A
TEST CAN PIN A BUG AS INTENDED BEHAVIOUR."*

**And the status half is untested in both directions.** `lib/manual-late.test.ts:102`:

```ts
it("a marked week with part of the money on it still reads LATE", () => {
  expect(paymentStatus({ ...base, amountPaid: 20_000, markedLate: true })).toBe("LATE");
  // …and without the mark it is the ordinary PARTIAL.
  expect(paymentStatus({ ...base, amountPaid: 20_000 })).toBe("PARTIAL");
});
```

`base` is an **open** week. No test anywhere constructs a part-paid week whose window has
**closed** — the exact Markos state. The ladder's answer there (`lib/derived.ts:196`
returning LATE before the money test at `:197`) is asserted by nothing.

> This one is not a gap to close blindly: it is the OPEN ruling in
> `docs/ONE_TRUTH_ENGINE.md` §3.3. The test to write depends on the ruling, and writing one
> now would pin an answer the organizer has not given.

## B1 — Missing reconciliation tests

| # | Test that should exist | Guards | Exists? |
|---|---|---|---|
| R1 | Sum of per-member `amountOutstanding` **=** `/admin/this-week` Short, over a fixture containing an **out-of-window overpayer** | A5 | **NO** |
| R2 | `memberAttention`'s `weeksBehind` **=** `computeStanding`'s, for the same member — including a skipped week with no payment row, and a marked-late open week | A1 | **NO** |
| R3 | The SQL view's `weeks_behind` **=** the TS `weeksBehind`, for a member with a marked-late open week | A1, C | **NO** — see C3 |
| R4 | The view's row set **=** the TS in-window population (stopped members and breaks excluded) | A4 | **NO** |
| R5 | `/me`'s per-week figure and the admin grid's cell agree, or the difference is asserted as intended with the rule quoted | A2 | **NO** |
| R6 | The confirmation message's claims **=** the allocation that produced it — a payment leaving a remainder can never render a week as covered | A6 | **NO** |
| R7 | The message **selected** = the event the engine named, over all five cases in `ONE_TRUTH_ENGINE.md` §3.7 | A6 | **NO** |
| R8 | `lateCount` and `weeksBehind` are named as different questions wherever both appear, or one is retired | A3 | **NO** |
| R9 | Sum of per-member truths **=** the cash position | §2 of the engine doc | **NO** |

## B2 — Missing correctness tests for Pass 2's WRONG rows

Pass 2 recorded **11 WRONG findings across 9 distinct labels** (6 headline, 4 visible, 1
footnote) in its Part B. Pass 2's own §5 records that **five RESOLVED defects are invisible
to the platform's own verification**, because the checking script carries its own copy of
the rule it checks:

- `scripts/audit-position-figures.mts:233` reproduces `lib/dashboard.ts:253`'s deferral drop
  by hand, so `npm run check:position` agrees by construction.
- `scripts/verify-member-privileges.mts:65` runs its own `$queryRawUnsafe` copy instead of
  selecting from `public.member_progress`, and prints PASS while comparing two copies of a
  rule **neither engine uses**.
- `lib/fee-preview.test.ts:99-112` models the member portal by re-splitting the weekly, so it
  passes precisely because it reproduces the defect it was written to catch.

**These are worse than missing tests.** A missing test is a known hole; a test that
reproduces the defect converts the hole into a green tick. Every one of them needs
rewriting to read the engine rather than re-implement it, and that work belongs in the
migration step that retires the duplicate (§5 step 3), not before it.

---

# PART C — THE SQL VIEW, EVIDENCED

**No decision is made here.** This is the evidence for the build ruling.

## C1 — What reads the view, and what reads TypeScript

`public.member_progress` has **exactly one application reader**:
`app/actions/member.ts` (`getGroupProgress`), which serves `/me/group` and nothing else.
Its two rendered surfaces are `member-group-list.tsx:124` (weeks paid), `:128`/`:186`
(weeks behind), and `:102` (the N-of-M current tile).

Non-application references: three migrations that define it, plus
`scripts/elapsed-rule-impact.mts` and `scripts/verify-member-privileges.mts`.

**Everything else in the platform — every admin screen, every message, and `/me` itself —
reads the TypeScript derivation.**

## C2 — Where the two currently differ

| Quantity | View | TypeScript | Differ? |
|---|---|---|---|
| `weeks_paid` | `least(floor(total / weekly), weeksCommitted)` | `Math.min(Math.floor(totalPaid / weeklyAmount), weeksCommitted)` | **No** — proven identical in Part A |
| `weeks_behind` | `elapsed − excused − floor(total/weekly)`, elapsed = `current_date >= date + 5` | `weeksElapsedInWindow − skipped − credited`, due includes `markedLate` (`derived.ts:113`) | **Yes** — the mark is invisible to SQL |
| Row population | every `participations` row in the cycle | in-window, break-aware, status-aware | **Yes** — stopped members included |
| Excused weeks | `count(*) FILTER (WHERE w."isSkipped")` | skipped counted from week rows | Agrees on the rule; differs on basis with `memberAttention` |
| Day boundary | `current_date` (DB server timezone) | UTC day (`utcDay`) | **Yes, at the boundary** — Pass 2 open ruling #7 |
| Window length | `+ 5` hardcoded in SQL | `PAYMENT_WINDOW_DAYS = 5` (`lib/derived.ts:13`) | Agrees today; **cannot follow a change** |

## C3 — Does any test assert the view matches TypeScript?

**No.** A search for `member_progress` across every `*.test.ts` and `*.test.tsx` in the
repository returns **zero results**. The view has no test of any kind — not equivalence,
not row population, not permissions.

The nearest thing is `scripts/verify-member-privileges.mts`, and Pass 2 established it does
not select from the view at all: it *"runs its own `$queryRawUnsafe` copy instead of
selecting from `public.member_progress`"* and prints PASS.

> So the 17-of-107 figure understates the exposure. It is not merely that a TypeScript
> change cannot reach the view — **nothing anywhere would report that it had not.**

## C4 — The three options, costed factually

**Retire the view; serve `/me/group` from the engine.**
Cost: `/me/group` currently reads through the caller's own Supabase session, so RLS gates
peers' rows in the database. Serving it from TypeScript moves that boundary into
application code, which must then enforce 2.8's privacy rule itself. One reader to migrate;
three migrations' worth of SQL to drop. Removes the divergence class permanently.

**Regenerate the view from the engine.**
Cost: requires the engine's rules to be expressible in SQL, including `markedLateAt`,
breaks, and status. Keeps RLS where it is. Creates a second artefact that must be
regenerated whenever a rule changes, and the regeneration itself needs a test — which is
the thing that has never existed.

**Keep it as a proven mirror.**
Cost: cheapest to build, and requires the equivalence test suite that does not exist today
(R3, R4) plus a guard that fails when a TypeScript rule changes without the SQL following.
Note that `PAYMENT_WINDOW_DAYS` is already a constant on one side and a literal `5` on the
other, and nothing connects them.

**A fact bearing on all three:** the view's only divergent quantity, `weeks_behind`, is
rendered **only** on `/me/group`. `weeks_paid` is proven identical. So the blast radius of
the view today is one number on one screen — plus the row population, which affects the
N-of-M tile on that same screen.

---

# WHAT PASS 3 COULD NOT DO

**No divergence in Part A has been observed on a live screen.** A5 and A6 were observed by
the organizer; A1, A2, A3 and A4 are proven from source with constructed member states and
are **unconfirmed against production data**. Confirming them is the post-build verification
task in `docs/ONE_TRUTH_ENGINE.md` §6 — the Playwright / agent-browser run that currently
wedges on admin sign-in.

**Part 0's 295 is an upper bound**, corrected to ~265–270 by hand-sampling. A per-claim
adjudication of all 622 to publishable standard was not done; the findings in Parts A–C
rest only on lines I opened and quoted.

**Pass 2's WRONG rows were not individually re-tested for coverage.** B2 records the
structural finding (five verifications that reproduce the rule they check) and the count;
mapping each of the 11 WRONG findings to a specific missing test is work the build should do
as it migrates each surface, when the correct behaviour is settled.

---

*Pass 3 ends here. The map is complete: Pass 1 catalogued, Pass 2 judged, Pass 3 checked
agreement and coverage. Sequencing belongs to `docs/ONE_TRUTH_ENGINE.md` §5.*
