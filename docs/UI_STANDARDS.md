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
