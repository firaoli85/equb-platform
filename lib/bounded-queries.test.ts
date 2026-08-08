import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// NO QUERY RETURNS AN ARBITRARY NUMBER OF ROWS.
//
// The audit that produced this found three shapes, and only one of them was
// fine:
//
//   UNBOUNDED AND GROWING — the balances screen loaded every person WITH
//   every ledger entry each of them had; the member profile loaded every
//   receipt from every cycle that person had ever been in. Both grow forever
//   and are never deleted (2.18). Fine at 189 receipts, unopenable at cycle
//   three.
//
//   SILENTLY CAPPED — the message log took 100 and the sign-in history 25,
//   with nothing on screen saying so. Worse than unbounded: a slow list is
//   slow, a quietly truncated one is a LIE. The organizer scrolls to the
//   bottom of the send log, does not find last cycle's notice, and concludes
//   it was never sent.
//
//   BOUNDED BY THE CYCLE — payments, collections, waiting, draws, weeks,
//   lucky numbers. About 27 members times 20 weeks, fixed by the domain.
//   These need no machinery and deliberately have none.
//
// This guard holds the first two closed. It cannot judge the third, so the
// EXEMPT list below names every unbounded query that is genuinely fine and
// says why — and a reason that stops being true is a failing test.

const ROOTS = ["app/actions", "lib"];

/** Queries whose result size is fixed by the domain, with the reason. */
const EXEMPT: Record<string, string> = {
  "app/actions/dashboard.ts":
    "one active cycle: participations (~27), payouts (~31), weeks (~20), lucky numbers (~31)",
  "app/actions/waiting.ts": "payouts and participations of the one active cycle",
  "app/actions/week-winners.ts": "weeks, draws and slot members of one cycle",
  "app/actions/wheel.ts": "slots and lucky numbers of one cycle",
  "app/actions/manual-payout.ts": "weeks, slots and numbers of one cycle",
  "app/actions/edits.ts": "rows of one participation or one cycle, resolved by id",
  "app/actions/cycles.ts": "cycles (a handful, ever) and one cycle's participations",
  "app/actions/cycle-position.ts": "weeks and payments of one cycle",
  "app/actions/participation-removal.ts": "the attachments of ONE participation",
  "app/actions/people.ts": "capped at CAPS.people, with a visible truncation notice",
  "app/actions/member-history.ts":
    "one person's participations and archives — one row per cycle they were in",
  "app/actions/auth.ts": "candidates for one phone number",
  "lib/participation-rules.ts": "weeks of one cycle",
  "lib/draw-cascade.ts": "one draw's payouts",
  "lib/draw-settlement.ts": "one participation's weeks",
  "lib/carry-reversal.ts": "one payout's ledger entries",
  "lib/number-conflict.ts": "lucky numbers of one cycle",
  "lib/people-lookup.ts": "people with a phone — the directory, bounded like it",
  "lib/messaging-engine.ts": "participations of one cycle, and one member's templates",
  "lib/session-record.ts": "already takes a limit",
};

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "generated" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsFiles(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * Source with comments removed.
 *
 * The guard's first run flagged `lib/person-record.ts`, which contains no
 * query at all — the word "findMany" appears there in a comment explaining
 * why a duplicate phone mis-authenticates. A guard that fires on prose is a
 * guard somebody switches off.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const FILES = ROOTS.flatMap((r) => tsFiles(join(process.cwd(), r))).map((f) => {
  const src = readFileSync(f, "utf8");
  return {
    path: relative(process.cwd(), f).replace(/\\/g, "/"),
    src,
    code: code(src),
  };
});

describe("every collection query is bounded, paged, or exempt with a reason", () => {
  it("finds the action and lib files", () => {
    expect(FILES.length).toBeGreaterThan(15);
  });

  it("has no unbounded findMany outside the exempt list", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (!file.code.includes("findMany")) continue;
      // Two ways to be bounded: a literal `take`, or paging maths that
      // computes one. The balances query pages through `pageInfo` and then
      // fetches by an id list — no `take` anywhere, bounded all the same,
      // and invisible to the first version of this check.
      const bounded = /\btake:/.test(file.code) || /\bpageInfo\(/.test(file.code);
      if (bounded || EXEMPT[file.path]) continue;
      offenders.push(file.path);
    }
    expect(
      offenders,
      "Add a take/paging, or add the file to EXEMPT with the reason its result " +
        "size is fixed by the domain:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("keeps the exempt list honest — every entry names a real file", () => {
    // An exemption for a file that no longer exists is an exemption nobody
    // will notice has stopped applying.
    const known = new Set(FILES.map((f) => f.path));
    const stale = Object.keys(EXEMPT).filter((p) => !known.has(p));
    expect(stale, `EXEMPT names files that are gone: ${stale.join(", ")}`).toEqual([]);
  });

  it("keeps every exemption's reason non-empty", () => {
    for (const [path, reason] of Object.entries(EXEMPT)) {
      // Non-empty and specific enough to check later — not long for its own
      // sake. "weeks of one cycle" is a complete reason in eighteen characters.
      expect(reason.trim().length, `${path} is exempt with no reason`).toBeGreaterThan(8);
    }
  });

  it("pages the three lists that grow without bound", () => {
    const paged = [
      ["app/actions/ledger.ts", "pageInfo"],
      ["app/actions/messages.ts", "pageInfo"],
      ["app/actions/audit.ts", "auditPageInfo"],
    ] as const;
    for (const [path, marker] of paged) {
      const file = FILES.find((f) => f.path === path);
      expect(file, `${path} is missing`).toBeDefined();
      expect(file!.src, `${path} no longer pages its list`).toContain(marker);
    }
  });

  it("keeps the balances query off the load-everything shape", () => {
    // The specific defect: every person, each with every ledger entry they
    // have ever had, to render one line per person.
    const ledger = FILES.find((f) => f.path === "app/actions/ledger.ts")!;
    expect(ledger.src).toContain("groupBy");
    expect(ledger.src).not.toMatch(
      /person\.findMany\(\{\s*where:\s*\{\s*ledgerEntries:\s*\{\s*some/,
    );
  });
});
