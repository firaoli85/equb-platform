# DESIGN-PASS QUEUE

Work the organizer has specified but deliberately **deferred** — it lands with the design
pass (2.25: screens are built plain and functional first; design is one deliberate later
pass across the whole platform).

Order is **audit-first**: the state-consistency backlog in `STATE_CONSISTENCY_AUDIT.md`
§9 is worked in severity order before anything here. Nothing in this file is started
early.

Each item records the organizer's own reasoning, because the reasoning is what makes the
placement decisions obvious later.

---

## 1. PAST CYCLES — IN ACCOUNT, NEVER ON THE HOME SCREEN

**Lands with:** member portal.

Members keep access to their completed cycles **permanently**.

> **Why (organizer):** it is their financial record, and without it the only copy sits
> with the organizer. If a carried balance exists, they must be able to see what they owe
> and where it came from.

This is 2.9 (readable archive, past cycles remain viewable) and 2.18 (the ledger keeps the
story) reaching the member side for the first time.

### Placement — so a past cycle can never be mistaken for the current one

| Member's situation | Home screen | Past cycles |
|---|---|---|
| **In the current cycle** | Exactly as now — unchanged | Under **ACCOUNT**. One quiet entry. **Not a tab. Not on the home screen.** |
| **Not in the current cycle** | One calm page: **"You're not in the current cycle."** with their most recent cycle summarised below. **No empty week grid**, nothing implying they are participating. | Same Account entry |

### What each past cycle must show

Unmistakably labelled and easy to read:

- cycle **name**
- **START and FINISH dates in full** — "May 17, 2026 to September 27, 2026"
- **total paid in**
- **what they received, and in which week**
- **closing balance** — "$0, complete" or "$2,000 outstanding" *with where it came from*

**Hard rule:** never show a past cycle's figures anywhere they could be mistaken for the
current one.

### Dependencies found while queuing this — read before starting

1. **The member portal cannot see a closed cycle at all today.** `getMyPortal`
   (`app/actions/member.ts:50`) queries
   `participation.findFirst({ where: { personId, status: "ACTIVE", cycle: { status: "ACTIVE" } } })`,
   and `getGroupProgress` / `getMemberCollections` filter the same way (`member.ts:261`,
   `:340`). The moment a cycle closes, every member loses their whole record — this is
   recorded as a **HIGH** finding (§9 #17) and is the real blocker for this item. It must
   be fixed first, and fixing it *is* most of the work here.
2. **`CycleArchive` is admin-only.** It is read from `app/actions/cycle-close.ts` and the
   two `app/admin/...` archive pages, and from **no member route**. Deciding whether the
   member view reads the archive JSON or the surviving relational rows is the first design
   question — 2.9 says the archive is the readable record, so it is the natural source,
   but a *deleted* cycle leaves only the archive while a merely *closed* one still has
   live rows.
3. **The "not in the current cycle" state already exists as an accident.** Today it is
   whatever the ACTIVE filter happens to render — not a designed page. This item is what
   turns it into one.

---

## 2. SHOW-PASSWORD TOGGLE ON ADMIN LOGIN

**Lands with:** the design pass over `/admin/login`.

An eye toggle on the password field at `/admin/login`, so the organizer can see what he
typed.

**Accessibility is part of the requirement, not a follow-up:**

- a **real `<button>`**, not a styled `div` or an icon with a click handler
- **labelled** — "Show password" / "Hide password"
- **keyboard reachable** — in the tab order, activated by Enter and Space
- **state announced** — `aria-pressed`, so a screen reader says whether the password is
  currently visible

Follows `docs/UI_STANDARDS.md` for hit target and control sizing.

---

## NOTED, NOT QUEUED

### Passkeys — a post-deploy idea

Supabase Auth has **no native passkey support**, so adding them would mean implementing
**WebAuthn** directly: credential creation and assertion, challenge storage, per-device
credential records, and recovery when every registered device is lost.

**That is a real build, not a toggle.** Recorded so the idea is not lost. Revisit after
deploy — never as a quick win, and never as a substitute for the show-password toggle
above, which is a different problem (seeing what you typed) with a five-minute answer.
