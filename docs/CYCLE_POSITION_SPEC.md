# THE CYCLE POSITION — SPEC (queued, not yet built)

Two specs the organizer gave by name, in order. They are one build: the second compares
against the first, so the first must land before the second can be checked against it.

> **The point, in his words:** "am I in negative, am I using someone else's money, or am
> I on track." And: *"if it's negative, I'm using other people's money. If it's positive,
> I'm good. And if I have to borrow, I know how much."*

This is the number he has calculated by hand for six years.

---

## PART 1 — `/admin/this-week`: ADD A WEEK SELECTOR

He likes this page: paid / not paid / partial, split into sections.

- Add a dropdown to choose **any** week, not only the current one, showing the same
  information for that week.
- **Default to the current week.**
- **Keep everything else exactly as it is.** This is an addition, not a redesign.

---

## PART 2 — REPLACE `/admin/cycle/weeks` WITH THE CYCLE POSITION

That page exists to skip weeks. **There are no skipped weeks in an Equb — every week is a
commitment.** Remove the skip concept from the UI and rebuild the page as the whole-cycle
money picture.

> Removing skip from the **UI** is not the same as removing `Week.isSkipped` from the
> schema. The column is read by the standing engine, the settlement, the archive and the
> close. Ripping it out is a separate, larger change; this spec covers the surface only.

At the current week, state plainly:

| Figure | Definition |
|---|---|
| **Should have been collected** | sum of every elapsed week's expectations |
| **Actually collected** | what has come in |
| **Shortfall** | the difference — **and who makes it up**: how many members owe, and how much |
| **Paid ahead** | money received for weeks that have **not yet elapsed**, with how many members paid ahead and by how much. **This is the piece he cannot see today.** |
| **Therefore** | how much of what he holds is genuinely *this cycle's collection* versus money owed forward |
| **Alongside** | paid out to date, still committed to pending payouts, and what remains |

Say it in plain English computed from the data, the way the dashboard's cash sentence
does.

---

## PART 3 — WHAT HE SHOULD BE HOLDING (derived)

The system already knows total received, total paid out, and what is committed to pending
payouts. State the expected cash position plainly, **separating the parts**:

- money **owed forward** (paid ahead — not his to spend)
- money **committed to pending payouts** (already promised)
- his own accumulated **FEE** (genuinely his)
- what **remains uncommitted**

> **The fee matters:** a positive difference may simply be his fee accumulating, not a
> surplus. **Say which it is.**

---

## PART 4 — WHAT HE ACTUALLY HOLDS (he enters it)

A simple entry: the real cash figure across bank and cash on hand — allow one total, or
separate lines if that is clearer. **Dated**, so it is a reading at a moment in time.

**Store each reading as a record** with its date and an optional note — **a small model,
not a setting** — so he can look back at what he held in week 8 versus week 12.

This is the **only stored fact** in the whole feature. Everything else is derived (2.14).

### Schema sketch (needs a migration — not yet written)

```prisma
model CashReading {
  id          String   @id @default(cuid())
  cycleId     String?  // nullable: a reading is about HIM, not only one cycle
  /** Cents. One total, or the sum of the lines below. */
  totalAmount Int
  bankAmount  Int?
  cashAmount  Int?
  readAt      DateTime
  note        String?
  createdAt   DateTime @default(now())
  @@index([readAt])
  @@map("cash_readings")
}
```

---

## PART 5 — THE ANSWER, IN PLAIN ENGLISH

Compare expected against actual and say **what it means**, computed. His own examples:

> "You hold **$2,300 MORE** than expected. **$8,350** of what you hold is your fee, so you
> are covered."

> "You hold **$4,000 LESS** than expected. You are short by $4,000 against what members
> are owed — you would need to cover that before the next payout."

**Never just print a number.** State whether he is **covered**, **in surplus**, or
**short**, and by how much — and when short, what he would need to make it right.

---

## PART 6 — HISTORY

A small list of past readings with **the difference at each**, so drift over the cycle is
visible rather than only today's snapshot.

---

## RULES THAT APPLY TO ALL OF IT

- Everything except the entered figure is **DERIVED** (2.14); the reading is the only
  stored fact.
- Figures **agree exactly** with the dashboard and with standing — one derivation, not
  several. (`lib/dashboard.ts` and `lib/standing.ts` are the existing sources; the new
  work extends them rather than recomputing alongside them.)
- **Paid-ahead is money on weeks whose window has NOT elapsed** — use the stored-date
  elapsed rule, not a projection off the start date.
- **Every figure drills down to who makes it up.**
- **Respects presentation mode** — this is the most sensitive screen in the platform.
- `requireAdmin`; **members never see any of it.**

## TESTS REQUIRED

- paid-ahead detection (against the stored-date elapsed rule)
- the should-vs-actual arithmetic
- the expected position **including fee and paid-ahead**
- the **short** and **surplus** sentences
- agreement with the dashboard, asserted rather than assumed
