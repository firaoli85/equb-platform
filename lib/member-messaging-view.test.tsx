import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemberMessaging } from "@/app/admin/(protected)/people/[id]/member-messaging";
import type { MemberMessagingView } from "@/app/actions/member-messaging";

// THE PROFILE'S SEND PANEL, ASSERTED ON RENDERED HTML.
//
// lib/member-messaging-wiring.test.ts proves the ACTION now produces a
// participation id and an applicable closing statement in both cycle states.
// This proves the screen does something with them — because the second half of
// the defect was in the markup, not the data: `participationId === null`
// replaced the entire send card with "is not in the running cycle, so there is
// no current position to state", so on the day the cycle closed every member's
// profile showed that sentence and no send control at all. 2.18 requires a
// closing statement for every member at exactly that moment.

vi.mock("next/navigation", () => ({
  // The component refreshes after a send so "Already sent to them" takes on
  // the new truth. Nothing here clicks, so a stub is enough.
  useRouter: () => ({ refresh: () => {} }),
}));

const CLOSING_PREVIEW =
  "Hi Tsion, your Equb closing statement: you paid 5 of 20 weeks, $1,250 in total. " +
  "Outstanding balance $1,500. Please contact Firaoli to confirm.";

const view = (over: Partial<MemberMessagingView> = {}): MemberMessagingView => ({
  participationId: "p-2026",
  types: [
    {
      key: "CYCLE_CLOSING_STATEMENT",
      label: "Closing statement",
      applicable: true,
      reason: null,
      note: null,
      chasing: false,
      preview: CLOSING_PREVIEW,
    },
    {
      key: "LATE_NOTICE",
      label: "Late notice",
      applicable: false,
      reason: "Tsion's cycle has closed. The closing statement is the statement for a finished cycle — anything still owed is now a carried balance on Tsion (2.18/2.19).",
      note: null,
      chasing: true,
      preview: null,
    },
  ],
  blockedReason: null,
  history: [],
  historyTotal: 0,
  ...over,
});

const html = (v: MemberMessagingView) =>
  renderToStaticMarkup(<MemberMessaging view={v} personName="Tsion" />);

describe("the send panel once the cycle has closed", () => {
  // HONEST ABOUT WHAT THIS ONE PROVES. The component would have rendered this
  // same markup before — it never saw the view below, because the action could
  // not produce it. So this is the PAIRING: given what getMemberMessaging now
  // returns for a closed cycle (pinned in lib/member-messaging-wiring.test.ts),
  // the screen shows a send control rather than an explanation. The two tests
  // in the next block are the ones this component alone can fail.
  it("offers the closing statement with a send button and the real text", () => {
    const out = html(view());
    expect(out).toContain("Send this to Tsion");
    expect(out).toContain("Outstanding balance $1,500");
    expect(out).not.toContain("is not in the running cycle");
  });

  // UI_STANDARDS 6b: the refusal belongs at the control, not only in a banner.
  it("keeps the types it cannot send on screen, each with its own reason", () => {
    const out = html(view());
    expect(out).toContain("Not applicable right now");
    expect(out).toContain("carried balance");
  });
});

describe("the send panel for a person in no cycle at all", () => {
  // The state that genuinely has nothing to state — and the ONLY one that now
  // reaches this card. The sentence had to change with it: "not in the running
  // cycle" was true of a closed cycle too, which is how it came to be shown to
  // 27 members who were very much in one.
  it("says which absence it means, and never mentions the running cycle alone", () => {
    const out = html(view({ participationId: null, types: [] }));
    expect(out).toContain("not the running one, and not a closed one");
    expect(out).not.toContain("Send this to Tsion");
  });

  it("still shows what has already been sent to them", () => {
    // Their record does not disappear because their cycle did (2.18).
    expect(html(view({ participationId: null, types: [] }))).toContain("Already sent to them");
  });
});

describe("a member who is blocked outright", () => {
  // The empty list can now only mean "blocked", because a member of a cycle
  // can always be sent the closing statement. The old hint asserted a cause
  // ("is current, and their number has not been drawn") that would have been
  // false in every case that can still produce it.
  it("does not invent a reason the list can no longer have", () => {
    const out = html(
      view({
        types: [
          {
            key: "CYCLE_CLOSING_STATEMENT",
            label: "Closing statement",
            applicable: false,
            reason: "Tsion is marked as receiving no messages (2.28).",
            note: null,
            chasing: false,
            preview: null,
          },
        ],
      }),
    );
    expect(out).toContain("Nothing can be sent right now");
    expect(out).not.toContain("their number has not been drawn");
    expect(out).toContain("receiving no messages");
  });
});
