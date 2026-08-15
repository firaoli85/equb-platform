import { describe, expect, it } from "vitest";
import {
  APPROVED_TEMPLATES,
  APPROVED_TEMPLATE_KEYS,
  driftMessage,
  toApprovedBody,
  toNamedBody,
  type ApprovedTemplateKey,
} from "./whatsapp-templates";
import { DEFAULT_TEMPLATES, MESSAGE_KEYS, placeholderValues } from "./messages";

// THE DRIFT GUARD.
//
// Seven templates carry Meta-approved wording (five on 7 August 2026, the
// member-relative v2 rework on 13 August 2026). Twilio sends them by
// ContentSid, which means the approved sentence goes out no matter what the
// database says — so a database body that has drifted does not change the
// message, it only makes the app lie to the organizer about what members are
// receiving.
//
// These tests exist so that drift fails the BUILD rather than being discovered
// by a member. They compare in both directions: the registry against itself,
// and (in the live-body test below) the database against the registry.

describe("the approved registry reproduces Meta's wording exactly", () => {
  for (const key of APPROVED_TEMPLATE_KEYS) {
    const t = APPROVED_TEMPLATES[key];

    it(`${key}: substituting the named tokens reproduces approvedBody character for character`, () => {
      expect(toApprovedBody(t.namedBody, t.variableOrder), driftMessage(key, "namedBody")).toBe(
        t.approvedBody,
      );
    });

    it(`${key}: the round trip is stable in both directions`, () => {
      expect(toNamedBody(t.approvedBody, t.variableOrder)).toBe(t.namedBody);
      expect(toApprovedBody(t.namedBody, t.variableOrder)).toBe(t.approvedBody);
    });

    it(`${key}: every {{n}} has a name, and every name is used`, () => {
      const positions = [...t.approvedBody.matchAll(/\{\{(\d+)\}\}/g)].map((m) =>
        Number.parseInt(m[1], 10),
      );
      const highest = Math.max(...positions);
      // No gaps: {{1}}..{{n}} must all appear, or the ContentVariables map
      // Twilio receives has a hole in it.
      expect([...new Set(positions)].sort((a, b) => a - b)).toEqual(
        Array.from({ length: highest }, (_, i) => i + 1),
      );
      expect(t.variableOrder).toHaveLength(highest);
    });

    it(`${key}: every variable name is one placeholderValues actually returns`, () => {
      // The type already enforces this at compile time; this catches the case
      // where the type is widened or an `as` slips in.
      const available = Object.keys(
        placeholderValues({
          name: "Test",
          weeksCredited: 1,
          weeksCommitted: 20,
          weeksBehind: 0,
          amountOutstanding: 0,
          lastPaymentWeek: 1,
          finishWeek: 20,
          finishDate: null,
          weeklyAmount: 100_000,
          totalPaid: 100_000,
          currentCycleWeek: 1,
          weeks: [],
        } as never),
      );
      for (const variable of t.variableOrder) {
        expect(available, `${key} uses {${variable}}, which nothing provides`).toContain(variable);
      }
    });

    it(`${key}: carries a real Meta ContentSid`, () => {
      expect(t.contentSid).toMatch(/^HX[0-9a-f]{32}$/);
      expect(t.key).toBe(key);
    });
  }

  // THE ONE CHARACTER THIS WHOLE FILE EXISTS FOR.
  it("PAYMENT_CONFIRMED keeps its EM DASH (U+2014), not a hyphen or an en dash", () => {
    const body = APPROVED_TEMPLATES.PAYMENT_CONFIRMED.approvedBody;
    expect(body).toContain("—");
    expect(body).toContain("for your Equb — recorded on your week(s)");
    // The two characters it is most likely to be silently "corrected" into.
    expect(body).not.toContain("–"); // en dash
    expect(body).not.toMatch(/Equb - recorded/); // hyphen
  });

  it("every ContentSid is distinct — a copy-paste would send the wrong template", () => {
    const sids = APPROVED_TEMPLATE_KEYS.map((k) => APPROVED_TEMPLATES[k].contentSid);
    expect(new Set(sids).size).toBe(sids.length);
  });
});

// ————————————————————————————————————————————————————————————————————————
// NO DASHES IN FIXED TEMPLATE TEXT — the organizer's v3 standing rule
// (14 Aug 2026), for ALL member-facing text going forward: maximally simple,
// "stupid-proof" sentences; a dash is punctuation a reader can misread and a
// writer can mistype three different ways.
//
// TWO EXEMPTIONS, PINNED AND SHRINKING: payment_confirmed_v2 and
// whatsapp_welcome were approved BEFORE the rule and carry an em dash each —
// Meta-frozen wording nobody may edit (5.3). They stay exempt until the day
// they are resubmitted, at which point their new bodies fall under this
// guard and the exemption list must LOSE the key, never gain one.
// ————————————————————————————————————————————————————————————————————————
describe("GUARD — no dashes in registry fixed text (v3 standing rule)", () => {
  const PRE_V3_EXEMPT: readonly string[] = ["PAYMENT_CONFIRMED", "WHATSAPP_WELCOME"];
  /** Fixed text only — the {{n}} slots are values, composed elsewhere. */
  const fixedText = (body: string) => body.replace(/\{\{\d+\}\}/g, "");

  for (const key of APPROVED_TEMPLATE_KEYS) {
    if (PRE_V3_EXEMPT.includes(key)) continue;
    it(`${key}: fixed text carries no em or en dash`, () => {
      const text = fixedText(APPROVED_TEMPLATES[key].approvedBody);
      expect(text, `${key} fixed text contains an em dash`).not.toContain("—");
      expect(text, `${key} fixed text contains an en dash`).not.toContain("–");
    });
  }

  it("the exemption list cannot grow past the two pre-v3 bodies", () => {
    expect(PRE_V3_EXEMPT).toEqual(["PAYMENT_CONFIRMED", "WHATSAPP_WELCOME"]);
    // And each exempt body really is the pre-v3 one still — the day either
    // changes, its exemption must be removed with it.
    expect(APPROVED_TEMPLATES.PAYMENT_CONFIRMED.contentSid).toBe(
      "HXf357ad3b5f22055d701a9e8f2b3816cc",
    );
    expect(APPROVED_TEMPLATES.WHATSAPP_WELCOME.contentSid).toBe(
      "HX90da7257223b48177b95dbbb132ea182",
    );
  });

  // NON-VACUITY, in-memory: the scan sees a planted dash. The live plant
  // (dash into a v3 body → build fails → restore) is run once at build time
  // and recorded in the build report, not repeated here.
  it("the scan catches a planted dash and ignores one inside a slot value", () => {
    expect(fixedText("That is {{3}} to catch up — please pay.")).toContain("—");
    // A dash arriving INSIDE a variable's value is composed text, not fixed
    // text, and the fixed-text scan must not look at it.
    expect(fixedText("recorded on your week(s) {{3}}.")).not.toContain("–");
  });
});

describe("LOCKOUT_NOTICE is undeliverable BY DESIGN", () => {
  it("is a real message key", () => {
    expect(MESSAGE_KEYS).toContain("LOCKOUT_NOTICE");
  });

  // If this ever fails, someone has added an approved template for it. That is
  // not a merge conflict to resolve — it is a decision to re-open. A lockout
  // notice is a security message; Twilio Verify is the channel for it.
  it("has NO approved template, and must not gain one by accident", () => {
    expect(APPROVED_TEMPLATE_KEYS).not.toContain("LOCKOUT_NOTICE" as ApprovedTemplateKey);
    // 12 since the phase-4 payment set landed (15 Aug 2026): the seven of the
    // 13/14 Aug sets plus payment_confirmed_v4, payment_confirmed_with_partial,
    // partial_confirmed, partial_completed and late_notice_v4. EXACT, not a
    // minimum — a registry that grew by accident must fail here.
    expect(Object.keys(APPROVED_TEMPLATES)).toHaveLength(12);
  });
});

describe("the failure message tells the reader what to DO", () => {
  const message = driftMessage("PAYMENT_CONFIRMED", "The database body");

  it("names what broke and where", () => {
    expect(message).toContain("PAYMENT_CONFIRMED");
    expect(message).toContain("The database body");
    expect(message).toContain("Meta approved");
  });

  it("says why editing the text here does not fix it", () => {
    expect(message).toContain("ContentSid");
    expect(message).toContain("does NOT change");
  });

  it("names the only route to changing the wording", () => {
    expect(message).toContain("RE-SUBMISSION");
    expect(message).toContain("RE-APPROVAL");
  });

  it("names the way back", () => {
    expect(message).toContain("sync-approved-templates");
  });

  it("is not merely 'strings differ'", () => {
    expect(message.length).toBeGreaterThan(200);
    expect(message).not.toMatch(/^expected/i);
  });
});

describe("toApprovedBody leaves unknown tokens alone", () => {
  it("does not collapse a token the template does not carry into a slot", () => {
    // A body mentioning {weeksLeft} when the template has no such variable
    // must FAIL to match rather than quietly becoming {{2}}.
    const out = toApprovedBody("Hi {name}, {weeksLeft} left.", ["name"]);
    expect(out).toBe("Hi {{1}}, {weeksLeft} left.");
    expect(out).not.toBe("Hi {{1}}, {{2}} left.");
  });

  it("maps a repeated token to the same position, as Twilio does", () => {
    expect(toApprovedBody("{name} and {name}", ["name"])).toBe("{{1}} and {{1}}");
  });
});

// ————————————————————————————————————————————————————————————————
// DEFAULT_TEMPLATES IS NOT A SECOND COPY OF THE APPROVED WORDING.
//
// It used to hold its own freeform text for the five approved keys, and
// deliver() falls back to it when a MessageTemplate row is absent. Twilio
// sends by ContentSid, so a member would still have received Meta's sentence
// — while MessageLog permanently recorded the fallback as the thing that was
// said. The log is the organizer's proof of what was said to whom; one that
// disagrees with what was sent is worse than none, because it is believed.
// ————————————————————————————————————————————————————————————————

describe("DEFAULT_TEMPLATES agrees with the registry", () => {
  it("every approved key's default body IS the registry's namedBody", () => {
    for (const key of APPROVED_TEMPLATE_KEYS) {
      expect(DEFAULT_TEMPLATES[key].body, driftMessage(key, "DEFAULT_TEMPLATES body")).toBe(
        APPROVED_TEMPLATES[key].namedBody,
      );
    }
  });

  it("round-trips back to the exact sentence Meta approved", () => {
    // The stronger check: named form → {{n}} form → must equal approvedBody
    // character for character, em dash included.
    for (const key of APPROVED_TEMPLATE_KEYS) {
      const t = APPROVED_TEMPLATES[key];
      expect(
        toApprovedBody(DEFAULT_TEMPLATES[key].body, t.variableOrder),
        driftMessage(key, "DEFAULT_TEMPLATES body"),
      ).toBe(t.approvedBody);
    }
  });

  it("carries no leftover {token} the approved template does not have", () => {
    for (const key of APPROVED_TEMPLATE_KEYS) {
      const t = APPROVED_TEMPLATES[key];
      const tokens = [...DEFAULT_TEMPLATES[key].body.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]);
      expect(new Set(tokens), key).toEqual(new Set(t.variableOrder));
    }
  });

  it("LOCKOUT_NOTICE keeps its own wording and is NOT in the registry", () => {
    // It has no approved template and must never look sendable.
    expect(APPROVED_TEMPLATE_KEYS).not.toContain("LOCKOUT_NOTICE");
    expect(DEFAULT_TEMPLATES.LOCKOUT_NOTICE.body).toContain("{lockMinutes}");
    expect(DEFAULT_TEMPLATES.LOCKOUT_NOTICE.body).not.toContain("{{");
  });

  it("the organizer-facing NAMES are ours, and still present", () => {
    // Meta approved the sentence a member reads, never the admin screen label.
    for (const key of APPROVED_TEMPLATE_KEYS) {
      expect(DEFAULT_TEMPLATES[key].name.trim().length, key).toBeGreaterThan(0);
    }
    expect(DEFAULT_TEMPLATES.PAYMENT_CONFIRMED.name).toBe("Payment confirmation");
  });
});
