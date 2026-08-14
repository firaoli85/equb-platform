import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DraftCycles, type DraftCycleRow } from "@/app/admin/(protected)/cycles/draft-cycles";

// THE DRAFTS SECTION — the screen half of closing the orphaned-draft hole.
//
// The three actions (listDraftCycles / activateCycle / deleteDraftCycle) were
// written and tested when the audit found that a draft cycle was invisible,
// unactivatable and undeletable — and then imported by NOTHING, so the hole
// stayed open with its fix sitting in the repo. These pin the wiring: the
// section renders from the action's data, the activate refusal lands at the
// control (UI_STANDARDS 6b), and the delete goes through the typed phrase.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, ...p.split("/")), "utf8");

const row = (over: Partial<DraftCycleRow> = {}): DraftCycleRow => ({
  id: "draft-1",
  name: "Cycle 2 2026",
  startDate: "2026-10-04",
  plannedWeeks: 20,
  unitAmount: 100_000,
  weekCount: 20,
  memberCount: 3,
  ...over,
});

describe("the drafts section", () => {
  it("renders each draft with its shape and both controls", () => {
    const out = renderToStaticMarkup(
      <DraftCycles drafts={[row(), row({ id: "draft-2", name: "Trial cycle", memberCount: 1 })]} />,
    );
    expect(out).toContain("Drafts — not running yet");
    expect(out).toContain("Cycle 2 2026");
    expect(out).toContain("Trial cycle");
    expect(out).toContain("From Oct 4, 2026");
    expect(out).toContain("$1,000 unit");
    expect(out).toContain("3 members so far");
    expect(out).toContain("1 member so far");
    expect(out).toContain("Make “Cycle 2 2026” the live cycle");
    expect(out).toContain("Delete draft…");
  });

  // "No section header when there are no drafts" — the organizer's rule. An
  // empty Drafts section would read as something missing from every visit.
  it("renders NOTHING at all when there are no drafts — header included", () => {
    expect(renderToStaticMarkup(<DraftCycles drafts={[]} />)).toBe("");
  });
});

// The interactive halves cannot fire in a static render (no jsdom here — the
// same limit components/admin/feedback-at-the-control.test.ts documents), so
// they are pinned as source facts, comments stripped, each naming its defect.
describe("the wiring the render cannot reach", () => {
  const src = read("app/admin/(protected)/cycles/draft-cycles.tsx").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const code = src.replace(/^\s*\/\/.*$/gm, "");

  // FALSIFIABLE: route the refusal to a page banner instead and this fails —
  // the refusal must render in the SaveButton slot keyed to the row.
  it("the activate refusal lands at the control, in the engine's words", () => {
    expect(code).toMatch(/kind: "err", message: `Not activated — \$\{result\.error\}`/);
    expect(code).toContain("state={save !== null && save.id === draft.id");
  });

  // FALSIFIABLE: pass `deleting.name` to the action instead of the typed
  // phrase — the replayed-call hole ConfirmDialog's contract documents — and
  // the first assertion fails.
  it("the delete forwards what was TYPED, and requires the cycle's name", () => {
    expect(code).toContain("deleteDraftCycle({ cycleId: deleting.id, typedName })");
    expect(code).toContain("requirePhrase: deleting.name");
  });

  // FALSIFIABLE: close the dialog in a finally — the fifteen-controls defect —
  // and this fails: a refusal must keep the dialog open with the reason.
  it("a delete refusal keeps the dialog open with the reason (6b)", () => {
    expect(code).toContain("setDeleteError(result.error)");
    expect(code).toMatch(/error=\{deleteError\}/);
  });

  it("the page feeds the section from listDraftCycles, not a second query", () => {
    const page = read("app/admin/(protected)/cycles/page.tsx");
    expect(page).toContain("listDraftCycles()");
    expect(page).toMatch(/draftsResult\.ok && <DraftCycles drafts=\{draftsResult\.data\}/);
  });
});
