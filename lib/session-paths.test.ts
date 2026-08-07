import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// THREE DOORS, ONE SESSION.
//
// PIN, WhatsApp code, and SMS code must all end in the IDENTICAL Supabase
// bridge session, so RLS, requireMember, and every downstream guard behave
// the same however a member signed in. That is a property of the SOURCE —
// each path calls the one mintBridgeSession helper — and cannot be exercised
// in a unit test, since minting needs a request scope and a live Supabase.
// So it is asserted structurally here: if someone adds a fourth door, or
// hand-rolls a session in one path, this fails.

const SOURCE = readFileSync("app/actions/auth.ts", "utf8");

/** The body of one exported action, up to the next top-level export. */
function actionBody(name: string): string {
  const start = SOURCE.indexOf(`export async function ${name}(`);
  expect(start, `${name} must exist in app/actions/auth.ts`).toBeGreaterThan(-1);
  const rest = SOURCE.slice(start + 1);
  const next = rest.indexOf("\nexport ");
  return next === -1 ? rest : rest.slice(0, next);
}

const MEMBER_DOORS = ["signInWithPin", "signInWithWhatsAppCode", "signInWithFirebaseSms"];

describe("every member sign-in path mints the SAME session", () => {
  it.each(MEMBER_DOORS)("%s goes through mintBridgeSession", (name) => {
    expect(actionBody(name)).toContain("mintBridgeSession(");
  });

  it("no member door mints a session any other way", () => {
    for (const name of MEMBER_DOORS) {
      const body = actionBody(name);
      // signInWithPassword is the raw Supabase call; only the shared helper
      // (and the organizer's own action) may use it.
      expect(body, `${name} must not sign in directly`).not.toContain("signInWithPassword");
      expect(body, `${name} must not set cookies itself`).not.toContain("cookies(");
    }
  });

  it("mintBridgeSession exists exactly once and is the only minter", () => {
    const defs = SOURCE.match(/async function mintBridgeSession\(/g) ?? [];
    expect(defs).toHaveLength(1);
  });

  it("the three doors are the complete set of member sign-ins", () => {
    // A new `signInWith…` export that is not in MEMBER_DOORS is either a
    // fourth door nobody added to this list, or a rename. Either way the
    // "one session" claim needs re-checking by a human.
    const found = [...SOURCE.matchAll(/export async function (signInWith\w+)\(/g)].map(
      (m) => m[1],
    );
    expect(found.sort()).toEqual([...MEMBER_DOORS].sort());
  });

  it("the organizer's door also mints server-side, never in the browser", () => {
    // signInAdmin is deliberately NOT a member door (no bridge session — the
    // organizer has a real Supabase password), but it must still write its
    // cookie through the server client so the hardened policy applies.
    const body = actionBody("signInAdmin");
    expect(body).toContain("createClient()");
    expect(body).toContain("signInWithPassword");
  });
});

describe("the SMS door proves the code was passed", () => {
  const body = actionBody("signInWithFirebaseSms");

  it("verifies a Firebase ID token before doing anything else", () => {
    expect(body).toContain("verifyFirebaseIdToken(");
  });

  it("checks the VERIFIED phone against the typed one with samePhone", () => {
    // Without this, a valid token for any number would sign in as whoever
    // was typed into the form.
    expect(body).toContain("samePhone(");
  });

  it("mints only AFTER verification (order matters)", () => {
    expect(body.indexOf("verifyFirebaseIdToken(")).toBeLessThan(body.indexOf("mintBridgeSession("));
    expect(body.indexOf("samePhone(")).toBeLessThan(body.indexOf("mintBridgeSession("));
  });

  it("never trusts a bare phone number the way the old build did", () => {
    // equb-app's /api/auth/firebase-otp took ONLY a phone and minted a
    // session. The ported door must require the token in its input.
    expect(body).toContain("idToken");
  });
});
