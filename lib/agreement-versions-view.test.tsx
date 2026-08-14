import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgreementVersionsScreen,
  type VersionRow,
} from "@/app/admin/(protected)/settings/agreement/agreement-versions";

// THE VERSIONING SCREEN (Cycle-2 build, feature C) — the two actions it wires
// existed tested and imported by nothing; changing the wording meant a deploy.

const publishMock = vi.fn(async (_input: unknown) => ({ ok: true as const, data: { version: 3 } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/actions/agreement", () => ({
  publishAgreementVersion: (input: unknown) => publishMock(input as never),
}));

const V1: VersionRow = {
  id: "v-1",
  version: 1,
  note: "The first version.",
  createdAt: "2026-08-12T04:00:00.000Z",
  signatures: 0,
};
const V2: VersionRow = {
  id: "v-2",
  version: 2,
  note: "Clause 4 reworded after the fee ruling",
  createdAt: "2026-08-14T04:00:00.000Z",
  signatures: 3,
};

const BODY = "1. Your commitment\nYou, {memberName}, are saving {weeklyAmount} a week.";

const html = () =>
  renderToStaticMarkup(
    <AgreementVersionsScreen currentVersion={2} currentBody={BODY} versions={[V2, V1]} />,
  );

beforeEach(() => publishMock.mockClear());

describe("the versions list", () => {
  it("renders every version newest-first with label, date, and which is in force", () => {
    const out = html();
    expect(out.indexOf("v2")).toBeLessThan(out.indexOf("v1"));
    expect(out).toContain("in force");
    expect(out).toContain("published August 14, 2026");
    expect(out).toContain("Clause 4 reworded after the fee ruling");
    expect(out).toContain("3 signatures");
    expect(out).toContain("0 signatures");
  });

  // Only the CURRENT version wears the pill — two "in force" pills would be
  // two claims about one fact. Counted as element text (`>in force<`), because
  // the prose above the editor legitimately says "is in force" too.
  it("marks exactly one version as in force", () => {
    expect(html().split(">in force<").length - 1).toBe(1);
  });
});

describe("the publish form", () => {
  // FALSIFIABLE: put the finality in a confirm dialog instead — discovered
  // after the click — and this fails: it must be readable BEFORE the button.
  it("states the create-only finality inline, before the button, with the next version number", () => {
    const out = html();
    const finality = out.indexOf("Publishing is permanent");
    const button = out.indexOf("Publish as version 3");
    expect(finality).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(-1);
    expect(finality).toBeLessThan(button);
    expect(out).toContain("never edited and never deleted");
    expect(out).toContain("bound to the exact text");
  });

  it("previews the typed body through the REAL clause pipeline, tokens visible", () => {
    const out = html();
    expect(out).toContain("what a member will sign");
    expect(out).toContain("Your commitment");
    // The token is VISIBLE in the preview — its value is each member's own
    // and does not exist on this screen. A filled-in sample would be a guess
    // presented as the document.
    expect(out).toContain("{memberName}");
  });

  it("refuses to publish the unchanged wording — the button is disabled until the text moves", () => {
    // The starting body IS the current body, so the button must be disabled
    // with the reason beside it.
    const out = html();
    expect(out).toContain("This is the wording already in force");
    // [\s\S] rather than the `s` flag — the TS target predates es2018.
    expect(out).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Publish as version 3/);
  });
});

describe("publishing calls the action with what was typed", () => {
  it("passes body and note through, and the confirmation names the new version", async () => {
    // Rendered-markup tests cannot click (no jsdom here — the same limit
    // every *-view test in this repo documents), so the wiring is pinned at
    // the source level: publish() forwards the TYPED state, not a copy of
    // the props, and the ok-state names the version members now sign.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(
        import.meta.dirname,
        "..",
        "app",
        "admin",
        "(protected)",
        "settings",
        "agreement",
        "agreement-versions.tsx",
      ),
      "utf8",
    );
    expect(src).toContain("publishAgreementVersion({ body, note: note.trim() || undefined })");
    expect(src).toContain("is now what every member signs");
    // The refusal lands at the control (6b), in the action's words.
    expect(src).toContain("`Not published — ${result.error}`");
  });
});
