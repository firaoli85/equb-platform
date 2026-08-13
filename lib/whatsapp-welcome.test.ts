import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIN_OFF,
  PORTAL_URL_MISSING,
  portalUrlProblem,
  portalUrlValue,
  welcomeSendCheck,
} from "./welcome-send";
import {
  APPROVED_TEMPLATES,
  APPROVED_TEMPLATE_KEYS,
  DRAFT_TEMPLATES,
  isApprovedTemplateKey,
  isDraftTemplateKey,
  toApprovedBody,
  toNamedBody,
} from "./whatsapp-templates";
import {
  DEFAULT_TEMPLATES,
  MESSAGE_KEYS,
  MANUAL_MESSAGE_KEYS,
  NO_VALUE,
  PLACEHOLDER_DOCS,
  applicableTypes,
  placeholderValues,
  renderTemplate,
  unknownPlaceholders,
} from "./messages";
import { mayRenderAsNoValue } from "./placeholder-kinds";

// THE WELCOME — the message that creates an obligation.
//
// Every other statement REPORTS something: money received, weeks behind, a
// payout. This one gives INSTRUCTIONS ("sign in at…", "your PIN is…") and, on a
// successful send, requires the member's signature before they can use their
// own portal. Both halves fail silently when they are wrong: a member who is
// told the wrong address or a PIN that is rejected does not report a bug, they
// conclude the account does not work and stop.
//
// So the tests below are about three things, in the order they can hurt:
// whether the message may leave at all, whether what it says is true, and
// whether the sentence can reach a member without Meta having approved it.

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Henok: joined at week 14 of a 20-week cycle, committed to his own 10. */
const HENOK = {
  name: "Henok",
  weeklyAmount: 100_000,
  weeksCommitted: 10,
  currentCycleWeek: 14,
  finishWeek: 23,
  // His own two dates. Week 14 of a cycle that started Sunday 17 May 2026.
  startDate: new Date(Date.UTC(2026, 7, 16)),
  finishDate: new Date(Date.UTC(2026, 9, 18)),
  portalUrl: "https://equb.example.org",
  weeksCredited: 0,
  weeksBehind: 0,
  amountOutstanding: 0,
  totalPaid: 0,
  lastPaymentWeek: null,
  weeks: [],
};

// ————————————————————————————————————————————————————————————————
// 1. MAY IT LEAVE — the two hard blocks, both directions.
// ————————————————————————————————————————————————————————————————

describe("the welcome refuses to send when what it would say is not true", () => {
  const ADDRESS = "https://equb.example.org";

  // FALSIFIABLE: delete the portalUrl branch of welcomeSendCheck and this
  // fails. Without it the send proceeds on the default setting — "" — and the
  // member reads "Sign in at —.", a sentence with a hole where their only way
  // in belongs.
  it("refuses with no sign-in address, and names where to set one", () => {
    const check = welcomeSendCheck({ portalUrl: "", defaultPinFromPhone: true });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reasons).toEqual([PORTAL_URL_MISSING]);
    // Actionable: the sentence has to say which screen fixes it.
    expect(check.reason).toContain("Settings → Messaging");
  });

  // FALSIFIABLE: remove the `.trim()` and this passes an address of three
  // spaces. It is not a hypothetical shape — a pasted URL that lost its text is
  // exactly what lands in a box like this — and every downstream test for
  // "empty" is a truthiness check that "   " walks straight through.
  it("treats a whitespace-only address as no address", () => {
    expect(welcomeSendCheck({ portalUrl: "   ", defaultPinFromPhone: true }).ok).toBe(false);
  });

  // FALSIFIABLE: delete the defaultPinFromPhone branch and this fails. Without
  // it the welcome tells a new member their PIN is the last 4 digits of their
  // phone while the server rejects exactly those digits — the message is
  // delivered, logged as ACCEPTED, and the member simply cannot get in.
  it("refuses when the phone-digit PIN is switched off, and names that screen", () => {
    const check = welcomeSendCheck({ portalUrl: ADDRESS, defaultPinFromPhone: false });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reasons).toEqual([DEFAULT_PIN_OFF]);
    expect(check.reason).toContain("Settings → Access");
    expect(check.reason).toContain("last 4 digits");
  });

  // FALSIFIABLE: an `if/else if` here — the obvious way to write two checks —
  // reports one problem, the organizer fixes it, presses send, and is refused
  // again for the other. The array is the assertion.
  it("reports BOTH problems at once rather than one page-load at a time", () => {
    const check = welcomeSendCheck({ portalUrl: "", defaultPinFromPhone: false });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reasons).toHaveLength(2);
    expect(check.reason).toContain("Settings → Messaging");
    expect(check.reason).toContain("Settings → Access");
  });

  // The allowed case. Without it every assertion above is satisfied by a
  // function that returns `ok: false` unconditionally.
  it("allows the send when both are in place", () => {
    expect(welcomeSendCheck({ portalUrl: ADDRESS, defaultPinFromPhone: true })).toEqual({
      ok: true,
    });
  });
});

describe("the sign-in address is judged before it can reach a message", () => {
  // FALSIFIABLE: with no validator, "equb.example.org" saves and the welcome
  // tells 27 people to open something their phone will not resolve. It is
  // refused rather than repaired with a guessed https:// — the app inventing a
  // scheme is a guess printed as an instruction in a message nobody can recall.
  it("refuses an address with no scheme rather than guessing one", () => {
    expect(portalUrlProblem("equb.example.org")).toContain("https://");
  });

  it("refuses a scheme a phone cannot open", () => {
    expect(portalUrlProblem("ftp://equb.example.org")).toContain("https://");
  });

  // FALSIFIABLE: without this coercion the very first thing the welcome does
  // with the stored value is `.trim()` it, and `getSetting` JSON-parses the row
  // and CASTS — nothing validates the shape. A row holding `false` or a number
  // therefore throws MID-SEND, inside a batch, after earlier members have
  // already been messaged. A non-string address is no address.
  it("a stored value that is not a string reads as no address, never a throw", () => {
    expect(portalUrlValue(false)).toBe("");
    expect(portalUrlValue(42)).toBe("");
    expect(portalUrlValue(null)).toBe("");
    expect(portalUrlValue(undefined)).toBe("");
    expect(portalUrlValue("https://equb.example.org")).toBe("https://equb.example.org");
    // …and it lands on the refusal that is actually true.
    expect(welcomeSendCheck({ portalUrl: portalUrlValue(false), defaultPinFromPhone: true }).ok).toBe(
      false,
    );
  });

  it("accepts a real address, and accepts an empty box", () => {
    expect(portalUrlProblem("https://equb.example.org/login")).toBeNull();
    // Clearing it is legitimate — an organizer moving the portal has to be able
    // to empty the box. welcomeSendCheck is what refuses to SEND while it is
    // empty; this only answers "could a member open what was typed".
    expect(portalUrlProblem("")).toBeNull();
    expect(portalUrlProblem("   ")).toBeNull();
  });
});

// ————————————————————————————————————————————————————————————————
// 2. IS WHAT IT SAYS TRUE — the three new placeholders.
// ————————————————————————————————————————————————————————————————

describe("the new placeholders speak the member's frame, not the cycle's", () => {
  // FALSIFIABLE: render {weeksTotal} instead — the existing token for the same
  // number — and the sentence reads "You are saving $1,000 a week for 10",
  // which is not English. The pluralised count is the shape the sentence needs.
  it("weeksCommitted is the member's own count, in words", () => {
    expect(placeholderValues(HENOK).weeksCommitted).toBe("10 weeks");
  });

  // FALSIFIABLE: `${n} weeks` unconditionally — the version anyone writes first
  // — produces "1 weeks" for a member committed to a single week, which is a
  // real state (the 2.22 override case, and anyone joining on the last week).
  it("and it is pluralised, because a one-week commitment exists", () => {
    expect(placeholderValues({ ...HENOK, weeksCommitted: 1 }).weeksCommitted).toBe("1 week");
  });

  // FALSIFIABLE: this is the defect the REWORK section of
  // docs/WHATSAPP_TEMPLATES.md was written for, caught before it shipped.
  // Henok joined at week 14 and finishes at week 23; neither number may appear
  // anywhere in his welcome (UI_STANDARDS 8c — cycle week numbers are the
  // ORGANIZER's frame). Two dates and his own count are what he can read.
  it("the whole welcome names two dates and no cycle week number", () => {
    const rendered = renderTemplate(
      DEFAULT_TEMPLATES.WHATSAPP_WELCOME.body,
      placeholderValues(HENOK),
    );
    expect(rendered).toContain("Sunday, August 16, 2026");
    expect(rendered).toContain("Sunday, October 18, 2026");
    expect(rendered).toContain("10 weeks");
    expect(rendered).toContain("https://equb.example.org");

    // THE TWO NUMBERS THE MEMBER HAS NO WAY TO INTERPRET, scanned as STANDALONE
    // NUMBERS rather than as the phrase "week 14". The phrase form could never
    // fail: this body has never contained a {week} token, so it has never
    // contained the word "week" followed by a number, and the assertion passed
    // on a template that said anything at all. `\b` is what keeps 14 from
    // matching inside 2014 — the dates are the reason a bare indexOf is wrong.
    const cycleNumbers = (text: string) =>
      [HENOK.currentCycleWeek, HENOK.finishWeek].filter((n) =>
        new RegExp(`\\b${n}\\b`).test(text),
      );
    expect(cycleNumbers(rendered), "a cycle week number reached the member").toEqual([]);

    // POSITIVE CONTROL — a scan that cannot fire is not a scan. This is the
    // exact defect it exists to catch: {week} put back in place of {startDate},
    // which renders Henok's joining week as a number and reads "from 14 to
    // Sunday, October 18, 2026".
    expect(
      cycleNumbers(renderTemplate("from {week} to {finishDate}.", placeholderValues(HENOK))),
      "the cycle-number scan no longer detects a cycle number",
    ).toEqual([HENOK.currentCycleWeek]);

    // And nothing was left as a literal token.
    expect(rendered).not.toMatch(/\{[a-zA-Z]+\}/);
  });

  // FALSIFIABLE: fall back to the week number the way {finishDate} still does
  // for older callers, and a member with no resolvable start week reads "from
  // 14 to Sunday, October 18, 2026" — a cycle week presented as a date.
  it("startDate renders the sentinel rather than a week number when it is absent", () => {
    expect(placeholderValues({ ...HENOK, startDate: null }).startDate).toBe(NO_VALUE);
  });

  it("portalUrl renders the sentinel when no address is set", () => {
    expect(placeholderValues({ ...HENOK, portalUrl: "" }).portalUrl).toBe(NO_VALUE);
    expect(placeholderValues({ ...HENOK, portalUrl: undefined }).portalUrl).toBe(NO_VALUE);
  });

  // FALSIFIABLE: add either name to DASHABLE_PLACEHOLDERS and this fails. The
  // allowlist in lib/placeholder-kinds.ts is default-deny, so the day this
  // template is approved, buildContentVariables refuses a send whose address or
  // start date came back empty instead of delivering the hole. Only
  // lastPaymentWeek is honestly a dash.
  it("neither may legitimately BE the sentinel in a delivered message", () => {
    // POSITIVE CONTROL, FIRST. The allowlist is default-deny, so `false` is also
    // what this returns for "banana", for a placeholder that was renamed, and
    // for every name in the list if DASHABLE_PLACEHOLDERS were emptied or the
    // function replaced with `() => false`. Without this line the three
    // assertions below would survive all of that and still read as a guard.
    expect(mayRenderAsNoValue("lastPaymentWeek"), "nothing is dashable any more").toBe(true);

    for (const name of ["startDate", "portalUrl", "weeksCommitted"] as const) {
      // …and each one is a variable this template actually carries, so a
      // renamed placeholder fails here rather than passing as an unknown string.
      expect(
        DRAFT_TEMPLATES.WHATSAPP_WELCOME.variableOrder,
        `${name} is no longer a variable of the welcome`,
      ).toContain(name);
      expect(mayRenderAsNoValue(name), `${name} must not be dashable`).toBe(false);
    }
  });

  // FALSIFIABLE: PLACEHOLDER_DOCS is what the template editor lists AND what
  // unknownPlaceholders() checks against — a token missing from it is reported
  // to the organizer as a mistake in his own template.
  it("all three are offered to the organizer as tokens he can use", () => {
    const tokens = PLACEHOLDER_DOCS.map((p) => p.token);
    expect(tokens).toContain("{weeksCommitted}");
    expect(tokens).toContain("{startDate}");
    expect(tokens).toContain("{portalUrl}");
    expect(unknownPlaceholders(DEFAULT_TEMPLATES.WHATSAPP_WELCOME.body)).toEqual([]);
  });
});

// ————————————————————————————————————————————————————————————————
// 3. IT CANNOT REACH A MEMBER — the guard that matters most.
// ————————————————————————————————————————————————————————————————

describe("WHATSAPP_WELCOME is a real message type that Meta has NOT approved", () => {
  it("is a message key, and is sent by hand", () => {
    expect(MESSAGE_KEYS).toContain("WHATSAPP_WELCOME");
    expect(MANUAL_MESSAGE_KEYS).toContain("WHATSAPP_WELCOME");
  });

  // THE GUARD THIS FILE EXISTS FOR.
  //
  // FALSIFIABLE: add the entry to APPROVED_TEMPLATES — the one-line "fix" that
  // makes the send work — and this fails. It has to, because Twilio answers a
  // missing or unrecognised template by substituting the values submitted at
  // APPROVAL: "Sara", "$7,000.00". The welcome would then deliver a fabricated
  // name and invented figures to a real member, formatted exactly like fact,
  // AND set an agreement requirement on the strength of it.
  it("is NOT in the approved registry, and the registry still holds exactly five", () => {
    expect(APPROVED_TEMPLATE_KEYS).not.toContain("WHATSAPP_WELCOME" as never);
    expect(Object.keys(APPROVED_TEMPLATES)).toHaveLength(5);
    expect(isApprovedTemplateKey("WHATSAPP_WELCOME")).toBe(false);
  });

  // FALSIFIABLE: give DraftTemplate a `contentSid: ""` field and this fails.
  // An empty ContentSid is the dangerous shape — it is a request on the wire
  // with no template behind it — so the field is ABSENT rather than blank, and
  // the send path has nothing to read even by mistake.
  it("the draft carries no ContentSid field at all — absent, not empty", () => {
    const draft = DRAFT_TEMPLATES.WHATSAPP_WELCOME;
    expect(isDraftTemplateKey("WHATSAPP_WELCOME")).toBe(true);
    expect(Object.hasOwn(draft, "contentSid")).toBe(false);
    expect(JSON.stringify(draft)).not.toContain("HX");
  });

  it("the draft's named body is DERIVED from the body that will be submitted", () => {
    const draft = DRAFT_TEMPLATES.WHATSAPP_WELCOME;
    expect(toNamedBody(draft.draftBody, draft.variableOrder)).toBe(draft.namedBody);
    expect(toApprovedBody(draft.namedBody, draft.variableOrder)).toBe(draft.draftBody);
    // And it is what the editable row starts from, so the organizer reads the
    // exact sentence that will be submitted rather than a second copy of it.
    expect(DEFAULT_TEMPLATES.WHATSAPP_WELCOME.body).toBe(draft.namedBody);
  });

  // FALSIFIABLE: Meta rejects a body that begins or ends with a variable — a
  // "dangling parameter" — and a rejection permanently burns the template name.
  // Every one of our six original bodies opened with `{name},` and would have
  // been rejected; this one is checked before submission rather than after.
  it("obeys Meta's shape rules: no dangling parameter, sequential numbering", () => {
    const body = DRAFT_TEMPLATES.WHATSAPP_WELCOME.draftBody;
    expect(body.startsWith("{{")).toBe(false);
    expect(body.trimEnd().endsWith("}}")).toBe(false);
    const positions = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number.parseInt(m[1], 10));
    expect([...new Set(positions)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(DRAFT_TEMPLATES.WHATSAPP_WELCOME.variableOrder).toHaveLength(6);
  });

  // FALSIFIABLE: a name placeholderValues does not return is not a blank on
  // screen — it is a missing ContentVariable, which Twilio fills from the
  // approval sample. The type already enforces this; this catches a widening.
  it("every variable name is one placeholderValues actually returns", () => {
    const available = Object.keys(placeholderValues(HENOK));
    for (const name of DRAFT_TEMPLATES.WHATSAPP_WELCOME.variableOrder) {
      expect(available, `the welcome uses {${name}}, which nothing provides`).toContain(name);
    }
  });
});

// ————————————————————————————————————————————————————————————————
// 4. THE WIRING — mechanical properties, read off the source.
//
// The requirement write cannot be exercised end-to-end today: deliver() skips
// every unsubmitted template before it reaches the log, which is the correct
// behaviour and makes the pair below unreachable until a ContentSid exists.
// What CAN be pinned now is that it is wired to the right condition and shares
// the right transaction, so approving the template is one step and not two.
// ————————————————————————————————————————————————————————————————

// WHAT THIS BLOCK CAN AND CANNOT PROVE, said plainly.
//
// Every test here is a SOURCE SCAN over a branch that cannot currently
// execute: `deliver()` skips WHATSAPP_WELCOME before reaching the requirement
// write, because the template has no approved ContentSid yet. So these assert
// the wiring is CORRECT, not that it RUNS — no fixture here gates anybody,
// and none could.
//
// They are still worth having: the day the ContentSid is registered, that
// branch goes live against real members with no further code change, and these
// are what stop it going live in the wrong shape. What they must never be
// mistaken for is evidence that the mechanism works end to end. Read
// `lib/agreement.test.ts` for the gate's own behaviour, which is fully
// exercised because it is pure.
describe("sending the welcome is what requires the signature", () => {
  const engine = read("lib/messaging-engine.ts");
  const deliver = engine.slice(engine.indexOf("async function deliver("));

  // FALSIFIABLE: two separate awaits — the obvious way to write this — leave a
  // window where the message was recorded as sent and the member is not gated,
  // or the reverse. The organizer's proof of what was said and the obligation
  // it created cannot exist without each other.
  it("the log row and the requirement share ONE transaction", () => {
    expect(deliver).toMatch(
      /\$transaction\(\[[\s\S]{0,600}messageLog\.create[\s\S]{0,600}agreementRequiredAt/,
    );
  });

  // FALSIFIABLE: drop `result.ok` and a FAILED send gates the member anyway —
  // locking someone out of their own portal behind a document they were never
  // sent. The agreement is owed by a member who was TOLD.
  it("only a send Twilio accepted sets it — never a failure", () => {
    // `isWelcome` rather than the literal: the key has to be captured BEFORE
    // the approved-template guard, which narrows it to ApprovedTemplateKey and
    // made the literal comparison a compile error — the type system stating
    // the same unreachability this block's header describes.
    expect(deliver).toMatch(/isWelcome\s*&&\s*result\.ok/);
    expect(engine).toMatch(/const isWelcome = input\.key === "WHATSAPP_WELCOME"/);
  });

  // FALSIFIABLE: a plain `update` throws when the row has moved on, AFTER the
  // message has already gone; and without the ACTIVE filter a participation
  // closed between the send and this line is gated for a cycle it has left.
  it("writes only to the ACTIVE participation, and cannot throw on a missing row", () => {
    const write = deliver.slice(deliver.indexOf("participation.updateMany"));
    expect(deliver).toContain("participation.updateMany");
    expect(write.slice(0, 300)).toContain(`status: "ACTIVE"`);
  });

  // FALSIFIABLE: the requirement lives in deliver(), so BOTH callers get it
  // from the one path they already share. Put it in either action instead and
  // the other one silently does not gate anybody — which is how the per-member
  // winner announcement shipped with no extras (lib/winner-extras.ts).
  it("both send paths reach it through the same sendStatement", () => {
    expect(engine).toMatch(/participationId: input\.participationId/);
    expect(read("app/actions/messages.ts")).toContain("sendStatement(");
    expect(read("app/actions/member-messaging.ts")).toContain("sendStatement(");
    // …and neither action WRITES the requirement itself. Reading it is fine —
    // the panel now shows "welcomed on {date}" from exactly this column — so
    // the scan matches the write shape (`agreementRequiredAt:` given a value),
    // not the bare name a `select:` also contains.
    for (const file of ["app/actions/messages.ts", "app/actions/member-messaging.ts"]) {
      expect(read(file), `${file} must not set the requirement itself`).not.toMatch(
        /agreementRequiredAt:(?!\s*true\b)/,
      );
    }
    // The write-shape scan still catches the engine's own write — the proof
    // it can catch anything (5.2).
    expect(engine).toMatch(/agreementRequiredAt:(?!\s*true\b)/);
  });
});

describe("the block is ONE rule, asked everywhere", () => {
  // FALSIFIABLE: a second copy of "is portalUrl empty" in any of these files is
  // how the settings form and the send path end up disagreeing — the settings
  // form being the one place the organizer could actually fix it.
  it("every caller asks welcomeSendCheck rather than re-deriving it", () => {
    for (const file of [
      "lib/messaging-engine.ts",
      "app/actions/messages.ts",
      "app/actions/member-messaging.ts",
      "app/admin/(protected)/settings/messaging/messaging-form.tsx",
    ]) {
      const src = read(file);
      expect(src, `${file} must ask the shared rule`).toContain("welcomeSendCheck");
      // The reason strings live in lib/welcome-send.ts and nowhere else.
      expect(src, `${file} must not restate the refusal`).not.toContain("last 4 digits of their");
    }
  });

  // FALSIFIABLE: the engine consults the rule before it renders and before it
  // writes anything, so a blocked welcome costs nothing and leaves no row.
  it("the engine checks it before the message is rendered or logged", () => {
    const engine = read("lib/messaging-engine.ts");
    const deliver = engine.slice(engine.indexOf("async function deliver("));
    const check = deliver.indexOf("welcomeSendCheck");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(deliver.indexOf("renderTemplate("));
    expect(check).toBeLessThan(deliver.indexOf("messageLog.create"));
  });
});

describe("the welcome is offered per member, and never pre-ticked in a batch", () => {
  const base = {
    name: "Henok",
    weeksBehind: 0,
    amountOutstanding: 0,
    drawnWeek: null as number | null,
    cycleClosed: false,
    participation: "live" as "live" | "ended" | "none",
    noMessages: false,
    hasPhone: true,
    welcomeSentAt: null as Date | null,
    hasEverPaid: true,
  };
  const welcome = (state: typeof base) =>
    applicableTypes(state).find((t) => t.key === "WHATSAPP_WELCOME")!;

  // FALSIFIABLE: without a case of its own the key falls through
  // applicableTypes' `default:` and the profile greys it out with "Not sent by
  // hand." — a sentence that is both wrong and unfixable by the organizer.
  it("is offered to a live member who has never been welcomed, and says what sending does", () => {
    const t = welcome(base);
    expect(t.applicable).toBe(true);
    expect(t.reason).toBeNull();
    // The consequence is ON THE CARD (organizer request): this is the one
    // button on the panel whose effect is a locked portal, not a message.
    expect(t.note).toContain("Not welcomed yet");
    expect(t.note).toContain("sign");
    // It is not a chase: deferral and the chasing rules have nothing to say
    // about a welcome.
    expect(t.chasing).toBe(false);
  });

  // FALSIFIABLE: revert to `applicable: true` unconditionally — the previous
  // ruling — and both halves fail: the offered flag and the date in the
  // sentence.
  it("stops being offered once sent, and shows WHEN it was sent", () => {
    const sent = { ...base, welcomeSentAt: new Date(Date.UTC(2026, 7, 10)) };
    const t = welcome(sent);
    expect(t.applicable).toBe(false);
    expect(t.reason).toContain("August 10, 2026");
    // …and the way to deliberately re-issue is named, not closed silently.
    expect(t.reason).toContain("Send to many");
    expect(t.note).toBeNull();
  });

  it("is refused with everything else to someone with no phone or no cycle", () => {
    expect(welcome({ ...base, hasPhone: false }).applicable).toBe(false);
    expect(welcome({ ...base, noMessages: true }).applicable).toBe(false);
    expect(welcome({ ...base, participation: "none" }).applicable).toBe(false);
    // A member who has stopped contributing is not welcomed to a cycle they
    // have left.
    expect(welcome({ ...base, participation: "ended" }).applicable).toBe(false);
  });

  // FALSIFIABLE: `checked: blocked === null` — what every other type uses —
  // pre-ticks all 27 members. "Prepare, glance, send" would then gate every
  // existing member against a document they were never expecting, and there is
  // no un-send. This is the one type where the default is off.
  it("prepareBatch leaves the welcome unticked", () => {
    expect(read("app/actions/messages.ts")).toContain(
      `checked: blocked === null && key !== "WHATSAPP_WELCOME"`,
    );
  });
});
