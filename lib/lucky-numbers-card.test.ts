import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE LUCKY NUMBERS CARD, after the 2.25 design pass (14 Aug 2026).
//
// A SOURCE SCAN, because the defect is structural JSX: the card was a table
// of always-open inputs — a number field and an amount field per row, plus a
// permanently-expanded add row — and the reported complaint was that the
// per-number amount field duplicates the weekly amount stated twice above it.
// No unit test of a pure function can see a form that is open when it should
// be shut, and there is no DOM test harness for this file.
//
// WHAT MUST SURVIVE: every capability. Add, edit a number, edit an amount,
// delete with a confirm, and the number-conflict resolution.

const ROOT = join(import.meta.dirname, "..");
const SRC = readFileSync(
  join(ROOT, "app", "admin", "(protected)", "people", "[id]", "participation-editor.tsx"),
  "utf8",
);
/** The card's own section — the file also holds the participation editor. */
const CARD = SRC.slice(SRC.indexOf("function LuckyRow"));

describe("a number READS by default and edits only when asked", () => {
  it("the row opens with no fields — Edit is what reveals them", () => {
    expect(CARD).toContain("const [editing, setEditing] = useState(false)");
    // Both fields live behind the flag.
    expect(CARD).toMatch(/editing && \(/);
    expect(CARD).toContain('aria-expanded={editing}');
  });

  it("the amount renders as TEXT, and only beside siblings", () => {
    // formatMoney in the chip, not an AmountInput.
    expect(CARD).toMatch(/showAmount && \([\s\S]{0,200}formatMoney\(n\.amount\)/);
    // The prop exists precisely so ONE number — which carries the whole
    // weekly amount already shown above — does not repeat it.
    expect(SRC).toContain("showAmount={props.luckyNumbers.length > 1}");
  });

  it("Save is dead until something actually changed", () => {
    expect(CARD).toContain("const dirty =");
    expect(CARD).toContain("disabled={busy || !dirty}");
  });

  it("reopening after a cancel does not carry the abandoned edit", () => {
    expect(CARD).toMatch(/setNumber\(String\(n\.number\)\);[\s\S]{0,80}setEditing/);
  });
});

describe("the add form is one control until it is used", () => {
  it("collapsed by default, expanded on request", () => {
    expect(SRC).toContain("const [addingNumber, setAddingNumber] = useState(false)");
    expect(SRC).toContain("+ Add a number");
    expect(SRC).toMatch(/\{!addingNumber \? \(/);
    expect(SRC).toContain("setAddingNumber(false)");
  });
});

describe("every capability survives the redesign", () => {
  it("add, update, delete and conflict resolution are all still wired", () => {
    for (const call of [
      "addLuckyNumber({",
      "updateLuckyNumber({",
      "deleteLuckyNumber({",
      "NumberConflictPanel",
    ]) {
      expect(SRC, `${call} was lost in the redesign`).toContain(call);
    }
  });

  it("delete still asks first, and says what it costs", () => {
    expect(CARD).toMatch(/ask\(\s*\{\s*title: `Delete lucky number/);
    expect(CARD).toContain("confirmLabel: `Delete #${n.number}`");
    expect(CARD).toContain("destructive: true");
  });
});

describe("the consequence is stated BEFORE the press, not only in the audit log", () => {
  // reconcileWeeklyAmount rewrites participation.weeklyAmount to the sum of
  // the numbers and replays every receipt. The card never said so.
  it("both the edit form and the add form name the reconciliation", () => {
    const editWarning = CARD.includes("re-allocates every receipt");
    const addWarning = SRC.includes("re-allocates their receipts");
    expect(editWarning, "editing an amount silently moves their weekly contribution").toBe(true);
    expect(addWarning, "adding a number silently raises their weekly contribution").toBe(true);
  });

  it("and both say it is refused once they have been drawn", () => {
    expect(CARD).toContain("refused once they have been drawn");
    expect(SRC).toContain("refused outright once they have been drawn");
  });
});
