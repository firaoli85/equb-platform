# WhatsApp Content templates — the approved set

**Status: SIX TEMPLATES APPROVED BY META 13 AUGUST 2026, all UTILITY, live in
the registry (`lib/whatsapp-templates.ts`).** Sender **+13016835755** (WABA
1018506704190290, business verified). Delivery is by `ContentSid` +
`ContentVariables`; the registry is the source of truth, the database mirrors
it, and the drift guards fail the build the moment the two diverge —
character for character, em/en dashes included.

**The member-relative language rule (organizer, 13 Aug 2026):** statements
speak the member's OWN weeks paired with real dates — "your week(s) 2–3
(Aug 23 – Aug 30)", where week 1 is THEIR first week — never the group
calendar. The composer is `lib/member-week-dates.ts`; the my* placeholders
carry its phrases. `lib/member-vocabulary.test.ts` fails the build on any
template body that frames a slot as a cycle week.

Read alongside [WHATSAPP_TEMPLATE_ONLY.md](WHATSAPP_TEMPLATE_ONLY.md) for why
statements are templates at all.

---

## The six approved templates

| Template | ContentSid | Language |
|---|---|---|
| payment_confirmed_v2 | HXf357ad3b5f22055d701a9e8f2b3816cc | English (US) |
| behind_notice_v2 | HX5ccceab671caae1a5a496f8a58f5695e | English (US) |
| late_notice_v2 | HX52a4f9c1490d5a34ef65e599fa4ace23 | English (US) |
| winner_announcement_v2 | HX02e0db4ce467224186802b64adb007a7 | English (EN) |
| whatsapp_welcome | HX90da7257223b48177b95dbbb132ea182 | English (US) |
| group_announcement | HX4981b5b4c3e692a489dc084d52d375ce | English (EN) |

Language codes are cosmetic — sends address by ContentSid — recorded so the
console listing is never mistaken for a defect. `cycle_closing_statement`
(HX517e5e10d8f11e741789b5c6ebed9565, approved 7 Aug 2026) was **not**
reworked and stays exactly as it was; LOCKOUT_NOTICE remains deliberately
template-less (a security message; Twilio Verify is its channel).

### 1. payment_confirmed_v2 — automatic (2.20)

```
Hi {{1}}, we received {{2}} for your Equb — recorded on your week(s) {{3}}. You have now paid {{4}} of your {{5}} weeks. Thank you.
```

Variables: 1 `name` · 2 `amountReceived` · 3 `myWeeksCovered` (composer
phrase) · 4 `weeksPaid` · 5 `weeksTotal`.
Samples: Henok · $2,000 · 2–3 (Aug 23 – Aug 30) · 3 · 10.
EM dash after "Equb" (U+2014); the {{3}} phrase carries EN dashes.
Required extras: `amountReceived`, `weeksCovered`.

### 2. behind_notice_v2 — manual. A record, never a threat.

```
Hi {{1}}, your Equb record as of your week {{2}}: last payment on your week {{3}}, and {{4}} of your {{5}} weeks are behind, {{6}} outstanding. Please contact Firaoli with any questions.
```

Variables: 1 `name` · 2 `myCurrentWeek` ("4 (Sep 6)") · 3 `myLastPaymentWeek`
("1 (Aug 16)", or "—" for a member who has never paid — the one dashable
my* token) · 4 `weeksBehind` · 5 `weeksTotal` · 6 `amountOwed`.
Samples: Henok · 4 (Sep 6) · 1 (Aug 16) · 2 · 10 · $2,000.
Six variables — one more than v1. No required extras.

### 3. late_notice_v2 — manual. Documented, no pressure.

```
Hi {{1}}, your week(s) {{2}} closed without a payment recorded. Your balance is {{3}} outstanding across {{4}} of your {{5}} weeks. Please contact Firaoli if this does not match your records.
```

Variables: 1 `name` · 2 `myLateWeeks` ("2 (Aug 23) and 3 (Aug 30)") ·
3 `amountOwed` · 4 `lateWeeksCount` (always the same set {{2}} names) ·
5 `weeksTotal`.
Samples: Henok · 2 (Aug 23) and 3 (Aug 30) · $2,000 · 2 · 10.
No required extras; no late weeks = no send, as established.

### 4. winner_announcement_v2 — manual. What continues, and until when.

```
Hi {{1}}, congratulations — your Equb payout is {{2}}. Your weekly contributions continue until {{3}}, with {{4}} of your weeks remaining. Firaoli will arrange the handover.
```

Variables: 1 `name` · 2 `payoutAmount` · 3 `finishDate` (the member's own
finish DATE) · 4 `weeksLeft`.
Samples: Henok · $9,800 · Sunday, October 18, 2026 · 5.
**No drawn-week reference, by design** — the payout is handed over in person;
the message's job is what continues and until when. **This resolves D-38**
(v1 stated the finish WEEK) in 2.22's favour, and it removes the drawn-week
fallback defect class structurally: no slot exists to mis-fill.
Required extras: `payoutNet` only — `drawnWeek` is no longer required.

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

## RETIRE AFTER DEPLOY

The four superseded v1 templates below **remain registered in Twilio** and
may be deleted from the Content Template Builder **only after**:

1. the switchover is deployed, and
2. one real send per NEW template has been observed **delivered** (not merely
   ACCEPTED — a StatusCallback confirmation, which needs the public
   `APP_BASE_URL`).

Until both hold, the old SIDs are the rollback path.

- [ ] payment_confirmed — HX87cb0a437434f7f9bba329958c74544a
- [ ] behind_notice — HX8bb8e24a790e8fafd81f232ecfe6e8dc
- [ ] late_notice — HXc25be8d015fc1d36a6b0caf3ebf89823
- [ ] winner_announcement — HX2774ec28d2785140d4610ba2f947f6e5

---

## History — superseded templates

Everything below is the record of what was approved or drafted BEFORE the
13 Aug 2026 set. None of it is live in the app; the four v1 templates are
still registered in Twilio until the retire-after-deploy list above clears.

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
known flaw, moot now.

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
