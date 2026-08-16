import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// §5.15, MADE STRUCTURAL — a sentence must not outlive the state it describes.
//
// The platform has been bitten by this three times, each time by a string that
// was TRUE when written and stayed on the screen or in the file after its cause
// ended: `STATEMENTS_DELIVERABLE`'s reason outlived the block, then the flag
// itself sat hardcoded true with an unreachable branch under it, then
// `WHATSAPP_STATEMENTS_BLOCKED_REASON` told the organizer statements could not
// send while eleven of them delivered.
//
// PHASE 7 FOUND FIVE MORE, all in comments rather than in strings, and comments
// are where this is hardest to notice because nothing renders them:
//
//   lib/engine.ts             "It wires nothing: after this phase every screen
//                              still reads its old implementation" — false since
//                              phase 3.
//   lib/messaging-config.ts   "NOTHING READS THIS YET, AND THAT IS THE POINT" —
//                              false since 4b-ii, which reads it per payment.
//   lib/messaging-config.ts   the timezone "rides on the §5.5 SQL-view decision"
//                              — phase 5 retired the view.
//   lib/whatsapp-templates.ts "Seven ... all category UTILITY" — twelve, and one
//                              is MARKETING, which is why it cannot reach a US
//                              number.
//   lib/whatsapp-templates.ts "NOTHING CALLS THESE YET" — true for one commit.
//
// A COMMENT CANNOT BE TYPE-CHECKED, so the only thing that catches this is a
// scan. This is not a style rule: every phrase below asserts something about
// what the CODE currently does, which is exactly the class of claim that goes
// stale silently and is then believed by the next reader.

const ROOT = join(import.meta.dirname, "..");

/** Every source file under a directory, recursively — the repo's own idiom. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (entry === "generated" || entry === "node_modules") continue;
      walk(rel, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || entry.includes(".test.")) continue;
    out.push(rel);
  }
  return out;
}

const FILES = [...walk("lib"), ...walk("app")];

/**
 * Phrases that assert nothing reads / nothing calls / nothing is wired.
 *
 * ALLOWED ONLY WITH A REASON THAT SURVIVES. "Not exported" is a fact about the
 * file. "Nothing reads this YET" is a prediction about other files, and it is
 * the prediction that rots — so it must name what will change it, or not be
 * written at all.
 */
const STALE_SHAPES = [
  "NOTHING READS THIS YET",
  "READ BY NOBODY YET",
  "NOTHING CALLS THESE YET",
  "NOTHING CALLS THIS YET",
  "It wires nothing",
  "changes no message any member receives",
];

describe("§5.15 — no comment may claim a state that has ended", () => {
  it("scans a real set of source files", () => {
    // A broken glob would satisfy every assertion below.
    expect(FILES.length).toBeGreaterThan(80);
    expect(FILES).toContain("lib/engine.ts");
    expect(FILES).toContain("lib/whatsapp-templates.ts");
    expect(FILES).toContain("lib/messaging-config.ts");
  });

  it("no file claims that nothing reads it", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const shape of STALE_SHAPES) {
        // The corrected comments QUOTE the old sentence to explain what went
        // wrong, which is the right way to record it — so a line that also
        // marks it as history is not an offence.
        for (const line of text.split("\n")) {
          if (!line.includes(shape)) continue;
          const marksItHistory =
            /\b(used to|this said|it said|was true|went stale|false since|no longer)\b/i.test(line);
          if (!marksItHistory) offenders.push(`${file}: ${line.trim().slice(0, 90)}`);
        }
      }
    }
    expect(
      offenders,
      "these assert a state that may already have ended — say what reads it now, " +
        "or mark the sentence as history:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the phase-5 view is not still described as present", () => {
    // The timezone comment rode on `member_progress` existing. It does not.
    for (const file of FILES) {
      const text = readFileSync(join(ROOT, file), "utf8");
      if (!text.includes("member_progress")) continue;
      const speaksOfItAsGone =
        /\bretired?\b|\bdropped\b|\bgone\b|\bDROP VIEW\b|\bno longer\b/i.test(text);
      expect(speaksOfItAsGone, `${file} mentions member_progress as though it exists`).toBe(true);
    }
  });
});
