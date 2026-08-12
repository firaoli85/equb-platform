import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// GUARD — RECORDING MONEY HAS EXACTLY ONE ROUTE (2.19).
//
// "One allocation engine, two entry points. The profile is not a second
// system." The rule has always been about the SERVER engine, and the server
// side has held: everything goes through `allocatePayment`.
//
// The CLIENT drifted anyway. `WeekActionPanel` grew its own amount field, its
// own preview and its own commit; the Patterns view got `PaymentEntry`. Two
// components calling the same action is still two routes — it is how a
// partial-payment rule fixed in one silently fails to reach the other, and no
// server-side test can see it because both call the same function correctly.
//
// So the rule is now checked where it broke: exactly one component may build
// a payment.

const ROOT = join(import.meta.dirname, "..");
const SURFACES = [join(ROOT, "app"), join(ROOT, "components")];

/** The one component allowed to call recordPayment. */
const THE_ONE_ROUTE = "components/admin/payment-entry.tsx";

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

const files = tsxFiles(SURFACES[0]).concat(tsxFiles(SURFACES[1]));
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

describe("GUARD — one payment route", () => {
  it("scans a real set of files", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  // THE DEFECT, STATED DIRECTLY.
  it("exactly one component records a payment", () => {
    const callers = files
      .filter((f) => /\brecordPayment\s*\(/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(
      callers,
      `more than one payment route — a rule fixed in one will not reach the other: ${callers.join(", ")}`,
    ).toEqual([THE_ONE_ROUTE]);
  });

  it("and that component is the shared one", () => {
    const src = readFileSync(join(ROOT, THE_ONE_ROUTE), "utf8");
    expect(src).toMatch(/export function PaymentEntry/);
    expect(src).toMatch(/recordPayment\(/);
  });

  // All three views must reach it. A shared component nobody shares is not a
  // fix, and this is the half a "one caller" check alone would miss.
  it("all three payment views reach it", () => {
    // Members and Grid go through WeekActionPanel; Patterns goes direct.
    const panel = readFileSync(join(ROOT, "components/admin/week-action-panel.tsx"), "utf8");
    expect(panel).toMatch(/<PaymentEntry\b/);

    const patterns = readFileSync(
      join(ROOT, "app/admin/(protected)/payments/patterns-view.tsx"),
      "utf8",
    );
    expect(patterns).toMatch(/<PaymentEntry\b/);

    for (const view of ["payments-members.tsx", "payments-grid.tsx"]) {
      const src = readFileSync(join(ROOT, "app/admin/(protected)/payments", view), "utf8");
      expect(src, `${view} does not open the shared panel`).toMatch(/<WeekActionPanel\b/);
    }
  });

  // The allocation preview is the engine's rule, mirrored for live typing. If
  // a second copy of that walk appears, the squares and the receipt can
  // disagree about where money lands.
  it("only one module previews the allocation for the squares", () => {
    const callers = [...files, join(ROOT, "lib/week-picking.ts")]
      .filter((f) => /\bcoverageForAmount\s*\(/.test(readFileSync(f, "utf8")))
      .map(rel)
      .sort();
    expect(callers).toEqual(["components/admin/payment-entry.tsx", "lib/week-picking.ts"]);
  });

  // NON-VACUITY: the scan must fail on the shape it forbids.
  it("the scan is not vacuous", () => {
    const planted = `const r = await recordPayment({ participationId, amount });`;
    expect(/\brecordPayment\s*\(/.test(planted)).toBe(true);
    const innocent = `// recordPayment is called by PaymentEntry`;
    expect(/\brecordPayment\s*\(/.test(innocent)).toBe(false);
  });
});
