import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expiryNotice, isExpiryReason } from "./session-policy";

// THE COMMON ROOT of all four session defects: a SignInSession row and the
// Supabase session are two halves of one thing, and they did not move
// together. Each fix below makes one pair move as one.

const ROOT = join(import.meta.dirname, "..");

describe("signing out one device signs out ONE device", () => {
  it("uses the LOCAL scope, not the global default", () => {
    // The default is global, so tapping "Sign out" on a phone killed the
    // laptop's refresh token too. The laptop kept working until its access
    // token expired, then bounced to /login with no reason — while its row
    // still read revokedAt = null and "Where you are signed in" called it
    // active for another seven days.
    const source = readFileSync(join(ROOT, "app/actions/auth.ts"), "utf8");
    expect(source).toMatch(/signOut\(\{\s*scope:\s*"local"\s*\}\)/);
  });
});

describe("a missing handle is not a free pass", () => {
  it("the gate takes the auth user so it can tell the two cases apart", () => {
    const source = readFileSync(join(ROOT, "lib/session-gate.ts"), "utf8");
    expect(source).toMatch(/authUserId\?: string \| null/);
    // Allowed only when the account has NEVER had a session row — the
    // pre-record case. Otherwise every sign-in since has set a handle.
    expect(source).toMatch(/everRecorded === 0/);
    expect(source).toMatch(/signInSession\.count/);
  });

  it("the proxy passes it from the VALIDATED claims", () => {
    const source = readFileSync(join(ROOT, "lib/supabase/proxy.ts"), "utf8");
    expect(source).toMatch(/authUserId: claims\?\.sub/);
  });

  it("the new reason reads as a sentence, not a code", () => {
    expect(isExpiryReason("unverified")).toBe(true);
    for (const role of ["MEMBER", "ADMIN"] as const) {
      const notice = expiryNotice("unverified", role);
      expect(notice).toMatch(/Sign in again/);
      expect(notice).not.toMatch(/error|invalid|unauthori[sz]ed/i);
    }
  });
});

describe("changing a credential ends the sessions it opened", () => {
  it("there is one helper, and it REVOKES rather than deletes", () => {
    // The rows are the history that lets a member recognise the intruder's
    // device later, and lets the organizer answer "was that you?" (2.14).
    const source = readFileSync(join(ROOT, "lib/session-record.ts"), "utf8");
    expect(source).toMatch(/export async function revokeSessionsForPerson/);
    expect(source).toMatch(/revokedAt: new Date\(\)/);
    expect(source).not.toMatch(/signInSession\.deleteMany/);
  });

  it("both PIN actions call it", () => {
    // The organizer had NO action anywhere that could end a member's session,
    // so "Reset PIN" — the one thing the page offers when a member reports an
    // intruder — left the intruder signed in for up to seven more idle days.
    const source = readFileSync(join(ROOT, "app/actions/auth.ts"), "utf8");
    for (const action of ["resetMemberPin", "setMemberPin"]) {
      const body = source.split(`export async function ${action}(`)[1];
      expect(body, action).toBeTruthy();
      const scoped = body.split("\nexport async function ")[0];
      expect(scoped, action).toMatch(/revokeSessionsForPerson\(/);
    }
  });

  it("and says so in the audit entry", () => {
    const source = readFileSync(join(ROOT, "app/actions/auth.ts"), "utf8");
    expect(source).toMatch(/open session\$\{endedSessions === 1/);
  });
});

describe("a stale winner batch is refused, not sent", () => {
  it("sendBatch checks every recipient is still a winner", () => {
    // The batch is prepared against the latest drawn week and sent later. In
    // between, the week can be redrawn or the winner moved — the exact
    // operations this audit came from. `?? {}` then filled the gap and the
    // member received a real, billed, logged message reading "you receive
    // this week — week 12. Your payout is —."
    const source = readFileSync(join(ROOT, "app/actions/messages.ts"), "utf8");
    expect(source).toMatch(/no longer a winner of the/);
    expect(source).toMatch(/!winners\.has\(id\)/);
  });

  it("it refuses the WHOLE batch rather than silently sending a subset", () => {
    const source = readFileSync(join(ROOT, "app/actions/messages.ts"), "utf8");
    expect(source).toMatch(/Nothing was sent/);
  });
});
