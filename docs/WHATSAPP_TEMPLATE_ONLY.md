# WhatsApp is template-only

**Status as of 2026-08-13. Login codes work. Statements work — as Meta-approved
templates, which is the only way they ever could.** Five templates were
approved on 7 August 2026 (see
[WHATSAPP_TEMPLATES.md](WHATSAPP_TEMPLATES.md) for bodies and ContentSids);
four deliver to real members today, and the fifth — the closing statement —
has its first real use when the cycle closes. The sender is **+13016835755**
("Equb", WABA 1018506704190290, business verified); the approved templates
carried over to it.

What follows is the rule that shaped this, and the history that proved it —
kept because the rule still governs every future template, and because the
wrong conclusion was drawn from the history once already.

---

## The rule

Meta accepts a **freeform** WhatsApp message only inside the **24-hour service
window** that opens when the member sends *us* a message. Outside that window,
the only thing that may be delivered is a **pre-approved template**.

Two consequences, and they pull in opposite directions:

| | Transport | Needs a window? | Works |
|---|---|---|---|
| **Login codes** | Twilio **Verify** — Twilio owns the content and sends its own approved authentication template | **No** | **Yes** |
| **Statements, reminders, payment confirmations** | Twilio **Messages API**, `ContentSid` + `ContentVariables` — a Meta-approved template per message type | **No** | **Yes** |
| **Freeform prose** (`Body`, no template) | Twilio Messages API | **Yes** | **Never in practice** — see below |

## Why the freeform window is never open

The account has **one inbound WhatsApp message in its entire history**:

```
19 May 2026 01:36 UTC   from whatsapp:+16465894168
```

That is the only time a member has ever messaged the sender. So there is no
open window for anyone, and no reason to expect one — members receive from
the Equb, they do not reply to it. This is why "statements will work" was
never a configuration question: the only route was templates, and the day the
templates were approved, statements worked.

**This rule still binds every FUTURE message type.** A new kind of statement
is not a feature branch — it is a template authored in the Content Template
Builder, submitted to Meta, approved, and only then wired by recording its
ContentSid in [lib/whatsapp-templates.ts](../lib/whatsapp-templates.ts) (the
registry is the source of truth; the drift guards hold the database rows to
it). A type with no ContentSid refuses itself at send time — WHATSAPP_WELCOME
does exactly this until its submission is approved.

## What was actually observed, and the wrong conclusion it produced

Worth keeping, because it cost a real diagnosis once.

- **2026-08-06 03:03 → 2026-08-07 01:53 UTC** — 15 consecutive sends failed
  with Twilio **63112**, *"Meta disabled the WhatsApp Business Account"*.
  Template sends through Verify failed alongside the freeform ones.
- That was read as permanent. **It was not.** It cleared on its own.
- **2026-08-08 00:22 and 01:03 UTC** — two login codes **delivered**; the
  Verify attempt log shows the first as `converted`, meaning the code was
  entered and accepted.

**Treat 63112 as an outage to wait out, not a verdict.** It says nothing about
the template rule — the two failures look similar from the outside and are
completely unrelated.

One send in that window failed with **21656**, *"The ContentVariables
Parameter is invalid"* — a malformed template variable on a single call, not a
channel problem. That failure mode is now closed structurally:
`buildContentVariables` refuses an incomplete or dashed variable set before
anything reaches Twilio, so the alternative — Twilio substituting the approval
SAMPLES and a member reading "Sara" and "$7,000.00" as fact — cannot happen.

## How the send path enforces all of this

- `lib/whatsapp.ts` — `sendWhatsAppMessage()` posts `ContentSid` +
  `ContentVariables`. There is no freeform `Body` path, and there never was
  one to remove: the function was a refusing stub until the send path was
  written against templates from the start.
- `lib/messaging-engine.ts` — `deliver()` refuses a key with no approved
  template, per key, with a reason derived from the registry. There is
  deliberately **no global "statements blocked" flag**: one existed, its
  reason string outlived its cause (§5.15), and it was deleted rather than
  parked.
- **Delivery is never assumed.** Twilio's 201/"queued" is logged `ACCEPTED`;
  `SENT` is written only when a StatusCallback confirms delivery — which
  requires a public `APP_BASE_URL`, so local sends stay honestly ACCEPTED.
- `whatsappEnabled` is the organizer's switch for the **whole channel** —
  codes and statements together.

### The constraint templates put on message design

Templates are approved **text with holes**, not free prose. Ground truth 2.21
says a message is a *statement carrying derived state* — that survives
templating, because the derived numbers are exactly what the variables carry.
What does not survive is varying the *sentence structure* per member or per
situation. Any message whose wording changes shape conditionally needs to
become either several templates or one template with more variables.

Meta also categorises templates (utility / marketing / authentication) and
prices them differently. All five approved templates are UTILITY — see
[WHATSAPP_TEMPLATES.md](WHATSAPP_TEMPLATES.md) for what would silently
re-categorise one as marketing.

## What is safe to rely on today

- **WhatsApp login codes** — working through Twilio Verify, no window needed.
- **WhatsApp statements** — working through the five approved templates,
  addressed by ContentSid.
- **PIN** — unaffected by any of this, and still the default door.
- **SMS** — a separate matter entirely; see the Firebase notes. Failing
  locally with `auth/invalid-app-credential` and parked.
