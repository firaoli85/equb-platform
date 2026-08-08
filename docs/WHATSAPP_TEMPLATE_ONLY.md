# WhatsApp is template-only

**Status as of 2026-08-08.** Login codes work. Statements do not, and no setting
can change that.

This is not a configuration problem, an outage, or a bug in our code. It is
Meta's rule about what a business may send unprompted, and the platform is on
the wrong side of it for statements.

---

## The rule

Meta accepts a **freeform** WhatsApp message only inside the **24-hour service
window** that opens when the member sends *us* a message. Outside that window,
the only thing that may be delivered is a **pre-approved template**.

Two consequences, and they pull in opposite directions:

| | Transport | Needs a window? | Works today |
|---|---|---|---|
| **Login codes** | Twilio **Verify** — Twilio owns the content and sends its own approved authentication template | **No** | **Yes** |
| **Statements, reminders, payment confirmations** | Twilio **Messages API**, raw `Body`, no `ContentSid` — freeform | **Yes** | **No** |

## Why the window is never open

The Twilio account has **one inbound WhatsApp message in its entire history**:

```
19 May 2026 01:36 UTC   from whatsapp:+16465894168
```

That is the only time a member has ever messaged the sender. So there is no
open window for anyone, and there is no reason to expect one to open — members
receive from the Equb, they do not reply to it.

Waiting does not help. Asking members to reply first would open a window per
member for 24 hours, which is not a system anyone should depend on.

## What was actually observed

Worth recording, because it produced a wrong conclusion once already.

- **2026-08-06 03:03 → 2026-08-07 01:53 UTC** — 15 consecutive sends failed
  with Twilio **63112**, *"Meta disabled the WhatsApp Business Account"*.
  Template sends through Verify failed alongside the freeform ones.
- That was read as permanent. **It was not.** It cleared on its own.
- **2026-08-08 00:22 and 01:03 UTC** — two login codes **delivered**; the
  Verify attempt log shows the first as `converted`, meaning the code was
  entered and accepted. The sender `+15559620327` ("Equb") reports:

  ```
  status ONLINE   quality HIGH   limit 100K customers/24hr
  ```

**Treat 63112 as an outage to wait out, not a verdict.** It says nothing about
the template rule — the two failures look similar from the outside and are
completely unrelated.

One send in that window failed with **21656**, *"The ContentVariables Parameter
is invalid"*. That is a malformed template variable on a single call, not a
channel problem — and a preview of the failure mode below.

## How this is enforced in code

Deliberately **not** as a setting, because there is no value of a setting that
makes a freeform send work, and a toggle invites someone to switch it on and
get silent non-delivery back.

- `lib/whatsapp.ts` — `sendWhatsAppMessage()` returns
  `WHATSAPP_STATEMENTS_BLOCKED_REASON` unconditionally, before credentials and
  before the network. The old `POST {API_BASE}/Accounts/{sid}/Messages.json`
  with `To` / `From` / `Body` was removed rather than left unreachable.
- `lib/messaging-engine.ts` — `STATEMENTS_DELIVERABLE = false`, checked
  **before** the `whatsappEnabled` switch, so turning WhatsApp on restores
  login codes only and never starts statement sends. It returns `SKIPPED`, not
  `FAILED`: nothing was attempted, so no `MessageLog` failure row is written and
  the real log stays readable.
- `lib/setting-defaults.ts` — `whatsappEnabled` now governs **login codes
  only**. Its reason string no longer blames Meta.

`sendWhatsAppMessage` keeps its signature so every caller and test still checks
against the same contract. Only the answer changed, and it is always the same
answer.

## What making statements deliverable actually requires

Not a switch. Per message shape:

1. **Author each template** in the Twilio Content Template Builder — one per
   `MessageKey`, with numbered variables (`{{1}}`, `{{2}}`, …) in place of the
   values our renderer substitutes today.
2. **Submit each for Meta approval** and wait. Approval is per template, and
   changing an approved template's text means re-approval.
3. **Record the returned `ContentSid`** on the matching `MessageTemplate` row —
   `metaTemplateSid` exists for exactly this.
4. **Change the send** from `Body` to `ContentSid` + `ContentVariables`, where
   `ContentVariables` is a JSON object keyed by variable number. Getting this
   shape wrong is the `21656` above.
5. **Flip `STATEMENTS_DELIVERABLE`** in `lib/messaging-engine.ts`. The
   render-and-log path below it is unchanged and becomes correct again as-is.

### The constraint this puts on message design

Templates are approved **text with holes**, not free prose. Ground truth 2.21
says a message is a *statement carrying derived state* — that survives
templating, because the derived numbers are exactly what the variables carry.
What does not survive is varying the *sentence structure* per member or per
situation. Any message whose wording changes shape conditionally needs to
become either several templates or one template with more variables.

Meta also categorises templates (utility / marketing / authentication) and
prices them differently. Payment confirmations and reminders are utility.

## What is safe to rely on today

- **WhatsApp login codes** — working, no window needed, no template work
  required on our side. Twilio Verify owns that template.
- **PIN** — unaffected by any of this, and still the default door.
- **SMS** — a separate matter entirely; see the Firebase notes. Failing locally
  with `auth/invalid-app-credential` and parked.
