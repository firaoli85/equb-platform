# WhatsApp Content templates — approved by Meta

**Status: LIVE AND DELIVERING (13 August 2026).** Approved by Meta 7 August
2026, ContentSids recorded below, and the send path sends by
`ContentSid` + `ContentVariables` — there is no freeform `Body` path. Four of
the five deliver to real members today (PAYMENT_CONFIRMED, BEHIND_NOTICE,
LATE_NOTICE, WINNER_ANNOUNCEMENT); CYCLE_CLOSING_STATEMENT is approved and
wired, and has its first real use when the cycle closes. The sender is
**+1 301 683 5755** (WABA 1018506704190290, business verified) — the five
approved templates carried over to it. WHATSAPP_WELCOME is drafted below and
**not yet submitted**.

The five bodies below are the text that was submitted. They are now the wording
of record: changing any of them means re-submitting that template and waiting
for approval again.

Read alongside [WHATSAPP_TEMPLATE_ONLY.md](WHATSAPP_TEMPLATE_ONLY.md), which
explains why statements need these at all.

---

## Approved templates and ContentSids

| Template | Twilio name | ContentSid | Language | Approved |
|---|---|---|---|---|
| PAYMENT_CONFIRMED | payment_confirmed | HX87cb0a437434f7f9bba329958c74544a | en | 2026-08-07 |
| BEHIND_NOTICE | behind_notice | HX8bb8e24a790e8fafd81f232ecfe6e8dc | en_US | 2026-08-07 |
| LATE_NOTICE | late_notice | HXc25be8d015fc1d36a6b0caf3ebf89823 | en_US | 2026-08-07 |
| WINNER_ANNOUNCEMENT | winner_announcement | HX2774ec28d2785140d4610ba2f947f6e5 | en_US | 2026-08-07 |
| CYCLE_CLOSING_STATEMENT | cycle_closing_statement | HX517e5e10d8f11e741789b5c6ebed9565 | en_US | 2026-08-07 |

- `payment_confirmed` was created as language `en`; the other four as `en_US`.
  This has no effect on sending, because messages are addressed by ContentSid,
  not by language. Recorded so the inconsistency is not later mistaken for a
  defect.
- Sample variable values were supplied at save time in Twilio's "Sample
  variables" dialog, using the rendered examples in this document.
- The "+ Add variable" button in the Content Template Builder appends a NEW
  variable to the body; it does not expose sample fields for existing ones.
  Sample values are collected in a dialog that opens on Save.
- Editing an approved template requires re-approval, and Twilio greys out the
  Edit action once a template is submitted. The in-app template editor now
  surfaces exactly this: the five approved templates are locked read-only with
  the approved-wording note, and the server refuses a wording edit
  (`templates-editor.tsx`, `app/actions/messages.ts`) — "Things to decide
  before submission" item 1, resolved.
- LOCKOUT_NOTICE remains undrafted and unsubmitted.

---

## Two findings that change the shape of every template

### 1. A template may not begin or end with a variable

Meta rejects a body that starts or ends with `{{n}}` — a "dangling parameter" —
because with no fixed text around it, the reviewer cannot tell what the message
actually says.

**All six of our current templates begin with `{name},`.** Every one would be
rejected as written. This is the single largest change below: each body now
opens with fixed text (`Hi {{1}},`) and closes with a fixed sentence.

The related guidance is roughly **three words of fixed text per variable**, so a
reviewer can read the message. Every draft below clears that.

### 2. A member's name IS allowed in a UTILITY template

The question was whether Meta restricts names in UTILITY. It does not —
names and other per-recipient values are explicitly expected in utility
templates. The restriction is on *position*, not on the name itself: it may not
be the first thing in the body. `Hi {{1}},` is the standard fix and is what all
five use.

---

## Category: all five are UTILITY

Meta's test for utility is two-part — a template must be **non-promotional**,
**and** be specific to the recipient's own transaction, account, or order.

All five qualify on both counts. Each one reports the member's own money in
their own Equb: a payment recorded, a balance, a payout, a closing position.
None sells, offers, invites, upsells, or persuades. Nothing is conditional on
the member doing something for our benefit.

**Why the category matters:** utility templates are cheaper than marketing ones
and approve more readily. A template that reads as promotional is not rejected
outright — it is silently **re-categorised** as marketing, and then billed and
rate-limited as marketing. Mixed content is the usual cause: one promotional
sentence inside an otherwise transactional message re-categorises the whole
thing.

**What would break the category, so do not add it later:** "exclusive",
"limited", "offer", "deal", "upgrade", "don't miss", any invitation to join the
next cycle, or any request for a rating or general feedback. A generic feedback
request is specifically named as not approvable as utility.

---

## The five templates

Variables are numbered `{{1}}`, `{{2}}`, … in the order they appear — Meta
requires sequential numbering with no gaps. At send time these become
`ContentVariables`, a JSON object keyed `"1"`, `"2"`, … Money and dates must
arrive already formatted inside the value; `placeholderValues()` in
[lib/messages.ts](../lib/messages.ts) already does this through `formatMoney`.

The example figures are real, from **Cycle 1 2026** (ACTIVE, 20 weeks,
$1,000 unit, 2% fee, started 17 May 2026, 27 participants, currently week
12). The **names are not real** — a member's name next to their own arrears
does not belong in a repo.

---

### 1. PAYMENT_CONFIRMED — automatic (2.20)

Sends itself when the organizer marks a payment. The only automatic one of the
five.

**Body**

```
Hi {{1}}, we received {{2}} for your Equb — recorded on week(s) {{3}}. You have paid {{4}} of {{5}} weeks. Thank you.
```

| Var | Fills from `placeholderValues()` | Notes |
|---|---|---|
| `{{1}}` | `name` | `standing.name` — first name |
| `{{2}}` | `amountReceived` | `extras.amountReceived`, via `formatMoney` |
| `{{3}}` | `weeksCovered` | `formatWeekList(extras.weeksCovered)` — "8" or "8–10" |
| `{{4}}` | `weeksPaid` | `min(weeksCredited, weeksCommitted)` |
| `{{5}}` | `weeksTotal` | `weeksCommitted` |

**Rendered**

> Hi Sara, we received $2,000 for your Equb — recorded on week(s) 11–12. You have paid 12 of 20 weeks. Thank you.

---

### 2. BEHIND_NOTICE — manual. A record, never a threat.

**Body**

```
Hi {{1}}, your Equb record as of week {{2}}: last payment week {{3}}, and {{4}} weeks behind, {{5}} outstanding. Please contact Firaoli with any questions.
```

**The "and" between `{{3}}` and `{{4}}` is deliberate — do not tidy it away.**
Without it the two variables are separated only by a comma, and Meta lists
adjacent variables as not recommended. A rejection would have permanently burned
the template name `behind_notice`, so the word was added before submission
rather than risk it. This is the approved body; removing the "and" means
re-approval.

The variable table is unchanged by it — still five variables in the same order,
so `placeholderValues()` needs no change.

| Var | Fills from | Notes |
|---|---|---|
| `{{1}}` | `name` | |
| `{{2}}` | `week` | current cycle week |
| `{{3}}` | `lastPaymentWeek` | `"—"` when they have never paid |
| `{{4}}` | `weeksBehind` | derived, 2.14 |
| `{{5}}` | `amountOwed` | true outstanding, deferred weeks included |

The closing line is deliberate: it offers a person to talk to instead of a
demand. The message states the position and stops — that is the whole of 2.21.

**Rendered**

> Hi Sara, your Equb record as of week 12: last payment week 5, and 7 weeks behind, $7,000 outstanding. Please contact Firaoli with any questions.

---

### 3. LATE_NOTICE — manual. Documented, no pressure.

**Body**

```
Hi {{1}}, your Equb week(s) {{2}} closed without a payment recorded. Your balance is {{3}} outstanding across {{4}} weeks. Please contact Firaoli if this does not match your records.
```

| Var | Fills from | Notes |
|---|---|---|
| `{{1}}` | `name` | |
| `{{2}}` | `lateWeeks` | only `status === "LATE"` weeks; deferred never appear |
| `{{3}}` | `amountOwed` | |
| `{{4}}` | `weeksBehind` | |

"closed without a payment recorded" is a statement about our books, not an
accusation. The closing invites correction rather than payment — if our record
is wrong, the member is the one who would know.

**Rendered**

> Hi Sara, your Equb week(s) 6–10 closed without a payment recorded. Your balance is $5,000 outstanding across 5 weeks. Please contact Firaoli if this does not match your records.

---

### 4. WINNER_ANNOUNCEMENT — manual. They receive this week.

**Body**

```
Hi {{1}}, your Equb payout for week {{2}} is {{3}}. Your contributions continue to week {{4}}. Firaoli will arrange the handover.
```

| Var | Fills from | Notes |
|---|---|---|
| `{{1}}` | `name` | |
| `{{2}}` | `week` | `extras.drawnWeek` |
| `{{3}}` | `payoutAmount` | `extras.payoutNet` — **net**, after the 2% fee |
| `{{4}}` | `finishWeek` | their own window end (2.22) |

The second sentence is doing real work: receiving does not end the obligation,
and saying so in the same breath prevents the most expensive
misunderstanding in the whole system.

Dropped from the current version: `weeksPaid`, `weeksTotal`, `weeksLeft`,
`finishDate`. Six variables became four. A payout message should read as one
clear fact, and the full position is always in the portal.

**Rendered**

> Hi Sara, your Equb payout for week 12 is $9,800. Your contributions continue to week 20. Firaoli will arrange the handover.

*(Real figures: $10,000 gross, 2% fee $200, $9,800 net.)*

---

### 5. CYCLE_CLOSING_STATEMENT — manual. Final position at close.

**Body**

```
Hi {{1}}, your Equb closing statement: you paid {{2}} of {{3}} weeks, {{4}} in total. Outstanding balance {{5}}. Please contact Firaoli to confirm.
```

| Var | Fills from | Notes |
|---|---|---|
| `{{1}}` | `name` | |
| `{{2}}` | `weeksPaid` | |
| `{{3}}` | `weeksTotal` | |
| `{{4}}` | `totalPaid` | everything paid this cycle |
| `{{5}}` | `amountOwed` | `$0` when settled — say it, don't hide it |

**Rendered**

> Hi Sara, your Equb closing statement: you paid 18 of 20 weeks, $18,000 in total. Outstanding balance $2,000. Please contact Firaoli to confirm.

---

## Variable count, before and after

Every variable is a chance for the `21656` "ContentVariables Parameter is
invalid" failure, which is what one send already hit.

| Template | Now | Drafted |
|---|---|---|
| PAYMENT_CONFIRMED | 5 | 5 |
| BEHIND_NOTICE | 6 | 5 |
| LATE_NOTICE | 5 | 4 |
| WINNER_ANNOUNCEMENT | 6 | **4** |
| CYCLE_CLOSING_STATEMENT | 5 | 5 |

Further reduction is possible by combining values into one variable — `{{4}}`
carrying `"12 of 20"` instead of two separate numbers. It is not proposed here
because it moves formatting decisions out of the template and into code, where
the organizer cannot see them. Worth doing only if variable mismatches turn out
to be a recurring problem in practice.

---

## Things to decide before submission

**1. Editing an approved template means re-approval.** Ground truth 2.20
promises editable templates — "wording, tone, and which facts appear". For
WhatsApp that becomes: edit freely, but the edited version does not send until
Meta approves it again. The in-app editor should say so, or an organizer will
change a word and quietly stop being able to send. This is the one place where
2.20 and Meta's rules genuinely conflict, and it needs a decision rather than a
workaround.

**2. "Firaoli" is baked into three of the five.** It is fixed text, so a change
of organizer means re-approval. The alternative is a sixth variable, which
costs a `21656` risk on every send. Recommendation: leave it fixed — the name
changes far less often than the messages send.

**3. LOCKOUT_NOTICE is the sixth key and is not drafted here.** It was outside
the five requested. It is also the one message that may not need a Content
template at all: it is authentication-adjacent, and if it moves to Twilio
Verify it inherits Verify's approved template like the login code does. Worth
settling before submitting, so it is not submitted unnecessarily.

**4. Language.** These are English-only. Members' names render bilingually in
the portal (`nameEnglishFirst` / `nameAmharic`), and Meta supports per-language
template variants — each is a separate submission and approval.

---

## After approval, in code

**Approved 7 August 2026**, category UTILITY. Build 1 is done; Build 2 is not.

**Done (Build 1):**

1. ✅ The five ContentSids are recorded on their `MessageTemplate` rows, and the
   bodies are rewritten to the approved wording in `{name}` form.
   [lib/whatsapp-templates.ts](../lib/whatsapp-templates.ts) is the source of
   truth; `scripts/sync-approved-templates.mts` writes the database from it.
2. ✅ Two drift guards fail the build if the registry or the stored bodies stop
   matching what Meta approved — because Twilio sends by `ContentSid`, so an
   edit in the app changes what the organizer *reads*, never what a member
   *receives*.
3. ✅ `LOCKOUT_NOTICE` is deliberately left with no ContentSid and no registry
   entry. It has no approved template and must not gain one by accident: a
   lockout notice is a security message, and Twilio Verify is its channel.

**Done (Build 2):**

4. ✅ **The send path is written and live.** `sendWhatsAppMessage` posts
   `ContentSid` + `ContentVariables`; there never was a `Body` path to migrate
   away from. Delivery status is classified honestly — Twilio's 201/"queued"
   is logged **ACCEPTED**, and **SENT** is written only when a StatusCallback
   confirms it (which requires a public `APP_BASE_URL`, so local sends stay
   ACCEPTED).
5. ✅ **An incomplete variable set is refused, not delivered.**
   `buildContentVariables` rejects a missing or dashed money placeholder and a
   template's `requiredExtras` are checked before rendering — the
   approval-sample failure mode below cannot reach a member.
6. ✅ `STATEMENTS_DELIVERABLE` is **deleted**, not flipped. Statements deliver;
   a global flag would only be a second copy of the registry's answer. A type
   with no ContentSid (the welcome, the lockout notice) refuses ITSELF in
   `deliver()` with a reason derived from the registry, so nothing depends on
   a constant somebody must remember to update.

---

## ⚠️ The sample values are wrong, on purpose, and cannot be fixed

The sample variable values submitted to Twilio at approval used the **incorrect
`.00` form** — `$7,000.00` where `formatMoney` actually produces `$7,000`
(cents are omitted when the remainder is zero).

**This is harmless as it stands.** Samples are fallback defaults shown to Meta's
reviewers, not content. They are never sent when `ContentVariables` is complete.
They also **cannot be corrected without forcing re-approval**, which would take
all five templates out of service for the sake of two characters in a document
nobody reads.

**But it means the failure mode is silent and dangerous.** If `ContentVariables`
is ever incomplete at send time — a missing key, a typo'd placeholder name, an
undefined value — Twilio does not error and does not leave a blank. It
**substitutes the sample**. A member then receives a message with a *fabricated
name* and *invented figures*, presented with the same authority as a real
statement: "Hi Sara, we received $2,000.00 for your Equb" sent to someone who is
not Sara and paid nothing.

**Build 2 must make an incomplete variable set structurally impossible.** Not
validated at send time — impossible to construct. The type work has started:
`variableOrder` is typed as `PlaceholderName`, read off `placeholderValues`
itself, so a name that function does not return is already a compile error.

**Sources for the Meta rules above:**
[Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization) ·
[Template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview) ·
[Dangling-parameter rejections](https://help.businesschat.io/en/articles/12302864-fixing-whatsapp-template-rejections-caused-by-dangling-parameters) ·
[Rejection reasons](https://docs.aws.amazon.com/social-messaging/latest/userguide/managing-templates_rejection.html)

---

# REWORK — cycle week numbers must leave the member's messages

**Status: DRAFTED FOR SUBMISSION — not yet registered.** The four live
templates still send the 7 August wording above; nothing switches until a
reworked body's new ContentSid is recorded in
[lib/whatsapp-templates.ts](../lib/whatsapp-templates.ts) (the registry is the
source of truth, and the drift guards hold the database to it). When Meta
approves a reworked body, replace that template's ContentSid and approvedBody
in the registry, run `scripts/sync-approved-templates.mts`, regenerate and
restart — that is the whole switchover.

## The defect, from live use

Henok joins at week 14 and receives *"Your contributions continue to week 23."*
He has no idea what week 23 is. He is thinking **"I am paying for 10 weeks"** —
his own count, from his own start.

Cycle week numbers are the **organizer's** frame. They were removed from the
member portal for exactly this reason (UI_STANDARDS 8c: the portal speaks dates
and the member's own counts, never the cycle's week numbers). The templates were
missed, so the one surface that reaches a member on their own phone is still the
one speaking the organizer's language.

The rule the rework applies, unchanged from 8c:

| Frame | Belongs to | Example |
|---|---|---|
| Cycle week number | the ORGANIZER | "week 23" — never in a member message |
| A date | everyone | "Sunday, October 18, 2026" |
| The member's own count | the MEMBER | "9 more weekly payments", "13 of 20 weeks" |

**"You have paid 13 of 20 weeks" stays.** That is already their own count, and it
is the sentence members quote back. Only the CYCLE-frame numbers go.

---

## What needs re-approval, and what does not

Changing a body means **re-submitting that template to Meta and receiving a new
ContentSid**. It is not an edit — the approved text is a document Meta holds, and
the current ContentSid points at the current wording. Until the replacement is
approved, the OLD wording is what sends.

| Template | Body changes? | Re-approval | Why |
|---|---|---|---|
| PAYMENT_CONFIRMED | **yes** | **required** | "recorded on week(s) 11-12" is a cycle frame |
| BEHIND_NOTICE | **yes** | **required** | "as of week 13" and "last payment week 11" are both cycle frames |
| LATE_NOTICE | **yes** | **required** | "week(s) 11-12 closed" is a cycle frame |
| WINNER_ANNOUNCEMENT | **yes** | **required** | "payout for week 12" and "continue to week 23" — the defect Henok reported |
| CYCLE_CLOSING_STATEMENT | **no** | **none** | every figure is already the member's own count or a money amount |
| LOCKOUT_NOTICE | n/a | n/a | never approved, never sent over WhatsApp (see the header of `lib/whatsapp-templates.ts`) |

**Four of five need re-approval. One is already correct.**

Sequencing note: submit all four together. Each approval produces a new
ContentSid, and `contentSid` + `approvedBody` must be updated in
`lib/whatsapp-templates.ts` **in the same commit** — a mismatched pair sends one
wording under the other's id.

---

## The four reworked bodies

Meta's two shape rules still apply to every draft below: no body begins or ends
with a variable, and there are at least three words of fixed text per variable.

### 1. PAYMENT_CONFIRMED — replace the week list with a count

The receipt covered three weeks. The member does not need to know *which* three
in the cycle's numbering — they need to know how much arrived and where they now
stand.

**Now**

```
Hi {{1}}, we received {{2}} for your Equb — recorded on week(s) {{3}}. You have paid {{4}} of {{5}} weeks. Thank you.
```

**Draft**

```
Hi {{1}}, we received {{2}} for your Equb. That covers {{3}}, and you have now paid {{4}} of {{5}} weekly payments. Thank you.
```

| Var | Fills from | Change |
|---|---|---|
| `{{1}}` | `name` | — |
| `{{2}}` | `amountReceived` | — |
| `{{3}}` | **`weeksCoveredCount`** — NEW | "3 weeks" / "1 week", not "11-13" |
| `{{4}}` | `weeksPaid` | — |
| `{{5}}` | `weeksTotal` | — |

> Hi Sara, we received $1,500.00 for your Equb. That covers 3 weeks, and you have
> now paid 12 of 20 weekly payments. Thank you.

**Code needed:** one new placeholder, `weeksCoveredCount`, derived from the
`weeksCovered` extra already passed. No new database read.

**DECIDED — the count (organizer ruling, Aug 2026).** The alternative was "That
covers the weeks of August 9, August 16 and August 23", which needs the week
DATES in `MessageExtras`, a path that does not carry them. It also grows without
limit: a member catching up on eight weeks gets an eight-date sentence. The count
is shorter, it never overflows, and it is the number they are holding in their
head.

This is the ONE place in the rework where a count replaces a date rather than the
other way round, and the reason is that the underlying fact is genuinely a count:
the member's question is "how much of my backlog did that clear", not "which
Sundays". `{{3}}` renders `weeksCoveredCount` — "3 weeks", or "1 week".

---

### 2. BEHIND_NOTICE — a date for "as of", a date for the last payment

**Now**

```
Hi {{1}}, your Equb record as of week {{2}}: last payment week {{3}}, and {{4}} weeks behind, {{5}} outstanding. Please contact Firaoli with any questions.
```

**Draft**

```
Hi {{1}}, your Equb record as of {{2}}: your last payment was for the week of {{3}}, you are {{4}} weekly payments behind, and {{5}} is outstanding. Please contact Firaoli with any questions.
```

| Var | Fills from | Change |
|---|---|---|
| `{{1}}` | `name` | — |
| `{{2}}` | **`asOfDate`** — NEW | "August 10, 2026", not "week 13" |
| `{{3}}` | **`lastPaymentDate`** — NEW | the DATE of that week, not its number |
| `{{4}}` | `weeksBehind` | their own count — kept |
| `{{5}}` | `amountOwed` | — |

> Hi Sara, your Equb record as of August 10, 2026: your last payment was for the
> week of July 26, 2026, you are 2 weekly payments behind, and $1,000.00 is
> outstanding. Please contact Firaoli with any questions.

**Code needed:** `asOfDate` (the send moment — no lookup) and `lastPaymentDate`
(the stored date of `lastPaymentWeek`'s row — 2.14, the day that actually
belonged to that week, never a projection).

**A member who has never paid** renders `lastPaymentDate` as the no-value dash
today. That reads badly mid-sentence. **Recommendation: BEHIND_NOTICE is not
applicable to someone who has never paid** — they get the first-payment
conversation, not a record of one. If you want it sendable anyway, the sentence
needs a second approved variant, which is a second Meta submission.

---

### 3. LATE_NOTICE — dates, and their own count

**Now**

```
Hi {{1}}, your Equb week(s) {{2}} closed without a payment recorded. Your balance is {{3}} outstanding across {{4}} weeks. Please contact Firaoli if this does not match your records.
```

**Draft**

```
Hi {{1}}, your Equb payment for the week of {{2}} has not been recorded. Your balance is {{3}} outstanding across {{4}} weekly payments. Please contact Firaoli if this does not match your records.
```

| Var | Fills from | Change |
|---|---|---|
| `{{1}}` | `name` | — |
| `{{2}}` | **`lateWeekDates`** — NEW | "August 2, 2026" or "August 2 and August 9, 2026" |
| `{{3}}` | `amountOwed` | — |
| `{{4}}` | `weeksBehind` | their own count — kept |

> Hi Sara, your Equb payment for the week of August 2, 2026 has not been
> recorded. Your balance is $1,000.00 outstanding across 2 weekly payments.
> Please contact Firaoli if this does not match your records.

**"week of" is singular in the fixed text.** With several late weeks the sentence
reads "the week of August 2 and August 9, 2026", which is grammatically loose but
clear. The alternative — "your Equb payments for {{2}}" — reads worse for the far
more common single-week case. **Recommendation: keep the singular framing.** Most
late notices name one week.

**This template now has a second trigger.** With the manual late mark (2.2) the
organizer can mark a week late before its window closes, and this notice becomes
sendable immediately. The wording above is true either way: it says the payment
"has not been recorded", which is the fact in both cases, and deliberately does
**not** claim the week "closed" — under a manual mark it has not.

**A DEFERRED week never reaches this notice.** Deferral beats the mark (ruling,
Aug 2026): a deferred week reads DEFERRED whatever else is true of it, so it
never appears in `lateWeeks` and never names itself here. That is the whole
purpose of deferral — a chase must not reach someone the organizer has decided
not to pursue.

---

### 4. WINNER_ANNOUNCEMENT — the one Henok reported, twice

**Now**

```
Hi {{1}}, your Equb payout for week {{2}} is {{3}}. Your contributions continue to week {{4}}. Firaoli will arrange the handover.
```

**Draft (organizer's wording, 13 Aug 2026 — replaces the earlier draft that
still dated the drawn week)**

```
Hi {{1}}, your Equb payout is {{2}}. You are still paying {{3}} a week for the rest of your {{4}}, finishing {{5}}. Firaoli will arrange the handover.
```

| Var | Fills from | Change |
|---|---|---|
| `{{1}}` | `name` | — |
| `{{2}}` | `payoutAmount` | — |
| `{{3}}` | `weeklyAmount` | **already exists** — their own rate |
| `{{4}}` | `weeksCommitted` | **already exists** — "10 weeks", pluralised |
| `{{5}}` | `finishDate` | **already exists** — 2.22, their own finish date |

> Hi Henok, your Equb payout is $9,800. You are still paying $1,000 a week for
> the rest of your 10 weeks, finishing Sunday, October 18, 2026. Firaoli will
> arrange the handover.

**No reference to the drawn week at all — not even as a date.** The first
rework kept "the week of {{2}}" for the drawn week, and that is still the
cycle's frame wearing a date: the member's question is "how much, and what do
I still owe", and the drawn week answers neither. Winning does not shorten the
commitment, and the sentence now says that plainly.

**Code needed: none.** All five placeholders already exist and render from
facts the system holds. `requiredExtras` shrinks to `payoutNet` alone — the
drawn week is no longer part of the message.

---

### 5. CYCLE_CLOSING_STATEMENT — unchanged, and correct

```
Hi {{1}}, your Equb closing statement: you paid {{2}} of {{3}} weeks, {{4}} in total. Outstanding balance {{5}}. Please contact Firaoli to confirm.
```

Every figure is the member's own count or a money amount. **No cycle week number
appears. No re-approval needed. Do not resubmit this one.**

---

## New placeholders this rework needs

| Placeholder | Derived from | Lookup needed? |
|---|---|---|
| `weeksCoveredCount` | `extras.weeksCovered.length` | no — already passed |
| `asOfDate` | the send moment | no |
| `lastPaymentDate` | the stored date of `lastPaymentWeek`'s row | yes — one week row |
| `lateWeekDates` | the stored dates of the LATE weeks | yes — the member's week rows |

Every date must come from the **stored week rows** (2.14), never from
projecting a week number off the cycle start date — the same rule
`resolveWeekDate` already enforces for `finishDate`.

WINNER_ANNOUNCEMENT needs **no new placeholder** (13 Aug rework): its five
variables all exist today, and its `requiredExtras` shrinks to `payoutNet` —
the drawn week left the message entirely. PAYMENT_CONFIRMED keeps
`weeksCovered` (the count derives from it). The boundary check in
`checkRequiredExtras` is what stops a caller omitting an extra and having
Twilio substitute the approval sample.

---

## What happens between submission and approval

The registry pairs a ContentSid with the exact approved body, and
`lib/whatsapp-templates.test.ts` fails the build if they drift. So:

1. Submit the four reworked bodies to Meta. **Nothing in the app changes yet.**
2. While they are pending, the current wording keeps sending. Members receive
   week numbers for a few more days — the defect persists, but nothing breaks.
3. On approval, update `contentSid` **and** `approvedBody` together, add the new
   placeholders, and run `scripts/sync-approved-templates.mts` to rewrite the
   database rows.
4. The in-app template editor shows all five as locked with Meta's wording, so
   the new sentences appear there automatically.

**Do not update `approvedBody` before approval.** It would make the app show and
log wording that Twilio is not sending — the precise failure the registry exists
to prevent.

---

# WHATSAPP_WELCOME — the sixth template

**Status: DRAFTED, NOT SUBMITTED. Nothing has been sent to Meta. There is no
ContentSid, the template is deliberately absent from `APPROVED_TEMPLATES`, and
every attempt to send it is refused in `deliver()` with
`draftNotSubmittedRefusal`.**

The wording below is agreed and lives in code as
`DRAFT_TEMPLATES.WHATSAPP_WELCOME` (`lib/whatsapp-templates.ts`), written once
in `{{n}}` form with the `{name}` form derived from it. It is the editable
MessageTemplate row's starting body, so the organizer can read and edit it under
Messages today — an edit is legitimate here precisely because Meta does not own
this sentence yet.

## Why it is not in `APPROVED_TEMPLATES`

That record means "Meta approved this exact wording", and the send path reads it
that way: `deliver()` posts `APPROVED_TEMPLATES[key].contentSid`. A sixth entry
with a blank ContentSid would put a request on the wire with no template behind
it — at the one layer whose failure mode is Twilio substituting the **approval
samples** and a real member reading "Sara" and "$7,000.00" as fact.

So `DraftTemplate` has **no `contentSid` field at all**. Not empty — absent, so
the send path cannot reach it even by mistake.

This is the same ruling as `LOCKOUT_NOTICE` one step earlier. That one has no
draft either, because it must never be submitted; this one has a draft because
it is waiting in a queue.

## Body

**Reordered 13 Aug 2026 (organizer): the sign-in address is the LAST thing in
the message** — in WhatsApp the final line is the tappable one, and the address
is the one thing the member acts on. `{{6}}` is still followed by fixed text,
because Meta refuses a body that ends on a variable.

```
Hi {{1}}, welcome to your Equb. You are saving {{2}} a week for {{3}}, from {{4}} to {{5}}. When you sign in you will be asked to read and sign your agreement. Sign in at {{6}} with your phone number — if you have set your own PIN use it, otherwise your PIN is the last 4 digits of your phone number.
```

Six variables, each separated by fixed text; the body opens and closes on fixed
text. Both shape rules from the top of this document are satisfied.

**"When you sign in", not "the first time you sign in" — kept, per the 12 Aug
ruling.** The organizer may send this to a member who has been in the group for
months — that is the intended way to bring an existing member into signing. For
them the agreement arrives on their NEXT visit, and "the first time you sign
in" describes a moment already long past. The PIN sentence covers both cases
the same way, and so must this one.

| Var | Fills from `placeholderValues()` | Notes |
|---|---|---|
| `{{1}}` | `name` | `standing.name` — first name |
| `{{2}}` | `weeklyAmount` | via `formatMoney` |
| `{{3}}` | **`weeksCommitted`** — NEW | **their own count, pluralised**: "10 weeks", "1 week" |
| `{{4}}` | **`startDate`** — NEW | the stored date of their start week (2.14) |
| `{{5}}` | `finishDate` | **already exists** — 2.22, their own finish date |
| `{{6}}` | **`portalUrl`** — NEW | the `portalUrl` setting, read at send time |

No cycle week number appears anywhere in it. `{{3}}`, `{{4}}` and `{{5}}` are
the member's own count and the member's own two dates, which is exactly the
frame UI_STANDARDS 8c reserves for them — the rework above exists because the
five approved templates broke that rule, and this one is drafted already
obeying it.

## Rendered

> Hi Henok, welcome to your Equb. You are saving $1,000 a week for 10 weeks,
> from Sunday, August 16, 2026 to Sunday, October 18, 2026. When you sign in
> you will be asked to read and sign your agreement. Sign in at
> https://equb.example.org with your phone number — if you have set your own
> PIN use it, otherwise your PIN is the last 4 digits of your phone number.

*(A member joining at week 14 of Cycle 1 2026 for 10 weeks. He is never shown
"week 14" or "week 23".)*

## Category

UTILITY, on the same two-part test as the five: it is non-promotional, and it is
entirely about this recipient's own account — their weekly amount, their own
window, and how to reach their own record. It sells nothing and invites nothing.
"welcome" is a greeting here, not an offer; there is no invitation to join, no
next cycle, and no request for a rating.

## Two hard send blocks, and why they are refusals

The rule is one pure function, `welcomeSendCheck` in
[lib/welcome-send.ts](../lib/welcome-send.ts), asked by `deliver()`, by
`prepareBatch`/`sendBatch`, by the member profile, and by the messaging settings
form.

1. **`portalUrl` is empty → refuse.** The message exists to give a member a way
   in. Without an address it gives them a sentence with a dash in it, and a
   welcome with no way in is worse than no welcome — the member believes they
   have been told everything.
2. **`defaultPinFromPhone` is OFF → refuse.** The message states the fallback
   PIN as fact. With the setting off those digits are rejected at sign-in, so
   the welcome hands a new member a password that does not work and their first
   act on the platform is a failure they cannot explain.

Both are refusals rather than warnings because both fail **silently**: the send
succeeds, the log says ACCEPTED, and the only evidence is a member who never
signs in.

## Sending it is what requires a signature

On a successful send, `deliver()` sets `Participation.agreementRequiredAt` for
that participation **in the same transaction as the MessageLog row**, so the
record of what was said and the obligation it created cannot exist without each
other. Only a real send does it — a FAILED row sets nothing, because the
agreement is owed by a member who was told.

**That pair is unreachable while this template is unsubmitted**, since the
no-approved-template skip returns first. It is written now so that registering
the ContentSid is the only remaining step rather than the first of two.

## New placeholders this template needs

| Placeholder | Derived from | Lookup needed? |
|---|---|---|
| `weeksCommitted` | `standing.weeksCommitted`, pluralised | no |
| `startDate` | the stored date of their start week | already loaded — the cycle's week rows |
| `portalUrl` | the `portalUrl` setting | one settings read, in `loadStandingFacts` |

`portalUrl` is threaded through `loadStandingFacts` rather than fetched at each
render site so the address in the organizer's **preview** and the address in the
**sent message** are the same string by construction.

## To submit it

1. Create the Content template in Twilio with the body above, category UTILITY.
2. Supply sample values from the rendered example — and note the `.00` warning
   above: `formatMoney` produces `$1,000`, not `$1,000.00`.
3. On approval, move the entry from `DRAFT_TEMPLATES` to `APPROVED_TEMPLATES`
   with its `contentSid` and `approvedBody` **in the same commit**, and add its
   `requiredExtras` (there are none — every variable comes from standing or a
   setting). The drift guard then covers it like the other five.
4. Nothing else changes: the blocks, the requirement write, and the placeholders
   are already in place.
