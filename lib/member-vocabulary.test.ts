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
