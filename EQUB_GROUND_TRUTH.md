# EQUB GROUND TRUTH

**The single source of truth for the platform.**
Read this first, every session, before touching anything.

| | |
|---|---|
| **Owner** | Firaoli ("Oli") Seboka — sole organizer and admin |
| **Status** | Built and audited. Pre-deploy. |
| **Live cycle** | Cycle 1 2026 — 20 weeks from 17 May 2026, 27 members, past week 12. Imported and verified to the cent. |
| **Horizon** | 2–3+ more years. Build for the long run, not for one cycle. |
| **Version** | v12 — August 2026 |

---

## 0. WHY THIS DOCUMENT EXISTS

The first build grew as a pile of features with no organizing brain. Decisions lived in
chat history, nothing was written down, the data model accumulated scars, and the app
hardcoded one specific cycle. It worked, but it could only be pushed — never driven.

This document ends that. Every principle and decision lives here. It is law. If code and
this document disagree, **this document is right and the code is wrong.**

**Working doctrine:** bold on architecture, careful on data. We rebuild the structure
without mercy. We do not lose a single recorded payment, payout, or member.

---

## 1. WHAT THIS IS

**This is a financial platform for the organizer. Equb is its first module — not the
whole product.**

An Equb is an Ethiopian rotating savings group: members contribute weekly, one member
receives the pot each week, everyone receives exactly once per cycle. It runs on trust,
and the organizer carries the risk.

**The organizer's real job is not collecting money. It is managing risk, trust, and the
financial position of the group.** The software exists to support that judgment and
present the truth clearly — not to replace the judgment.

Architecture must therefore be **modular**: Equb is one module. Other financial modules
may follow. Nothing may be built assuming Equb is the only thing here.

### 1.1 THIS IS ALSO THE TEST GROUND FOR NEXO ACCESS

Equb is deliberately the **proving ground and research method** for the larger Nexo
Access platform — in particular the two apps coming there (member app and driver app).

- What works here gets **promoted** to Nexo.
- What fails here is **avoided** there.

That makes this serious R&D, not a hobby project. Every pattern, tool, and design
decision is evaluated twice: does it serve Equb, and would it survive being carried into
Nexo? Cost is not the deciding factor — proven value is.

---

## 2. CORE PRINCIPLES (LAW)

### 2.1 THE PRESENTATION LAYER — "WHERE AM I, RIGHT NOW"

The organizer logs in and the complete state of his financial world is **in front of
him**, without hunting, clicking, or searching. Not a chatbot — a display that answers
everything at a glance:

- Where are we? Which cycle, which week, how far along
- What was supposed to be collected? What actually came in?
- What has gone out? To whom? How much?
- What is outstanding — who owes, who is late, who is deferred?
- **The cash position:** collected vs disbursed, and the gap between them

**The defining example:** *"We are in week 7, but only 5 people have been paid out. The
group is holding 2 weeks' worth of money that has not gone out yet."* The system must
show that surplus explicitly and continuously, without being asked.

This presentation layer is the primary admin surface. **The wheel is a tool inside the
platform — it is not the dashboard.**

### 2.2 ORGANIZER DISCRETION IS A FEATURE, NOT A HACK

The organizer decides who receives the payout each week. This is legitimate, standard
Equb practice, and it is why six years have run without loss.

**The risk curve — the actual logic:**

| Cycle stage | Risk if an unproven member wins | Organizer behavior |
|---|---|---|
| **Early weeks** | HIGH — they take the full pot and still owe most of the cycle. If their finances break, the group absorbs it. | Steer toward trusted, proven, financially stable members. |
| **Around halfway** | FALLING — months of proven reliability, fewer weeks owed. | Steering relaxes. |
| **Late weeks** | LOW — they owe only a few weeks and are deeply invested. | **No steering. Whoever the wheel picks, wins.** |

Risk management, not favoritism. The tool must make it effortless and invisible.

### 2.3 WINNER SELECTION IS A PLANNING TOOL, AND THE PLAN IS LOCKED

Selecting who wins is **not a switch — it is planning**. When the organizer designates
numbers, the system must offer real configuration:

- **Together or separate** — do these numbers win in the SAME week, or different weeks?
- **Which week** — assign each selection to a specific week, planning several weeks ahead.

Once configured, **the plan is locked and protected from the system's own automation:**

- Auto-arrange and reshuffle must **never separate** numbers the organizer grouped together.
- Auto-arrange and reshuffle must **never re-pair** a number that is committed to a week.
- Committed numbers are treated exactly like already-drawn numbers: excluded from the
  shuffle pool, their slot frozen.

**The principle underneath:** the Brain must know **intent**, not only **state**. The
system already knows what *has happened* (drawn numbers). It must equally know what is
*intended to happen* (committed selections) and defend that intent.

**Known defect this fixes (verified in code):** `handleReshuffleAll` filters drawn
numbers from the pool but has no awareness of committed selections. It can silently
re-pair a selected number with someone unintended — the exact failure that occurred
twice in practice.

### 2.4 ZOOM SAFETY — THE WHEEL SCREEN IS CLEAN BY DEFAULT

Draws happen live on Zoom with the organizer screen-sharing. The design rule:

- **The winner is configured BEFOREHAND, in settings — a separate place entirely.**
- **On the wheel screen there is nothing but the wheel.** No gear icon, no hidden panel,
  no control to click, nothing that could be mis-clicked or noticed. The organizer opens
  it and spins. That is all that exists there.
- **Configurable visibility:** before screen-sharing, the organizer can set what is
  visible and what is hidden across the app — payment details, member information,
  amounts — so nothing sensitive appears by accident.
- Selection logic and data live server-side and must never reach the browser.

**Rejected design:** a hidden control on the wheel page itself (gear + passphrase). Any
control living on the shared screen is a liability, however well hidden.

### 2.5 PEOPLE ARE PERMANENT — PARTICIPATION IS PER-CYCLE

Members are real people the organizer knows, not rows belonging to one cycle.

| Permanent (the person, forever) | Per-cycle (chosen fresh) |
|---|---|
| Amharic name | Weekly contribution amount |
| English name (first / last) | Lucky / wheel number |
| Phone number | Whether they are in this cycle at all |
| History across all cycles | Their draw outcome and payout |

**The Member Directory** persists across all cycles. Starting a new cycle means picking
people from the directory — *"Add Tizita to this cycle?"* — never re-typing anyone. A
person may sit out cycles 1–3 and join cycle 4; the directory remembers them.

Contribution changes between cycles because income changes. Normal and expected.

### 2.6 EVERYTHING CONFIGURABLE — NOTHING HARDCODED

Starting a new cycle asks: start date, number of weeks, which people from the directory,
and each participant's own contribution (they are **not** equal). Weeks and dates
generate automatically. Member count is independent of week count. Fee rules and
contribution tiers are configuration, not code.

### 2.7 PLANNED LENGTH vs ACTUAL LENGTH — TRACK BOTH

A cycle is *planned* as 20 weeks. Reality may take 22 — someone joins late, a week is
skipped, life happens. The system must:

- **Respect the plan:** 20 weeks was the commitment, and the organizer keeps control of it
- **Track the truth:** if it is actually running longer, show the real week
- **Calculate per member:** for anyone joining at any point, compute what they owe and
  when *they* finish — regardless of when the cycle started
- **Keep the record** of what actually happened, in the archive

Mid-cycle joins must never break the math or anyone else's standing.

### 2.8 PRIVACY BOUNDARY (SETTLED)

**Shared between members** — payment progress, for accountability and the social nature
of an Equb. Members see who is keeping up.

**Never shared between members** — contribution amounts, lucky numbers, payout amounts,
phone numbers, PINs, who won which draw (numbers only, never names).

The social layer stays. Equb is friends doing this together; minimal friendly visibility
is part of the point.

### 2.9 CLEAN DELETE, READABLE ARCHIVE

Ending a cycle means **wipe it clean** to start fresh — not soft-delete, not lingering
state. But **before** wiping, the archive produces a readable record: who paid what, who
was paid out, how much, when — human-readable, not a raw JSON blob. Past cycles remain
viewable.

### 2.10 SAVE FEEDBACK MUST BE UNMISTAKABLE

Every action gives a clear result — obvious confirmation on success, visible reason on
failure. Never leave doubt about whether something saved.

### 2.11 MESSAGING IS STATE-AWARE AND CONFIGURABLE

One **Send** action. The system chooses the right message for each member from their
actual state and fills it with real data:

| Member state | Message content |
|---|---|
| Paid | "You paid week N. You have paid X of Y. Z weeks left." |
| Behind | "You are behind by N weeks." — a record, never a threat |
| Late (window closed) | "Week N was not paid." — documented, no pressure |
| Selected to receive | "You receive this week. Amount, and what remains." |

**All templates are configurable by the organizer** — wording, tone, and the data fields
included. The organizer edits them; they are never hardcoded.

**Delivery:** build on what actually works today (Telegram is live and working). Do not
block the product waiting on WhatsApp/Meta or carrier approval. Additional channels are
added when and if approval arrives.

### 2.14 MONEY IS THE TRUTH — EVERYTHING ELSE IS DERIVED

The system stores **what actually happened**, and calculates everything else. Nothing
that can be computed is ever stored, because stored values drift and computed values
cannot.

**Stored:** the money received (amount, date, method), and the organizer's own two
decisions about a week — `deferred` (excuse the chase; the money is still owed) and the
**manual late mark** (`markedLateAt` with an optional note, added 12 Aug 2026 — §2.29).
A decision is not computable, so storing one breaks no rule here; everything that CAN be
computed still is. One further stored figure is named in §2.30: once a payout exists, the
fee it actually charged is kept on that payout as historical fact.

**Derived — never stored:**

| Derived value | How |
|---|---|
| Weeks credited | total money paid ÷ current weekly amount |
| Weeks behind | weeks elapsed in their window − weeks credited |
| Status (paid / partial / not paid) | from the amount against the weekly amount |
| Late | unpaid **and** either the window has closed **or** the organizer marked it late himself (§2.29). Deferral outranks both. |
| Current week | cycle start date + today — never hardcoded, never stored |
| Finish week | their start week + weeks committed |
| Fee (projected) | the cycle's fee percent × gross, where gross is **weekly amount × weeks COMMITTED** — never weeks paid (§2.30). 2% today, but read from the cycle, never a constant. |
| Fee (once drawn) | **stored**, not derived — `Payout.feeAmount` records what was actually charged, and is read in preference to the projection (§2.30) |
| Payout | gross − fee, **per lucky number** |

**Why this matters — it removes every special case:**

- **Rate change mid-cycle:** someone paid 6 weeks at $250 ($1,500) and moves to $500 →
  $1,500 ÷ $500 = 3 weeks credited → they are now 3 weeks behind. Automatic.
- **Uneven amounts:** $450/week and $1,000 arrives → 2 full weeks ($900) + $100 partial
  on the third. Pure arithmetic.
- **No "mark late" job:** a week becomes late when its window passes. Nothing to run,
  nothing to forget.
  **Amended 12 Aug 2026 (D-40).** Still true of the calendar route, and there is still no
  job to run — but the calendar is no longer the *only* thing that can say "late". The
  organizer may mark a week himself before the window closes; §2.29 is the rule. The
  sentence above stays because the principle it defends is intact: nothing becomes late
  because a nightly task said so.

### 2.15 PAYMENT ALLOCATION — OLDEST DEBT FIRST, THEN FORWARD

Money is never assigned to a week by hand. The organizer enters the amount received;
the system allocates it and **shows the allocation before it is committed**:

1. **Oldest unpaid weeks first**, waterfalling forward.
2. Once caught up, the **current week**.
3. Any surplus rolls into **future weeks** (paying ahead is normal and expected).
4. A leftover too small for a full week is recorded as **partial** on the next week.

Rationale from practice: a member four weeks behind who sends money is paying down the
oldest debt — never the current week. The old grid forced the organizer to decide the
week manually, which is both slow and error-prone.

**The grid stays.** It is genuinely good at showing everyone at once and spotting
patterns (streaks of red, people paid ahead). Its failure was being the *recording*
tool as well. Two jobs, two tools: the grid is the map, payment entry is the action.

### 2.16 REMOVED BY REAL-WORLD EVIDENCE

- **Request Review** — built, shipped, used by nobody. Members contact the organizer
  directly. Removed.
- **"Unpaid" vs "Late" as separate stored statuses** — collapsed. Late is derived.

Rule: features with no real use are liabilities. Remove them.

### 2.17 BUILD INCREMENTALLY, EXCEPT BELOW THE LINE

Fix issues as they surface; do not try to perfect everything at once. **The exception:**
structural decisions — the data model and the money principles — must be right before
building, because everything sits on them and they are expensive to change later.
Everything above that line (screens, polish, features) is fixed as it comes up.

### 2.18 THE CARRIED BALANCE — PEOPLE, NOT CYCLES, OWE

Real life interrupts. A member may stop paying because of a death in the family, a job
loss, a move. **The organizer absorbs the gap so no other member is ever short.** That is
his responsibility and it is not negotiable. The software's job is to **remember, never
to enforce**.

**The balance belongs to the person and survives cycle deletion.** People are permanent
(2.5); so is what they carry.

**A balance is created two ways:**
1. **Early close (manual)** — the organizer knows at week 12 that someone will not
   continue. He marks them as no longer contributing in their profile; the system
   calculates the remaining weeks at their rate and closes their participation.
2. **Automatic at cycle end** — if nothing is done, at the final week the system computes
   every member's balance itself. Paid in full → $0. Behind → the amount.

**Rules:**
- **Unpaid means owed.** A week stops being owed only when it is marked paid. Nothing
  else clears it.
- **Winning while owing NEVER auto-deducts.** If someone wins $20,000 while owing $5,000,
  the organizer may still hand over the full $20,000. The system shows the balance and
  *offers* to deduct. The decision is human, always.
- **Paying a balance does not require being in a cycle.** Someone may settle two years
  later while participating in nothing. Recorded on the profile; balance drops.
- **Closed members stay visible** — not removed from the cycle. They keep access to their
  own record and can see where they stopped. Dignity, and a useful record for them.
- **The record of where they stopped is preserved** in the archive — last payment week,
  amount, and the resulting balance.

**Stored as a LEDGER, not a single number.** Each entry records its origin ("Cycle 1,
2026 — 8 weeks unpaid, $2,000") and each payment against it ("paid $1,000, March 2027"),
with a running total. Two years later the organizer needs to know *why* a balance exists,
not only that it does. A bare number loses the story; the ledger keeps it.

**Closing statement for every member at cycle end** — factual, no pressure, same tone as
the late messages:
- "You completed all 20 weeks. Balance $0."
- "You paid 12 of 20. Last payment week 12. Outstanding $2,000."

### 2.19 ONE ALLOCATION ENGINE, TWO ENTRY POINTS

Money can be recorded from the **week view** (during the cycle) or from the **member
profile** (any time). Both run the identical oldest-first allocation (2.15). The profile
is not a second system — it is the same engine reached from the person rather than the
week.

**While the cycle is open** — allocation lands on weeks.
Example: last paid week 7, $250/week → profile shows $1,250 behind. Enter $750 → clears
weeks 8, 9, 10. Enter $650 → clears weeks 8 and 9, leaves $150 partial on week 10.

**After the cycle closes** — the weeks are final, so money recorded on the profile
reduces the **ledger balance** instead. Same entry, same math, different target.

**The profile balance is derived, never typed.** If weeks are marked normally, the profile
shows $0 by itself. The organizer must never count weeks by hand to learn what someone
owes.

### 2.20 MESSAGING CONTROL — AUTOMATIC ON ACTION, MANUAL FOR JUDGEMENT

**Automatic:** confirmation when the organizer marks a payment. It is the direct result
of an action already taken, so it never needs a separate click.

**Manual — the organizer presses send:** late notices, behind reminders, winner
announcements, closing statements. These are *decisions*, not events. Someone dealing
with a death in the family must never receive an automatic "you are late" text.

**Always:**
- **Preview before send** — the real rendered message with real numbers, before anything
  leaves.
- **Per-person override** — uncheck anyone in a batch; mark a person "no messages"
  (hardship) to exclude them everywhere.
- **Editable templates** — wording, tone, and which facts appear.

**Principle:** the system never speaks to a member without the organizer knowing exactly
what it said. In a group that runs on friendship, a message with the wrong tone costs
more than it saves.

### 2.21 MESSAGES ARE STATEMENTS, NOT NOTIFICATIONS

A message must carry the true, derived state — not a bare label. Not "you are late," but:

> "Your last payment was week 5. You are 7 weeks behind, $1,750 outstanding."

Everything in it is derived at send time from the money-is-truth rules (2.14): last
payment week, weeks behind, amount owed, weeks remaining. Nothing stored, nothing stale.

**A notification nags. A statement informs.** These inform.

**Imported history never triggers messages.** Only live actions do. Back-filled weeks are
silent.

**Equb is outbound only.** Inbound/reply handling is out of scope here.

---

**NOTE FOR NEXO ACCESS (not Equb):** inbound SMS is genuinely valuable there — a member
texting "READY" for a will-call trip could create the return leg and push it to dispatch
automatically, replacing a phone call. Nexo already has Twilio and A2P in progress, so it
is feasible there. Recorded so the idea is not lost; not built here.

### 2.22 COMMITMENT IS CAPPED TO THE CYCLE — OVERRIDE IS DELIBERATE

When someone joins after the cycle has started, their commitment is **capped by default
so they finish with everyone else**.

- Join at week 15 of a 20-week cycle → the maximum offered is 6 weeks. The system does
  not allow more by accident.
- **The organizer may override manually** and extend someone past the planned end. Only
  then are the extra weeks generated, and the cycle runs longer than planned (2.7).

**Every member sees their own finish date**, always. It differs from person to person and
that is normal — someone joining week 12 for 6 weeks finishes at week 17, three weeks
before the group. Their portal shows *their* window, never the group's.

**Why capped by default:** the common case (join late, finish with the group) becomes
automatic and impossible to get wrong; the rare case (deliberate extension) stays
possible but requires an explicit decision. The system should make the ordinary path
safe and the unusual path conscious.

### 2.23 FULL ORGANIZER CONTROL — NOTHING REQUIRES A DEVELOPER

Anything the organizer can create, he can **edit and remove** from the UI. No correction
may ever require a developer, a script, or raw SQL.

This applies to every entity: people, participations, contributions, lucky numbers,
weeks, payments, payment events, draws, payouts, cycles, slots, winner plans, message
templates, and settings.

**Control does not mean fragility.** Every destructive or corrective action must have:
- a **confirmation** stating plainly what will happen and what it affects
- an **audit trail** recording what changed, from what to what, and when
- **derived figures recalculated immediately**, so a correction never leaves stale numbers

**Why:** real life produces mistakes — a payment recorded on the wrong week, a wrong
amount, a member added twice, a draw entered against the wrong week. The organizer must
be able to fix his own data at the moment he notices, not wait for someone else.

### 2.24 TESTS ACCOMPANY EVERY IMPORTANT CHANGE

Anything that touches **money, allocation, derived state, or data integrity** ships with
tests in the same build. Not later, not "when there's time."

**Always tested:** allocation, fee and payout math, derived state (weeks credited,
behind, status, late), the commitment cap, import and reconciliation, edit operations
that recalculate money, and constraint enforcement.

**Not required:** cosmetic UI, layout, copy.

**Two levels:**
- **Unit tests** for pure logic — fast, exhaustive, run on every change.
- **Behavioural verification against the live database** for schema constraints and
  transactional writes — attempt the defect, confirm the database refuses it, clean up.
  This has already caught real bugs that unit tests could not.

**Rule:** a build that changes money behaviour is not finished until its tests pass and
are shown.

### 2.25 UI DESIGN COMES AFTER THE LOGIC IS PROVEN

Screens are built plain and functional first. Design is a deliberate later pass, done
once, across the whole platform — not while the logic underneath is still moving.

Hard-to-read text and unstyled forms during the build era are expected and are not
defects. They are the cost of not redesigning the same screen five times.

**The design pass happens when the feature set is settled**, using the sanctioned design
sources (2.13) and the member-portal design system already proven in the previous build.

### 2.26 CI/CD AT DEPLOY TIME, NOT BEFORE

Continuous integration and deployment are set up when the platform is ready to deploy —
not during the build era. Running the test suite locally is sufficient while nothing is
live.

**At deploy time, CI must gate:** typecheck, the full test suite, and a successful build,
before anything reaches production.

### 2.27 LUCKY NUMBERS LEAVE THE POOL AUTOMATICALLY — WITH A WARNING FIRST

A lucky number is drawable only while its owner's participation window is open. It
leaves the pool two ways:

1. **It is drawn** — normal. Removed immediately.
2. **The window ends** — removed automatically. Their participation is complete.

**Mandatory safeguard:** if a member's window is approaching its end and they have **not
yet been drawn**, the system must WARN the organizer in advance — clearly and on the
dashboard — e.g. *"Meheret's window ends in 2 weeks and she has not been drawn."*

**Why the warning is not optional:** everyone in an Equb receives exactly once. A member
whose window closes undrawn has paid in and received nothing. Because the organizer
controls the draw order (2.2), the system must actively protect against him running out
of weeks for someone. Silent automatic removal without the warning would let a real
person be quietly missed.

Members who finish early (2.22) are the common case for this — their window closes before
the group's, so their draw must happen sooner.

### 2.28 MESSAGING CHANNELS — SETTLED

**WhatsApp Business is the channel for per-member messaging.** Already approved and
already working.

| Channel | Status | Use |
|---|---|---|
| **WhatsApp Business** | **LIVE** — business verified with Meta, sender **+13016835755** (WABA 1018506704190290), display name "Equb". Login codes through Twilio Verify; statements through the live template set: **behind_notice_v3, late_notice_v3, winner_announcement_v3 (approved 14 Aug 2026)** + payment_confirmed_v2, whatsapp_welcome, group_announcement (13 Aug) + the unchanged cycle_closing_statement (7 Aug). Every v1/v2 predecessor is deleted from Twilio. | **Per-member messages** — confirmations, behind/late notices, winner announcements, the welcome that arms the agreement gate, per-member broadcasts, closing statements |
| **Telegram group** | Working | Weekly group broadcast only — one bot, one chat, one message to everyone |
| **US SMS** | **REJECTED — do not pursue** | none |

> **Sender history** — kept so the old number does not resurface as "settled":
> the first approval was on +15559620327 via Healthway Transport LLC. Twilio
> support's finding was that a **555-prefix number is unsupported for WhatsApp
> Business** — that is why it changed, not a preference. The platform moved to
> +13016835755 under its own business-verified WABA (12 Aug 2026), and the five
> approved templates carried over. Test fixtures use the live number.

**Statements speak the member's own weeks with dates, never the group calendar**
(principle, 13 Aug 2026): every template pairs the MEMBER'S own week numbers —
week 1 is their first week — with the stored dates. The composer is
`lib/member-week-dates.ts`, and `lib/member-vocabulary.test.ts` fails the build
on any template body that frames a slot as a cycle week.

**The v3 standing rules for ALL member-facing text** (organizer rulings,
14 Aug 2026, from one day of v2 live use): **no dashes** — em or en — in fixed
template text (guarded in `lib/whatsapp-templates.test.ts`; payment_confirmed_v2
and whatsapp_welcome are Meta-frozen exemptions until resubmitted, and the
exemption list may only shrink); **maximally simple** ("stupid-proof")
sentences; **weeks are the member's counting language with dates in brackets as
reference**; **repetition of facts is good** — the paid-up-to and current-week
anchors repeat across notices on purpose. A never-paid member's paid-up-to
composes as "the start (Sunday, May 17)", their own start date — always
composable, superseding the v2 "—" sentinel. The winner's {{5}} is PAYMENTS
LEFT (committed minus paid, the count owed), never calendar weeks remaining.

**Why SMS is closed:** since February 2025 all major US carriers block unregistered A2P
traffic from 10-digit numbers outright — no filtering, no delay, simply undelivered. The
gate is **The Campaign Registry (TCR)**, which sits underneath *every* provider, so
switching from Twilio to another vendor does not change the outcome. Registration was
rejected even with a privacy page and terms in place. **Do not re-propose SMS providers.**

**Why WhatsApp works:** Meta is a different approving authority than TCR, and approval was
already granted. Utility templates ("You paid week 12. You have paid 8 of 20. 12 weeks
left.") are exactly the category Meta routinely approves. Members are already on WhatsApp,
so nothing is asked of them — no bot to start, no new app, no setup for non-technical
members.

**Constraints to design around:** messages outside a 24-hour window from the member's last
reply must use a Meta-approved template. Templates are drafted, submitted, and reused —
build the messaging system so template content is configurable (2.20) and each message
type maps to an approved template.

**Login page rule:** the sign-in screen must only offer channels that actually work. Do
not present an option that dead-ends.

### 2.29 THE MANUAL LATE MARK — HIS OWN, AND DEFERRAL OUTRANKS IT

**Ruling, 12 August 2026. Amends §2.14 and D-16 — recorded as D-40.**

LATE has two routes. The calendar closes a payment window and the week reads late by
itself; that is the original rule and it still stands. The second route is the organizer:
he may mark a week late **by hand, before the window closes**, because he knows things
the calendar does not (2.2). A member says on Monday that this week is not coming, and
the calendar makes him wait until Thursday to record a fact he already has.

**It is a STORED decision, deliberately.** §2.14 says nothing computable is ever stored,
and this does not breach it: a decision is not computable. What is stored is a
**timestamp, not a flag** — `markedLateAt`, with an optional `markedLateNote` — so the
record says *when* he decided. This is a financial record.

**Money still wins.** A week that gets paid reads PAID whatever the mark says, and the
payment path clears the mark on any week the money fully covers. Marking a week that is
already paid in full is refused outright: *"Money is the truth — there is nothing to mark
late."*

**DEFERRAL OUTRANKS THE MARK.** This is the ruling, not an accident of ordering.
Deferral exists to stop a chase reaching someone he has decided not to pursue; a mark on
a deferred week would have the platform asserting *chase them* and *do not chase them*
about one week, and whichever won, one of his own decisions would be discarded in
silence. So the mark does not apply to a deferred week at all — **across all five
effects**, the same five `docs/DOMAIN_RULES.md` §5 lists:

| # | Effect | What deferral does to the mark |
|---|---|---|
| 1 | **Status** | The week reads `DEFERRED`, never `LATE`. |
| 2 | **Arithmetic** | A mark cannot pull a not-yet-due deferred week forward, and the attention list applies the same test — so the list and the standing derivation cannot disagree. An *elapsed* deferred week still counts as owed: deferral has never excused the money. |
| 3 | **Messages** | The week never enters the late-week list, so no chasing statement can name it. The chasing gate reads only the derived status; it never looks at the mark. |
| 4 | **The control** | Disabled, with the reason on screen: *"This week is deferred — remove the deferral first if you want to chase it."* Disabled rather than hidden, because a control that vanishes leaves him hunting for something he used yesterday. Refused **server-side** too — a stale page is exactly the caller that would send it. |
| 5 | **Clearing** | **Deferring a week clears an existing mark**, so removing the deferral months later cannot spring a forgotten mark back. |

Deferral is tested **before** "this week is already late", because a deferred week whose
window has closed is not late at all; saying otherwise would be false as well as
unhelpful.

**Reversible.** Unmarking is the same action inverted, and it is allowed even on a
deferred week, so a mark that got stranded can always be lifted by hand. Every set and
every clear is audited, with the note, before and after.

**Two implementation gaps are open against this rule** — §6.4. The rule above is the law;
the code does not yet meet it in two places, and neither is a reason to soften it.

### 2.30 THE FEE IS FIXED BY THE COMMITMENT, NOT BY ATTENDANCE

**Ruling, August 2026 — a correction to what was built first. Recorded as D-41.**

The fee is the organizer's charge for **running the member's place in the cycle**. The
place was held for them whether or not the wheel ever reached them, so the fee follows
what they COMMITTED to, not how much of it they attended:

> gross = weekly amount × weeks **committed**  ·  fee = the cycle's fee percent × gross

- Join for 20 weeks at $500 → payout $10,000, fee **$200**.
- **Stop at week 12 → the fee is still $200.** Stopping never shrinks it.
- Change the **terms** and the fee moves with them: 20 weeks at $250 is a $5,000 gross
  and a $100 fee. **Either** term moves it — the rate or the number of weeks.

**Per lucky number, never once on the pot.** Each number is its own payout of its own
amount over its owner's committed weeks, and each pays its own fee — two numbers, two
payouts, two fees. The arithmetic happens to agree with one combined payout; the *record*
does not, and the record is what the archive keeps.

**Derived until it is real, then stored.** No fee is stored on a participation: every
projected fee is computed at read time from the current commitment, so a terms change
moves it everywhere at once — and when money has already gone out under the old terms the
organizer is stopped and made to settle the difference rather than allowed to save past
it. **Once a payout exists, the fee it charged is stored on that payout and is read in
preference to the projection.** That is the design, not a lapse: a later change to the
cycle's fee percent must never silently rewrite a payout that already happened. It can be
corrected by hand, and the correction is audited.

**What is recoverable is floored at what they paid in.** For a member who stopped
undrawn, the money returned is `paid in − fee`, never below zero. Someone who paid $50
against a commitment carrying a $400 fee is reported as **settled**, not as owing $350:
the fee is not reduced, it is simply not pursued into a debt. Whether to chase the
remainder is the organizer's call, and the platform does not make it for him. In the
other direction — a member who took the pot and stopped short — no fee is charged again,
because it was already withheld from the payout they received.

**THE SIGNED AGREEMENT SAYS THE SAME THING.** Section 4 of the member agreement, which
every member signs, reads verbatim:

> **4. The management fee**
> The fee is {feeAmount}, which is {feePercent} of what I am entitled to. It is fixed by
> what I committed to, not by how many weeks I end up paying. If I stop early the fee
> does not shrink. It changes only if my weekly amount changes.

The member's copy is filled from the same arithmetic the organizer's screens use, so the
document cannot quote a fee that differs from his by a cent, and three of those four
sentences are pinned by test.

**The one divergence, recorded rather than hidden:** §4's last sentence says the fee
changes *only* if the weekly amount changes. The platform also moves it when the **weeks
committed** change, because both are factors of the same gross. Members who stop early
are unaffected — stopping is not a terms change, and that is the sentence's real subject —
but the wording is narrower than the behaviour. Closing it means either constraining the
code or re-wording §4, and re-wording is a **re-signing event** for everyone who has
already signed, so it is the organizer's decision (§6.4).

### 2.12 BUILD PROPERLY, AND TEACH

No shortcuts. Real research before technology decisions, tradeoffs explained so the
organizer learns *why*, not just *what*. Every significant decision gets its own
discussion and is recorded here.

### 2.13 DESIGN REFERENCE — MOBBIN MCP IS THE SANCTIONED SOURCE

Design direction is sourced from **real, shipped products** — not invented from scratch
and not guessed at from vague preference.

**Mobbin MCP** (official, ~600k real app screens) is the sanctioned tool. It connects
directly to Claude so references are pulled with the context of the actual codebase,
rather than pasted screenshots.

Connect in **both** places when the design phase begins:
- **Claude Code** — `claude mcp add mobbin --scope user --transport http https://api.mobbin.com/mcp`,
  then `/mcp` → select mobbin → Authenticate. This is the higher-value one: it can read
  the real codebase and design tokens while pulling references.
- **Claude Desktop / Web** — Customize → Connectors → Add → Browse connectors → Mobbin.
  Used for design discussion and choosing direction before implementation.

Requires a paid Mobbin plan. **Workflow:** design direction is chosen in discussion here,
then Claude Code implements it. Connect at the design phase, not before.

---

## 3. DECISIONS RECORD

| # | Decision | Status |
|---|---|---|
| D-1 | Rebuild as a configurable multi-cycle **platform**, Equb as first module | **SETTLED** |
| D-2 | Existing live data migrates intact — never destroyed | **SETTLED** |
| D-3 | Member Directory: identity permanent, participation per-cycle | **SETTLED** |
| D-4 | Organizer discretion is a first-class feature | **SETTLED** |
| D-5 | Zoom safety: winner configured beforehand in settings; wheel screen clean, no controls | **SETTLED** |
| D-6 | Configurable visibility controls for screen-sharing | **SETTLED (concept) — design pending** |
| D-7 | Planned vs actual cycle length both tracked | **SETTLED** |
| D-8 | Privacy boundary: progress shared; amounts, numbers, payouts private | **SETTLED** |
| D-9 | Winner selection is a planning tool (together/separate + which week); plan locked against reshuffle | **SETTLED** |
| D-10 | Messaging is state-aware with organizer-configurable templates; build on Telegram now, don't wait for Meta | **SETTLED** |
| D-11 | Equb is the test ground for Nexo Access (member + driver apps) | **SETTLED** |
| D-12 | Mobbin MCP is the sanctioned design-reference source; connect at design phase | **SETTLED** |
| D-13 | **Database: relational Postgres via hosted supabase.com (free tier), separate project from Nexo. Auth + RLS included. Idle-gap handled by a keep-alive scheduler + automated gap backups.** Reasoning: data is deeply relational; money needs ACID; queries must stay ad-hoc; scale irrelevant at 45 people; Supabase auth/RLS is the learning that transfers to Nexo; hosted (not self-hosted) because Equb must never share the PHI/BAA server and there is no value in operating a second server. | **SETTLED** |
| D-14 | Hosting and infrastructure (Vercel+Neon vs AWS) | **OPEN — own discussion** |
| D-15 | Financial command center design | **DESIGNED — approved** |
| D-16 | Money is truth; weeks credited, behind-count, status and late are all derived | **SETTLED — one carve-out added 12 Aug 2026, see D-40.** Money is still truth and everything computable is still derived. LATE gained a second route that is a stored DECISION rather than a derivation (§2.29); weeks credited, behind-count and status are untouched. |
| D-17 | Payment allocation: oldest debt first, then current, then forward; partial = leftover; allocation previewed before commit | **SETTLED** |
| D-18 | Grid kept as the overview map; payment entry is a separate action with unmistakable save feedback | **SETTLED** |
| D-19 | Remove Request Review (unused). Collapse unpaid/late into one derived status. | **SETTLED** |
| D-20 | Mid-cycle joins cannot start before the cycle start date; organizer enters weeks committed, system calculates the finish week | **SETTLED** |
| D-21 | Member profile: permanent person fields vs per-cycle participation, clearly separated; live recalculation preview before saving; history across cycles | **DESIGNED — approved** |
| D-22 | Carried balance lives on the person as a LEDGER, survives cycle deletion; created by manual early-close or automatically at cycle end | **SETTLED** |
| D-23 | Winning while owing never auto-deducts — the system offers, the organizer decides | **SETTLED** |
| D-24 | Balances can be settled outside any cycle; closed members stay visible with their own record | **SETTLED** |
| D-25 | One allocation engine, two entry points (week view + profile); target is weeks while open, ledger once closed | **SETTLED** |
| D-26 | Closing statement to every member at cycle end — factual, no pressure | **SETTLED** |
| D-27 | Messaging: automatic only on mark-paid; everything else manual with preview, per-person override, editable templates | **SETTLED** |
| D-28 | Messages are statements carrying derived state (last payment, weeks behind, amount owed), not bare labels | **SETTLED** |
| D-29 | Equb is outbound-only. Inbound SMS ("READY" for will-call) recorded as a Nexo idea, not built here | **SETTLED** |
| D-37 | Messaging: WhatsApp Business (Meta-approved, already wired) for per-member messages; Telegram for the weekly group broadcast; US SMS is closed — TCR rejection is carrier-level and follows every provider | **SETTLED** |
| D-38 | `WINNER_ANNOUNCEMENT` states the finish **WEEK**, not the finish **DATE** — a deliberate divergence from 2.22, accepted with Meta's v1 approval in hand and pinned by test so it stayed a decision rather than becoming a bug. | **RESOLVED 13 Aug 2026, retained in v3 (14 Aug)** — the winner announcement carries the finish **DATE** ("your weeks run until Sunday, October 18, 2026"), restoring 2.22 in full; v3 adds {{5}} = payments left (the count owed, not calendar weeks). The drawn-week slot stays removed, so the current-week-fallback defect class the v1 template carried stays retired. |
| D-39 | Every approved template declares `requiredExtras`, and `deliver()` refuses at the **extras boundary** — before rendering — when a caller has not supplied them. Enforced at **runtime**, because `MessageExtras` fields are all optional. Making `extras` a discriminated union keyed on template would move this to compile time; it touches every call site and is its own decision, not something folded into a bug fix. | **SETTLED (runtime); compile-time enforcement OPEN** |
| D-36 | Lucky numbers leave the wheel pool automatically when drawn or when the owner's window ends; the system must warn in advance if a window is closing undrawn | **SETTLED** |
| D-33 | Tests accompany every change touching money, allocation, derived state, or integrity — unit tests plus behavioural verification against the live DB | **SETTLED** |
| D-34 | UI design is a deliberate later pass, done once, after the logic is proven | **SETTLED** |
| D-35 | CI/CD set up at deploy time; must gate typecheck, tests, and build | **SETTLED** |
| D-32 | Full organizer control: every entity addable, editable, removable from the UI, with confirmation, audit trail, and immediate recalculation. Nothing requires a developer. | **SETTLED** |
| D-31 | Late joiners' commitment is capped to the cycle end by default; organizer may override deliberately, which generates extra weeks. Every member sees their own finish date. | **SETTLED** |
| D-30 | Add-member flow: system knows the active cycle; existing person = set cycle fields only; new person = created in directory AND added to cycle in one step; guided step-by-step with live computed consequences | **SETTLED** |
| D-40 | **The organizer may mark a week LATE by hand before its window closes** — a stored decision (`markedLateAt`, a timestamp, plus an optional note), because he learns on Monday what the calendar cannot say until Thursday (2.2). Amends §2.14's "everything else is derived" and D-16 with one named carve-out. Money still beats the mark, and **deferral outranks it across all five effects** — status, arithmetic, messages, the control, and clearing an existing mark. Full rule in §2.29. | **SETTLED 12 Aug 2026** — two implementation gaps open against it, listed in §6.4. |
| D-41 | **The fee is fixed by what a member COMMITTED to, not by how much of it they attended.** gross = weekly × weeks committed; fee = the cycle's percent of that, per lucky number. Stopping early never shrinks it — the place was held either way — though what is recoverable is floored at what they paid in, and a shortfall is reported as settled rather than chased. Either term (rate or weeks) moves the fee, and when money has already gone out the organizer must settle rather than save past it. Projected fees derive at read time; a drawn payout's fee is stored as historical fact. The member's signed agreement §4 says the same. Full rule in §2.30. | **SETTLED Aug 2026** — a correction to what was built first. One narrow divergence from the agreement's §4 wording is recorded in §6.4. |

**Flexibility rule (Oli, Aug 2026):** rules are judged by their *reasons*, not applied blindly.
Nexo's "open source first" doctrine exists for PHI, BAA, MCO review, and scale — none of
which apply here. Equb is low-risk, closed, max ~45 people, and **learning is the real
product**. Be professional and rigorous; do not be rigid.

**Rule:** nothing OPEN gets decided in passing. Each gets a real discussion with
researched options and tradeoffs, then is recorded here as SETTLED.

---

## 4. CURRENT STATE — August 2026

**Live app:** runs locally at `localhost:3000`. **Not yet deployed.**
**Repo:** `C:\Users\firao\Desktop\equb-platform` · github.com/firaoli85/equb-platform
**Old app (still what members use):** equb-app-hazel.vercel.app · `C:\Users\firao\Desktop\equb-app`

**Stack:** Next.js 16, React 19, Prisma 7, Supabase Postgres (hosted free tier), Tailwind,
Vercel (pending). Firebase Auth for SMS login. Twilio for WhatsApp.

**Live data:** Cycle 1 2026 — 20-week plan from 17 May 2026, 23 weeks generated —
mid-cycle joiners running their own windows, as designed (§2.7, §2.22). 29 people,
27 participations (25 ACTIVE), 30 lucky numbers, at week 13. Imported from the old app
and **verified to the cent**: $197,175 received, $124,950 paid out at import. Figures
move as payments are recorded.

**Test suite:** ~2240 tests across 118 files, `tsc --noEmit` clean, `next build` compiles,
34 scripts under `scripts/` (20 `verify-*` behavioural checks against the live database
that clean up after themselves, plus import/repair/diagnostic tools and the standing
`npm run check:position`).

### 4.1 WHAT IS BUILT

| Area | State |
|---|---|
| Schema, constraints, RLS, column-level grants | Done |
| Auth — admin email/password, member PIN, WhatsApp code, SMS (failing locally) | Done |
| Sessions — device/IP recorded, idle + absolute expiry, sign-out-everywhere, new-device notice | Done |
| Money core — allocation, derived state, fees, payouts, settlements | Done, heavily tested |
| Import of Cycle 1 | Done, verified to the cent |
| Full edit control with audit trail | Done |
| Financial command centre (`/admin`) | Done |
| Payments — Members list + Grid, partial recording, week action panel | Done |
| Collections — read-first, add/remove/move winners, manual payout | Done |
| Who is waiting · Carried balances · Cash position | Done |
| The wheel — locked planning, clean draw screen, pool exit, undrawn warning | Done |
| Presentation mode (screen-share safety) | Done, server-enforced |
| Member portal — savings-led, group, collections, schedule, sessions | Done |
| Cycle close — pre-close review, ledger debts, archive, read-only lock, wait period | Done |
| Audit log — paged, filtered, append-only by DB trigger | Done |
| Design pass — IA, charts, motion, glass surfaces, portalled overlays | Substantially done |
| WhatsApp login codes | **Working** |
| WhatsApp statements | **Working** — behind/late/winner on the v3 set (14 Aug 2026, no-dash stupid-proof wording), payment confirmation/welcome/group announcement from v2 (13 Aug), cycle_closing_statement unchanged from 7 Aug; live send by ContentSid on sender +13016835755. Twilio's acceptance is logged ACCEPTED; SENT only on a confirmed StatusCallback (needs a public `APP_BASE_URL`, so local sends stay ACCEPTED). Every superseded v1/v2 template is deleted from Twilio (retirement list in docs/WHATSAPP_TEMPLATES.md — DONE). |
| WHATSAPP_WELCOME | **ARMED** (13 Aug 2026, HX90da…) — approved, registered, live: a successful send writes `agreementRequiredAt` in the same transaction as its log row and gates the member's portal until they sign. The portal-address and PIN-truth refusals in lib/welcome-send.ts still fire before the network. |
| Lockout notice over WhatsApp | **No approved template, deliberately** — a security message; Twilio Verify is its channel. Skips honestly. The `notifyOnLockout` setting still has nothing behind it: disable it in the UI, or build the Verify-based channel. |
| Member agreement + signing gate | Done — per-member generated document, SHA-256 signature record, portal gated by welcome-send or by zero payments; organizer sees state on profile + directory |
| Message centre | Done — member list + conversation view, send within, search/filter/date, paginated |
| Manual LATE override | Done — stored with timestamp + note, reversible, payment clears it, deferral outranks it (DOMAIN_RULES rule 5) |
| Mid-cycle participation close | Done — `ParticipationBreak`, gaps are holes not cutoffs (rule 17) |
| Payment entry | Done — one route through PaymentEntry: grid as preview, tick-to-compute, oldest-first allocation unchanged (rule 4) |
| Save feedback | Done — `SaveButton` renders confirmation at the control platform-wide (2.10, UI_STANDARDS 6) |
| SMS login | **Failing locally — parked** |

### 4.2 THE STATE-CONSISTENCY AUDIT

An 88-agent adversarial audit of every state-changing action produced **48 confirmed
findings**. Status:

- **Money findings: 7 of 7 closed.** Every defect that lost or misreported money.
- **High findings: 19 of 19 closed.**
- **Medium: 14 of 26 closed**, 12 deferred with a one-line cost each in
  `docs/STATE_CONSISTENCY_AUDIT.md` §9.1.

The money findings are worth remembering, because they show the shape of the risk:

1. **Doubled fee** for anyone above the unit amount — invisible on 23 of 27 members.
2. **Archive counted pending payouts as paid out** — the document contradicted itself on
   one screen, permanently.
3. **Closing blanked every member's portal** — all 27 lose their record on the day the
   closing statement tells them to look.
4. **Concurrent carry deduction** — two panels, same balance, both commit, member is short
   in cash with every surface reading "settled".
5. **Lucky-number amount edit** moved the payout with nothing behind it — $19,600 to
   $196,000 with one field.
6. **Payout figure edit** invented the settlement amount — and the refusal message
   *pointed the organizer at the screen that did it.*
7. **Notes erased by omission** — same action, data loss on one screen only.

---

## 5. ENGINEERING LESSONS — HOW THINGS ACTUALLY BREAK

These cost real time to learn. They generalise beyond this project and should be carried
to Nexo.

### 5.1 A FIXTURE THAT DOES NOT RESEMBLE PRODUCTION HIDES THE BUG IT WAS WRITTEN TO CATCH

Caught **three times**. The lucky-number REPLACE feature was reported fixed twice and
never worked: the fixture numbered members 9101–9103, so a low number was always free and
the failing swap path never ran. Production numbers sequentially from 1 with no gaps.

`scripts/lib/production-fixture.mts` now builds the real shape — 27 members, numbers 1–31
with no gaps, four members holding two numbers, mixed collected/pending payouts, a late
joiner, a partial, a deferral, a carried balance. **Every property there is one a defect
hid behind.**

### 5.2 A GUARD TEST IS WORTHLESS UNTIL YOU PROVE IT FAILS

Plant the violation, watch the guard catch it, restore the file. Several guards were
vacuous on first write — one matched a bare identifier, so the *import line* satisfied it.

### 5.3 A GUARD THAT FAILS ON CORRECT CODE GETS DELETED

Sharpen the rule; never bend correct code to satisfy a guard. And an over-strict guard
that flags its own documentation will be switched off by whoever meets it next.

### 5.4 AN EXEMPT ENTRY IS A CLAIM ABOUT THE CODE

One exemption said an action "deletes through undoDraw" when it called `deleteMany`
directly. The guard passed while the bug stayed. Exemptions are prose; verify them.

### 5.5 A COMMENT CAN BE THE BUG'S BEST CAMOUFLAGE

`"Re-read inside the transaction so a balance that moved cannot be over-deducted"` — the
read was not in the transaction. Anyone reviewing would read the comment and move on.

### 5.6 A TEST CAN PIN A BUG AS INTENDED BEHAVIOUR

A test named *"scales with the number of lucky numbers they hold"* certified the doubled
fee, using a fixture state the code can never produce.

### 5.7 A TEST CAN PASS FOR THE WRONG REASON

After the `spinWheel` fix the old test still passed — `random: () => 0.99` happened to
land on the same slot. Sweep the range; do not trust one roll.

### 5.8 THE GAP IS USUALLY A RULE WITH NO OWNER

"Never auto-deduct a carried balance" existed only as a UI branch. The fix was not a
better function — it was giving the rule a home: a type with no `deducted` field, and a
required `confirmedByOrganizer` with no default, so the wrong thing cannot be written.

### 5.9 FRICTION CAUSES DRIFT

The closed-cycle guard was applied by hand and reached 9 of 19 mutations, because it cost
three lines of plumbing each. One line, and it reached all of them.

### 5.10 TWO FUNCTIONS ANSWERING ONE QUESTION IS THE SAME DEFECT AS NONE

### 5.11 A TYPED CONFIRMATION THE CLIENT SUPPLIES IS DECORATIVE

Three of five typed-name gates passed unconditionally because the client sent its own copy
of the expected value — including `closeCycle` and `deleteClosedCycle`, the two most
consequential actions in the product.

### 5.12 OVERLAYS MUST BE PORTALLED TO `document.body`

A leftover identity `transform` from a finished animation makes an element the containing
block for `position: fixed` descendants. The dialog rendered 191px above the viewport.
Portal, then measure and re-measure the anchor on scroll and resize.

### 5.13 RLS GATES ROWS, NOT COLUMNS

Members could read their own `pinHash`, lockout state and organizer notes — they own the
row. Column-level `REVOKE`/`GRANT` is the fix.

### 5.14 SECURITY HEADERS CAN BREAK THIRD-PARTY AUTH SILENTLY

`Referrer-Policy: no-referrer` stripped the `Referer` that reCAPTCHA needs to bind its
token to an authorised domain. Result: a well-formed token Google rejects, no CSP
violation, nothing malformed to point at.

### 5.15 A REASON STRING THAT OUTLIVES ITS CAUSE IS A LIE

### 5.16 A SENTINEL LEGITIMATE FOR ONE PLACEHOLDER IS A DEFECT FOR ANOTHER

`"—"` is the honest answer for `lastPaymentWeek` when a member has never paid, and
catastrophic for `payoutAmount`. A blanket "empty is fine" rule made the guard **vacuous
for 16 of 17 placeholders**: `placeholderValues` never returns `undefined` or `""`, so the
refusal could only ever have fired on an empty `name`. It was written to stop invented
figures reaching a member and could not have stopped them.

### 5.17 A GUARD PLACED AFTER A FALLBACK CANNOT SEE WHAT THE FALLBACK DESTROYED

A missing `drawnWeek` did not produce a blank for a later check to catch — it silently
became the member’s **current** week, a valid string no output-scanning guard could flag.
"Week 12" read as correct because the draw happened to be for week 12. The check had to
move to the extras boundary, before the information was lost.

### 5.18 DERIVED VALUES ALWAYS PRODUCE A FIGURE; SUPPLIED VALUES CAN BE FORGOTTEN

Every defect-producing placeholder was fed from caller-supplied `extras`; every legitimate
sentinel was fed from derived `standing`. That split is not a coincidence and it predicts
where the next one will be — look at what a caller has to remember, not at what the
function computes.

### 5.19 A GUARD CANNOT SCAN OUTPUT FOR A SENTINEL THAT APPEARS IN APPROVED COPY

`PAYMENT_CONFIRMED`’s em dash and the `NO_VALUE` sentinel are the **same codepoint**
(U+2014). Scanning rendered output for it would refuse every correct payment confirmation.
Detection has to happen per-variable, before substitution, where the sentinel is
distinguishable from the template’s own punctuation.

### 5.20 A VACUOUS TEST IN THE FAILURE DIRECTION IS WORSE THAN IN THE SUCCESS DIRECTION

Four `if (r.ok)` blocks lacked `expect(r.ok).toBe(true)` and would pass with zero
assertions on a refusal. Seven `if (!r.ok)` blocks were worse: they pass silently if a send
that **should fail starts succeeding** — which for a messaging system is the direction that
reaches a member.

---

## 6. KNOWN ISSUES AND PARKED WORK

### 6.1 SMS LOGIN — PARKED

Fails on localhost with `auth/invalid-app-credential`. A **verbatim port** of the working
old app still fails: same Firebase project, same SDK version, same client code, same
origin, zero CSP violations. The difference is environmental.

Three real causes were found and fixed along the way (§5.14, plus `connect-src` missing
`www.google.com` for the `api2/clr` call, and `frame-src` missing `recaptcha.google.com`).

**Next step:** retest after deploy on the production domain. **Add that domain to Firebase
→ Authentication → Settings → Authorized domains first.** Re-confirmed parked 14 Aug 2026
— still failing locally with the same error; the deploy-day retest above is the only
planned move, and recovery/sign-in flows treat SMS as maybe-unavailable meanwhile.

Priority is low: the default PIN signs every member in directly.

### 6.2 WHATSAPP — RESOLVED 7–8 AUGUST 2026

**Both halves now work.** Login codes go through Twilio Verify; statements go through
Meta-approved Content templates, all category UTILITY — five approved 7 August 2026, the
member-relative v2 rework 13 August, and the no-dash stupid-proof v3 rework of the three
notices 14 August (§2.28 has the live set; every superseded template is deleted from
Twilio).

**Why freeform could never have worked.** A freeform body requires the member to have
messaged the business within 24 hours, and the account has **one inbound message in its
entire history (19 May 2026)** — so no window is open for anyone, ever. A template needs no
window, which is the whole reason this became possible.

The earlier "Meta disabled the WABA" reading was wrong — 63112 was a temporary block that
cleared. The platform has since moved to the business-verified sender **+13016835755**
(WABA 1018506704190290, display name "Equb"); the five approved templates carried over.

**Acceptance is not delivery, and the log now says which is which.** Twilio answers a
send with 201/"queued" — that is logged **ACCEPTED**. **SENT** is written only when a
StatusCallback confirms delivery, and Twilio can only call the webhook when a public
`APP_BASE_URL` is set — so on a dev machine every send stays honestly ACCEPTED. Set
`APP_BASE_URL` at deploy, and run `scripts/reconcile-message-status.mts` to true up any
rows written before the distinction existed.

**What the work actually was.** `sendWhatsAppMessage` was a **refusing stub** — it returned
a permanent failure and never called Twilio at all. So this was *writing* the send path,
not switching an existing one from `Body` to `ContentSid`. There was no `Body` path to
migrate away from, and the plan that said otherwise was wrong about its own codebase.

**Delivery is by ContentSid, and that has a consequence worth stating plainly.** Twilio
sends the sentence Meta approved, keyed by SID. Editing a template's text in the app
therefore changes **the audit log and nothing else** — the member still receives Meta's
wording. An organizer could read one thing in the app while members received another, and
believe the log. That asymmetry is the entire reason the drift guard exists
(`lib/whatsapp-templates.test.ts`, plus a live-database check): the registry is the source
of truth, the database mirrors it, and divergence fails the build.

**`LOCKOUT_NOTICE` has no approved template and must not gain one by accident.** It is a
security message; Meta's UTILITY category covers transactional account activity, and
submitting "your account is locked" invites a rejection that risks the whole sender.
Twilio Verify is its channel. Until then it renders and goes nowhere — see §4.1.

**`WHATSAPP_WELCOME` is armed (13 Aug 2026).** The draft-and-refuse era ended when its
ContentSid registered; the draft queue is empty. LOCKOUT_NOTICE is now the only
template-less key, and that is a decision, not a queue.

**Meta rule that reshaped every template:** a body may not begin or end with a variable.
All originals opened with `{name},` and would have been rejected. Names *are* allowed in
UTILITY; only the position was wrong.

### 6.3 TOOLING

`agent-browser` wedges after admin sign-in — every subsequent call times out. Verification
has been done through rendered-HTML assertions instead, which catch geometry, contrast
pairing, tap targets and overflow, but **not actual paint**.
`docs/MANUAL_QA_CHECKLIST.md` covers 26 admin screens, 7 member screens and the charts,
written against defects that actually occurred. **The organizer runs it.**

### 6.4 SMALL OPEN ITEMS

- **Week 6** holds only Hana (#19) at $4,900 — her real partner needs adding via
  Collections → "Add a winner to this week".
- ~~**Slot 23** is empty wheel clutter~~ — deleted; the pool holds 30 numbers.
- **12 medium audit findings** deferred, listed with costs in
  `docs/STATE_CONSISTENCY_AUDIT.md` §9.1. `closeCycle` irreversibility is the one worth
  doing before 27 September.
- **Passkeys** noted as a post-deploy idea — Supabase Auth has no native support, so it
  means implementing WebAuthn.
- **Selling a turn** (a member offers their week to another) — designed in conversation,
  not built. Simpler than first assumed: money changes hands privately, the system only
  swaps who won. The hard part is preserving anonymity in the offer.
- **Deferral does not clear the mark on the second deferral path** (D-40 gap 1, found
  14 Aug 2026). The deferral control clears the mark as §2.29 requires; the participation
  editor's week-row editor flips the same `isDeferred` field and leaves the mark stored
  underneath, and the money-driven clear only fires on weeks the money fully covers. Every
  READ still shows DEFERRED correctly, so nothing is mis-stated today — but the
  contradiction sits in the record and springs back the day the deferral is lifted, which
  is exactly what the clearing rule exists to prevent. One field on one write.
- **One site lets the mark outrank deferral** (D-40 gap 2, found 14 Aug 2026). The
  "who is affected by changing this week's date" count treats a marked-late member as
  settled and skips them without asking whether a deferral superseded the mark, so a
  member in the state gap 1 allows is under-counted. Reachable only through gap 1; worth
  fixing with it, and worth a test that puts BOTH conditions on ONE member — no current
  fixture does.
- **Agreement §4 is narrower than D-41** — it says the fee changes only with the weekly
  amount, while the platform also moves it with the weeks committed. Members who stop
  early are unaffected. Fixing it by re-wording is a **re-signing event** for everyone who
  has already signed, so it is a decision, not a cleanup.
- **A stale comment on the settled branch** of the final-position derivation describes it
  as "never drawn and paid nothing in", which is only one of the two ways to reach it —
  the other is a fee larger than what they paid. Comment only; the arithmetic and its
  tests are correct.

---

## 7. WHAT IS NEXT

1. **Post-deploy: observe one real DELIVERED send per v2 template**, then clear the
   retire-after-deploy list in `docs/WHATSAPP_TEMPLATES.md` (the four v1 templates
   still registered in Twilio). The switchover itself landed 13–14 Aug 2026; the
   welcome is armed.
2. **Run `docs/MANUAL_QA_CHECKLIST.md`** — the organizer's eyes, in short sittings.
3. **Deploy** — Vercel, environment variables (including a public `APP_BASE_URL`, so
   Twilio's StatusCallback can confirm deliveries and ACCEPTED rows can become SENT), the
   production domain into Firebase authorized domains, the keep-alive scheduler for the
   idle gap, CI gating typecheck and tests.
4. **Parallel run** — record payments in both systems for the remaining weeks and compare.
   The old app stays live for members until this proves out.
5. **Cycle close on 27 September**, then Cycle 2 on the new platform.

---

## 8. HOW WE WORK

- **Design in plain English first.** Discuss and agree before any code.
- **One part at a time.** No batching of unrelated work.
- **Claude writes the prompts and SQL; Oli runs them** in Claude Code and the DB console.
- **Oli runs git himself** — git commands are standalone copy-paste terminal blocks, never
  inside a Claude Code prompt.
- **ONE Claude Code session at a time.** Two sessions in this tree cost an implementation,
  left parse errors twice, and produced contradictory "FIXED" claims.
- **Verify against live data before and after.** Counts prove changes; claims do not.
- **Build, then verify repeatedly — not once.** At least three rounds per screen.
- **Decisions get recorded here**, not left in chat history.
- **Push back when the reasoning is wrong.** Honesty over agreement.
- **Do not tell Oli to rest or stop.** He manages his own breaks; sessions span days.
- **State sequencing in terms of work and risk**, never energy.
- **Instructions must be step by step and exact.** Assume nothing about where a menu is or
  what a field is called.
- **Edit with tools that FAIL LOUDLY on a missed anchor, and re-grep after every edit.**
  Scripted string replacement (`node -e "...replace(...)"`) returns silently when the
  anchor does not match, so the edit simply does not happen and nothing says so. In one
  session that produced **five silent no-ops** — and one of them made a `tsc --noEmit`
  pass meaningless, because the file it was supposed to have changed was untouched and
  therefore still compiled. Use the editing tool that errors on a non-match; when a script
  is genuinely the right shape (a repeated mechanical change across many files), have it
  print what it changed and assert the count, then grep the result before believing it.
  **A green check on code you did not actually write is worse than a red one.**
- **A migration is not finished until the client is regenerated AND the dev server is
  restarted.** A stale Prisma client broke a page **four times in one session** — most
  recently `markedLateAt`, added by the manual-late migration. The symptom is always the
  same and always misleading: a property that "does not exist" on a model the schema
  plainly has, which reads as a code defect and is not one. The fix was always the same
  two commands, and the second one is the one that gets forgotten.

  Both halves are now harder to skip:

  ```
  npm run db:migrate      # migrate deploy AND generate, in one command
  ```

  `predev`, `prebuild` and `postinstall` also regenerate, so a fresh start is never
  stale. **But `predev` only fires when the server BOOTS.** Applying a migration while
  `next dev` is already running leaves the old client loaded in Next's module graph, and
  regenerating the files underneath it does not evict what is in memory. **Restart the dev
  server before testing anything the migration touched** — otherwise the first thing you
  test reports a defect that does not exist, and the time goes on hunting it.

### The Sunday check — `npm run check:position`

**Run it before recording payments whenever a figure looks wrong.** One command, no
arguments, writes nothing:

```
npm run check:position
```

It recomputes **17 figures by hand from the raw receipt rows** — a different route from the
one the screens take — and prints them beside what `/admin/cycle/position`, `/admin/cash`
and the dashboard actually report:

| It proves | Against |
|---|---|
| what should have come in by now, and what did | every elapsed week × every member in window |
| what is genuinely paid ahead | weeks **after** the current one only |
| this week's own money | the open week, counted separately |
| handed out vs drawn-but-not-handed-out | COLLECTED payouts only |
| what a stopped participation removed | their forward weeks × their weekly |
| what a member paid out and then stopped costs him | the same weeks, as **his** to cover |

Every figure prints **YES** or **\*\*\*NO\*\*\***, and the command **exits non-zero if
anything disagrees** — so it is a check, not a report. A figure that agrees with itself
proves nothing; these agree with the receipts or they do not.

**Why it exists.** Mid-week 13 the position reported 13 members "paid ahead" totalling
$12,925. $9,375 of that was ordinary on-time money for the current week: the split was made
on whether a week's payment **window had closed** rather than whether the week **had
happened**, and those are five different days. Nothing in the platform disagreed with
itself, so nothing caught it — every screen was reading the same wrong boundary. Only
arithmetic done a second way, against the rows, could show it.

Run it after any change to a money derivation too. It is the fastest proof that the screens
and the receipts still say the same thing.
