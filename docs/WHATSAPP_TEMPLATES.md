# WhatsApp Content templates — submitted to Meta

**Status: CREATED IN TWILIO, SUBMITTED TO META 7 August 2026. Not yet approved,
nothing sent.**

The five bodies below are the text that was submitted. They are now the wording
of record: changing any of them means re-submitting that template and waiting
for approval again.

Read alongside [WHATSAPP_TEMPLATE_ONLY.md](WHATSAPP_TEMPLATE_ONLY.md), which
explains why statements need these at all.

---

## Submitted templates and ContentSids

| Template | Twilio name | ContentSid | Language | Submitted |
|---|---|---|---|---|
| PAYMENT_CONFIRMED | payment_confirmed | HX87cb0a437434f7f9bba329958c74544a | en | 2026-08-07 |
| BEHIND_NOTICE | behind_notice | HX8bb8e24a790e8fafd81f232ecfe6e8dc | en_US | 2026-08-07 |
| LATE_NOTICE | late_notice | HXc25be8d015fc1d36a6b0caf3ebf89823 | en_US | 2026-08-07 |
| WINNER_ANNOUNCEMENT | winner_announcement | HX2774ec28d2785140d4610ba2f947f6e5 | en_US | 2026-08-07 |
| CYCLE_CLOSING_STATEMENT | cycle_closing_statement | HX517e5e10d8f11e741789b5c6ebed9565 | en_US | 2026-08-07 |

- Sample variable values were supplied at save time in Twilio's "Sample
  variables" dialog, using the rendered examples already in this document.
- `payment_confirmed` was created as language `en`; the other four as `en_US`.
  This has no effect on sending, because messages are addressed by ContentSid,
  not by language. Recorded so the inconsistency is not mistaken for a defect.
- The "+ Add variable" button in the Content Template Builder appends a new
  variable to the body rather than exposing sample fields for existing ones.
  Sample values are collected in a dialog that opens when Save is clicked.
- LOCKOUT_NOTICE remains undrafted and unsubmitted, per the decision recorded
  in "Things to decide before submission".

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
$1,000.00 unit, 2% fee, started 17 May 2026, 27 participants, currently week
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

> Hi Sara, we received $2,000.00 for your Equb — recorded on week(s) 11–12. You have paid 12 of 20 weeks. Thank you.

---

### 2. BEHIND_NOTICE — manual. A record, never a threat.

**Body**

```
Hi {{1}}, your Equb record as of week {{2}}: last payment week {{3}}, {{4}} weeks behind, {{5}} outstanding. Please contact Firaoli with any questions.
```

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

> Hi Sara, your Equb record as of week 12: last payment week 5, 7 weeks behind, $7,000.00 outstanding. Please contact Firaoli with any questions.

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

> Hi Sara, your Equb week(s) 6–10 closed without a payment recorded. Your balance is $5,000.00 outstanding across 5 weeks. Please contact Firaoli if this does not match your records.

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

> Hi Sara, your Equb payout for week 12 is $9,800.00. Your contributions continue to week 20. Firaoli will arrange the handover.

*(Real figures: $10,000.00 gross, 2% fee $200.00, $9,800.00 net.)*

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
| `{{5}}` | `amountOwed` | `$0.00` when settled — say it, don't hide it |

**Rendered**

> Hi Sara, your Equb closing statement: you paid 18 of 20 weeks, $18,000.00 in total. Outstanding balance $2,000.00. Please contact Firaoli to confirm.

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

1. Record each returned `ContentSid` on the matching `MessageTemplate` row —
   `metaTemplateSid` exists for this and is currently `null` on all six.
2. Change `sendWhatsAppMessage` from `Body` to `ContentSid` +
   `ContentVariables`.
3. Flip `STATEMENTS_DELIVERABLE` in [lib/messaging-engine.ts](../lib/messaging-engine.ts).

The render-and-log path is unchanged by all of this and becomes correct again
as it stands.

**Sources for the Meta rules above:**
[Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization) ·
[Template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview) ·
[Dangling-parameter rejections](https://help.businesschat.io/en/articles/12302864-fixing-whatsapp-template-rejections-caused-by-dangling-parameters) ·
[Rejection reasons](https://docs.aws.amazon.com/social-messaging/latest/userguide/managing-templates_rejection.html)
