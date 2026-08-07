# The Self-Test Loop

The standing definition of "self-tested". When a build says *drive the real app and fix
what you find*, it means this — **repeated per screen until that screen passes**, not one
sweep with a list of findings at the end.

Born from a real miss: the PIN pad rendered a phantom fifth dot after four digits. It
rendered fine, errored nothing, and had perfect contrast — every mechanical check passed.
It was **wrong, not broken**. Everything below exists so wrong-not-broken gets caught.

**The two targets:**
- `docs/UI_STANDARDS.md` — what the screen must look like and do
- `docs/DOMAIN_RULES.md` — what the numbers on it must say

A screen passes only against both. A beautiful screen showing a wrong figure fails.

---

## The loop

```
for each SCREEN:
  for each VIEWPORT (390, 1280):
    for each THEME (light, dark):

      attempt = 1
      repeat:
        run the CHECKS below
        if nothing fails:  mark PASS, move to the next combination
        fix what failed
        attempt = attempt + 1
      until attempt > 3

      if still failing after 3 attempts:
        mark UNRESOLVED, record the reason, move on — do not loop forever
```

**The rule that makes it a loop:** after a fix, **re-run the same checks on the same
screen**. Do not move on while a screen is failing, and do not batch fixes across screens
and verify at the end — a fix for one screen routinely breaks another, and only
re-running catches it.

**Stop when** a complete pass over every screen finds nothing, or a screen has had three
attempts. Three is the cap because the fourth attempt is almost always the wrong model of
the problem, and an honest UNRESOLVED is worth more than a fifth guess.

---

## Per-screen checks

### A. Mechanical (necessary, never sufficient)

- [ ] Renders with **real data**. Zero console errors, zero page errors.
- [ ] **Contrast measured, not assumed.** Canvas probe; AA in both themes.
- [ ] **No horizontal page scroll.** `scrollWidth === clientWidth`.
- [ ] **Hit targets** ≥ 44px mobile / 32px desktop on every interactive element.
- [ ] **Focus visible** on every interactive element.
- [ ] **Privacy:** where a boundary exists (2.8, presentation mode), the data is *absent
      from the payload*, not hidden with CSS.

### B. Judgement (the ones that catch WRONG)

- [ ] **INDICATOR TRUTH** — every counter, dot, badge and progress bar equals the real
      value. Enumerate from the data, read from the DOM, compare. No off-by-one, no
      phantom slot.
- [ ] **STATE HONESTY** — empty, loading, error, partial, full each look deliberate.
- [ ] **VISUAL CORRECTNESS** — nothing misaligned, clipped, cramped. The same component
      looks identical to its other appearances; compare directly, do not assume.
- [ ] **REAL-DATA STRESS** — long Amharic names, the full roster, all weeks, zero values,
      very large amounts, a member with no phone, a late joiner mid-window.
- [ ] **NUMBERS AGAINST `DOMAIN_RULES.md`** — pick the figures on screen and check them
      against the rule that governs them. A payout must be gross − fee. "Overdue" must
      exclude weeks whose window is open.
- [ ] **VOCABULARY** — one word per concept (`UI_STANDARDS` rule 8). A second word for
      the same thing is a finding.
- [ ] **THE HONEST QUESTION** — *"would the organizer or a member find this confusing, or
      think something is wrong?"* If yes, that is a finding even when nothing failed.

---

## Probe notes, learned the hard way

**Measure contrast through canvas.** Tailwind 4 emits `lab()`/`oklch()`; no regex parses
them. Paint the computed colour into a 1×1 canvas and read the pixel back.

**Composite translucent layers bottom-up.** Folding the other way reports false failures
on anything with a `white/5` background.

**Handle covering siblings.** A filled `absolute inset-0` layer behind an icon and label
(the nav capsule) is *not an ancestor*. Ancestor-walking alone reports white-on-white and
produces a confident false failure at 1.01:1 where the truth is 17.85:1.

**Skip elements over background images** — there is no single colour to measure.

**`display` is not visibility.** A `<nav>` inside a `display:none` `<aside>` reports
`display: block`. Use `getBoundingClientRect().height > 0`.

**Duplicate landmark labels break element selection.** Two navs both labelled "Primary
navigation" means `querySelector` returns whichever is first in the DOM, not whichever is
on screen. Filter by rect.

---

## Driving it

1. Drive the **real running app** with agent-browser, as the real user (organizer or
   member) — not as a DOM inspector. Click the thing; do not call the action.
2. Both roles need a session. Use synthetic fixtures only
   (`scripts/portal-test-fixture.mts`, `scripts/bootstrap-admin.mts`).
3. **Never record test money against a real member.** Ever.
4. Fix in the presentation layer. A loop fix never changes business logic — if a screen is
   wrong because the logic is wrong, that is a separate change with its own tests.
5. **Clean up every fixture** the loop created: test people, temp admins, auth users,
   ledger entries, sessions. Verify the cleanup, do not assume it.

---

## Reporting

Per screen, in this shape — including the re-verification, which is the part that proves
the loop actually looped:

```
SCREEN            390 light · 390 dark · 1280 light · 1280 dark
FOUND             what failed, with the measured value
FIXED             what changed, and why that is the right fix
RE-VERIFIED       the same check, re-run, with the new measured value
REMAINS           anything unresolved after 3 attempts, and the reason
```

A screen with nothing found still gets a line. "Nothing found" is a result, and its
absence is how a skipped screen hides.
