import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// MEMBER CARDS — a member should read as one object, not a line of text.
//
// SOURCE SCANS, because what changed is arrangement and vocabulary. The two
// things worth pinning are both real defects that were found rather than
// invented: the directory offered three sort keys for figures NO view showed,
// and the same 27 people were identified by a coloured disc on one screen and
// by bold text on another.

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const DIRECTORY = read("app/admin/(protected)/people/people-directory.tsx");
const PAYMENTS = read("app/admin/(protected)/payments/payments-members.tsx");

describe("the directory leads with boxes, not a table", () => {
  it("opens on the card view", () => {
    expect(DIRECTORY).toContain('useViewMode("admin-people-view", "grid")');
  });

  it("keeps the dense table available behind the toggle", () => {
    expect(DIRECTORY).toContain('labels={{ list: "List", grid: "Cards" }}');
    expect(DIRECTORY).toContain("<table");
  });
});

describe("every sortable figure is a figure the card shows", () => {
  // THE DEFECT: sortDirectory offers weekly / contributed / committed /
  // weeksPaid. Three of the four were invisible, so re-ordering the page
  // shuffled it on evidence the reader could not see.
  it("renders weeks paid, weeks committed, the weekly amount and the total", () => {
    expect(DIRECTORY).toContain("{p.weeksPaid} of {p.weeksCommitted} weeks");
    expect(DIRECTORY).toContain("formatMoney(p.weeklyAmount)");
    expect(DIRECTORY).toContain("formatMoney(p.contributedThisCycle)");
  });

  it("shows progress as a bar with a real accessible value, not colour alone", () => {
    expect(DIRECTORY).toContain('role="progressbar"');
    expect(DIRECTORY).toContain("aria-valuenow={p.weeksPaid}");
    expect(DIRECTORY).toContain("aria-valuemax={p.weeksCommitted}");
    // …and the same fact in words, for anyone who cannot see the bar.
    expect(DIRECTORY).toContain("weeks paid`}");
  });

  it("never divides by zero for someone outside a cycle", () => {
    expect(DIRECTORY).toContain("p.inActiveCycle && p.weeksCommitted > 0");
  });
});

describe("one identity vocabulary across screens", () => {
  it("both the directory and the payments list identify people by the disc", () => {
    expect(DIRECTORY).toContain("<InitialAvatar");
    expect(PAYMENTS).toContain("<InitialAvatar");
  });

  it("presentation mode gets NO disc — initials are the identity it hides (2.4)", () => {
    // The avatar must sit in the branch that only renders when NOT presenting.
    const presenting = PAYMENTS.indexOf("{presentation ? (");
    const avatar = PAYMENTS.indexOf("<InitialAvatar", presenting);
    const elseBranch = PAYMENTS.indexOf(") : (", presenting);
    expect(presenting).toBeGreaterThan(-1);
    expect(avatar).toBeGreaterThan(elseBranch);
  });
});

describe("the boxes obey the radius and number rules", () => {
  it("the inner panel is a smaller radius than the card that holds it", () => {
    // Concentric radius: card rounded-2xl with p-4, so the panel inside is
    // rounded-xl. Two equal radii read as a sticker on a card.
    expect(DIRECTORY).toContain("p-4 shadow-sm");
    expect(DIRECTORY).toContain('className="mt-3 rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-white/[0.03]"');
  });

  it("the payments week squares step down from their rounded-2xl box", () => {
    expect(PAYMENTS).toContain("rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] p-3 shadow-sm");
    expect(PAYMENTS).toMatch(/flex h-8 w-9 shrink-0 items-center justify-center rounded /);
  });

  it("every figure that changes is tabular", () => {
    for (const figure of [
      "{p.weeksPaid} of {p.weeksCommitted} weeks",
      "formatMoney(p.contributedThisCycle)",
    ]) {
      const i = DIRECTORY.indexOf(figure);
      expect(i).toBeGreaterThan(-1);
      // The nearest enclosing span carries tabular-nums.
      expect(DIRECTORY.slice(Math.max(0, i - 220), i)).toContain("tabular-nums");
    }
  });
});

describe("what the restructure must not break", () => {
  it("the list view still emits one row per person, with the pinned header", () => {
    expect(DIRECTORY).toContain('"Agreement"');
    expect(DIRECTORY).toContain("<tr");
  });

  it("the card grid keeps the marker the signing-chip test slices on", () => {
    const grid = DIRECTORY.indexOf("sm:grid-cols-2");
    expect(grid).toBeGreaterThan(-1);
    expect(DIRECTORY.indexOf("<SigningChip", grid)).toBeGreaterThan(grid);
  });

  it("payments still opens the one shared panel", () => {
    expect(PAYMENTS).toMatch(/<WeekActionPanel\b/);
  });
});
