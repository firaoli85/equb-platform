import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// ————————————————————————————————————————————————————————————————
// A TYPED CONFIRMATION MUST CARRY WHAT WAS TYPED.
//
// `assignPayoutManually` checked `nameConfirmed(input.replaceConfirmation, …)`
// server-side, which reads as a real gate. The client sent
// `options.confirmPhrase` — its own copy of the EXPECTED value — so the check
// passed unconditionally. Only ConfirmDialog's `requirePhrase` made a human
// type anything, and a replayed or retried call destroyed collected payouts
// with no confirmation at all.
//
// An audit of every other typed confirmation found the same shape twice more,
// on the two most consequential actions in the product:
//
//   closeCycle          sent `review.cycleName` — writes a carried debt onto
//                       every short member and freezes the books
//   deleteClosedCycle   sent `cycle.name` — wipes every participation, week,
//                       receipt, draw and payout in the cycle
//
// Three of five were decorative. The two that were real — removeFromCycle and
// the participation settlement — bind to actual input state, which is what
// makes the difference visible in a diff and worth a test.
//
// These tests catch the SHAPE. A confirmation is decorative when the value
// sent as proof is derivable from what the client already knows.
// ————————————————————————————————————————————————————————————————

const ROOT = join(import.meta.dirname, "..");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "generated") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** The fields a server action accepts as proof that a human typed something. */
const PROOF_FIELDS = ["typedName", "typedPhrase", "replaceConfirmation"];

describe("GUARD — typed confirmations carry the typed value", () => {
  it("ConfirmDialog hands onConfirm what the human typed", () => {
    const source = readFileSync(join(ROOT, "components/ui/confirm-dialog.tsx"), "utf8");
    expect(source).toMatch(/onConfirm: \(typedPhrase: string\) => void/);
    expect(source).toMatch(/onConfirm\(typed\)/);
  });

  it("no caller passes a client-derived value as the proof", () => {
    // The tell: the proof field is assigned something OTHER than a bare
    // identifier — a property access, a literal, a call. A bare identifier is
    // a state variable holding what was typed; `review.cycleName` or
    // `options.confirmPhrase` is the client agreeing with itself.
    const offenders: string[] = [];
    for (const file of tsxFiles(join(ROOT, "app")).concat(tsxFiles(join(ROOT, "components")))) {
      const source = readFileSync(file, "utf8");
      for (const field of PROOF_FIELDS) {
        // THE TELL IS A DOT.
        //
        // A decorative confirmation reads the expected value off something the
        // client already has: `review.cycleName`, `cycle.name`,
        // `options.confirmPhrase`. A real one forwards a bare identifier —
        // state bound to an input, or the value ConfirmDialog handed back.
        //
        // Matching on the dot rather than parsing the expression also steps
        // around every TYPE position (`typedName: string;`,
        // `doClose(typedPhrase: string)`, `onConfirm: (typedPhrase: string)
        // => void`), none of which contains one.
        const re = new RegExp(`${field}:\\s*([A-Za-z_$][\\w$]*\\.[\\w$.]+)`, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(source)) !== null) {
          offenders.push(`${relative(ROOT, file).replace(/\\/g, "/")}  ${field}: ${m[1]}`);
        }
      }
    }
    expect(
      offenders,
      "These pass a value the CLIENT already holds as proof that a human typed " +
        "it, so the server-side check passes unconditionally and the " +
        "confirmation is decorative. Forward what ConfirmDialog hands to " +
        "onConfirm, or the bound state of a real input.\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("the four irreversible actions check the typed name SERVER-SIDE", () => {
    // THE ORGANIZER'S RULING (August 2026), recorded in
    // docs/STATE_CONSISTENCY_AUDIT.md and lib/typed-confirmation.ts.
    //
    // The threat is not an attacker — there is one admin, and he owns the
    // data. It is him, tired, on a Sunday, clicking something whose
    // consequence he did not register; or a double-submit; or a stale form
    // replayed after the page moved on. A browser-only confirmation survives
    // none of those.
    //
    // So the line is drawn by CONSEQUENCE: a server check for actions that
    // destroy a money record nothing else can rebuild. A phone edit is
    // retyped in ten seconds and is deliberately left client-only.
    const MUST_CHECK: { file: string; action: string; why: string }[] = [
      {
        file: "app/actions/wheel.ts",
        action: "undoDraw",
        why: "deletes payout records for money already handed over",
      },
      {
        file: "app/actions/edits.ts",
        action: "deletePayout",
        why: "deletes the only record that collected cash left",
      },
      {
        file: "app/actions/ledger.ts",
        action: "forgiveBalance",
        why: "clears a real debt without anyone paying it",
      },
      {
        file: "app/actions/edits.ts",
        action: "deletePerson",
        why: "deletes the directory row and every sign-in record",
      },
    ];

    const missing: string[] = [];
    for (const { file, action, why } of MUST_CHECK) {
      const source = readFileSync(join(ROOT, file), "utf8");
      const body = source.split(`export async function ${action}(`)[1];
      if (!body) {
        missing.push(`${file} :: ${action} — not found`);
        continue;
      }
      // Up to the next exported function, so a neighbour's check cannot
      // satisfy this one.
      const scoped = body.split("\nexport async function ")[0];
      if (!scoped.includes("typedName")) {
        missing.push(`${file} :: ${action} — takes no typedName (${why})`);
        continue;
      }
      if (!scoped.includes("typedConfirmationRefusal(")) {
        missing.push(`${file} :: ${action} — never compares it (${why})`);
      }
    }
    expect(
      missing,
      "These destroy something irreversible and must verify the typed name on " +
        "the SERVER. A dialog alone does not survive a double-submit or a " +
        "replayed form.\n" + missing.join("\n"),
    ).toEqual([]);
  });

  it("the comparison itself rejects an empty or absent value", () => {
    // The replay case IS the empty case: a retried call sends nothing.
    const source = readFileSync(join(ROOT, "lib/typed-confirmation.ts"), "utf8");
    expect(source).toMatch(/candidate\.length > 0/);
  });

  it("every action that accepts proof actually checks it", () => {
    // The mirror failure: a field named like a confirmation that nothing
    // compares. Cheaper to assert than to discover.
    const actions = join(ROOT, "app/actions");
    const checked: Record<string, boolean> = {};
    for (const file of tsxFiles(actions)) {
      const source = readFileSync(file, "utf8");
      for (const field of PROOF_FIELDS) {
        if (!source.includes(`${field}:`)) continue;
        checked[`${relative(ROOT, file).replace(/\\/g, "/")}:${field}`] =
          // The three ways a confirmation is compared in this codebase.
          // `typedConfirmationRefusal` is the newest and was missing here —
          // which this guard found by failing on `deleteDraftCycle`, an action
          // that does check. A guard that does not know every legitimate form
          // reports false positives until someone stops believing it.
          source.includes("typedConfirmationRefusal(") ||
          source.includes("nameConfirmed(") ||
          new RegExp(`input\\.${field}[^\\n]*!==`).test(source) ||
          new RegExp(`input\\.${field}\\.trim\\(\\)`).test(source);
      }
    }
    const unchecked = Object.entries(checked)
      .filter(([, ok]) => !ok)
      .map(([k]) => k);
    expect(
      unchecked,
      "These actions accept a typed confirmation and never compare it:\n" +
        unchecked.join("\n"),
    ).toEqual([]);
  });
});
