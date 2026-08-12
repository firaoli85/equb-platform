import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// GUARD — NO QUERY ON A GROWING TABLE IS UNBOUNDED.
//
// lib/paging.ts already states the rule: "a list is either fully shown, paged,
// or visibly truncated." Nothing enforced it, and it is not a property you can
// eyeball — there are 50-odd `findMany` calls across the actions, and the ones
// that matter are the handful reading tables that grow forever.
//
// A table that grows FOREVER is different from one bounded by the group's
// size. There will never be more than a few dozen people or a few dozen weeks
// in a cycle. But every message ever sent, every receipt, every audit entry
// and every sign-in accumulate for the life of the platform — so a query with
// no `take` on one of those is a page that gets slower every week until it
// stops loading, and it does so silently.
//
// This is mechanical, so it is a scan.

const ROOT = join(import.meta.dirname, "..");

/** Tables with no natural ceiling — they grow with USE, not with the roster. */
const UNBOUNDED_TABLES = [
  "messageLog",
  "paymentEvent",
  "auditLog",
  "signInSession",
  "ledgerEntry",
  "cashReading",
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === "generated" || entry === "node_modules") continue;
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(p);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

// Scripts are excluded deliberately: they are one-shot tools the organizer
// runs by hand, not pages he waits on, and several must read every row BY
// DESIGN (the audit recomputes every figure from every receipt).
const files = tsFiles("app").concat(tsFiles("lib"));
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

/**
 * Every `prisma.<table>.findMany({...})` call, with its argument text.
 *
 * Brace-matched rather than regex-terminated: a nested `include` or `where`
 * contains braces, and a lazy regex stops at the first one, which would read
 * the outer `take` as absent and report a false positive.
 */
function findManyCalls(source: string): { table: string; args: string; index: number }[] {
  const out: { table: string; args: string; index: number }[] = [];
  const re = /(?:prisma|tx)\.(\w+)\.findMany\(\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    out.push({ table: m[1], args: source.slice(re.lastIndex, i - 1), index: m.index });
  }
  return out;
}

describe("GUARD — growing tables are never read unbounded", () => {
  it("scans a real set of queries", () => {
    const total = files.reduce((n, f) => n + findManyCalls(readFileSync(f, "utf8")).length, 0);
    expect(total).toBeGreaterThan(20);
  });

  /**
   * THE RULE IS SCOPE, NOT `take` — and the first version of this scan got it
   * wrong in a way worth recording.
   *
   * It flagged every `findMany` on a growing table that had no `take`, and
   * found ten. Every one turned out to be ARITHMETIC: settlement events read
   * with `select: { amount: true }` and summed. Adding `take` to those would
   * not make a page faster, it would make a TOTAL WRONG — silently, and in the
   * direction that loses money. A cap on a sum is a bug, not a safeguard.
   *
   * What actually distinguishes a dangerous query is its SCOPE. A read pinned
   * to one participation, one person, or an explicit list of ids is bounded by
   * something the organizer can see and control: that member's own history. A
   * read scoped only to a cycle — or to nothing — grows with the platform's
   * whole life, and that is the one that eventually stops loading.
   */
  // Accepts SHORTHAND too — `{ payoutId, type }` is as scoped as
  // `{ payoutId: x }`, and the first version of this regex required the colon,
  // so it reported two correctly-scoped reads as unbounded.
  const SINGLE_ENTITY =
    /\b(participationId|personId|authUserId|settlementPayoutId|luckyNumberId|payoutId|weekId|drawId|slotId)\s*[:,}]/;

  it("every unbounded read of a growing table is scoped to ONE entity", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const call of findManyCalls(source)) {
        if (!UNBOUNDED_TABLES.includes(call.table)) continue;
        if (/\btake\s*:/.test(call.args)) continue;
        if (SINGLE_ENTITY.test(call.args)) continue;
        const line = source.slice(0, call.index).split("\n").length;
        offenders.push(
          `${rel(file)}:${line} — prisma.${call.table}.findMany: no take AND not scoped to one entity`,
        );
      }
    }
    expect(
      offenders,
      `reads that grow with the platform's whole life:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  // The other half: a read that feeds a rendered LIST needs a take even when
  // it is scoped, because one member's receipts still grow every week.
  it("the lists that grow per member are paged, not merely scoped", () => {
    const paging = readFileSync(join(ROOT, "lib", "paging.ts"), "utf8");
    for (const key of ["messageLog", "receipts", "cashReadings"]) {
      expect(paging, `${key} has no page size`).toMatch(new RegExp(`\\b${key}\\s*:`));
    }
  });

  // A `take` is only half the answer: a list cut at N without saying so reads
  // as the whole list. lib/paging.ts exists to say so.
  it("the paging module still offers both halves — a size and a notice", () => {
    const paging = readFileSync(join(ROOT, "lib", "paging.ts"), "utf8");
    expect(paging).toMatch(/export const PAGE_SIZES/);
    expect(paging).toMatch(/export const CAPS/);
    expect(paging).toMatch(/export function truncationNotice/);
    expect(paging).toMatch(/export function pageInfo/);
  });

  // Every capped list must actually render its notice, or the cap is a silent
  // truncation — the exact thing the module was written to prevent.
  it("every CAP is matched by a truncation notice somewhere", () => {
    // The cap is applied in the ACTION; the notice is rendered by the
    // COMPONENT. Requiring both in ONE file — which this did at first —
    // reports every correctly-built pair as a defect. The property that
    // matters is per CAP KEY across the codebase, not per file.
    const all = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const capKeys = [...new Set([...all.matchAll(/CAPS\.(\w+)/g)].map((m) => m[1]))];
    expect(capKeys.length).toBeGreaterThan(2);
    const unannounced = capKeys.filter((k) => {
      // The notice must be computed against THIS cap, not just imported.
      const near = new RegExp(`truncationNotice\\([\\s\\S]{0,200}CAPS\\.${k}\\b`);
      return !near.test(all);
    });
    expect(
      unannounced,
      `capped but never says it was cut: ${unannounced.join(", ")}`,
    ).toEqual([]);
  });

  it("the scan is not vacuous", () => {
    const planted = `  const rows = await prisma.messageLog.findMany({ where: { personId }, orderBy: { createdAt: "desc" } });`;
    const calls = findManyCalls(planted);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("messageLog");
    expect(/\btake\s*:/.test(calls[0].args)).toBe(false);

    // And it must NOT fire when the take is present past a nested object.
    const bounded = `  await prisma.messageLog.findMany({ where: { person: { id } }, include: { template: true }, take: 50 });`;
    expect(/\btake\s*:/.test(findManyCalls(bounded)[0].args)).toBe(true);
  });
});
