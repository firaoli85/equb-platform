# WhatsApp Content templates — the approved set

**Status: THE v3 SET IS LIVE (14 August 2026), all UTILITY, in the registry
(`lib/whatsapp-templates.ts`).** Behind, late and winner were reworked and
approved 14 Aug (v3); payment confirmation, the welcome and the group
announcement stand from the 13 Aug v2 approval; the closing statement is
unchanged since 7 Aug. Sender **+13016835755** (WABA 1018506704190290,
business verified). Delivery is by `ContentSid` + `ContentVariables`; the
registry is the source of truth, the database mirrors it, and the drift
guards fail the build the moment the two diverge — character for character.

**STANDING RULES for all member-facing text (organizer, 13–14 Aug 2026):**

1. **Member-relative weeks** (13 Aug): statements speak the member's OWN
   weeks — week 1 is THEIR first week — with real dates in brackets as
   reference, never the group calendar. The composer is
   `lib/member-week-dates.ts`; the my* placeholders carry its phrases.
   `lib/member-vocabulary.test.ts` fails the build on any template body that
   frames a slot as a cycle week.
2. **No dashes** (14 Aug): no em or en dash in fixed template text —
   guarded in `lib/whatsapp-templates.test.ts`. The two pre-v3 bodies that
   carry one (payment_confirmed_v2, whatsapp_welcome) are Meta-frozen
   exemptions until resubmitted; the exemption list may only shrink.
3. **Maximally simple** (14 Aug): "stupid-proof" sentences — short, plain,
   no colons doing sentence work. Repetition of facts is GOOD: the paid-up-to
   and current-week anchors repeat across notices on purpose.

Read alongside [WHATSAPP_TEMPLATE_ONLY.md](WHATSAPP_TEMPLATE_ONLY.md) for why
statements are templates at all.

---

## The live templates

| Template | ContentSid | Language |
|---|---|---|
| payment_confirmed_v2 | HXf357ad3b5f22055d701a9e8f2b3816cc | English (US) |
| behind_notice_v3 | HXf6fd58391615502d88ea81a812460bc7 | English (US) |
| late_notice_v3 | HX5888a36a63291feccee719a37dcaff64 | English (US) |
| winner_announcement_v3 | HX4775224d54e9799a67c9b9ad5ccf6f63 | English (US) |
| whatsapp_welcome | HX90da7257223b48177b95dbbb132ea182 | English (US) |
| group_announcement | HX4981b5b4c3e692a489dc084d52d375ce | English (EN) |

Language codes are cosmetic — sends address by ContentSid — recorded so the
console listing is never mistaken for a defect. `cycle_closing_statement`
(HX517e5e10d8f11e741789b5c6ebed9565, approved 7 Aug 2026) was **not**
reworked and stays exactly as it was; LOCKOUT_NOTICE remains deliberately
template-less (a security message; Twilio Verify is its channel). The
Content API listing was checked on 14 Aug 2026: these seven are exactly what
Twilio holds (plus Verify's own auto-created login templates), and every v1
and v2 predecessor is gone.

### 1. payment_confirmed_v2 — automatic (2.20)

```
Hi {{1}}, we received {{2}} for your Equb — recorded on your week(s) {{3}}. You have now paid {{4}} of your {{5}} weeks. Thank you.
```

Variables: 1 `name` · 2 `amountReceived` · 3 `myWeeksCovered` (composer
phrase) · 4 `weeksPaid` · 5 `weeksTotal`.
Samples: Henok · $2,000 · 2–3 (Aug 23 – Aug 30) · 3 · 10.
EM dash after "Equb" (U+2014); the {{3}} phrase carries EN dashes.
Required extras: `amountReceived`, `weeksCovered`.

### 2. behind_notice_v3 — manual. A record, never a threat.

```
Hi {{1}}, you are {{2}} payments behind on your Equb. That is {{3}} to catch up. You are paid up to your week {{4}}, and the current week is week {{5}}. Please contact Firaoli with any questions.
```

Variables: 1 `name` · 2 `weeksBehind` · 3 `amountOwed` · 4 `myPaidUpToWeek`
("11 (Sunday, July 26)" — the last week they are fully paid through, or
"the start (Sunday, May 17)" for a member with no fully-paid week yet;
ALWAYS composable, never dashed — this supersedes the v2 "—" sentinel) ·
5 `myCurrentWeek` ("13 (Sunday, August 9)", full-date form, clamped to the
member's own final week once the cycle runs past their window).
Samples: Henok · 2 · $2,000 · 11 (Sunday, July 26) · 13 (Sunday, August 9).
No required extras.

### 3. late_notice_v3 — manual. Documented, no pressure.

```
Hi {{1}}, we did not receive your payment for your week(s) {{2}}. That is {{3}} to catch up. You are paid up to your week {{4}}, and the current week is week {{5}}. Please contact Firaoli if this does not match your records.
```

Variables: 1 `name` · 2 `myLateWeeks` ("12 and 13 (Aug 2 and Aug 9)" — the
v3 list form: plain enumeration, dates grouped in one bracket, no ranges,
no dashes) · 3 `amountOwed` · 4 `myPaidUpToWeek` · 5 `myCurrentWeek` (both
as in the behind notice — the anchors repeat across notices on purpose).
Samples: Henok · 12 and 13 (Aug 2 and Aug 9) · $2,000 · 11 (Sunday,
July 26) · 13 (Sunday, August 9).
No required extras; `myLateWeeks` stays non-dashable — no late weeks, no
send, as established.

### 4. winner_announcement_v3 — manual. The payout, the progress, the debt.

```
Hi {{1}}, congratulations! Your Equb payout is {{2}}. So far you have paid {{3}} of your {{4}} weeks. You have {{5}} payments left, and your weeks run until {{6}}. Firaoli will arrange the handover.
```

Variables: 1 `name` · 2 `payoutAmount` · 3 `weeksPaid` · 4 `weeksTotal` ·
5 `paymentsLeft` (**committed minus paid — the COUNT OWED, not calendar
weeks remaining**: the two split whenever a member is behind or ahead, the
13-Aug finding) · 6 `finishDate` (the run-until anchor — **D-38's
resolution retained in v3**: the finish DATE, not a week number).
Samples: Henok · $9,800 · 5 · 10 · 5 · Sunday, October 18, 2026.
**No drawn-week reference** — the payout is handed over in person.
Required extras: `payoutNet` only; everything else derives.

### 5. whatsapp_welcome — manual; the send that arms the agreement gate

```
Hi {{1}}, welcome to the Equb. Your commitment is {{2}} every week for {{3}}, starting {{4}} and finishing {{5}}. Your first step is to sign in and sign your agreement at {{6}} — your account opens once you have.
```

Variables: 1 `name` · 2 `weeklyAmount` · 3 `weeksCommitted` ("10 weeks") ·
4 `startDate` · 5 `finishDate` · 6 `portalUrl` (the setting, read at send
time; the send refuses while it is unset — the rule stands).
Samples: Henok · $1,000 · 10 weeks · Sunday, August 16, 2026 · Sunday,
October 18, 2026 · https://equb.example.org.
A successful send writes `agreementRequiredAt` in the same transaction as the
log row and gates the member's portal until they sign.

### 6. group_announcement — the broadcast, sent per member

```
Hi {{1}}, a message from your Equb: {{2}}
```

Variables: 1 `name` · 2 `announcementText` — the organizer's free composition
at send time (required extra: an omitted text would deliver Twilio's approval
sample as fact).
Samples: Henok · The draw this week moves to Saturday 7pm. Same Zoom link as
always.
**A broadcast delivered individually** — each recipient reads their own name;
there is no group-chat send on WhatsApp. Wired to the announcement card:
the organizer types once, it sends to every ACTIVE member with a phone, one
MessageLog row each, alongside the card's Telegram side.

**Delivery observation (14 Aug 2026, live test):** both test sends to
+13015416005 were accepted by Twilio, then marked `undelivered` with Meta
error **63049** ("Meta chose not to deliver this message" — its engagement
filter) — reproducibly, minutes apart, while all four statement templates
**delivered** to the same number in the same window. The open-composition
shape ("a message from your Equb: {{2}}") is the likely trigger: Meta's
runtime treats free-text slots as marketing-like regardless of the approved
UTILITY category. The approved body stays exactly as approved; whether to
resubmit with more fixed context, or lean on the Telegram side for
broadcasts, is the organizer's decision.

---

## PENDING SUBMISSION — the Phase 4 payment set (drafted 15 Aug 2026)

**Not submitted. Not built. Awaiting Oli's review, then submission.**

Five bodies, all UTILITY, none carrying a dash. Two supersede live templates; three
are new types. The rulings behind them are in
[docs/ONE_TRUTH_ENGINE.md](ONE_TRUTH_ENGINE.md) §3.7 and are law:

- **No receipt dates, anywhere.** A recorded date is not the date the money moved,
  and `PaymentAllocation` is a REPLAY that `rebuild.ts` re-derives on every edit —
  so a dated split can silently change while the member holds a message asserting
  the old one. Messages state facts that stay true.
- **Anchor to the week**: the member's own week number plus that week's SCHEDULED
  date, both stable cycle facts.
- **One message per payment event**, documenting that payment and the standing it
  produced. Three payments on one week send three messages, each true forever.

### P1. payment_confirmed_v4 — SUPERSEDES payment_confirmed_v2 (HXf357ad…)

```
Hi {{1}}, we received {{2}} for your Equb. That paid {{3}}. You have now paid {{4}} of your {{5}} weeks. Thank you.
```

Variables: 1 `name` · 2 `amountReceived` · 3 `paymentBreakdown` · 4 `weeksPaid` ·
5 `weeksTotal`.
Samples: Henok · $6,000 · week 14 (Aug 16), week 15 (Aug 23) and week 16 (Aug 30) · 16 · 20.
Replaces v2's `{{3}} myWeeksCovered`, the RANGE composer — "2–3 (Aug 23 – Aug 30)"
— which is both the form the organizer rejected and a carrier of two EN dashes v3
bans. "recorded on your week(s)" is dropped: it asserted coverage a payment may not
have delivered.

### P2. payment_confirmed_with_partial — NEW TYPE

```
Hi {{1}}, we received {{2}} for your Equb. That paid {{3}}. {{4}}. You have now paid {{5}} of your {{6}} weeks. Thank you.
```

Variables: 1 `name` · 2 `amountReceived` · 3 `paymentBreakdown` · 4 `stillDueOnWeek`
· 5 `weeksPaid` · 6 `weeksTotal`.
Samples: Henok · $2,500 · week 13 (Aug 9) · $1,500 is still due for your week 14 (Aug 16) · 13 · 20.
The mixed case: one payment finishes earlier week(s) AND leaves a remainder on the
next. `{{4}}` is a whole sentence and mandatory.

### P3. partial_confirmed — NEW TYPE

```
Hi {{1}}, we received {{2}} for your Equb. That paid part of your {{3}}. {{4}}. You have now paid {{5}} of your {{6}} weeks. Thank you.
```

Variables: 1 `name` · 2 `amountReceived` · 3 `partialWeekLabel` · 4 `stillDueOnWeek`
· 5 `weeksPaid` · 6 `weeksTotal`.
Samples: Henok · $200 · week 14 (Sunday, August 16) · $1,800 is still due for your week 14 (Aug 16) · 13 · 20.
The week is named twice deliberately: v3 says repetition of facts is good, and this
is the fact the member most needs.

### P4. partial_completed — NEW TYPE

```
Hi {{1}}, we received {{2}} for your Equb. You had already paid {{3}} toward your {{4}}, and it is now paid in full. You have now paid {{5}} of your {{6}} weeks. Thank you.
```

Variables: 1 `name` · 2 `amountReceived` · 3 `priorPaidOnWeek` · 4 `weekLabel` ·
5 `weeksPaid` · 6 `weeksTotal`.
Samples: Henok · $1,800 · $200 · week 14 (Sunday, August 16) · 14 · 20.

**Names the exact prior amount, not "part"** (organizer, 15 Aug 2026). "You had
already paid part" makes the member do the arithmetic to check it, and v3 forbids
reader math. The figure carries NO date and NO split, so no later edit can falsify
it, and it stops the "but I only sent $1,800" reading of a message that would
otherwise look like a full week's payment.

**{{3}} is computed as `amountDue − appliedToThatWeek`, NEVER as the sum of the
prior receipts.** Both give the same number at send time, but the receipt sum reads
`PaymentAllocation`, which `rebuild.ts` deletes and re-creates on every edit; the
subtraction reads only this week's due amount and what this payment applied to it,
so no rebuild can move it. It is exact rather than approximate: `allocatePayment`
sets `applied = min(owed, remaining)`, so on a week that FILLS, `applied === owed`
and `amountDue − applied` is the prior to the cent. Multiple prior partials collapse
correctly with no itemizing: $100 then $100, completed by $1,800 on a $2,000 week,
gives `2000 − 1800 = $200`.

### P5. late_notice_v4 — SUPERSEDES late_notice_v3 (HX5888a3…)

```
Hi {{1}}, this is a reminder about your Equb. {{2}}. You are paid up to your {{3}}, and the current week is {{4}}. Please contact Firaoli if this does not match your records.
```

Variables: 1 `name` · 2 `stillDueOnWeek` (or the multi-week list form) ·
3 `myPaidUpToWeek` · 4 `myCurrentWeek`.
Samples: Henok · $1,800 is still due for your week 14 (Aug 16) · week 13 (Sunday, August 9) · week 15 (Sunday, August 23).
**The trust-law fix.** v3 says "we did not receive your payment for your week(s)
{{2}}", which is FALSE for anyone who part paid, and its `{{3}}` was the member's
TOTAL where the sentence named one week. Both are gone.

### The three placeholders these need

| Placeholder | Renders | Rule |
|---|---|---|
| `paymentBreakdown` | week 14 (Aug 16), week 15 (Aug 23) and week 16 (Aug 30) | never a range; caps at 8 weeks then "and N more weeks" |
| `stillDueOnWeek` | $1,800 is still due for your week 14 (Aug 16) | a whole sentence |
| `partialWeekLabel` / `weekLabel` | week 14 (Sunday, August 16) | one week, full date |
| `priorPaidOnWeek` | $200 | amountDue minus what THIS payment applied to that week, never the receipt sum |

**None is dashable.** Empty is refused at the ContentVariables boundary, so a
confirmation can never send unable to say which weeks the money reached.

All three are single-line, comma-separated prose with single spaces — no newlines,
no tabs, no four-space runs, per the shape rules below.

### Before submitting — two tasks, off the critical path

1. **Verify Meta's parameter rule with ONE sandbox send.** The newline / tab /
   four-consecutive-space prohibition is the single constraint that would force a
   redesign rather than a re-word. Designed to comply; not yet confirmed against
   the live API.
2. **Submit all five as UTILITY.** Predecessors (`payment_confirmed_v2`,
   `late_notice_v3`) are retired only after one observed DELIVERED send on their
   replacement, the practice already used for the v2 and v3 sets.

---

## Shape rules (Meta), unchanged

A body may not begin or end with a variable; sequential `{{n}}` numbering
with no gaps; roughly three words of fixed text per variable. Names ARE
allowed in UTILITY — position was the only issue. All six above comply.
Editing an approved template means re-submission; the in-app editor locks
approved wording read-only with a server-side refusal.

## Category: all UTILITY

Non-promotional AND specific to the recipient's own account. What would break
the category, so do not add it later: "exclusive", "limited", "offer",
"deal", "upgrade", "don't miss", invitations to the next cycle, requests for
ratings or feedback. One promotional sentence re-categorises the whole
template as marketing — silently.

---

## Retirement — DONE (14 Aug 2026)

**Every superseded template is deleted from Twilio**, confirmed against the
Content API listing on 14 Aug 2026:

- [x] payment_confirmed (v1) — HX87cb0a437434f7f9bba329958c74544a
- [x] behind_notice (v1) — HX8bb8e24a790e8fafd81f232ecfe6e8dc
- [x] late_notice (v1) — HXc25be8d015fc1d36a6b0caf3ebf89823
- [x] winner_announcement (v1) — HX2774ec28d2785140d4610ba2f947f6e5
- [x] behind_notice_v2 — HX5ccceab671caae1a5a496f8a58f5695e
- [x] late_notice_v2 — HX52a4f9c1490d5a34ef65e599fa4ace23
- [x] winner_announcement_v2 — HX02e0db4ce467224186802b64adb007a7

The v2 three were deleted BEFORE the v3 registry cutover landed in the app —
which broke those statement types until it did (the reason the cutover ran
as an urgent one-run order), and it removed the rollback path the original
retire-after-deploy rule existed to protect. Nothing outside this file's
history references any deleted SID (swept by grep, 14 Aug 2026).

---

## History — superseded templates

Everything below is the record of what was approved or drafted BEFORE the
current set. None of it is live in the app or registered in Twilio.

### The v2 statement set (approved 13 Aug 2026, superseded 14 Aug 2026)

The v2 rework brought the member-relative frame in; one day of live use
produced the v3 rulings — no dashes, stupid-proof wording, paid-up-to
instead of a dashable last-payment, payments-left instead of a weeks-left
that could be misread as calendar weeks.

| Template | ContentSid | Body |
|---|---|---|
| behind_notice_v2 | HX5ccceab671caae1a5a496f8a58f5695e | Hi {{1}}, your Equb record as of your week {{2}}: last payment on your week {{3}}, and {{4}} of your {{5}} weeks are behind, {{6}} outstanding. Please contact Firaoli with any questions. |
| late_notice_v2 | HX52a4f9c1490d5a34ef65e599fa4ace23 | Hi {{1}}, your week(s) {{2}} closed without a payment recorded. Your balance is {{3}} outstanding across {{4}} of your {{5}} weeks. Please contact Firaoli if this does not match your records. |
| winner_announcement_v2 | HX02e0db4ce467224186802b64adb007a7 | Hi {{1}}, congratulations — your Equb payout is {{2}}. Your weekly contributions continue until {{3}}, with {{4}} of your weeks remaining. Firaoli will arrange the handover. |

The three delivered live test sends on 14 Aug 2026 (payment_confirmed_v2
and winner_announcement_v2 delivered; the chasing pair refused correctly on
a paid-up recipient) before the v3 rulings superseded the wording.

### The v1 set (approved 7 Aug 2026, superseded 13 Aug 2026)

The first approved wording spoke CYCLE week numbers — the organizer's frame —
which a mid-cycle joiner cannot read (UI_STANDARDS 8c). The defect was
reported from live use twice (Henok's winner announcement) before the
member-relative rework replaced them.

| Template | ContentSid | Body |
|---|---|---|
| payment_confirmed | HX87cb0a437434f7f9bba329958c74544a | Hi {{1}}, we received {{2}} for your Equb — recorded on week(s) {{3}}. You have paid {{4}} of {{5}} weeks. Thank you. |
| behind_notice | HX8bb8e24a790e8fafd81f232ecfe6e8dc | Hi {{1}}, your Equb record as of week {{2}}: last payment week {{3}}, and {{4}} weeks behind, {{5}} outstanding. Please contact Firaoli with any questions. |
| late_notice | HXc25be8d015fc1d36a6b0caf3ebf89823 | Hi {{1}}, your Equb week(s) {{2}} closed without a payment recorded. Your balance is {{3}} outstanding across {{4}} weeks. Please contact Firaoli if this does not match your records. |
| winner_announcement | HX2774ec28d2785140d4610ba2f947f6e5 | Hi {{1}}, your Equb payout for week {{2}} is {{3}}. Your contributions continue to week {{4}}. Firaoli will arrange the handover. |

The v1 sample values submitted at approval used the incorrect cycle-week
frame and could not be corrected without re-approval — recorded then as a
known flaw, moot now that the templates are deleted.

### The intermediate rework drafts (never submitted)

Between v1 and the approved v2 set, a count/date rework was drafted in this
document ("That covers 3 weeks", "the week of August 2, 2026"). The organizer
superseded it before submission with the member-relative week+date form the
v2 set carries. Kept as one line of history so the drafting sequence is
reconstructible; the bodies are in this file's git history.

### The welcome's first draft (superseded before submission)

```
Hi {{1}}, welcome to your Equb. You are saving {{2}} a week for {{3}}, from {{4}} to {{5}}. When you sign in you will be asked to read and sign your agreement. Sign in at {{6}} with your phone number — if you have set your own PIN use it, otherwise your PIN is the last 4 digits of your phone number.
```

The submitted `whatsapp_welcome` (section 5 above) replaced the
PIN-instructions wording with the commitment-first form before anything went
to Meta. Same six variables, same order.
