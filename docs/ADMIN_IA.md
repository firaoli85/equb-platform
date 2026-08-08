# ADMIN INFORMATION ARCHITECTURE

**Proposal, written before the build.** What lives where, what gains its own page, and why.

**Precedence.** `EQUB_GROUND_TRUTH.md` wins over this document; `docs/UI_STANDARDS.md` measures the
result. This settles *placement* — the argument about where a thing belongs — so that argument
does not have to be re-had per screen.

---

## 1. What is actually wrong now

Four findings, each verified against the code rather than asserted.

### 1.1 Eight screens have no navigation

`this-week`, `held`, `paid-out`, `received` are reachable **only** by clicking a stat card on the
dashboard (`app/admin/(protected)/page.tsx` is the sole file linking to each). `cycle/close` is
linked from exactly two places, one of which is the **archive page of an already-closed cycle** —
so the way to close a cycle is to visit a different cycle's archive.

A screen with one entry point is not a screen the organizer can find. It is a screen he has to
remember.

### 1.2 The groups are nouns, not jobs

`Overview / Money / The draw / People / System`. "Cycle" sits under **People**. "New cycle" sits
under **System**, next to Settings and the audit log. Nothing about the current cycle's *life* —
set it up, run it, close it, archive it — is in one place, so the organizer assembles that
sequence from memory every time.

### 1.3 Settings is four jobs in one scroll

`/admin/settings` currently holds, top to bottom: the WhatsApp channel switch, PIN login on/off,
the phone-digit default PIN, lockout attempts and duration, the closing wait period, the lockout
notice toggle, session lifetimes for both roles, and the list of devices the organizer is signed
in on.

Those are **four unrelated decisions**: who may sign in, how the platform talks to members, when a
cycle may be closed, and the organizer's own account. Putting the closing wait — a rule about
money and the ledger — three inches below "WhatsApp notice on lockout" is the specific complaint.

### 1.4 Weight does not match placement

| Action | What it actually does | Where it lives now |
|---|---|---|
| **Close the cycle** | Writes a carried-ledger debt onto every short member, freezes the archive, makes the books permanently read-only | A link on another cycle's archive page |
| **New cycle** | Creates the container everything else hangs off, and fixes the numbering rule for its whole life | A nav row under "System", between Settings and Audit log |
| **Closing wait period** | Decides whether last week's money lands on the week or becomes a debt | A number input in the middle of the security settings |
| **PIN login on/off** | A toggle | The same page, same visual weight |

---

## 2. The organizing principle

> **Group by the organizer's job, not by the entity the code happens to name.**

Ground truth 2.1: *"The organizer's real job is not collecting money. It is managing risk, trust,
and the financial position of the group."* The navigation should read like that job.

Six sections. Each answers one question the organizer actually has.

| Section | The question it answers |
|---|---|
| **Today** | Where am I right now? |
| **Money** | What came in, what went out, what am I holding? |
| **The draw** | Who wins, and when? |
| **People** | Who are they, and how is each one doing? |
| **The cycle** | Where is this cycle in its life? |
| **Record** | What happened, and when? |

Settings is **not** a seventh section in the sidebar. It is the account menu, because settings are
something you go and change, not somewhere you work.

---

## 3. The proposed structure

```
TODAY
  Dashboard                  /admin              the financial position, at a glance (2.1)
  This week                  /admin/this-week    the current week's collection, in detail

MONEY
  Payments                   /admin/payments     record and see every member's weeks
  Collections                /admin/collections  payouts going out — who won, who collected
  Who is waiting             /admin/waiting      drawn but not yet handed over
  Cash position              /admin/cash         ← NEW. Received / paid out / held, over time
  Carried balances           /admin/balances     what people owe across cycles (2.18)

THE DRAW
  Wheel setup                /admin/wheel/setup  arrange slots, plan winners
  Draw screen                /admin/wheel        bare by design (2.4) — nothing but the wheel

PEOPLE
  Members                    /admin/people       the directory (2.5)
  Messages                   /admin/messages     statements, previewed before sending (2.20)

THE CYCLE                                        ← NEW SECTION
  This cycle                 /admin/cycle        members, weeks, terms — the cycle's own page
  Where this cycle stands    /admin/cycle/position  the stored dates that are authoritative (rule 7),
                                                    and the position they produce
  Draws                      /admin/cycle/draws  every draw, editable
  Close the cycle            /admin/cycle/close  ← its own page, with room (see §4.1)
  Start a new cycle          /admin/cycles/new   ← moved out of "System"

RECORD
  Audit log                  /admin/audit        append-only, paged and filtered (rule 15)
  Archives                   /admin/cycles       ← NEW index. Every closed cycle, readable (2.9)

ACCOUNT MENU (not a sidebar section)
  Access and security        /admin/settings/access
  Messaging                  /admin/settings/messaging
  Cycle rules                /admin/settings/cycle
  Your account               /admin/settings/account
  Sign out
```

**Routes that keep working.** `/admin/settings` becomes an index that links the four; the three
orphan money views redirect into `/admin/cash` (see §4.2). No bookmark breaks.

---

## 4. What gains its own page, and why

### 4.1 Close the cycle — `/admin/cycle/close`

**It already has a route. What it gains is a place in the navigation and room to explain itself.**

This is the single most consequential action in the product. It writes a `DEBT` ledger entry onto
every member who is short — money they will still owe in two years (2.18) — freezes the archive,
and makes every cycle-scoped write refuse from that moment (rule 14). It is irreversible in
practice: reopening does not un-write the ledger.

An action that does that is not a link on another page. It gets:

- its own nav row, under **The cycle**, last — where it falls in the cycle's life
- the wait period stated **as a sentence with a date**, not a disabled button (already built)
- every member's final position, before anything is written
- the statements count, because after closing the messenger can no longer read these standings
- the typed-name confirmation, which it already has

**Why not a modal.** A modal is for a decision you can hold in your head. This one has 25 rows of
money in it.

### 4.2 Cash position — `/admin/cash` (new)

**Replaces three orphan routes with one screen that answers the question they were each answering
a third of.**

`received`, `paid-out` and `held` are three lists of the same ledger seen from three angles. Ground
truth 2.1 names the actual question — *"the group is holding 2 weeks' worth of money that has not
gone out yet"* — and no current screen answers it as a **position over time**.

One screen: the chart (§5.2), then the three figures as tabs over the same list. The old routes
redirect to the matching tab, so the dashboard's stat cards keep working and gain a chart.

### 4.3 Archives — `/admin/cycles` (new index)

`/admin/cycles/[id]/archive` exists with no index. Ground truth 2.9: *"Past cycles remain
viewable."* They are not viewable if you need the id.

### 4.4 Settings, split four ways

Each page gets room to say why the setting exists — which the current single scroll cannot.

| Page | Holds | Why it is its own page |
|---|---|---|
| **Access and security** | PIN login, phone-digit default, lockout attempts and duration, session lifetimes | Every row here decides **who can get in**. They are read at check time and want explaining together |
| **Messaging** | WhatsApp channel switch and its reason, lockout notice, template links | 2.28 — which channels work is a factual state, not a preference. It deserves the WhatsApp/TCR explanation beside the switch |
| **Cycle rules** | Closing wait period, fee percent default, numbering default, commitment cap behaviour | **The complaint that started this.** These are money rules. They belong with each other and nowhere near a notification toggle |
| **Your account** | The organizer's own devices and sessions, sign out everywhere | It is about *him*, not the group |

**Not a tab bar.** Four pages with a left rail, in the [Shopify](https://mobbin.com/screens/3903c940-24c1-44f5-8747-ae6a3e2e0e5d)
shape: an icon and a label per row, detail on the right. Tabs suggest the four are variations of
one thing; they are not.

**Destructive settings sit in a bordered region at the foot of their own page**, in the
[Framer](https://mobbin.com/screens/cd5de83c-ee9e-4467-aad4-121427f9b9cf) "Danger Zone" shape —
never inline with the routine ones.

---

## 5. The charts

Four, as briefed. **Chart choice is an argument about the data's shape, not a style preference** —
so each one states why it is that chart and what it refuses to be.

### 5.1 Money collected vs expected, per week

**Grouped bars per week, with an elapsed / to-come divider.**

Expected is structural — `weeks × unitAmount`, fixed the moment the cycle exists (rule 1). Collected
is a fact. Two series over an ordered categorical axis (weeks) is a bar chart; there is no argument.

The part that matters is the **divider**: a vertical rule between weeks whose payment window has
closed and weeks still open, borrowing
[Xero's Actuals | Projected](https://mobbin.com/screens/1c9ccbcc-0900-4bd4-b86c-dd68aa8c96f6)
split. Without it, this week always looks like a shortfall — the exact false alarm rule 7 exists to
prevent. Bars right of the divider are outlined, not filled.

- **Refused:** a line chart. Weekly collection is not continuous; a line implies values between weeks.
- **Drills to:** a week → that week on Payments.

### 5.2 Cash position over time

**A filled area for the running position, with received and paid out as the two movements below it.**

The headline is a single running value — *held* — which is `received − paid out` at every point in
time. That is one continuous series, so it is an area. The two movements that produce it are events,
so they are bars, on a shared time axis beneath.

This is the [Monarch](https://mobbin.com/screens/48cd2fcd-6cfb-4a9c-be7a-81c5e08fa412) shape (bars
carrying a line), read with [Mercury's](https://mobbin.com/screens/d83e2ef6-913d-4ffb-a91d-06568a3d769b)
restraint — money in and money out named plainly, figures tabular, no gradient.

- **Refused:** three overlaid lines. Received and paid out are not positions; drawing them as lines
  invites reading a slope that means nothing.
- **Refused:** a stacked area. Stacking implies the parts sum to the whole. Paid out *reduces* held.
- **Drills to:** a point → that week's receipts and payouts.

### 5.3 Payouts made vs pending

**One segmented horizontal bar, of a known total.**

Everyone receives exactly once per cycle, so the total is `memberCount` and it is known in advance.
That makes this part-to-whole with a **fixed denominator** — a single stacked bar reading
*collected · pending · still to come*, with the counts as text.

- **Refused: a donut.** Three segments of a known total is a bar. A donut of three values is
  decoration, it makes the counts harder to compare, and the brief said do not decorate.
- **Drills to:** a segment → Collections filtered to it.

### 5.4 Per-member payment consistency

**A dot strip per member — one dot per week of their own window.**

Consistency is a *pattern over time per person*, and the pattern is what carries the meaning: three
reds in a row is a different fact from three reds scattered. Ground truth 2.15 already says the grid
is good at exactly this — *"spotting patterns (streaks of red, people paid ahead)"*. This is that,
compressed to one row per member so 25 members fit on a screen.

Each dot is one week: paid, partial, deferred, overdue, or not yet due. **Never colour alone** —
paid is filled, partial is half, deferred is hollow with a ring, overdue is filled red *and* marked.

- **Refused:** a percentage per member. "84% consistent" hides whether they are recovering or
  falling apart, which is the only thing the organizer needs.
- **Refused:** a heatmap. A heatmap of 25 × 20 with five states is a legend-reading exercise.
- **Drills to:** a dot → that member's week. A row → their profile.

**Every chart obeys rule 8:** figures `tabular-nums`, cents through `formatMoney`, and the
vocabulary — *paid in*, *still to save*, *overdue* — never re-invented in a legend.

---

## 6. Design references

Pulled from Mobbin (2.13, the sanctioned source). Named here so the build has a target rather than
a preference.

| Reference | What is taken |
|---|---|
| [Mercury — Money movement](https://mobbin.com/screens/d83e2ef6-913d-4ffb-a91d-06568a3d769b) | **Primary for Money.** Money in / money out as two plain figures with a sparkline each, a "last 3 months average" line beneath, and the transaction list directly below. Quiet, tabular, no chrome |
| [Midday](https://mobbin.com/screens/514c372f-89f5-4182-9bbe-5ab3d1d0d397) | **Primary for restraint.** Near-monochrome cards, one big figure, the chart subordinate to it. Proof a financial dashboard does not need colour to feel serious |
| [Xero — cash in / cash out](https://mobbin.com/screens/1c9ccbcc-0900-4bd4-b86c-dd68aa8c96f6) | The **Actuals \| Projected** divider — the single most important borrowing in this document (§5.1) |
| [Monarch — Cash Flow](https://mobbin.com/screens/48cd2fcd-6cfb-4a9c-be7a-81c5e08fa412) | Bars carrying a line for the running position, and a dashed segment for what has not happened yet |
| [Shopify — Settings](https://mobbin.com/screens/3903c940-24c1-44f5-8747-ae6a3e2e0e5d) | The settings rail: icon + label per row, detail on the right (§4.4) |
| [Framer — Site Settings](https://mobbin.com/screens/cd5de83c-ee9e-4467-aad4-121427f9b9cf) | Destructive actions in their own bordered region at the foot of the page, never inline |
| [Revolut — Budget](https://mobbin.com/screens/b578103d-3eca-4520-b50f-1698113428d7) | **Primary for the member portal.** A three-quarter arc, the label *above* the figure inside it, the remainder in grey — then the components as a plain list underneath, each with its figure right-aligned |
| [Origin — Breakdown](https://mobbin.com/screens/413f86df-ddd9-4956-8dfa-515256bd949d) | The `$7 of $200` partial pattern, which is exactly what UI_STANDARDS rule 4 demands of a partial state |
| [GoFundMe — Donations](https://mobbin.com/screens/8db3b0c9-cae2-47b0-b89b-cd409bc56be0) | Raised-against-goal with a compact ring and a plain list — the shape for the member's group view |

**Designed away from, deliberately:**
[QuickBooks](https://mobbin.com/screens/a1576a19-53f6-498d-80a7-02ece64072d8) — a widget wall where
every card competes and nothing is the answer to 2.1; and
[Base44/FinFlow](https://mobbin.com/screens/f3aba9b5-2b39-41ad-aac0-e865b189a65a) — the
blue-to-green gradient balance card, which is the exact hero-metric cliché the design skills ban and
which would make a real financial record look like a demo.

---

## 7. What this changes, screen by screen

| Screen | Change |
|---|---|
| Sidebar | Six sections, job-shaped. Settings leaves the sidebar for the account menu |
| `/admin` | Keeps the four stat cards; they now link into `/admin/cash` tabs and gain §5.1 |
| `/admin/this-week` | Gains a nav row. No longer dashboard-only |
| `/admin/cash` | **New.** §5.2 chart + the three former routes as tabs |
| `/admin/received`, `/paid-out`, `/held` | Redirect to the matching `/admin/cash` tab |
| `/admin/cycle/close` | Gains a nav row, in the cycle's life sequence |
| `/admin/cycles` | **New** archive index |
| `/admin/cycles/new` | Moves from "System" to "The cycle" |
| `/admin/settings` | Becomes an index over four pages |
| `/admin/settings/{access,messaging,cycle,account}` | **New**, with room to explain |
| Everywhere | Context-aware linking (§8) |

---

## 8. Context-aware linking — the rule

> **Every figure, name and date on screen is a link to the thing it is about.**

Not decoration: the organizer's job is to follow money to its source, and every click he cannot
make is a screen he has to find by memory.

| What is on screen | Opens |
|---|---|
| A member's name, anywhere | Their profile |
| A payout figure | That collection, on Collections |
| A week number or date | That week, on Payments |
| A "still to save" or "overdue" figure | The weeks that make it up |
| A carried balance | That person's ledger story |
| A lucky number | The wheel, scrolled to its slot |
| A chart segment or bar | The rows behind it (§5) |
| An audit entry's entity | The record it changed |

**Where it must not link:** a figure that is a *sum of things on this screen already* — linking it
sends the organizer away from the answer he is looking at.

---

## 9. Build order

1. The shell — sidebar, account menu, page transitions
2. Settings split (the named complaint)
3. `/admin/cash` + the §5.2 chart
4. Dashboard + §5.1 chart
5. §5.3 and §5.4 charts into Collections and Payments
6. Cycle section + archives index
7. Context-aware linking sweep
8. Member portal
9. Motion pass over all of it

Each step verified against `docs/UI_STANDARDS.md` and `docs/DOMAIN_RULES.md` before the next
begins, per `docs/SELF_TEST_LOOP.md` — three rounds minimum, and more while anything is still
found.
