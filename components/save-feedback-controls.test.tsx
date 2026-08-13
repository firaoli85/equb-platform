import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemberSidebar } from "./member/member-sidebar";
import { NewDeviceNotice } from "./member/new-device-notice";
import { PresentationToggle } from "./presentation-toggle";
import { SessionList } from "./session-list";
import type { SessionView } from "@/app/actions/sessions";

// UI_STANDARDS RULE 6 ON FOUR CONTROLS THAT ARE NOT A "SAVE" BUTTON.
//
// The reported defect was a confirmation rendered 100 lines above the button
// that produced it. Three of these four had the same shape or worse:
//
//   presentation-toggle  showed a failure but DISCARDED the server's reason,
//                        so a refusal and an outage read identically.
//   session-list         put the outcome at the TOP of the list, above every
//                        session row — and sent refusals out as `role="status"`.
//   new-device-notice    awaited the dismissal and dropped the result entirely.
//   member-sidebar       `void signOutAction()` — a rejected sign-out silently
//                        did nothing at all.
//
// The interactive states cannot be driven from `renderToStaticMarkup`, so the
// claims that matter are pinned two ways: the IDLE markup for what is on
// screen before anything is pressed, and the SOURCE for the wiring — the same
// technique payment-entry.test.tsx uses for the pointer events, and for the
// same reason. A revert to the old handler leaves rendered-markup tests green.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/me",
}));
vi.mock("@/app/actions/settings", () => ({
  setPresentationMode: async () => ({ ok: true as const, data: { presentationMode: true } }),
}));
vi.mock("@/app/actions/sessions", () => ({
  signOutEverywhereElse: async () => ({ ok: true as const, data: { endedCount: 1 } }),
  dismissNewDeviceNotice: async () => ({ ok: true as const, data: { dismissed: true } }),
}));
vi.mock("@/app/actions/auth", () => ({ signOutAction: async () => {} }));

/**
 * The file with its comments stripped.
 *
 * These four files DOCUMENT the defect they fixed, quoting the old handler
 * verbatim — `setError(true)`, `void signOutAction()`, `role="status"`. Read
 * raw, every "the old shape is gone" assertion below failed on the sentence
 * explaining that it was gone, and the obvious way out is to stop quoting the
 * old code in the comments: the test would then be pressuring the file to
 * explain itself less. So the test reads what the file DOES, and the prose is
 * left free to say whatever a reader needs.
 */
const code = (...parts: string[]) =>
  readFileSync(join(import.meta.dirname, ...parts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/.*$/gm, "");

const SOURCES = {
  "presentation-toggle": code("presentation-toggle.tsx"),
  "session-list": code("session-list.tsx"),
  "new-device-notice": code("member", "new-device-notice.tsx"),
  "member-sidebar": code("member", "member-sidebar.tsx"),
};

const session = (over: Partial<SessionView> = {}): SessionView => ({
  id: "s1",
  label: "Chrome on Windows",
  browser: "Chrome",
  os: "Windows",
  deviceType: "Computer",
  location: "Addis Ababa",
  ip: "10.0.0.1",
  method: "PIN",
  startedAt: "2026-08-01T09:00:00.000Z",
  lastSeenAt: "2026-08-01T09:00:00.000Z",
  isCurrent: false,
  isNewDevice: false,
  ...over,
});

const NOW = Date.parse("2026-08-01T11:00:00.000Z");

describe("every one of the four renders its feedback through the shared control", () => {
  // Four hand-rolled message boxes are four chances to put one in the wrong
  // place. The shared component has nowhere wrong to put it.
  it.each(Object.entries(SOURCES))("%s imports SaveFeedback rather than re-rolling it", (_n, s) => {
    expect(s).toContain('from "@/components/ui/save-button"');
    expect(s).toContain("<SaveFeedback");
  });

  // The documented trap: an effect has not run at first paint, so a mirrored
  // message is ABSENT from the server-rendered HTML.
  it.each(Object.entries(SOURCES))("%s does not mirror the message into state", (_n, s) => {
    expect(s).not.toContain("useEffect");
  });

  // One state, derived. Two booleans for one condition drift apart.
  it.each(Object.entries(SOURCES))("%s keeps one SaveState and derives busy", (_n, s) => {
    expect(s).toContain('useState<SaveState>({ kind: "idle" })');
    expect(s).toMatch(/const busy = save\.kind === "saving"/);
  });
});

describe("the presentation toggle — the reason it could not switch", () => {
  const html = (on: boolean) => renderToStaticMarkup(<PresentationToggle on={on} />);

  it("says which state it is in, both ways", () => {
    expect(html(false)).toContain("○ Presentation off");
    expect(html(true)).toContain("● Presentation");
  });

  it("shows no message before anything is pressed", () => {
    expect(html(false)).not.toContain('data-testid="save-error"');
    expect(html(false)).not.toContain('data-testid="save-ok"');
  });

  // THE FIX. `setError(true)` threw the server's sentence away.
  it("carries the server's own reason into the message", () => {
    expect(SOURCES["presentation-toggle"]).toContain("`Not switched: ${result.error}`");
    expect(SOURCES["presentation-toggle"]).not.toMatch(/setError\(/);
  });

  // A safety control that stops saying whether it is ON is worse than one that
  // stops saying it failed. The label reads the state and nothing else.
  it("never lets a failure overwrite the on/off label", () => {
    expect(SOURCES["presentation-toggle"]).toContain(
      '{busy ? "Switching…" : on ? "● Presentation" : "○ Presentation off"}',
    );
  });

  // app/admin/wheel/setup/page.tsx renders this inside a <p> used as a layout
  // row. A <div> root is closed out of that paragraph by the HTML parser, and
  // the server and client then disagree about the tree.
  it("has an inline root, so it is legal where it is actually used", () => {
    expect(html(false).startsWith("<span")).toBe(true);
  });
});

describe("the session list — the outcome is no longer above the fold", () => {
  const sessions = [session({ id: "here", isCurrent: true }), session({ id: "a" }), session({ id: "b" })];
  const html = (list: SessionView[]) =>
    renderToStaticMarkup(<SessionList sessions={list} now={NOW} />);

  it("still offers the sign-out when there are other sessions", () => {
    expect(html(sessions)).toContain("Sign out everywhere else");
  });

  it("does not offer it when this device is the only one", () => {
    expect(html([session({ id: "here", isCurrent: true })])).not.toContain(
      "Sign out everywhere else",
    );
  });

  // The hand-rolled box is gone: it sat above every row, and it announced
  // refusals politely as a status.
  it("no longer hand-rolls a green/red box at the top of the list", () => {
    expect(SOURCES["session-list"]).not.toContain("bg-green-50");
    expect(SOURCES["session-list"]).not.toContain('role="status"');
  });

  it("prefixes the refusal so the state is unmistakable", () => {
    expect(SOURCES["session-list"]).toContain("`Not signed out: ${result.error}`");
  });

  // THE TRAP THIS GROUP NEARLY FELL INTO. A success ends the last other
  // session, so `others > 0` is false on the very next render. A confirmation
  // nested inside that guard is carried off with the button — press it, it
  // works, and you see nothing. Exactly the defect, one layer down.
  it("renders the confirmation OUTSIDE the guard that the success falsifies", () => {
    const s = SOURCES["session-list"];
    const start = s.indexOf("{others > 0 && (");
    expect(start).toBeGreaterThan(-1);
    const guard = s.slice(start, s.indexOf("\n      )}", start));
    // Non-vacuity: a slice that missed would be empty and pass on nothing.
    expect(guard).toContain("Sign out everywhere else");
    expect(guard).not.toContain("SaveFeedback");
    expect(s.indexOf("<SaveFeedback")).toBeGreaterThan(start);
  });

  it("does not report signing out of zero devices as a plain count", () => {
    expect(SOURCES["session-list"]).toContain("endedCount === 0");
  });
});

describe("the new-device notice — a refusal takes the dismissal back", () => {
  const html = () =>
    renderToStaticMarkup(<NewDeviceNotice sessionId="s1" message="New sign-in from Addis Ababa." />);

  it("renders the warning and its dismissal", () => {
    expect(html()).toContain("New sign-in from Addis Ababa.");
    expect(html()).toContain("That was me");
  });

  // It was `await dismissNewDeviceNotice({ sessionId })` with the result
  // dropped: the notice vanished whether or not the server accepted, and came
  // back on the next visit with nothing to explain why.
  it("reads the result instead of firing and forgetting", () => {
    expect(SOURCES["new-device-notice"]).toContain(
      "const result = await dismissNewDeviceNotice(",
    );
    expect(SOURCES["new-device-notice"]).toContain("`Not dismissed: ${result.error}`");
  });

  // The optimistic hide is kept — but it is now a hide that can be undone,
  // which is the only way the reason has anywhere to render.
  it("restores the notice when the dismissal is refused", () => {
    expect(SOURCES["new-device-notice"]).toContain("setDismissed(false)");
  });
});

describe("the member sidebar — exempt, but the refusal still lands", () => {
  const html = () => renderToStaticMarkup(<MemberSidebar />);

  it("renders the sign-out", () => {
    expect(html()).toContain("Sign out");
  });

  // EXEMPT from SaveButton: a sign-out is not a save and has no success
  // message — it redirects. 6b is not exempt, and `void signOutAction()`
  // discarded the rejection outright.
  it("no longer voids the promise away", () => {
    expect(SOURCES["member-sidebar"]).not.toContain("void signOutAction()");
    expect(SOURCES["member-sidebar"]).toContain("await signOutAction()");
  });

  it("says which way it went, rather than just that it failed", () => {
    expect(SOURCES["member-sidebar"]).toContain("Not signed out:");
    expect(SOURCES["member-sidebar"]).toContain("STILL signed in on this device");
  });

  // No `kind: "ok"` anywhere: a sign-out that worked has replaced this tree.
  it("writes no success message it could never show", () => {
    expect(SOURCES["member-sidebar"]).not.toContain('kind: "ok"');
  });
});
