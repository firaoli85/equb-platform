import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// GUARD — THE DOCUMENTS DO NOT GET TO LIE.
//
// `docs/DOMAIN_RULES.md` ends every rule with a **Pinned by:** line naming the
// test files and test names that hold it. `EQUB_GROUND_TRUTH.md` §2 is the law
// the whole platform is built from. Both are load-bearing: the precedence note
// says the Ground Truth wins over DOMAIN_RULES, which wins over the code, so a
// citation that has rotted is worse than no citation — it is a claim of proof
// where there is none.
//
// Nothing checked this. A test could be renamed, a file split, a rule quietly
// left unpinned, and the document would go on asserting it was covered.
//
// This is mechanical, so it is a scan rather than a reading: the file names and
// quoted test names are right there in the markdown.

const ROOT = join(import.meta.dirname, "..");
const DOMAIN_RULES = readFileSync(join(ROOT, "docs", "DOMAIN_RULES.md"), "utf8");
const GROUND_TRUTH = readFileSync(join(ROOT, "EQUB_GROUND_TRUTH.md"), "utf8");

const CODE_DIRS = ["lib", "app", "components", "scripts", "prisma"];

function filesUnder(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  const full = join(ROOT, dir);
  if (!existsSync(full)) return out;
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === "generated" || entry === "node_modules") continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (exts.some((e) => entry.endsWith(e))) out.push(p);
    }
  };
  walk(full);
  return out;
}

const sourceFiles = CODE_DIRS.flatMap((d) =>
  filesUnder(d, [".ts", ".tsx", ".mts", ".prisma"]),
);
const sourceText = sourceFiles.map((f) => readFileSync(f, "utf8")).join("\n");

// ————————————————— DOMAIN_RULES "Pinned by" —————————————————

/** Every `x.test.ts` named anywhere in a Pinned-by block. */
function citedTestFiles(): string[] {
  const cited = new Set<string>();
  for (const m of DOMAIN_RULES.matchAll(/\*\*Pinned by:\*\*([\s\S]*?)(?:\n\n|\n---)/g)) {
    for (const f of m[1].matchAll(/`([a-zA-Z0-9/_-]+\.test\.tsx?)`/g)) cited.add(f[1]);
  }
  return [...cited].sort();
}

/** Every quoted test name in a Pinned-by block, with the file it follows. */
function citedTestNames(): { file: string; name: string }[] {
  const out: { file: string; name: string }[] = [];
  for (const m of DOMAIN_RULES.matchAll(/\*\*Pinned by:\*\*([\s\S]*?)(?:\n\n|\n---)/g)) {
    const block = m[1];
    let current: string | null = null;
    // Walk the block in order: a file name sets the context for the quoted
    // names that follow it, exactly as the prose reads.
    for (const token of block.matchAll(
      /`([a-zA-Z0-9/_-]+\.test\.tsx?)`|\*"([^"]+)"\*/g,
    )) {
      if (token[1]) current = token[1];
      else if (token[2] && current) out.push({ file: current, name: token[2] });
    }
  }
  return out;
}

describe("GUARD — every test DOMAIN_RULES cites actually exists", () => {
  const files = citedTestFiles();

  it("finds a real set of citations", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("every cited test FILE exists", () => {
    const missing = files.filter((f) => !existsSync(join(ROOT, f)));
    expect(
      missing,
      `DOMAIN_RULES claims these pin its rules, but they do not exist: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  // The sharper check: a file can exist while the test named inside it has
  // been renamed away, which is exactly how a citation rots unnoticed.
  it("every cited TEST NAME exists in the file it is cited under", () => {
    const missing: string[] = [];
    for (const { file, name } of citedTestNames()) {
      const path = join(ROOT, file);
      if (!existsSync(path)) continue; // already reported above
      const body = readFileSync(path, "utf8");
      // Test names are quoted in the doc and appear in it/describe titles.
      // Compare on a normalised form so smart quotes and spacing do not matter.
      const norm = (s: string) => s.replace(/[‘’“”]/g, "'").replace(/\s+/g, " ");
      if (!norm(body).includes(norm(name))) missing.push(`${file} :: "${name}"`);
    }
    expect(
      missing,
      `cited by DOMAIN_RULES but not found in the file: ${missing.join(" | ")}`,
    ).toEqual([]);
  });

  it("the scan is not vacuous", () => {
    expect(citedTestNames().length).toBeGreaterThan(20);
    // It must fail on a citation that does not exist.
    const norm = (s: string) => s.replace(/\s+/g, " ");
    expect(norm("describe('a')").includes(norm("a test nobody wrote"))).toBe(false);
  });
});

// ————————————————— Ground Truth §2 —————————————————

/** Every numbered law in §2, in document order. */
function lawNumbers(): string[] {
  return [...GROUND_TRUTH.matchAll(/^### (2\.\d+) /gm)].map((m) => m[1]);
}

describe("GUARD — every law in Ground Truth §2 is reachable from the code", () => {
  const laws = lawNumbers();

  it("finds every law", () => {
    expect(laws.length).toBeGreaterThanOrEqual(28);
  });

  /**
   * A law nothing in the code refers to is not necessarily unimplemented — but
   * it IS unattributable, and on this codebase that is the same problem. The
   * house style cites the law beside the code that satisfies it ("(2.14)",
   * "2.27:", "§2.18"), and that citation is how anyone later finds out WHY a
   * rule exists before changing it.
   *
   * Process laws are exempt: they govern how the work is done, not what the
   * software does, so there is nothing for the code to cite.
   */
  const PROCESS_LAWS: Record<string, string> = {
    "2.12": "build properly and teach — about how the work is done",
    "2.13": "design reference (Mobbin) — a sourcing rule for the design pass",
    "2.16": "removed by real-world evidence — a record of what was DELETED",
    "2.17": "build incrementally — sequencing, not behaviour",
    "2.25": "UI design comes after the logic — sequencing",
    "2.26": "CI/CD at deploy time, not before — deployment process",
  };

  it("every behavioural law is cited somewhere in the code", () => {
    const uncited = laws
      .filter((n) => !PROCESS_LAWS[n])
      .filter((n) => {
        // "2.14" / "(2.14)" / "§2.14" / "2.14:" — any reference counts.
        const re = new RegExp(`(?:§|\\()?${n.replace(".", "\\.")}(?![0-9])`);
        return !re.test(sourceText);
      });
    expect(
      uncited,
      `laws with no reference anywhere in the code — either unimplemented, or implemented ` +
        `without saying which law it serves: ${uncited.join(", ")}`,
    ).toEqual([]);
  });

  it("the process-law exemptions are real laws, not a way to silence the scan", () => {
    for (const n of Object.keys(PROCESS_LAWS)) {
      expect(laws, `${n} is exempted but is not a law in §2`).toContain(n);
    }
  });

  it("the scan is not vacuous — an invented law number is not cited", () => {
    expect(/(?:§|\()?2\.99(?![0-9])/.test(sourceText)).toBe(false);
  });
});

// ————————————————— The untested-rules list —————————————————

describe("GUARD — the 'Rules with no test' list stays honest", () => {
  /** Rows still listed as untested, e.g. "**D-5**". */
  function openGaps(): string[] {
    const section = DOMAIN_RULES.slice(DOMAIN_RULES.indexOf("## Rules with no test"));
    return [...section.matchAll(/^\| \*\*(D-\d+)\*\* \|/gm)].map((m) => m[1]);
  }

  it("still lists the gaps it has not closed", () => {
    // If this ever empties, the list has served its purpose and the assertion
    // should be changed deliberately rather than silently passing on nothing.
    expect(openGaps().length).toBeGreaterThan(0);
  });

  it("a gap marked CLOSED is struck through, not deleted", () => {
    const section = DOMAIN_RULES.slice(DOMAIN_RULES.indexOf("## Rules with no test"));
    // The closed ones are recorded as ~~D-1~~ with the evidence — the record of
    // what was fixed is the point (2.16's habit, applied to the backlog).
    expect(section).toMatch(/~~D-\d+~~/);
    expect(section).toMatch(/\*\*CLOSED\*\*/);
  });
});

// A DOCUMENTED COMMAND THAT DOES NOT EXIST IS WORSE THAN NO DOCUMENTATION.
//
// Ground Truth now tells the organizer to run `npm run db:migrate` after a
// migration, and says `predev`/`prebuild`/`postinstall` keep the Prisma client
// fresh. Those are claims about package.json, and package.json is edited far
// more often than the document is re-read.
//
// THE DEFECT THIS EXISTS FOR. A stale Prisma client broke a page four times in
// one session — a property "missing" from a model the schema plainly has,
// which reads as a code defect and is not one. Deleting `predev` to shave two
// seconds off a dev start would bring all four back, silently.
describe("the Prisma-client scripts the working practice promises", () => {
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};

  it("regenerates before dev, before build, and after install", () => {
    for (const hook of ["predev", "prebuild", "postinstall"]) {
      expect(scripts[hook], `${hook} must regenerate the client`).toContain("prisma generate");
    }
  });

  // The one that matters most: `predev` fires only when the server BOOTS, so
  // it does nothing for a migration applied while `next dev` is running.
  // Binding generate to the migration is what removes the forgettable step.
  it("binds generate to the migration itself, not only to the dev start", () => {
    expect(scripts["db:migrate"]).toBeDefined();
    expect(scripts["db:migrate"]).toContain("prisma migrate deploy");
    expect(scripts["db:migrate"]).toContain("prisma generate");
  });

  it("Ground Truth names the command that exists", () => {
    const practice = readFileSync(
      join(import.meta.dirname, "..", "EQUB_GROUND_TRUTH.md"),
      "utf8",
    );
    const named = [...practice.matchAll(/npm run ([a-z:]+)/g)].map((m) => m[1]);
    const missing = [...new Set(named)].filter((s) => !(s in scripts));
    expect(missing, `documented but not in package.json: ${missing.join(", ")}`).toEqual([]);
    // Non-vacuity: it must actually have found some commands to check.
    expect(named.length).toBeGreaterThan(0);
  });

  // The restart half cannot be automated, so the document has to carry it —
  // regenerating the files underneath a running Next server does not evict the
  // client already in its module graph.
  it("says the dev server must be restarted, which no script can do", () => {
    const practice = readFileSync(
      join(import.meta.dirname, "..", "EQUB_GROUND_TRUTH.md"),
      "utf8",
    );
    // `\s+` rather than a literal space: the sentence wraps across lines in
    // the markdown, and a guard that breaks on re-wrapping is a guard that
    // gets deleted the first time someone reflows a paragraph.
    expect(practice).toMatch(/Restart\s+the\s+dev\s+server\s+before\s+testing/i);
  });
});

// ————————————————————————————————————————————————————————————————————————
// THE RETIRED SENDER CANNOT RESURFACE AS THE ACTIVE ONE (Build 1, item 1).
//
// The 555-prefix number was the first approval and is dead: Twilio's finding
// was that a 555-prefix number is unsupported for WhatsApp Business. The live
// sender is +13016835755. The old number cost a real debugging session — the
// organizer read it off the settings screen while diagnosing delivery — so it
// may survive ONLY as labelled history, never as a current fact.
// ————————————————————————————————————————————————————————————————————————

describe("GUARD — the retired WhatsApp sender is history, never the active sender", () => {
  // Constructed, not written literally — this file is inside its own scan, and
  // a guard that names the forbidden string verbatim reports itself forever.
  const OLD = ["1555", "962", "0327"].join("");

  it("no source file names the retired sender at all", () => {
    const offenders: string[] = [];
    for (const dir of CODE_DIRS) {
      for (const file of filesUnder(dir, [".ts", ".tsx", ".mts", ".sql", ".prisma"])) {
        if (readFileSync(file, "utf8").includes(OLD)) {
          offenders.push(relative(ROOT, file).replaceAll("\\", "/"));
        }
      }
    }
    expect(
      offenders,
      `these files name the retired sender ${OLD} — the live sender is +13016835755, ` +
        `and history belongs in EQUB_GROUND_TRUTH.md §2.28's sender-history note`,
    ).toEqual([]);
  });

  it("in the documents it appears only inside the labelled sender-history note", () => {
    const docs = [
      ...filesUnder("docs", [".md"]),
      join(ROOT, "EQUB_GROUND_TRUTH.md"),
      join(ROOT, "README.md"),
    ].filter(existsSync);
    const offenders: string[] = [];
    for (const file of docs) {
      const text = readFileSync(file, "utf8");
      for (const [i, line] of text.split("\n").entries()) {
        if (!line.includes(OLD)) continue;
        // The ONE legitimate home: the §2.28 blockquote that opens with the
        // words "Sender history". A history line is a "> "-quoted line inside
        // that note, so the test walks back to the start of the enclosing
        // blockquote and reads its first line.
        const lines = text.split("\n");
        let start = i;
        while (start > 0 && lines[start - 1].startsWith(">")) start--;
        const labelled =
          line.startsWith(">") && /sender history/i.test(lines[start] ?? "");
        if (!labelled) {
          offenders.push(
            `${relative(ROOT, file).replaceAll("\\", "/")}:${i + 1} → ${line.trim().slice(0, 90)}`,
          );
        }
      }
    }
    expect(
      offenders,
      "the retired sender appears outside the labelled history note — a reader " +
        "will take it for the active number",
    ).toEqual([]);
  });

  // NON-VACUITY (5.2): the history note itself exists and is caught as
  // legitimate — if it were deleted, the first test would be scanning for a
  // number that appears nowhere and this guard would prove nothing.
  it("the labelled history note is really there, and really carries the number", () => {
    expect(GROUND_TRUTH).toMatch(/\*\*Sender history\*\*/);
    const note = GROUND_TRUTH.slice(GROUND_TRUTH.indexOf("**Sender history**"));
    expect(note.slice(0, 600)).toContain(OLD);
    expect(note.slice(0, 600)).toContain("13016835755");
    expect(note.slice(0, 600)).toMatch(/555-prefix.*unsupported/);
  });
});

// ————————————————————————————————————————————————————————————————————————
// A DOCUMENT MAY NOT CALL AN APPROVED TEMPLATE UNAVAILABLE.
//
// The organizer's request, verbatim: "a document claiming a template is
// unavailable fails when that template has a registered ContentSid." This is
// §5.15 turned into a build failure: WHATSAPP_TEMPLATE_ONLY.md spent six days
// saying "statements do not work" after Meta approved five templates, and the
// day WHATSAPP_WELCOME's SID lands in the registry, any sentence still calling
// it unsubmitted fails here — nobody has to remember the docs exist.
// ————————————————————————————————————————————————————————————————————————

describe("GUARD — no document calls a registered template unavailable", () => {
  // The claims that would make a reader believe a template cannot send. Tight
  // on purpose (5.3): "approved 7 August" and "the wording that was submitted"
  // must keep passing — HISTORY is allowed, a present-tense denial is not.
  const DENIALS = [
    /not (?:yet )?submitted/i,
    /remains? unsubmitted/i,
    /awaiting submission/i,
    /has no (?:approved )?(?:template|ContentSid)/i,
    /no approved template exists/i,
    /cannot (?:be )?sen[dt]/i,
    /is not registered/i,
    /none are registered/i,
  ];

  const DOCS = [
    ...filesUnder("docs", [".md"]),
    join(ROOT, "EQUB_GROUND_TRUTH.md"),
  ].filter(existsSync);

  it("every key with a registered ContentSid is free of unavailability claims", async () => {
    const { APPROVED_TEMPLATE_KEYS } = await import("./whatsapp-templates");
    const offenders: string[] = [];
    for (const file of DOCS) {
      const lines = readFileSync(file, "utf8").split("\n");
      // A TWO-LINE WINDOW, because markdown wraps: "WHATSAPP_WELCOME is
      // drafted below and\n**not yet submitted**" is one sentence on two
      // lines, and a line-by-line scan reads it as neither. EXCEPT table
      // rows: a "|" row is complete on its own line, and joining two rows
      // pairs one template's name with its NEIGHBOUR'S status.
      for (let i = 0; i < lines.length; i++) {
        const window = lines[i].trimStart().startsWith("|")
          ? lines[i]
          : `${lines[i]}\n${lines[i + 1] ?? ""}`;
        for (const key of APPROVED_TEMPLATE_KEYS) {
          if (!window.includes(key)) continue;
          if (DENIALS.some((d) => d.test(window))) {
            offenders.push(
              `${relative(ROOT, file).replaceAll("\\", "/")}:${i + 1} → ${window.replace(/\n/g, " ⏎ ").trim().slice(0, 100)}`,
            );
          }
        }
      }
    }
    expect(
      offenders,
      "a doc line claims a template with a registered ContentSid is unavailable — " +
        "the registry (lib/whatsapp-templates.ts) says otherwise, and the registry is the truth",
    ).toEqual([]);
  });

  // THE DAY ARRIVED (13 Aug 2026): the welcome registered, the expires-by-
  // design assertion flipped, and the scan above now covers every sentence
  // about it. LOCKOUT_NOTICE is the one key that may legitimately be called
  // template-less forever — asserted so the guard's exemption cannot widen.
  it("the welcome is registered, so the scan covers its lines — LOCKOUT alone stays out", async () => {
    const { isApprovedTemplateKey } = await import("./whatsapp-templates");
    expect(isApprovedTemplateKey("WHATSAPP_WELCOME")).toBe(true);
    expect(isApprovedTemplateKey("GROUP_ANNOUNCEMENT")).toBe(true);
    expect(isApprovedTemplateKey("LOCKOUT_NOTICE")).toBe(false);
  });
});
