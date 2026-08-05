# The Self-Test Loop

The standing definition of "self-tested" for every build in this project. When a build
phase says *drive the real app and fix what you find*, it means ALL of this, repeated
until a full pass finds nothing.

Born from a real miss: the PIN pad rendered a phantom fifth dot after four digits. It
rendered fine, errored nothing, and had perfect contrast — the mechanical checks all
passed. It was WRONG, not BROKEN. The loop below exists so wrong-not-broken gets caught.

## Mechanical checks (necessary, never sufficient)

- Every screen renders with real data at the target viewports (mobile 390px, desktop,
  and 1280px for admin), in BOTH light and dark.
- Zero console errors.
- Text contrast measured, not assumed: secondary text ≥ 4.5:1 against its actual
  background in both themes (probe computed styles; the old app failed exactly here).
- Keyboard focus visible on every interactive element.
- Privacy: page source / RSC payload inspected wherever a boundary exists (2.8,
  presentation mode) — absent, not hidden.

## Behaviour and appearance checks (the ones that catch WRONG)

**INTERACTION SENSE** — for every interactive element, does it do what a user would
expect? Counters, indicator dots, progress states, and badges must match the actual
value EXACTLY — no off-by-one, no phantom slots, no placeholder that reads as missing
input. A completed action must LOOK complete; the user can always tell when they are
done.

**STATE HONESTY** — empty, loading, error, partial, and full states each look
deliberate. Nothing looks broken, unfinished, or accidental. An empty state invites; an
error explains and offers a way out; a partial state says what remains.

**VISUAL CORRECTNESS** — nothing misaligned, overflowing, clipped, cramped, or
inconsistent. The same component on different screens looks identical — compare them
side by side, do not assume.

**REAL-DATA STRESS** — exercise with: long Amharic names, the full roster (27 members),
all 20 weeks, zero values, very large amounts, a member with no phone, a late joiner
mid-window. Layout must hold on all of them.

**THE HONEST QUESTION** — after each screen, ask: *"would the organizer or a member
find this confusing, or think something is wrong?"* If yes, that is a finding — even if
nothing technically failed. Write it down and fix it.

## The loop itself

1. Drive the REAL running app with agent-browser as the real user (organizer or
   member), not as a DOM inspector.
2. Run every check above per screen. Record findings — including honest-question ones.
3. Fix everything found. Presentation-layer fixes never touch business logic.
4. Re-run the full pass. Do not stop at the first clean-looking pass; stop when a
   complete pass finds nothing.
5. Clean up every fixture the loop created (test people, temp admins, auth users).

Reference this file from any build phase that includes self-testing.
