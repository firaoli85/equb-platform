import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CloseParticipation } from "./close-participation";

// THE WAY BACK REPORTS AT ITS OWN CONTROL (UI_STANDARDS rule 6).
//
// The reactivate button used to be a plain <button> whose result was written
// to a `msg` banner at the TOP of the panel. This asserts the RENDERED HTML
// instead of the state, because "we set a variable" was true of the broken
// version too: what matters is that the slot the confirmation lands in is in
// the same control group as the button that was pressed.
//
// Only this branch is reachable from a static render — `open` and `save` are
// internal state with no way in from props, so the close flow itself is
// covered by the SaveButton contract in components/ui/save-button.test.tsx.

// The panel calls `router.refresh()` after a write. Nothing here drives a
// write; the router is stubbed only so the component renders at all.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
// The server actions are never called from a static render, and importing the
// real module would drag Prisma and a live DATABASE_URL into a markup test.
vi.mock("@/app/actions/participation-close", () => ({
  closeParticipation: vi.fn(),
  previewParticipationClose: vi.fn(),
  reactivateParticipation: vi.fn(),
}));

const stopped = () =>
  renderToStaticMarkup(
    <CloseParticipation
      participationId="p1"
      personName="Getahun"
      cycleName="Cycle 12"
      closed={{ atWeek: 6, reason: "LEFT_THE_GROUP", note: null }}
    />,
  );

describe("the stopped panel — feedback belongs to the control", () => {
  it("offers the way back, live", () => {
    const out = stopped();
    expect(out).toContain("They are contributing again");
    // Nothing has to be "dirty" to press it: there is one decision and it is
    // the button. A disabled control here would read as a broken app.
    expect(out).not.toContain('disabled=""');
  });

  it("carries the announced slot the result lands in, beside that button", () => {
    const out = stopped();
    // `SaveButton` renders the button and its message region in ONE wrapper —
    // a refusal from `reactivateParticipation` cannot be rendered anywhere
    // else, which is the whole point of rule 6b.
    const group = out.slice(out.indexOf("They are contributing again"));
    expect(group).toContain('aria-live="polite"');
    expect(out).toContain('aria-busy="false"');
  });

  it("shows no confirmation box before anything has been pressed", () => {
    const out = stopped();
    expect(out).not.toContain('data-testid="save-ok"');
    expect(out).not.toContain('data-testid="save-error"');
  });

  it("still says where they stopped, why, and that everything they paid stands", () => {
    const out = stopped();
    expect(out).toContain("at week 6");
    expect(out).toContain("Cycle 12");
    // The stored key never reaches the screen raw — it is read back as the
    // label the organizer chose.
    expect(out).toContain("Left the group");
    expect(out).not.toContain("LEFT_THE_GROUP");
    expect(out).toContain("everything they paid stays exactly as");
  });
});
