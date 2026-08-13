import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// GUARD — THE WEEK PANEL AND THE WINNER EDITOR SPEAK AT THEIR OWN CONTROLS
// (UI_STANDARDS rule 6).
//
// Both of these render inside something long: the panel opens under a cell of
// a 27×20 grid, the editor at the foot of a week card on a page of week cards.
// Every message either of them produced used to travel UPWARDS — to the panel's
// own top banner, or to the host, which drew it at the top of its screen. The
// organizer was looking at the button.
//
// These are source scans, like refusal-placement.test.ts, because the property
// is about WHERE a message is rendered from, and that is a fact about the file.

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const panel = read("components/admin/week-action-panel.tsx");
const editor = read("components/admin/week-winner-editor.tsx");

/** The text of a block, given the index just past its opening brace. */
function braceBody(source: string, start: number): string {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
    i++;
  }
  return source.slice(start, i - 1);
}

/** The text of the JSX attribute `name={…}`, brace-matched. */
function attribute(source: string, name: string): string {
  const start = source.indexOf(`${name}={`);
  expect(start, `${name}= not found`).toBeGreaterThan(-1);
  return braceBody(source, start + `${name}={`.length);
}

describe("GUARD — the week action panel confirms at the control", () => {
  // ONE STATE. Three variables for one fact is how "saving" and "saved"
  // disagree; the old triple even carried a `busy` case nothing set any more.
  it("keeps one save state and derives the busy flag from it", () => {
    expect(panel).toMatch(/const \[save, setSave\] = useState<\{ slot: ActionSlot; state: SaveState/);
    expect(panel).toMatch(/const busy = save\.state\.kind === "saving"/);
    // The replaced triple is gone for good.
    expect(panel).not.toMatch(/setBusy\(/);
    expect(panel).not.toMatch(/const \[error, setError\]/);
    expect(panel).not.toMatch(/const \[ok, setOk\]/);
  });

  // TWO CLUSTERS OF CONTROLS, TWO PLACES TO SPEAK. `PaymentEntry` stands
  // between the header actions and the receipt list, so one message rendered
  // once would confirm an Undo pressed at the bottom up at the top.
  it("renders the message for the cluster it belongs to, in both places", () => {
    expect(panel).toContain('<SaveFeedback state={save.slot === "week" ? save.state : IDLE} />');
    expect(panel).toMatch(/<SaveFeedback state=\{save\.slot === "receipt" \? save\.state : IDLE\}/);
  });

  // ONE SAVE, ONE CONFIRMATION. PaymentEntry owns a SaveButton that renders
  // the receipt line beside its own Record button — inside this panel. The
  // panel used to copy that message into a second green paragraph of its own.
  it("does not echo the payment's own confirmation", () => {
    const onRecorded = attribute(panel, "onRecorded");
    expect(onRecorded).toContain("onSaved(message)");
    expect(onRecorded, "the panel is repeating PaymentEntry's message").not.toMatch(/setSave|setOk/);
  });

  // The note is the one control here with a button of its own, and a text
  // field: Enter finishes typing, and the SaveButton press is that submit.
  it("saves the note through a SaveButton inside a form", () => {
    expect(panel).toMatch(/<form[\s\S]*?<SaveButton[\s\S]*?<\/form>/);
    expect(panel).toMatch(/dirty=\{note !== \(detail\?\.note \?\? ""\)\}/);
    // The reason, carried verbatim from the server.
    expect(panel).toMatch(/message: `Not saved: \$\{result\.error\}`/);
  });

  // A REFUSAL IS KEPT TWICE ON PURPOSE: in the dialog, so it appears beside
  // the button just pressed, and on the panel, so cancelling out of the dialog
  // does not throw it away. And the dialog is never closed on that path.
  it("keeps a refusal in the dialog and on the panel", () => {
    const start = panel.indexOf("const refuse = (reason: string) => {");
    expect(start, "the confirm helper no longer has one refusal path").toBeGreaterThan(-1);
    const body = braceBody(panel, start + "const refuse = (reason: string) => {".length);
    expect(body).toContain("setDialogError(reason)");
    expect(body).toMatch(/set\(\{ kind: "err"/);
    expect(body, "closing here loses the reason with the dialog").not.toMatch(/setConfirm\(null\)/);
  });

  // A READ THAT FAILED IS NOT A SAVE THAT FAILED. Both used to print through
  // one banner as "Not recorded: …" — a refusal for something never asked for.
  it("says a failed load as a load", () => {
    expect(panel).toMatch(/could not be loaded: \$\{result\.error\}/);
    expect(panel).not.toMatch(/Not recorded: \{/);
  });
});

describe("GUARD — the winner editor refuses at its Review button", () => {
  // The refusals it produces are the ones that never reach a confirmation:
  // a pool that would not load, or a choice answered immediately. Pressing
  // "Review…" and getting no dialog is silence unless the reason is right
  // there — and it used to print at the top of the editor instead.
  it("renders its refusal beside Review…, not above the whole editor", () => {
    const feedback = [...editor.matchAll(/<SaveFeedback state=\{save\}/g)];
    expect(feedback.length, "the add panel and the move panel each need one").toBe(2);
    for (const m of feedback) {
      const review = editor.lastIndexOf("Review…", m.index);
      expect(review, "no Review… button precedes this message").toBeGreaterThan(-1);
      // NOTHING ELSE IN BETWEEN. A message under the button is the property;
      // a message somewhere further up the same panel is the defect.
      expect(
        editor.slice(review, m.index),
        "another control sits between the button and its message",
      ).not.toMatch(/<Select|<label/);
    }
    // The old top-of-block paragraph is gone.
    expect(editor).not.toMatch(/\{loadError && \(/);
  });

  it("prefixes each refusal with what did not happen", () => {
    expect(editor).toMatch(/message: `Not added: \$\{refusal\}`/);
    expect(editor).toMatch(/message: `Not moved: \$\{refusal\}`/);
  });

  // A refusal describes the pair that was chosen. Change either half and it
  // describes nothing on screen.
  it("clears a stale refusal when the choice changes", () => {
    const bodies = [...editor.matchAll(/onChange=\{\(v\) => \{/g)].map((m) =>
      braceBody(editor, m.index + m[0].length),
    );
    expect(bodies.length, "the number, the winner and the destination").toBe(3);
    for (const body of bodies) {
      expect(body, "a changed choice leaves the previous refusal on screen").toContain(
        "setSave(IDLE)",
      );
    }
  });
});

describe("the scans are not vacuous", () => {
  it("each pattern fires on the shape it forbids", () => {
    const echoed = `onRecorded={(message) => { setSave(message); onSaved(message); }}`;
    expect(/setSave|setOk/.test(attribute(echoed, "onRecorded"))).toBe(true);

    const head = "const refuse = (reason: string) => {";
    const closedOnRefusal = `${head}\n  setDialogError(reason);\n  setConfirm(null);\n};`;
    expect(
      /setConfirm\(null\)/.test(braceBody(closedOnRefusal, closedOnRefusal.indexOf(head) + head.length)),
    ).toBe(true);

    const topBanner = `      {loadError && (\n        <p role="alert">{loadError}</p>\n      )}`;
    expect(/\{loadError && \(/.test(topBanner)).toBe(true);

    // The between-the-two check must fire when the message is hoisted above
    // the picker instead of sitting under the button.
    const hoisted = `Review…</button>\n<label><Select /></label>\n<SaveFeedback state={save} />`;
    const at = hoisted.indexOf("<SaveFeedback");
    expect(/<Select|<label/.test(hoisted.slice(hoisted.lastIndexOf("Review…", at), at))).toBe(true);

    // A change handler that forgets to clear.
    const stale = `onChange={(v) => { setTargetWeekId(v); }}`;
    expect(
      braceBody(stale, stale.indexOf("onChange={(v) => {") + "onChange={(v) => {".length),
    ).not.toContain("setSave(IDLE)");

    // And the attribute reader really brace-matches rather than stopping at
    // the first `}` — the object literal inside would break a lazy regex.
    const nested = `onRecorded={(m) => { setSave({ kind: "ok", message: m }); }}`;
    expect(attribute(nested, "onRecorded")).toContain('kind: "ok"');
  });
});
