import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// GUARD — a typed-name confirmation must send what was TYPED.
//
// `assignPayoutManually` checks `nameConfirmed(input.replaceConfirmation, ...)`
// server-side, which reads as a real gate. The client sent
// `options.confirmPhrase` — its own copy of the EXPECTED value — so the check
// passed unconditionally. Only ConfirmDialog's requirePhrase made a human type
// anything, and a replayed or retried call destroyed collected payouts with no
// confirmation at all.
//
// The dialog now hands the typed text to onConfirm, and callers must forward
// that. This catches the shape of the mistake rather than the one instance.

const ROOT = join(import.meta.dirname, "..");

describe("GUARD — typed confirmations carry the typed value", () => {
  it("ConfirmDialog gives onConfirm what the human typed", () => {
    const source = readFileSync(join(ROOT, "components/ui/confirm-dialog.tsx"), "utf8");
    expect(source).toMatch(/onConfirm: \(typedPhrase: string\) => void/);
    expect(source).toMatch(/onConfirm\(typed\)/);
  });

  it("no caller sends its own copy of the expected phrase as the confirmation", () => {
    const source = readFileSync(
      join(ROOT, "app/admin/(protected)/people/[id]/assign-payout.tsx"),
      "utf8",
    );
    // The tell: passing the expected phrase straight back as the proof.
    expect(source).not.toMatch(/replaceConfirmation:[^\n]*confirmPhrase/);
    expect(source).toMatch(/replaceConfirmation: needsPhrase \? typedPhrase : undefined/);
  });
});
