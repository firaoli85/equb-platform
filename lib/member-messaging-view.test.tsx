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
  welcomeSentAt: null,
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

// THE DELIBERATE RE-SEND (organizer, Aug 2026): once a welcome has been sent
// the ordinary list stops offering it, and re-issuing to ONE person must not
// mean unticking twenty-six in the batch. Its own card, its own copy — the
// consequence (a re-locked portal) is read where it is pressed.
describe("the welcome re-send card", () => {
  const WELCOME_PREVIEW =
    "Hi Tsion, welcome to your Equb. You are saving $250 a week for 20 weeks…";
  const welcomed = (over: Partial<MemberMessagingView> = {}) =>
    view({
      welcomeSentAt: "2026-08-10T14:00:00.000Z",
      types: [
        {
          key: "WHATSAPP_WELCOME",
          label: "Welcome message",
          applicable: false,
          reason: "Tsion was welcomed on Monday, August 10, 2026…",
          note: null,
          chasing: false,
          preview: WELCOME_PREVIEW,
        },
      ],
      ...over,
    });

  it("appears once a welcome was sent, and states the consequence before the button", () => {
    const out = html(welcomed());
    expect(out).toContain("Send the welcome again");
    expect(out).toContain("Last sent August 10, 2026");
    // The two halves of what a second send DOES, in the card's own words —
    // signing the current terms, and a portal shut until they do.
    expect(out).toContain("current terms");
    expect(out).toContain("portal stays closed to them until they sign");
    expect(out).toContain("There is no un-send");
    // The exact text a second send carries, not a description of it (2.20).
    expect(out).toContain(WELCOME_PREVIEW);
    expect(out).toContain("Send the welcome to Tsion again");
  });

  // FALSIFIABLE: key the card off the types list instead — the shape that
  // renders it for a NEVER-welcomed member, where the primary send already
  // covers it and two buttons would gate someone twice.
  it("is absent until a welcome has actually been sent", () => {
    expect(html(view({ welcomeSentAt: null }))).not.toContain("Send the welcome again");
  });
});
