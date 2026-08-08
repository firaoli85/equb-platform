# Manual QA checklist

The `docs/SELF_TEST_LOOP.md` checks, written out per screen so they can be run by hand.

**Why this exists.** The loop is meant to be driven against the real app with a browser.
When the browser tooling is unavailable, the checks still have to happen — and a checklist
that names every screen is how a skipped screen stops hiding.

---

## How to run it

**Four passes per screen.** Every screen gets all four before it counts as done:

| | 390px (mobile) | 1280px (desktop) |
|---|---|---|
| **Light** | ☐ | ☐ |
| **Dark** | ☐ | ☐ |

In Chrome: `F12` → the device-toolbar icon (`Ctrl+Shift+M`) → set the width to **390**, then
**1280**. Theme follows the OS; switch it in Windows Settings → Personalisation → Colours,
or use DevTools → `Ctrl+Shift+P` → "Emulate CSS prefers-color-scheme".

**The rule that makes it a loop:** after a fix, **re-run the same checks on the same
screen**. Do not move on while a screen is failing, and do not batch fixes across screens
and verify at the end — a fix for one screen routinely breaks another. Three attempts, then
mark UNRESOLVED and move on.

**Never record test money against a real member.** Use `scripts/portal-test-fixture.mts`.

---

## The universal checks

Run these on **every** screen. They are the mechanical ones — necessary, never sufficient.

- [ ] **Renders with real data.** Console open (`F12`): zero errors, zero warnings that
      name this screen.
- [ ] **No horizontal page scroll.** Paste in the console: `document.documentElement.scrollWidth === document.documentElement.clientWidth` → must be `true`.
- [ ] **Contrast.** Any text that looks faint against its background: DevTools → inspect the
      element → the colour swatch in Styles shows the contrast ratio. Body text needs
      **4.5:1**, large/bold text **3:1**. Check in *both* themes — dark mode is where this
      usually fails.
- [ ] **Hit targets.** Every button, link, checkbox and select: at 390px they must be at
      least **44×44px**. Inspect → the element's box in DevTools shows the size.
- [ ] **Focus visible.** Press `Tab` repeatedly through the whole screen. Every stop must
      show a visible ring. Nothing may be reachable but invisible, and nothing interactive
      may be skipped.
- [ ] **Tab order matches reading order.** The focus ring must not jump around the page.

And these are the ones that catch **wrong** rather than **broken** — the phantom fifth PIN
dot passed every mechanical check above:

- [ ] **Indicator truth.** Every counter, badge, dot and progress bar equals the real
      value. Count the rows yourself and compare.
- [ ] **State honesty.** Empty, loading, error, partial and full each look deliberate — not
      like a mistake.
- [ ] **Visual correctness.** Nothing misaligned, clipped or cramped. A component that
      appears on more than one screen looks identical on each; compare directly.
- [ ] **Real-data stress.** Long Amharic names, the full roster, zero values, very large
      amounts, a member with no phone, a late joiner mid-window.
- [ ] **Numbers against `docs/DOMAIN_RULES.md`.** Pick the figures on screen and check them
      against the rule that governs them. A payout is gross − fee. "Overdue" excludes weeks
      whose window is still open.
- [ ] **Vocabulary.** One word per concept. A second word for the same thing is a finding.
- [ ] **The honest question.** *"Would the organizer or a member find this confusing, or
      think something is wrong?"* If yes, that is a finding even when nothing failed.

---

# ADMIN SCREENS

## Sign-in — `/admin/login`

- [ ] The Sign in button is disabled until both fields have content.
- [ ] A wrong password gives a plain message, not a code or a stack trace.
- [ ] The password field is masked and the browser offers to save it.
- [ ] At 390px the form is not cut off and the keyboard does not cover the button.

## Dashboard — `/admin`

- [ ] Every headline figure matches the screen it links to. Click through and compare.
- [ ] "Total contributed" is the headline; paid in / still to save / overdue stay distinct.
- [ ] The collected-vs-expected chart — its own section under **THE CHARTS** below.
- [ ] With presentation mode ON (Settings), names and money are **absent**, not hidden with
      CSS — check the page source, not just the pixels.
- [ ] The current week number matches the real date.

## This week — `/admin/this-week`

- [ ] The week shown is the week we are actually in.
- [ ] Only weeks whose 5-day window has **closed** count anyone as overdue.
- [ ] The member count equals the number of rows.
- [ ] A member who joined mid-cycle appears only from their start week.

## Payments — `/admin/payments`

- [ ] Members view and Grid view show the same totals for the same member.
- [ ] Recording a partial payment updates the row immediately and the totals with it.
- [ ] A deferred week reads as deferred, never as unpaid or as overdue.
- [ ] Grid view at 390px scrolls **inside** the grid — the page itself must not scroll
      sideways.
- [ ] The week-action panel opens over the grid and closes on `Esc`.
- [ ] Patterns view shows the same member set as the other two, and a member who reads
      overdue in the grid reads overdue here. **A member late in one view and current in
      another is the drift these three views exist to prevent.**
- [ ] The chosen view survives a reload.

## Collections — `/admin/collections`

- [ ] Every drawn week shows its real payout total. **A drawn week showing no amount is a
      bug** — that is the empty-draw defect.
- [ ] Collected and Pending totals equal the sum of their rows.
- [ ] "Edit winners" opens for a drawn week and lists exactly its winners.
- [ ] Add a winner → the number leaves the pool and the total rises by the right amount.
- [ ] Remove the LAST winner → the week becomes **UNDRAWN and selectable again**, and the
      confirmation says so before you press it.
- [ ] Move a winner → the destination list includes **free (undrawn) weeks**, and a week
      you just emptied is offered immediately.
- [ ] A week with a committed winner plan is refused as a destination, with the reason.
- [ ] The payout progress bar — its own section under **THE CHARTS** below.

## Waiting — `/admin/waiting`

- [ ] Everyone listed has been drawn and not yet collected.
- [ ] The total equals the sum of the rows.
- [ ] Marking one collected removes it here and adds it to Paid out.

## Cash position — `/admin/cash`

Replaces the three former screens. The chart itself has its own section below.

- [ ] Received − Paid out = Held. Check the arithmetic across the three tabs.
- [ ] Each tab's total equals the sum of its own rows.
- [ ] The three stat cards open the matching tab, and the tab that opens is the one you
      clicked.
- [ ] `/admin/held`, `/admin/paid-out` and `/admin/received` each land on the right tab —
      **a 404 on any of them is a bug**; those URLs are in the organizer's history.
- [ ] Committed + Uncommitted = Held, on the Held tab.
- [ ] Date ranges, if any, include the whole of the end day.

## Cycles — `/admin/cycles`

- [ ] Every closed cycle appears with its name, close date and totals.
- [ ] A closed cycle whose **cycle row was deleted** still appears, marked as such. This is
      the point of the screen — if deleting a cycle makes its record vanish, that is the
      2.9 failure.
- [ ] The running cycle appears under "Running now" and is not listed as a record.
- [ ] Each record opens its archive.
- [ ] The red "no written record" panel is **absent** in normal operation.

## Balances — `/admin/balances`

- [ ] Every person listed carries a non-zero balance.
- [ ] The story for one person adds up: debts − payments − written off = the balance shown.
- [ ] Recording a payment against a balance updates it immediately.
- [ ] Writing off requires a reason and records it as FORGIVEN, not as a payment.

## People — `/admin/people`

- [ ] The count equals the number of rows.
- [ ] Search finds a member by English name **and** by Amharic name.
- [ ] A person with no phone renders without a gap or a stray dash.

## Member profile — `/admin/people/[id]`

Five tabs; check each.

- [ ] **Header** figures agree with the Payments screen for the same member.
- [ ] **Payments tab** — every week of their window, with the right status.
- [ ] **Payout tab** — gross − fee = net, at the cycle's fee percent.
- [ ] **Receipts tab** — a settlement receipt shows its amount **locked**, with the reason,
      and Save carries only date/method/notes.
- [ ] **Receipts tab** — deleting a settlement receipt is refused and offers Collections.
- [ ] **Settings tab** — changing the phone warns that it changes how they sign in, and
      names the new PIN when they are still on the phone default.
- [ ] **Settings tab** — emptying the phone demands the typed name and says it locks them out.
- [ ] **Settings tab** — "Remove from directory" on someone with history explains **every**
      blocker at once and offers "stop messaging them" instead.
- [ ] **Settings tab** — typing a lucky number already in use names **who holds it** and
      offers Replace or Keep. Neither option is pre-selected.
- [ ] **Settings tab** — Replace on a *drawn* number is refused, with the reason; Keep is
      still offered.
- [ ] **Settings tab** — shortening the weeks offers "Remove from cycle" as the alternative.
- [ ] **History tab** — every cycle they have been in.
- [ ] Sign-in history lists devices; "sign out everywhere else" leaves the current one.

## Cycle — `/admin/cycle`

- [ ] Member count, weekly total and week count all match the cycle's real rows.
- [ ] The current week is highlighted correctly.

## Add member — `/admin/cycle/add`

- [ ] "Finish with the group" is ON by default and updates when the start week changes.
- [ ] Typing a weeks figure turns the toggle off by itself — no hunting for the switch.
- [ ] The finish week and date are shown live at every step.
- [ ] Auto numbers fill from the lowest free number.
- [ ] In a carry-over cycle, an existing member keeps their previous numbers **where free**
      and gets fresh ones only for those taken.
- [ ] Manual numbers: entering one already in use names **who holds it** and offers Replace
      or Keep — not "Number 22 is already taken".
- [ ] Keep writes the free number into the field, ready to save.
- [ ] Replace moves the holder and does not disturb anyone else's numbers.
- [ ] A member with a carried balance forces the carry decision before saving.
- [ ] The success screen states the numbers assigned and how they were chosen.

## Cycle weeks — `/admin/cycle/weeks`

- [ ] Each week's stored date is the day that actually happened.
- [ ] Skipping a week removes it from everyone's obligations, and says so.
- [ ] Editing a date does not silently move other weeks.

## Draws — `/admin/cycle/draws`

- [ ] Only weeks that are genuinely undrawn are offered for a new draw.
- [ ] A committed winner plan is honoured and labelled as planned, not as chance.
- [ ] Undoing a draw returns the numbers to the pool and restores any fulfilled plan to
      PLANNED.
- [ ] After an undo the week is immediately drawable again.

## Wheel — `/admin/wheel` and `/admin/wheel/setup`

- [ ] Every number in the cycle appears exactly once, in a slot or in the pool.
- [ ] A drawn number is not in the pool.
- [ ] A number freed by an undo or a removal appears in the pool **immediately**.
- [ ] Reshuffle refuses to move a number in a committed plan, with the reason.
- [ ] A slot with nobody in it is either released or clearly labelled — never silently
      holding a position.
- [ ] Dragging at 390px works, or the screen offers a non-drag alternative.

## Cycle close — `/admin/cycle/close`

- [ ] Before the wait expires: the wait is stated as a sentence **with a date**, and the
      Close button is disabled with that reason as its tooltip.
- [ ] Changing "Wait before a cycle can be closed" in Settings changes it here.
- [ ] Setting the wait to 0 offers closing immediately.
- [ ] Undrawn members block closing until a reason is typed.
- [ ] The statement count is real — send one and watch it rise.
- [ ] Every member's final position matches their profile.
- [ ] Cash: received − paid out = still held.

## New cycle — `/admin/cycles/new`

- [ ] The numbering choice must be made — there is no default.
- [ ] "Fresh" assigns from 1 upward; "carry-over" reuses previous numbers where free.
- [ ] A second ACTIVE cycle is refused, with the reason.

## Archive — `/admin/cycles/[id]/archive`

- [ ] The archive is readable and complete without the cycle's live rows.
- [ ] Every week, draw and payout appears.
- [ ] Nothing on the page can be edited.

## Messages — `/admin/messages`

- [ ] A member with "no messages" set never appears as a recipient.
- [ ] Every figure in a rendered message equals that member's real standing.
- [ ] With WhatsApp disabled, no send is offered and the reason is stated.
- [ ] The message log records failures as well as successes.

## Audit log — `/admin/audit`

- [ ] The sentence above the table says what is on screen, including "Every recorded change"
      when nothing is filtered.
- [ ] Filter by action → only that action; the sentence updates.
- [ ] Filter by person → entries about their receipts and payouts, not only their own row.
- [ ] A date range includes the **whole** of the end day — set from and to to the same day
      and check an entry from that afternoon still appears.
- [ ] Reversing the dates does not silently return nothing.
- [ ] Paging: Older/Newer move, the position reads "Page N of M", and changing a filter
      returns to page 1.
- [ ] Clear filters returns the whole record.

## Settings — `/admin/settings`

- [ ] Every switch reflects the stored value on reload.
- [ ] Turning presentation mode on hides names and money **across the admin**.
- [ ] Session limits: a zero or a negative is refused with a plain reason.
- [ ] The closing wait accepts 0 and refuses anything above 90.
- [ ] "Where you are signed in" lists this browser; signing out others leaves it.

---

# THE CHARTS

A chart fails differently from a screen. A screen that is broken looks broken; a chart that
is wrong looks **fine** — the bar is drawn, the axis has numbers, nothing is in the console,
and the figure it shows is not the truth. Every check below was written against a defect
that actually reached a rendered chart in this codebase, so none of them is hypothetical.

**Run all four passes on the screen that hosts the chart**, then these.

## Every chart — the four that apply to all of them

- [ ] **The picture agrees with the table.** Every chart carries its figures as a real
      table for screen readers. Turn the SVG off — DevTools → select the `<svg>` → `Delete`
      — and read what remains. It must say the same thing the picture said.
- [ ] **A real but tiny value is visible.** One member's $1,000 against a $27,000 week is
      3.7% of the scale. Find the smallest non-zero value on the chart and confirm it is
      drawn as *something*. **A real figure rendered as nothing is the worst chart bug there
      is** — it reads as "nobody paid".
- [ ] **Nothing is clipped.** Inspect the `<svg>` and any `<rect>`/`<path>` inside it. No
      element may extend past the `viewBox`. A clipped bar is silently shortened, and a
      shortened bar is a smaller number.
- [ ] **No `NaN` anywhere.** `Ctrl+F` the page source for `NaN`. A browser drops a path
      containing `NaN` without a console error, so the chart simply loses a series.
- [ ] **Scrolls inside itself at 390px.** The plot may be wider than the phone. The *page*
      may not: re-run the `scrollWidth === clientWidth` check with the chart on screen.

## Cash position — the area chart on `/admin/cash`

- [ ] The last point of the running line equals the **Held** stat card above it, to the
      cent. Two figures for one number is the drift 2.14 exists to prevent.
- [ ] The dashed "still open" divider sits between the last **closed** week and the first
      week still collecting. Compare against `/admin/cycle/weeks`.
- [ ] **The current week does not read as a collapse.** Money is still arriving in it; the
      line right of the divider is dashed, not solid, and the headline figure is taken from
      the last *closed* week. If today's half-collected week drags the position visibly
      down, that is the false alarm the divider exists to prevent.
- [ ] A **pending** payout does not reduce the held line — the cash has not left. It appears
      as the dashed outline below the midline, and it equals *Committed* on the Held tab.
- [ ] Money is counted against the week it is **for**. Record a catch-up payment for an
      early week and confirm it lands in *that* week, not in today's.
- [ ] Clicking a week number opens that week on Payments.

## Collected vs expected — the bars on `/admin`

- [ ] **A week still open is never called short.** Its bar is outlined, it carries no red
      dot, and it is excluded from the "overdue across closed weeks" headline. Check this in
      the middle of a week, before anyone has paid — the headline must still read *All in*
      if every closed week is settled.
- [ ] The red dot appears on closed weeks that came up short, and *only* those.
- [ ] Expected drops a member who was deferred or whose week was skipped. Defer one week for
      one member and confirm the expected bar falls by exactly their weekly amount.
- [ ] Expected drops a member outside their window — a late joiner adds nothing to the weeks
      before they started.
- [ ] The two bars per week are distinguishable in greyscale: expected is the wide quiet
      backdrop, collected is the narrower bar in front.

## Payout progress — the segmented bar on `/admin/collections`

- [ ] **The denominator is LUCKY NUMBERS, not members.** Count the numbers in the cycle —
      `/admin/wheel/setup` — and confirm the headline reads *N of that count*. With 27
      members holding 31 numbers it must say **31**. A member-count denominator reports the
      cycle finished four payouts early.
- [ ] **The bar never exceeds 100%.** Inspect each segment's inline `width` and add them
      up. The container hides its overflow, so a bar summing past 100% is clipped
      *silently* — the last segment just ends early and reads as fewer people waiting.
- [ ] Collected + Waiting + Still to come = the total, in the numbers below the bar.
- [ ] The red "one has been paid twice" panel is **absent** in normal operation. If it
      appears, stop and check Collections before trusting anything else on the screen.
- [ ] The three states are distinguishable in greyscale: solid, hatched, empty.
- [ ] Each segment opens the rows behind it.

## Payment consistency — the dot strip on `/admin/payments` (Patterns)

- [ ] **Sorted by longest overdue RUN, not by count.** A member with three misses in a row
      must appear above a member with three scattered misses. Both have three; only one has
      stopped paying.
- [ ] **A late joiner's strip is SHORT, not full of holes.** Their dots start at their own
      start week. A strip padded out with empty weeks turns "joined in week 9" into "missed
      eight weeks".
- [ ] A week whose window is still open is **not** a red square.
- [ ] Overdue is findable with colour off — it is the only square dot. Deferred is hollow,
      partial is half-filled.
- [ ] Every dot's tooltip and every row name is reachable by keyboard, and each dot has a
      real hit area — a bare 8px dot in a row of twenty is not tappable at 390px.
- [ ] The "N in a row" badge appears at two or more, never at one.

## The savings ring — `/me`

- [ ] The figure inside the ring is what they have **paid in**, with the label above it.
- [ ] The sweep matches the figure: half the commitment saved is half the arc. Read the
      percentage from the screen-reader text (select the card and inspect) and compare.
- [ ] **Paying ahead fills the ring and stops.** Record more than the full commitment for a
      synthetic member. The ring must be **full** and the surplus stated in words beside it.
      *An over-full sweep wraps past the top and draws a shorter arc than someone who has
      saved less* — the exact opposite of the truth, and it looks completely normal.
- [ ] **Before the first payment there is no arc at all** — only the grey track. A round
      line cap on a zero-length arc renders as a **dot**, which reads as "you have saved a
      little" when the truth is nothing.
- [ ] The ring turns amber only when something is genuinely overdue, and green otherwise.
- [ ] With "Emulate `prefers-reduced-motion: reduce`" on (DevTools → `Ctrl+Shift+P`), the
      ring appears **already drawn** — no sweep animation.
- [ ] Still to save and Overdue below the ring stay distinct, and a member who is current
      sees no debt-shaped box at all.

---

# MEMBER PORTAL

Run these signed in as a **synthetic** member from `scripts/portal-test-fixture.mts`.

## Sign-in — `/login`

- [ ] Only channels that actually work are offered.
- [ ] An unregistered number gives a plain message.
- [ ] The PIN pad shows exactly the digits entered — **four dots for a four-digit PIN, no
      phantom fifth**.
- [ ] Backspace works and is disabled when empty.
- [ ] After signing in with the phone-digit default, setting a new PIN is required, not
      offered.
- [ ] A wrong PIN counts toward the lock; the lock message says when it lifts.
- [ ] At 390px the pad is reachable one-handed and the keys are at least 44px.

## Home — `/me`

- [ ] The savings ring — its own section under **THE CHARTS** above. Run those checks here.
- [ ] Paid in is the headline; paid in / still to save / overdue stay distinct.
- [ ] Their own week is never shown as owed in the week they won.
- [ ] The next payment date is the real next week.

## Schedule — `/me/schedule`

- [ ] Every week of their window, and no other week.
- [ ] Paid, partial, deferred and overdue each look distinct.
- [ ] A week whose window is still open is not called overdue.

## Collections — `/me/collections`

- [ ] Their payout shows gross, fee and net, and net = gross − fee.
- [ ] Before their draw it says so plainly rather than showing zeroes.

## Group — `/me/group`

- [ ] Only what the privacy rule allows about other members (2.8) — check the page source.
- [ ] Their own row is identifiable.

## Documents — `/me/documents`

- [ ] Every document opens.
- [ ] The empty state is a sentence, not a blank panel.

## Security — `/me/security`

- [ ] Their devices are listed with the last-seen time.
- [ ] "Sign out everywhere else" leaves this device signed in.
- [ ] A new-device notice appears once and does not nag afterwards.
- [ ] Changing their PIN takes effect on the next sign-in.

---

## Recording the result

Per screen, in this shape — the re-verification is the part that proves the loop looped:

```
SCREEN            390 light · 390 dark · 1280 light · 1280 dark
FOUND             what failed, with the measured value
FIXED             what changed, and why that is the right fix
RE-VERIFIED       the same check, re-run, with the new measured value
REMAINS           anything unresolved after 3 attempts, and the reason
```

A screen with nothing found still gets a line. "Nothing found" is a result, and its absence
is how a skipped screen hides.
