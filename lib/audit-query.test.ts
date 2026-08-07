import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditDateWindow,
  auditFilterActive,
  auditFilterSummary,
  auditPageInfo,
  AUDIT_PAGE_SIZE,
  isAuditAction,
  parseAuditFilter,
  personNamePattern,
} from "./audit-query";

describe("reading the filter off a URL, trusting none of it", () => {
  it("an empty URL is the whole record, page 1", () => {
    const f = parseAuditFilter({});
    expect(f).toEqual({ action: "all", entity: "all", personId: null, from: null, to: null, page: 1 });
    expect(auditFilterActive(f)).toBe(false);
  });

  it("keeps a real action and drops an invented one", () => {
    expect(parseAuditFilter({ action: "delete" }).action).toBe("delete");
    expect(parseAuditFilter({ action: "DROP TABLE" }).action).toBe("all");
    expect(isAuditAction("move")).toBe(true);
    expect(isAuditAction("archive")).toBe(false);
  });

  it("drops a date that is not a date", () => {
    expect(parseAuditFilter({ from: "yesterday" }).from).toBeNull();
    expect(parseAuditFilter({ from: "2026-03-01" }).from).toBe("2026-03-01");
  });

  it("SWAPS a reversed range rather than returning nothing", () => {
    // A reversed range matches no rows, and an empty screen reads as "nothing
    // happened" — the one conclusion the audit log must never invite.
    const f = parseAuditFilter({ from: "2026-03-09", to: "2026-03-01" });
    expect(f.from).toBe("2026-03-01");
    expect(f.to).toBe("2026-03-09");
  });

  it("a nonsense page is page 1", () => {
    for (const page of ["0", "-4", "abc", "1.5", null]) {
      expect(parseAuditFilter({ page }).page, String(page)).toBe(1);
    }
    expect(parseAuditFilter({ page: "3" }).page).toBe(3);
  });
});

describe("the date range means whole DAYS", () => {
  it("no range is no window", () => {
    expect(auditDateWindow({ from: null, to: null })).toBeNull();
  });

  it("the TO day is included in full", () => {
    // An entry at 23:59 on the 5th belongs to "up to the 5th". A `lte` on the
    // 5th at midnight would drop almost the entire day.
    const w = auditDateWindow({ from: "2026-03-01", to: "2026-03-05" })!;
    expect(w.gte).toEqual(new Date("2026-03-01T00:00:00.000Z"));
    expect(w.lt).toEqual(new Date("2026-03-06T00:00:00.000Z"));
    expect(new Date("2026-03-05T23:59:59.000Z") < w.lt!).toBe(true);
  });

  it("a single day is a whole day", () => {
    const w = auditDateWindow({ from: "2026-03-05", to: "2026-03-05" })!;
    expect(w.lt!.getTime() - w.gte!.getTime()).toBe(86_400_000);
  });

  it("one-sided ranges leave the other side open", () => {
    expect(auditDateWindow({ from: "2026-03-01", to: null })!.lt).toBeUndefined();
    expect(auditDateWindow({ from: null, to: "2026-03-01" })!.gte).toBeUndefined();
  });
});

describe("paging", () => {
  it("an empty log is still page 1 of 1, not page 1 of 0", () => {
    const info = auditPageInfo(0, 1);
    expect(info).toMatchObject({ page: 1, pages: 1, total: 0, firstShown: 0, lastShown: 0 });
    expect(info.hasPrevious).toBe(false);
    expect(info.hasNext).toBe(false);
  });

  it("counts the pages and the window on each", () => {
    const info = auditPageInfo(120, 2, 50);
    expect(info).toMatchObject({ pages: 3, skip: 50, firstShown: 51, lastShown: 100 });
    expect(info.hasPrevious).toBe(true);
    expect(info.hasNext).toBe(true);
  });

  it("the last page stops at the total, not at the page size", () => {
    expect(auditPageInfo(120, 3, 50).lastShown).toBe(120);
  });

  it("CLAMPS a page past the end instead of showing an empty screen", () => {
    // Narrowing a filter while sitting on page 7 is the ordinary way to reach
    // this, and an empty result would read as "there are no entries".
    const info = auditPageInfo(30, 7, 50);
    expect(info.page).toBe(1);
    expect(info.firstShown).toBe(1);
  });

  it("the default page size is a screenful, not the whole table", () => {
    expect(AUDIT_PAGE_SIZE).toBe(50);
  });
});

describe("the sentence that says what is on screen", () => {
  const base = parseAuditFilter({});

  it("says so plainly when nothing is filtered", () => {
    const info = auditPageInfo(120, 1);
    expect(auditFilterSummary(base, info, null)).toBe("Every recorded change — showing 1–50 of 120.");
  });

  it("names every active filter", () => {
    const f = parseAuditFilter({ action: "delete", entity: "Payout", from: "2026-03-01", to: "2026-03-05" });
    const line = auditFilterSummary(f, auditPageInfo(3, 1), "Hana");
    expect(line).toContain("deletes only");
    expect(line).toContain("Payout entries");
    expect(line).toContain("everything touching Hana");
    expect(line).toContain("2026-03-01 to 2026-03-05");
  });

  it("says NOTHING MATCHES rather than leaving a blank screen unexplained", () => {
    const f = parseAuditFilter({ action: "move" });
    expect(auditFilterSummary(f, auditPageInfo(0, 1), null)).toContain("nothing matches");
  });

  it("does not fake a range when the whole result fits on one page", () => {
    expect(auditFilterSummary(base, auditPageInfo(3, 1), null)).toContain("3 entries");
    expect(auditFilterSummary(base, auditPageInfo(1, 1), null)).toContain("1 entry");
  });
});

describe("matching a person by name in an entry's prose", () => {
  it("matches the name on its own boundaries", () => {
    const p = personNamePattern(["Hana"])!;
    expect(p.test("Payout for Hana collected")).toBe(true);
    expect(p.test("Deleted Hana's receipt")).toBe(true);
    expect(p.test("(Hana)")).toBe(true);
  });

  it("does NOT match a longer name that merely contains it", () => {
    const p = personNamePattern(["Hana"])!;
    expect(p.test("Payout for Hanan collected")).toBe(false);
    expect(p.test("Bethana paid")).toBe(false);
  });

  it("matches Amharic, where an ASCII word boundary never fires", () => {
    const p = personNamePattern(["ሐና"])!;
    expect(p.test("ክፍያ ሐና ተመዝግቧል")).toBe(true);
    expect(p.test("nothing here")).toBe(false);
  });

  it("treats regex punctuation in a name as literal text", () => {
    const p = personNamePattern(["A.B"])!;
    expect(p.test("Edited A.B today")).toBe(true);
    expect(p.test("Edited AXB today")).toBe(false);
  });

  it("ignores names too short to be a safe match", () => {
    expect(personNamePattern(["A", "", null])).toBeNull();
  });

  it("matches any of several forms of the same person", () => {
    const p = personNamePattern(["Hana Bekele", "Hana", "ሐና"])!;
    expect(p.test("Hana Bekele was added")).toBe(true);
    expect(p.test("ሐና was added")).toBe(true);
  });
});

// ————————————————————————————————————————————————————————————————
// GUARD — the log is APPEND-ONLY.
//
// A Postgres trigger is the real enforcement (it holds against a hand-run
// query, which is the case that matters). This catches the same mistake at
// review time, where it is cheap, and names the file that would otherwise be
// the first place someone reaches for.
// ————————————————————————————————————————————————————————————————

const ROOT = join(import.meta.dirname, "..");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    // The generated Prisma client declares update/delete for every model,
    // AuditLog included. It is the surface this rule forbids USING, not a
    // use of it — and it is rewritten by `prisma generate`, so a rule about
    // it could never be honoured anyway.
    if (entry === "generated") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("GUARD — nothing rewrites or removes an audit entry", () => {
  it("no code updates or deletes auditLog rows", () => {
    const offenders: string[] = [];
    const forbidden = /\bauditLog\.(update|updateMany|delete|deleteMany|upsert)\b/;
    for (const dir of ["app", "lib", "scripts"]) {
      for (const file of tsFiles(join(ROOT, dir))) {
        const source = readFileSync(file, "utf8");
        if (forbidden.test(source)) offenders.push(relative(ROOT, file).replace(/\\/g, "/"));
      }
    }
    expect(
      offenders,
      "The audit log is append-only (D-32): a wrong entry is answered by a NEW entry, " +
        "never by a rewritten one. These files change existing entries:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the database enforces it too, not just this test", () => {
    const migration = readFileSync(
      join(ROOT, "prisma/migrations/20260807030000_audit_log_append_only/migration.sql"),
      "utf8",
    );
    expect(migration).toMatch(/BEFORE UPDATE ON public\.audit_logs/);
    expect(migration).toMatch(/BEFORE DELETE ON public\.audit_logs/);
    expect(migration).toContain("RAISE EXCEPTION");
  });
});
