import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// GUARD — THE MEMBER PORTAL DOES NOT SPEAK IN CYCLE WEEK NUMBERS.
//
// A cycle week number is the ORGANIZER'S administrative coordinate. He runs a
// 20-week cycle and lives in it. The member does not: they think "I started on
// this date and I am paying for ten weeks."
//
// The portal said "You joined in week 14. Your weeks run from 14 to 23." Week
// 14 is a coordinate the reader has never seen, and "joined in week 14" reads
// as arriving late to something already running — which 2.22 explicitly says
// is not how this works. Everyone simply has their own window.
//
// This is a SOURCE scan because the failure is a literal string in JSX. There
// is no type that distinguishes "the cycle's week 14" from "your week 3", so
// nothing else can catch a `week {p.startWeek}` creeping back in.
//
// The ADMIN keeps cycle week numbers everywhere. That is the organizer's
// frame and it is correct there — this scan deliberately covers only the
// member surfaces.

const ROOT = join(import.meta.dirname, "..");
const MEMBER_SURFACES = [join(ROOT, "app", "me"), join(ROOT, "components", "member")];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

const files = MEMBER_SURFACES.flatMap(tsxFiles);
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

/**
 * Rendered text only — strip comments, so the reasoning ABOUT this rule (which
 * necessarily quotes the banned phrasing) never trips the rule itself. Proven
 * non-vacuous below.
 */
function renderedText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("GUARD — members read dates and their own counts, never cycle weeks", () => {
  it("scans a real set of member files", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  // The exact sentence that was reported, and every shape of it.
  it("nothing says a member JOINED in a week", () => {
    const offenders = files.filter((f) =>
      /joined in week|you joined in|joined at week/i.test(renderedText(readFileSync(f, "utf8"))),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("nothing renders a cycle week number as a member-facing label", () => {
    // `week {expr}` / `Week {expr}` in JSX, and the template-literal form.
    const pattern = /(?:^|[^a-z])[Ww]eeks?\s+\{(?!\s*(?:ownWeek|own)\b)/;
    const offenders: string[] = [];
    for (const f of files) {
      const text = renderedText(readFileSync(f, "utf8"));
      for (const [i, line] of text.split("\n").entries()) {
        if (pattern.test(line)) offenders.push(`${rel(f)}:${i + 1} → ${line.trim().slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("nothing interpolates a week number into a member sentence", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = renderedText(readFileSync(f, "utf8"));
      for (const [i, line] of text.split("\n").entries()) {
        if (/(?:in|on|from|to|until)\s+week\s+\$\{/i.test(line)) {
          offenders.push(`${rel(f)}:${i + 1} → ${line.trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // "of 20" for a ten-week member is the cycle's denominator on their card.
  it("no member surface renders the CYCLE's week total as their denominator", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = renderedText(readFileSync(f, "utf8"));
      for (const [i, line] of text.split("\n").entries()) {
        if (/\{plannedWeeks\}|of \{plannedWeeks\}|\{cycleWeek\}/.test(line)) {
          offenders.push(`${rel(f)}:${i + 1} → ${line.trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("nothing says 'before you joined' — the boundary is a date", () => {
    const offenders = files.filter((f) =>
      /before you joined|after you finish week|before your week \d/i.test(
        renderedText(readFileSync(f, "utf8")),
      ),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  // NON-VACUITY. The scan must fail on the exact string it exists to forbid,
  // and must NOT fail on that string inside a comment.
  it("the scan is not vacuous — it catches the reported sentence", () => {
    const planted = `  <p>You joined in week {p.startWeek}. Your weeks run from {p.startWeek}</p>`;
    expect(/joined in week/i.test(renderedText(planted))).toBe(true);
    expect(/(?:^|[^a-z])[Ww]eeks?\s+\{(?!\s*(?:ownWeek|own)\b)/.test(renderedText(planted))).toBe(
      true,
    );
  });

  it("and it does NOT fire on the reasoning about it in a comment", () => {
    const comment = `// It used to read "You joined in week 14 — Week {n}" and that was wrong.`;
    expect(renderedText(comment).trim()).toBe("");
    expect(/joined in week/i.test(renderedText(comment))).toBe(false);
  });

  // The portal's own vocabulary must actually be in use, or the rule above is
  // satisfied by simply saying nothing at all.
  it("the portal DOES speak in its own terms", () => {
    const all = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const pages = readFileSync(join(ROOT, "app", "me", "page.tsx"), "utf8");
    expect(pages).toMatch(/memberWindowSentence/);
    expect(all).toMatch(/formatDate(Long)?UTC/);
  });
});

// ————————————————————————————————————————————————————————————————————————
// THE SAME RULE OVER THE MESSAGE TEMPLATES (organizer, 13 Aug 2026 — raised
// three times before it reached here).
//
// A WhatsApp message IS a member surface — the most member-facing one the
// platform has — and the winner announcement still read "your Equb payout for
// week 1 is $9,800. Your contributions continue to week 23" at a member who
// joined for ten weeks and has never seen either number.
//
// TWO DIFFERENT OBLIGATIONS, so two different scans:
//
//   DRAFT bodies (unsubmitted) and the REWORK drafts in the doc are OURS to
//   fix today, so a cycle-week frame in one fails the build outright.
//
//   APPROVED bodies are Meta's exact wording — the drift guard holds them
//   verbatim, week numbers included, until a reworked body's ContentSid lands.
//   Scanning them would fail the build on text nobody may change (5.3), so
//   they are exempt HERE and the rework's whole purpose is recorded in
//   docs/WHATSAPP_TEMPLATES.md.
// ————————————————————————————————————————————————————————————————————————

import { DRAFT_TEMPLATES } from "./whatsapp-templates";

describe("GUARD — message templates speak the member's frame too", () => {
  // A {{n}} slot whose neighbouring fixed text frames it as a cycle week
  // number: "week {{2}}", "week(s) {{3}}", "to week {{4}}", "as of week {{2}}".
  // "weekly payments" and "a week for {{3}}" survive — the word "week" is not
  // banned, POSITIONING a number slot as a week coordinate is.
  const CYCLE_WEEK_SLOT = /week(?:\(s\))?\s+\{\{\d+\}\}/i;

  // The cycle-frame placeholders, by name. `week`, `finishWeek`,
  // `lastPaymentWeek` and `lateWeeks` all render CYCLE week numbers;
  // `weeksCovered` renders a cycle-week RANGE ("11-13"). A draft that lists
  // one in its variableOrder is putting a cycle coordinate into a member's
  // message whatever the fixed text around it says.
  const CYCLE_FRAME_PLACEHOLDERS = ["week", "finishWeek", "lastPaymentWeek", "lateWeeks", "weeksCovered"];

  it("no DRAFT body positions a variable as a cycle week number", () => {
    for (const [key, draft] of Object.entries(DRAFT_TEMPLATES)) {
      expect(draft.draftBody, `${key} frames a slot as a cycle week`).not.toMatch(CYCLE_WEEK_SLOT);
    }
  });

  it("no DRAFT carries a cycle-frame placeholder", () => {
    for (const [key, draft] of Object.entries(DRAFT_TEMPLATES)) {
      for (const name of CYCLE_FRAME_PLACEHOLDERS) {
        expect(
          draft.variableOrder as readonly string[],
          `${key} renders {${name}} — a cycle coordinate — to a member`,
        ).not.toContain(name);
      }
    }
  });

  // The four reworked bodies in the doc are what the organizer submits to
  // Meta. They are fenced "Draft" blocks; every one must already obey the
  // rule, because approval freezes the wording — a week number approved is a
  // week number members read for the life of the template.
  it("every REWORK draft block in the doc is free of cycle week slots", () => {
    const doc = readFileSync(join(ROOT, "docs", "WHATSAPP_TEMPLATES.md"), "utf8");
    const rework = doc.slice(doc.indexOf("# REWORK"));
    expect(rework.length, "the REWORK section is gone from the doc").toBeGreaterThan(100);
    // Fenced blocks introduced by "**Draft" — the submission wording. "Now"
    // blocks quote the live (Meta-frozen) bodies and are deliberately exempt.
    // The marker may wrap over lines (the winner's carries a dated note), so
    // the scan allows a short run of any text between marker and fence.
    const drafts = [...rework.matchAll(/\*\*Draft[\s\S]{0,220}?```\n([\s\S]*?)```/g)].map(
      (m) => m[1],
    );
    expect(drafts.length, "no Draft blocks found — the scan is scanning nothing").toBeGreaterThanOrEqual(4);
    for (const body of drafts) {
      expect(body, `a submission draft still frames a slot as a cycle week:\n${body}`).not.toMatch(
        CYCLE_WEEK_SLOT,
      );
    }
  });

  // NON-VACUITY: the exact reported sentence, in template form, is caught by
  // both halves.
  it("the template scan catches the winner announcement that shipped", () => {
    expect("Hi {{1}}, your Equb payout for week {{2}} is {{3}}.").toMatch(CYCLE_WEEK_SLOT);
    expect("your Equb week(s) {{2}} closed without a payment").toMatch(CYCLE_WEEK_SLOT);
    // …and does NOT fire on the member-frame shapes that must survive:
    expect("You are saving {{2}} a week for {{3}}").not.toMatch(CYCLE_WEEK_SLOT);
    expect("you are {{4}} weekly payments behind").not.toMatch(CYCLE_WEEK_SLOT);
    expect("your last payment was for the week of {{3}}").not.toMatch(CYCLE_WEEK_SLOT);
  });
});
