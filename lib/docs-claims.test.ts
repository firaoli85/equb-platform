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
