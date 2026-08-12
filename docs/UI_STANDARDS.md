# UI STANDARDS

What "modern and usable" means **here**, in criteria that can be checked rather than
argued about.

**What this is for.** Taste is not the standard — a screen either meets these numbers or
it does not. `docs/SELF_TEST_LOOP.md` is the procedure that checks them; this is the
target. When something fails, the loop fixes it against this document rather than against
whoever is looking at the screen that day.

**Precedence.** `EQUB_GROUND_TRUTH.md` 2.25 (design comes after the logic is proven) and
2.10 (save feedback) win over this document. Where this document and a design skill
disagree, this document wins — it is the one the loop measures.

---

## 1. Contrast — measured, never assumed

**The rule.** Every text/background pair meets WCAG AA in **both** themes:

| Text | Minimum |
|---|---|
| Normal (< 18.66px, or < 24px if not bold) | **4.5:1** |
| Large (≥ 24px, or ≥ 18.66px bold) | **3:1** |
| UI component boundaries and focus rings | **3:1** |

**Measured how.** Tailwind 4 emits `lab()` and `oklch()`, which **no RGB regex can
parse**. Contrast must be measured by painting the computed colour into a 1×1 canvas and
reading the pixel back. The probe must also composite translucent layers bottom-up and
skip elements over background images, or it reports false failures of its own.

**Why this is rule 1.** The previous app failed exactly here: inactive nav labels were
`gray-400` at 10px, members could not see the other tabs, and they phoned the organizer.
It was not a crash and no test caught it.

**Known traps, each found by measuring:**

- `gray-500` on white is **4.34:1** — fails. Use `gray-600`.
- `gray-500` on the admin card in dark is **3.81:1** — fails. Use `gray-400`.
- White on `amber-600` is **3.2:1** — fails at 12px bold. Use `amber-700`.
- **The same component on two surfaces has two results.** The session list passed on the
  member portal card and failed on the lighter admin card. Measure every surface it
  appears on, not one.

**Check:** zero failures reported by the canvas probe on every screen, both themes.

---

## 2. Hit targets

| Context | Minimum |
|---|---|
| Mobile, primary controls | **44 × 44 px** (Apple HIG) |
| Mobile, dense rows and secondary actions | **40 × 40 px**, never below |
| Desktop pointer targets | **32 × 32 px** |
| Gap between adjacent targets | **≥ 8 px** |

**What counts as a target.** Buttons, inputs, selects, checkboxes, and any link that acts
as a control. **Not** an inline text link inside a sentence or a data-table cell — a
member's name in a 28-row table is *text that happens to navigate*, and forcing it to
44px would make the table unreadable, which is a worse outcome than the one the rule
protects against. Where such a link is the row's main action, the **row** carries the
target size.

This distinction is stated because the loop's probe reported 589 "failures" on one
screen, nearly all of them table-cell names — a rule that flags everything gets ignored.

**Documented exceptions**, each a decision rather than an oversight:

| Exception | Why |
|---|---|
| A link whose whole content is a **person's name** inside a list row | Text that navigates. The row is the target; inflating the name to 44px would double the height of a 28-member list and bury the figures next to it |
| The **payments grid** cells at mobile (36 × 32) | A 20-week × 28-member grid cannot have 44px cells on a 390px screen. The Members view is the mobile answer, and the screen offers both behind an explicit toggle. The grid is a desktop instrument, where its cells clear the 32px pointer floor |

An exception is only an exception when the alternative path exists and the user can reach
it. If the toggle ever disappears, the grid exception dies with it.

`touch-action: manipulation` on every tappable control, to drop the 300 ms delay.
Expand a small visual target with padding or a pseudo-element rather than shrinking the
touchable area — but expanded areas must not overlap.

**Safe area.** Any fixed bottom element carries `padding-bottom: env(safe-area-inset-bottom)`.
A bottom nav that ignores it puts labels under the iOS home indicator.

**Check:** measure `getBoundingClientRect()` on every interactive element at 390px. No
height below 40; primary actions at 44.

---

## 3. One component, one appearance

**The rule.** A component looks identical everywhere it appears. If two screens show the
same thing differently, one of them is wrong — and it is a finding even when both look
fine alone.

**How to check:** screenshot the component on every screen that uses it and compare
directly. Do not assume; the drift is usually a one-off `className` override.

**Corollary:** if a screen needs a variant, the variant belongs **in the component** as a
named prop, never as a local override at one call site.

---

## 4. Every state deliberate

Five states, each designed on purpose — never a byproduct:

| State | Requirement |
|---|---|
| **Empty** | Invites. Says what would appear here and how to make it appear. Never a bare "No data" |
| **Loading** | Skeleton or progress for anything over 300 ms. Never a blank region |
| **Error** | Explains what happened **and** offers a way out. Never a stack trace, never "unauthorized" |
| **Partial** | Says what remains, in figures (*"$500 of $750"*), not a vague badge |
| **Full** | Reads as finished. The user can tell they are done without checking |

**Worked (empty done right):** *"No carried balance. One appears if a cycle closes with
them short, or a terms change leaves a gap."*

**Worked (error done right):** *"You haven't used your account in a while, so we signed
you out. Sign in again to continue."* — not a 401 page.

---

## 5. Indicators match reality exactly

**The rule.** Counters, dots, progress bars, badges and step markers equal the real value.
No off-by-one. No phantom slot. No placeholder that reads as missing input.

**The founding defect:** the PIN pad drew a fifth dot after four digits. It rendered,
errored nothing, and had perfect contrast. It was **wrong, not broken**.

**Check per indicator:** enumerate the real value from the data, read the rendered value
from the DOM, assert they are equal — at zero, at one, at the maximum, and at one past
what the designer expected.

---

## 6. Save feedback (2.10)

Every mutating control follows the same four beats:

1. **Disabled until valid** — and until *dirty*. A Save that is live on an unchanged form
   invites a pointless write.
2. **Working** — the control shows it (*"Saving…"*), and is not clickable twice.
3. **Success is unmistakable** — a visible confirmation, and the screen reflects the new
   truth. Never a silent return to the same view.
4. **Failure shows the reason** — the actual reason, positioned at the control, with the
   state left intact so the user can retry without retyping.

**Destructive actions additionally:** a confirmation that states plainly what will happen
and what it affects, and for high-stakes ones a typed confirmation of the member's name.

### 6b. A refusal appears AT THE CONTROL that was pressed

> **The reason must render where the organizer is looking — beside the button, inside the
> panel, in the dialog that is still open. A banner at the top of the page is not enough,
> and on a long screen it is not feedback at all.**

Beat 4 above already said "positioned at the control". It was a clause inside a list, and
an audit of every admin surface found **fifteen** controls that ignored it. So it gets its
own rule, with the failure mode named.

**Why it is worse than no feedback.** The organizer presses Save. The server refuses for a
real reason. The refusal renders 370 lines up, above the fold, behind a scroll. He sees
nothing change and reports *"it did not save"* — with no error to quote, because from where
he sat there wasn't one. Debugging then starts from a false premise: everyone looks for a
swallowed exception, and the message was there the whole time.

That is exactly how the participation-save bug was reported, and the message was never
missing — `submitParticipation` set it correctly every time.

**The test.** With the control on screen and the page scrolled to it, can the reason be read
without moving? If not, it is misplaced. Specifically:

| Shape | Where the reason goes |
|---|---|
| Button in a panel or drawer | Inside that panel, adjacent to the button |
| Button at the foot of a long form | Beside the button — a top banner may *also* fire, never instead |
| Confirmation dialog | **In the dialog**, which stays open on failure. A dialog that closes and reports elsewhere has thrown the message away |
| Row action in a table or list | In that row, or in a slot pinned to it |
| Refusal knowable before the request | Say so at the control instead of round-tripping (see `saveParticipation`'s cap check) |

**Never discard the result.** `await action(...)` with no `if (!result.ok)` is the worst
case: the screen renders success over a refusal.

**Two examples already right, to copy:** `components/presentation-toggle.tsx` renders its own
failure *inside the button label* ("Could not switch — try again"); `components/admin/week-winner-editor.tsx:215`
puts a `role="alert"` slot in the editor block, two lines from the control it serves.

**Known violations, from the audit — real outstanding work, not a disclaimer:**

| Severity | Control | File |
|---|---|---|
| high | "Close the cycle" — writes every carried balance | `cycle/close/close-flow.tsx:282` → banner at `:85` |
| high | "Mark collected", "Save" (payout edit) | `collections/collections-view.tsx:649, :762` → banner at `:265` |
| high | "Review…" add/move a winner | `components/admin/week-winner-editor.tsx:290` → banner on the parent page |
| high | "Send N messages on WhatsApp" | `messages/compose-send.tsx:225` → error above the recipient list |
| high | "Create plan" | `wheel/setup/wheel-setup.tsx:643` → banner at `:283` |
| high | "Record" a ledger payment | `people/[id]/member-payments.tsx:252` → alert at `:492` |
| high | "Remove completely" / "keep the records" | `components/admin/remove-from-cycle.tsx:261` → alert at `:157` |
| high | "Record that they stopped" | `components/admin/close-participation.tsx:301` → alert at `:161` |
| high | Receipt row Save / Delete | `people/[id]/participation-editor.tsx:1081, :1128` → banner at `:503` |
| medium | Delete a cash reading · lucky-number row · "Record $X collected" · "Cancel" a plan | `cash-reading-panel.tsx:250` · `participation-editor.tsx:960` · `waiting-view.tsx:379` · `wheel-setup.tsx:655` |
| medium | **Result discarded entirely** — `recordCarryDecision` | `cycle/add/add-member-wizard.tsx:316` |
| low | "Review and assign…" | `people/[id]/assign-payout.tsx:328` |

---

## 7. Motion

Values come from `lib/motion-tokens.ts`. No inline durations or easings.

| Use | Duration |
|---|---|
| Press feedback | 100–160 ms |
| Tooltip, small popover | 125–200 ms |
| Dropdown, select | 150–250 ms |
| Modal, drawer, page transition | 200–400 ms |

- **Enter** `ease-out`; **exit** `ease-in`, and ~65% of the enter duration. Never `ease-in`
  on an entrance — it delays the first movement, exactly when the eye is watching.
- **Animate `transform` and `opacity` only.** Never `width`, `height`, `top`, `left`,
  `margin`, `padding`.
- **Never animate from `scale(0)`** — nothing in the world appears from nothing. Start at
  `0.95`.
- **Never `transition: all`.** Name the properties.
- **Reduced motion is gated, not decorative:** `useReducedMotion()` disables transforms;
  opacity-only fades at ≤ 0.2 s are the permitted fallback.
- **Do not animate high-frequency actions.** Something used hundreds of times a day
  should be instant.

---

## 8. Money and vocabulary

- **Money is always `tabular-nums`.** A column of figures that shifts as digits change is
  unreadable. Applies to counters, timers and week numbers too.
- **Cents as integers, formatted once** through `formatMoney`. Never a hand-rolled
  `toFixed(2)`.
- **One word per concept, platform-wide.** The current vocabulary:

| Concept | The word | Never |
|---|---|---|
| Money whose window has closed unpaid | **overdue** | outstanding, arrears, owing, due |
| What they have saved so far | **paid in** | contributed, total, collected |
| The remainder of the commitment | **still to save** | outstanding, remaining debt |
| Excused, still owed | **deferred** | skipped, excused, waived |
| Nobody owes it | **skipped** | deferred, cancelled |
| Balance cleared without payment | **written off** | paid, forgiven, cleared |

A second word for the same concept is a finding, not a style preference.

### 8b. No accounting words. He is not an accountant.

The organizer has run this Equb for six years with a notebook. He knows exactly what his
money is doing — he has never once called any of it a *balance* or a *position*. Every
word below appeared on a cash screen and every one of them made him stop and translate:

| Banned | Say instead |
|---|---|
| committed / committed to payouts | **promised to winners**, or **drawn but not handed out** |
| uncommitted | **not promised to anyone** |
| owed forward | **paid early for weeks that have not happened** |
| claimed / unclaimed | **handed out** / **not handed out yet** |
| free (of money) | **not promised to anyone** |
| net (as a noun) | **what is left**, or name the two figures |
| reconcile / reconciliation | **check what you are holding against the books** |
| expected holding | **what you should be holding** |

Two rules that go with the words, and matter more than the words:

1. **A cash position is FACTS ONLY.** Money in, money out, what is left. Every figure in
   it has already happened. A **projection never goes inside it** — the fee is what he
   *might* keep if the cycle finishes as planned, so it gets its own card, labelled an
   estimate, and is subtracted from nothing.
2. **Only money that has actually LEFT reduces what he holds.** A payout that is drawn but
   not handed over is still cash in his hand. State it beneath the figure as a sentence;
   never net it out. Understating what he holds is the direction that makes an organizer
   borrow money he did not need to borrow.

Enforced by `lib/cycle-position.test.ts` ("uses no accounting vocabulary in any verdict,
ever") and by `scripts/verify-cycle-position.mts` against live rows.

### 8c. Members read dates and their own counts. Cycle week numbers are ADMIN-only.

A cycle week number is the **organizer's administrative coordinate**. He runs a 20-week
cycle and lives in it all day. The member does not — they think *"I started on this date and
I am paying for ten weeks."*

The portal said:

> You joined in week 14. Your weeks run from 14 to 23 — you finish Sunday, October 18, 2026.

Two faults in one sentence. **Week 14 is a coordinate the reader has never seen.** And
**"joined in week 14" implies they came in late** to something already running, which is not
how an Equb works — 2.22 is explicit that everyone simply has their own window and that the
difference between them *"is normal"*. It now reads:

> You started Sunday, August 16, 2026 and you are paying for 10 weeks — you finish Sunday,
> October 18, 2026.

**One sentence shape for everybody**, so nobody's window reads as the exception. There is no
longer a branch on whether they started at week 1.

| Member surface | Never | Always |
|---|---|---|
| Their window | "your weeks run from 14 to 23" | a start **date**, a **count**, a finish **date** |
| Their week list | the cycle's week number | **their** ordinal — "week 3 of your 10" — or the date |
| Progress | "3 of 20 weeks paid" | "3 of 10 weeks paid" — **their** denominator |
| A draw | "you won in week 14" | "you won on Sunday, August 16, 2026" |
| A boundary | "before you joined" | "before you started — your weeks begin {date}" |
| The group page | "Week 12 of 20" | member counts and dates |

**The admin keeps cycle week numbers everywhere.** That is the organizer's frame and it is
correct there. Only `app/me/` and `components/member/` are bound by this rule.

One derivation: `lib/member-window.ts` (`memberWindowSentence`, `ownWeekNumber`,
`ownWeekLabel`, `ownProgressLabel`, `outsideWindowLabel`). Enforced by
`lib/member-vocabulary.test.ts`, a source scan over every member `.tsx` — proven
non-vacuous on the reported sentence, and proven not to fire on comments that quote it.

---

## 9. Navigation

**The standard.** Both the current location and the other destinations must be readable at
a glance, in both themes, without hunting.

- **Active state carries at least three signals**, never colour alone (`color-not-only`):
  surface, icon weight or fill, and font weight. A colour-only active state disappears in
  a bright room and for a colour-blind member.
- **Inactive labels are legible, not decorative.** They meet the same 4.5:1 as body text.
  This is the specific failure that made members phone the organizer.
- **Bottom nav ≤ 5 items**, each with an icon **and** a text label. Icon-only navigation
  destroys discoverability for non-technical members.
- **Safe area** handled (see rule 2).
- **`aria-current="page"`** on the active item.

### Design references (2.13 — Mobbin is the sanctioned source)

Navigation work designs toward these rather than re-deciding each time:

| Reference | What we take from it |
|---|---|
| [Truecaller](https://mobbin.com/screens/5ac800ad-606f-4f54-b0eb-f02d54904cf4) | **Primary.** Capsule behind the active item, and — critically — *every* label stays dark and legible, not just the active one |
| [komoot](https://mobbin.com/screens/0a24ef32-c81f-45af-8ef0-783658b2735e) | Active icon changes **fill weight**, giving a second non-colour signal |
| [Ladder](https://mobbin.com/screens/81249caf-390e-4980-82ce-bc588dec78d2) | Dark-theme treatment: the active item gets a distinct light surface rather than a tint |
| [Play](https://mobbin.com/screens/5a796023-ef12-4dc2-bf87-59a9c3c6daf9) · [Calm](https://mobbin.com/screens/f8e4bc27-30fe-40dc-b785-1da1f3707966) · [Quizlet](https://mobbin.com/screens/8b473941-73b2-47fc-9a46-b231145620d6) | Floating pill bar geometry |
| [Whatnot](https://mobbin.com/screens/d3d96f2d-2c3e-43bf-910f-9be20874841e) · [SoundCloud](https://mobbin.com/screens/7a9bf21f-c5be-4480-8b8e-97b856965f97) | Neutral chrome: active = near-black/white, inactive = grey. The highest-contrast pattern in the set |

**Financial screens** — for cards, figures and dashboards:
[Freenow](https://mobbin.com/screens/c1502ac6-38ff-41b0-b41b-8edf4229574f),
[CVS Health](https://mobbin.com/screens/966a6c3c-74a4-46ed-ae08-8ba990bf4ecf),
[Octopus Energy](https://mobbin.com/screens/4b9fab5e-e372-4781-b200-a44c9cd2f088).

---

## 10. Colour

**Brand.** Indigo means **money and identity** — the savings figure, primary actions,
member-facing accents. It is the product's colour and does not move.

**Chrome.** Navigation and structural surfaces use the **#42 "Banking / Traditional
Finance"** palette from the `ui-ux-pro-max` library:

| Token | Value | Use |
|---|---|---|
| Primary | `#0F172A` | Active nav surface in light |
| On primary | `#FFFFFF` | Its content |
| Muted foreground | `#64748B` | Inactive labels (darkened where measurement requires) |
| Border | `#E2E8F0` | Structural dividers |

**Why navy rather than a hue.** The primary is near-black, so an active item is the
**inversion of its bar** — 17.9:1 in light, inverted in dark — instead of a tint on a tint,
which is inherently lower contrast and is what the old nav did. It also leaves indigo free
to keep meaning "money" everywhere else, so chrome and content never compete.

**Semantics** (fixed): amber = attention/awareness, red = destructive/overdue,
emerald = good/complete, gray = neutral.

---

## 10b. Overlays

> **Every modal and sheet is portalled to `document.body` and positioned against
> the viewport. A transform on ANY ancestor silently breaks `position: fixed`.**

**The mechanism, because it is invisible.** Any element with a non-`none`
`transform`, `filter`, `perspective`, `will-change: transform`, or
`contain: paint` becomes the **containing block** for its `position: fixed`
descendants. `inset-0` then resolves against *that element*, not the viewport.

**How it actually failed here.** A confirmation on `/admin/collections` rendered
near the bottom of the document. It already used `position: fixed`. The breaker
was `<div class="animate-fade-in-up-2">`, whose finished CSS animation leaves:

```
transform: matrix(1, 0, 0, 1, 0, 0)
```

An **identity** transform — visually nothing at all, and still enough. Measured
at `scrollY 1019` in a 569px viewport, the panel's top sat at **−191px**.

Nobody adding a fade-in animation to a card would expect it to move a dialog on
another part of the page. That is why the rule is *always portal*, not *avoid
transforms*.

**Required of every modal / sheet:**

1. `createPortal` into `document.body` — never rendered inline at the trigger.
2. Overlay `position: fixed; inset: 0`, high z-index, centred with flexbox.
3. Body scroll locked while open, and the **exact** scroll position restored on
   close. `overflow: hidden` alone does not hold iOS Safari; pin the body with
   `position: fixed; top: -{scrollY}px` and put it back.
4. Focus trapped inside; Escape closes; **focus returns to the trigger**.
5. Long content scrolls **inside** the panel (`max-h-[85dvh]` + `overflow-y-auto`),
   never pushing past the top and bottom of the screen.
6. At 390px: full width minus margins, never wider than the viewport.

**Anchored popovers (select, date picker) are a different case.** They use
`position: absolute` inside their own `relative` wrapper, so they resolve
against that wrapper and ancestor transforms do **not** move them. Their failure
mode is *clipping*, not mispositioning: an ancestor with `overflow: hidden|auto`
cuts them off. `Table` wraps its children in `overflow-x-auto`, so a popover
rendered inside a table is at risk and needs portalling with measured anchor
positioning.

---

## 11. Layout and responsive

- **Breakpoints:** 390 (mobile), 768 (tablet), 1280 (admin desktop).
- **No horizontal page scroll, ever.** Wide content (tables, grids) scrolls **inside its
  own** `overflow-x: auto` container.
- **Body text ≥ 16px on mobile** (below it, iOS auto-zooms on focus).
- **Line length** 35–60 characters on mobile, 60–75 on desktop.
- **`min-h-dvh`, not `100vh`** on mobile.
- **Spacing on a 4px scale.**
- `text-wrap: balance` on headings; `text-pretty` on short body text.

---

## 12. Accessibility floor

- Visible focus ring on **every** interactive element (never `outline: none` without a
  replacement).
- `aria-label` on every icon-only control.
- Form inputs have **visible labels** — placeholder-only is not a label.
- Errors use `role="alert"`; status uses `aria-live="polite"`.
- Sequential heading levels, no skips.
- Colour is never the only carrier of meaning.
- Full keyboard operation, tab order matching visual order.

---

## The checklist

What the loop asserts per screen, per viewport, per theme:

- [ ] Renders with real data; zero console errors
- [ ] Contrast measured — zero failures (rule 1)
- [ ] Hit targets measured — none below minimum (rule 2)
- [ ] Shared components identical to their other appearances (rule 3)
- [ ] Empty / loading / error / partial / full all deliberate (rule 4)
- [ ] Every indicator equals its real value (rule 5)
- [ ] Save feedback complete on every mutating control (rule 6)
- [ ] Motion from tokens; reduced-motion respected (rule 7)
- [ ] Money tabular; vocabulary consistent (rule 8)
- [ ] Navigation active state and label legibility (rule 9)
- [ ] No horizontal scroll; layout holds under stress (rule 11)
- [ ] Focus visible; labels present; roles correct (rule 12)
- [ ] **Figures on screen agree with `docs/DOMAIN_RULES.md`**
- [ ] **The honest question:** would the organizer or a member think something is wrong?
