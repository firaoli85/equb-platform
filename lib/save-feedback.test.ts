import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// GUARD — SAVE FEEDBACK COMES FROM THE SHARED CONTROL, NOT FROM A PAGE BANNER.
//
// THE REPORTED DEFECT. The organizer changed a participation from 10 weeks to
// 12, pressed Save, and saw nothing. The save had worked. The confirmation WAS
// rendered — 100 lines of JSX above the button, at the top of a long form. He
// was looking at the button; the message was above the fold.
//
// components/ui/save-button.tsx exists so that cannot happen again: `SaveButton`
// and `SaveFeedback` own all four beats of UI_STANDARDS rule 6, and a caller
// that uses them CANNOT put the feedback in the wrong place, because there is
// nowhere else to put it.
//
// That is a convention, and a convention held by nothing is a convention that
// lasts until the next screen is written. The rollout across the admin took a
// dozen passes and still left three files behind — which is exactly the point:
// nobody was going to notice by reading, and the ones left behind are the
// longest files on the platform, where the banner-to-button distance is worst.
//
// WHAT THIS SCAN OWNS, and what it deliberately does not:
//
//   OWNS   the shared component is rendered at all (below);
//   OWNS   the old `{ kind: "ok" | "err" }` banner state is gone;
//   OWNS   a ConfirmDialog's `error` slot has a WRITER — the regression this
//          refactor causes, distinct from the slot merely EXISTING, which
//          lib/refusal-placement.test.ts already pins;
//   OWNS   no message is mirrored into state by a `useEffect` — this bug has
//          shipped once already, see the note on that test;
//   NOT    whether the wording carries the figures. "Saved — 12 weeks at $500,
//          3% fee" versus "Saved." is a judgement about prose. That one is the
//          manual read, and its findings live in UI_STANDARDS rule 6.
//
// TWO LISTS BELOW, AND THEY DO DIFFERENT JOBS.
//
//   NO_SUCCESS_MESSAGE is an EXEMPTION list: files that are deliberately
//   different, each with its reason. A scan with no exemption list is a scan
//   that gets switched off the first time it fires on something correct.
//
//   KNOWN_GAPS is a RATCHET, not an exemption: three files the rollout missed,
//   named so they are not mistaken for the deliberate kind. It is asserted with
//   `toEqual`, not `not.toContain` — so a NEW hand-rolled banner fails the
//   build, and so does FIXING one of these three without deleting it from the
//   list. A list that only ever grows is a list that means nothing.

const ROOT = join(import.meta.dirname, "..");

/**
 * Every file whose feedback this rule governs: a client component that calls a
 * server action. A server component cannot hold save state, and a client
 * component that calls no action has no save to report.
 */
function clientComponentsCallingActions(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "generated" || entry === ".next") continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!entry.endsWith(".tsx") || entry.endsWith(".test.tsx")) continue;
      const src = readFileSync(p, "utf8");
      if (!/^\s*["']use client["']/m.test(src)) continue;
      if (!/from\s+["']@\/app\/actions\//.test(src)) continue;
      out.push(p);
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "components"));
  return out.sort();
}

const files = clientComponentsCallingActions();
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

/**
 * The same source with comments removed.
 *
 * REQUIRED, not tidiness. Half these files document the trap they escaped by
 * QUOTING IT — components/member/member-sidebar.tsx:88 reads
 * "No `setSave({ kind: \"ok\" })` and no reset: on success the action …", and a
 * raw text match reports that file as still having a success path because it
 * says in prose that it does not. Stripping keeps the guard about the code
 * rather than pressuring the files to explain themselves less.
 *
 * String-aware, because `"https://api…"` is not a comment and blanking the rest
 * of that line would silently hide real code from every pattern below.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The text of a block, given the index just past its opening brace. */
function braceBody(src: string, start: number): string {
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  return src.slice(start, i - 1);
}

const code = new Map(files.map((f) => [f, stripComments(readFileSync(f, "utf8"))]));
const at = (f: string, index: number) => `${rel(f)}:${code.get(f)!.slice(0, index).split("\n").length}`;

// ————————————————————————————————————————————————————————————————————————
// THE EXEMPTIONS. Each names the file and WHY, and each is CHECKED — the list
// asserts these files have no success message AND still show a failure. An
// exemption that stops being true is a defect, not a permission.
// ————————————————————————————————————————————————————————————————————————
const NO_SUCCESS_MESSAGE: Record<string, string> = {
  "app/admin/login/admin-login-form.tsx":
    "A sign-in is not a save. Nothing is being edited so beat 1 (dirty) has no meaning, and beat 3's success is the NEXT PAGE — router.push takes the form off screen, so a confirmation would describe a screen he has already left.",
  "components/admin/account-menu.tsx":
    "Sign-out. No record to confirm, and a success replaces the whole tree via redirect(). The refusal is the only thing worth saying, and it was missing entirely before.",
  "components/member/member-sidebar.tsx":
    "Sign-out, member side. Same reason; on a borrowed phone 'am I still signed in?' is the only question the button exists to answer, so the failure is the whole point.",
  "components/member/new-device-notice.tsx":
    "A dismissal. The notice disappearing IS the confirmation; a success line would sit where the thing it confirms used to be. A refusal restores the notice and says why.",
  "components/presentation-toggle.tsx":
    "The confirmation is the screen redacting. This control lives in a permanent header and SaveFeedback has no fade, so a success line there would never go away.",
  "components/admin/week-winner-editor.tsx":
    "The write belongs to the parent's `ask` and collections-view renders the success under the card. Only what never reaches a confirmation lands here — pressing Review… and getting no dialog.",
};

// ————————————————————————————————————————————————————————————————————————
// THE RATCHET. Not exemptions — misses. See the header note.
// ————————————————————————————————————————————————————————————————————————

// THE RATCHET IS EMPTY, and that is the state it was built to reach.
//
// It named five files across three properties. Every one has since been fixed
// and delisted — which is the mechanism working, because `toEqual` means a
// file cannot be repaired quietly OR left to rot quietly. From here the lists
// do the other half of their job: adding a new hand-rolled banner, or a dialog
// slot nothing can fill, fails the build with the file named.

/** Files that render NEITHER shared component: no beat 3 or 4 at any control. */
const KNOWN_GAPS_NO_SHARED_COMPONENT: string[] = [];

/** Files still holding the `{ kind: "ok" | "err" }` state the refactor replaces. */
const KNOWN_GAPS_HAND_ROLLED_STATE: string[] = [];
// participation-editor.tsx and wheel-setup.tsx both came off this list. Nine
// actions and six actions respectively, each previously writing to ONE banner
// at the top of a very long screen; each now writes to one slot-keyed state
// with the message rendered at the control that produced it.

/** ConfirmDialogs whose `error` slot exists but has no writer — see below. */
const KNOWN_GAPS_DEAD_DIALOG_SLOT: string[] = [];
// Both files had the same shape and both are fixed. participation-editor's
// `ask` closed the dialog in a promise `.finally()` on both paths — a spelling
// `lib/refusal-placement.test.ts` could not see until it was taught the
// `.finally(() => {` form alongside the `finally {` statement. wheel-setup's
// was worse: it called `fn()` and `setConfirm(null)` on consecutive lines,
// SYNCHRONOUSLY, so the dialog closed before the action could resolve and
// `setDialogError` was only ever reachable with `null`.

describe("GUARD — save feedback belongs to the control", () => {
  // A BROKEN GLOB MUST NOT PASS. Every `toEqual([...])` below is satisfied by
  // an empty scan, so the count is the load-bearing assertion: it is what turns
  // "nothing was found" into "nothing was found because nothing was looked at".
  it("scans a real set of client components", () => {
    expect(files.length).toBeGreaterThan(30);
    const names = files.map(rel);
    // Reaches through a route group with parens AND a dynamic segment — the two
    // path shapes a naive glob drops on Windows.
    expect(names).toContain("app/admin/(protected)/people/[id]/participation-editor.tsx");
    expect(names).toContain("components/admin/week-action-panel.tsx");
    expect(names).toContain("components/member/login-flow.tsx");
  });

  // BEAT 3 AND BEAT 4 HAVE A HOME. Not "a message exists somewhere" — that was
  // true of the original defect too. The shared component is the only thing
  // that makes WHERE unarguable.
  it("every client component that calls an action renders the shared control", () => {
    const missing = files
      .filter((f) => !/<Save(Button|Feedback)\b/.test(code.get(f)!))
      .map(rel);
    expect(
      missing,
      "feedback is hand-placed here, so nothing stops it landing off-screen:\n  " +
        missing.join("\n  "),
    ).toEqual(KNOWN_GAPS_NO_SHARED_COMPONENT);
  });

  // THE SHAPE BEING REPLACED. `{ kind: "ok" | "err"; text }` in a component's
  // own state is the page banner by another name: it is one value for the whole
  // screen, so the sixth control's message renders at the first control's slot.
  // SaveState is per-control by construction.
  it("no component still holds its own ok/err banner state", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const m = /useState<\{\s*kind:\s*["'](?:ok|err)["']/.exec(code.get(f)!);
      if (m) offenders.push(rel(f));
    }
    expect(
      offenders,
      "a hand-rolled page banner — one message for every control on the screen:\n  " +
        offenders.join("\n  "),
    ).toEqual(KNOWN_GAPS_HAND_ROLLED_STATE);
  });

  // THE REGRESSION THIS REFACTOR CAUSES (a).
  //
  // lib/refusal-placement.test.ts already requires every <ConfirmDialog> to be
  // GIVEN an `error` prop. That is necessary and not sufficient, and the gap
  // between the two is exactly what shipped: a `dialogError` useState wired to
  // the dialog, cleared in `onCancel`, and SET BY NOTHING. The slot is there,
  // the scan is green, and every refusal from that dialog still goes to the
  // page banner. Converting a file to SaveState is how it happens — the writer
  // moves into the save state and the old useState is left behind, live-looking
  // and dead.
  //
  // So: a slot must have a WRITER. `setDialogError(null)` is a clear, not a
  // report, and does not count.
  it("every dialog error slot has something that can fill it", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = code.get(f)!;
      const decl = /const\s*\[\s*dialogError\s*,\s*setDialogError\s*\]\s*=\s*useState/.exec(src);
      if (!decl) continue; // Derived from the save state — the converted shape.
      if (/setDialogError\(\s*(?!null\s*\))/.test(src)) continue;
      offenders.push(at(f, decl.index));
    }
    expect(
      offenders,
      "the dialog has an error slot that nothing writes to — every refusal it " +
        "shows is one it was never given:\n  " +
        offenders.join("\n  "),
    ).toEqual(KNOWN_GAPS_DEAD_DIALOG_SLOT.map((p) => expect.stringContaining(p)));
  });

  // THE REGRESSION THIS REFACTOR CAUSES (b), AND IT HAS SHIPPED ONCE.
  //
  // SaveButton derives `shown` from the `state` PROP on purpose. It used to
  // mirror it into local state through a useEffect, and the rendered-HTML test
  // caught what that costs: effects do not run during render, so the
  // confirmation was ABSENT from the server-rendered markup and only appeared
  // after hydration. A component whose entire job is "the feedback is visible"
  // must not need an effect to have run in order to be visible.
  //
  // The distinguishing fact is whether the effect does ASYNCHRONOUS WORK. An
  // effect that fetches and reports the fetch's failure is fine — that message
  // could not have existed at render. An effect with no await and no .then is
  // copying something the render already had, and that is the bug.
  it("no feedback message is mirrored into state by an effect", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = code.get(f)!;
      for (const m of src.matchAll(/useEffect\(\s*\(\)\s*=>\s*\{/g)) {
        const body = braceBody(src, m.index + m[0].length);
        if (!/set\w*\(\s*\{\s*kind:\s*["'](?:ok|err)["']/.test(body)) continue;
        if (/\bawait\b|\.then\(|\basync\b/.test(body)) continue;
        offenders.push(at(f, m.index));
      }
    }
    expect(
      offenders,
      "mirrored through an effect — absent from the server-rendered HTML on " +
        "first paint:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  // THE EXEMPTION LIST, CHECKED IN BOTH DIRECTIONS.
  //
  // Listing a file here says two things, and both are asserted: it renders no
  // success (because its success is a redirect, a redaction, or the control
  // disappearing), and it STILL SHOWS ITS FAILURE (rule 6b is owed by
  // everything, exempt or not). Drop the failure path and the exemption stops
  // being true, and this fails.
  it("each exempt file is exempt for the reason given, and still shows refusals", () => {
    for (const [path, why] of Object.entries(NO_SUCCESS_MESSAGE)) {
      expect(why.length, `${path}: write the reason, not a placeholder`).toBeGreaterThan(60);
      const f = files.find((x) => rel(x) === path);
      expect(f, `${path} is listed as exempt but is not in the scan`).toBeDefined();
      const src = code.get(f!)!;
      expect(src, `${path}: exempt from beat 3, not from beat 4 — no failure path`).toMatch(
        /kind:\s*["']err["']/,
      );
      expect(src, `${path}: has a success message, so the exemption is stale — delete it`).not.toMatch(
        /kind:\s*["']ok["']/,
      );
    }
  });

  // NON-VACUITY. Every pattern above is `toEqual` against a list, and a pattern
  // that matches NOTHING satisfies that just as well as a codebase that is
  // clean. So each one is fired at the defect it forbids AND at the fix, here,
  // where both are visible on the page.
  it("the scan is not vacuous", () => {
    // The banner state, planted and fixed.
    const banner = `const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);`;
    const perControl = `const [save, setSave] = useState<SaveState>({ kind: "idle" });`;
    expect(/useState<\{\s*kind:\s*["'](?:ok|err)["']/.test(banner)).toBe(true);
    expect(/useState<\{\s*kind:\s*["'](?:ok|err)["']/.test(perControl)).toBe(false);

    // The shared control, planted and fixed.
    const handRolled = `<button disabled={busy}>{busy ? "Saving…" : "Save"}</button>`;
    expect(/<Save(Button|Feedback)\b/.test(handRolled)).toBe(false);
    expect(/<Save(Button|Feedback)\b/.test(`<SaveButton state={save} dirty={dirty} />`)).toBe(true);

    // THE DEAD SLOT. The whole point is that these two are indistinguishable to
    // refusal-placement.test.ts — both render `error={dialogError}`.
    const dead = `const [dialogError, setDialogError] = useState<string | null>(null);\n  onCancel={() => setDialogError(null)}`;
    const live = `const [dialogError, setDialogError] = useState<string | null>(null);\n  if (!res.ok) { setDialogError(res.error); return; }`;
    const hasWriter = (s: string) => /setDialogError\(\s*(?!null\s*\))/.test(s);
    expect(hasWriter(dead)).toBe(false);
    expect(hasWriter(live)).toBe(true);
    // And the converted shape is not reported at all, because it never declares
    // the state — `const dialogError = save.kind === "err" ? save.message : null`.
    expect(
      /const\s*\[\s*dialogError\s*,\s*setDialogError\s*\]\s*=\s*useState/.test(
        `const dialogError = save.kind === "err" ? save.message : null;`,
      ),
    ).toBe(false);

    // THE EFFECT MIRROR — the bug that shipped, and the async load that must
    // not be reported as it.
    const mirrored = `useEffect(() => {\n  if (message) setShown({ kind: "ok", message });\n}, [message]);`;
    const asyncLoad = `useEffect(() => {\n  startLoad(async () => {\n    const r = await poolCandidates({ weekId });\n    if (!r.ok) setSave({ kind: "err", message: r.error });\n  });\n}, [weekId]);`;
    const isMirror = (s: string) => {
      const m = /useEffect\(\s*\(\)\s*=>\s*\{/.exec(s)!;
      const body = braceBody(s, m.index + m[0].length);
      return (
        /set\w*\(\s*\{\s*kind:\s*["'](?:ok|err)["']/.test(body) &&
        !/\bawait\b|\.then\(|\basync\b/.test(body)
      );
    };
    expect(isMirror(mirrored)).toBe(true);
    expect(isMirror(asyncLoad)).toBe(false);

    // COMMENT STRIPPING, which the exemption list depends on: member-sidebar
    // says in prose that it has no `kind: "ok"`, and a raw match reads that
    // sentence as the code it is denying.
    const denial = `// No \`setSave({ kind: "ok" })\` and no reset: on success the action redirects.\nsetSave({ kind: "err", message });`;
    expect(/kind:\s*["']ok["']/.test(denial)).toBe(true);
    expect(/kind:\s*["']ok["']/.test(stripComments(denial))).toBe(false);
    expect(/kind:\s*["']err["']/.test(stripComments(denial))).toBe(true);
    // …without eating a URL, which is the way a naive stripper hides real code.
    expect(stripComments(`const u = "https://api.twilio.com/x"; // gone`)).toContain(
      "https://api.twilio.com/x",
    );
  });
});
