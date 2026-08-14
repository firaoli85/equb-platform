import { beforeEach, describe, expect, it, vi } from "vitest";
import { agreementRequirement } from "./agreement";

// THE SIGNING SCREEN'S TWO HALVES CANNOT CONTRADICT EACH OTHER (reported
// defect, Aug 2026).
//
// /agreement rendered BOTH "Sign and see my payments" AND the red "There is
// nothing to sign." for Henok — gated by the no-payment route, unsigned. The
// two are exclusive states of one fact, drawn together because the READ path
// (getMyAgreement) asked `agreementRequirement` — both routes — while the
// WRITE path (signMyAgreement) still asked the welcome timestamp alone. The
// sign button was the true state; the refusal was the stale rule.
//
// THE PROPERTY, pinned across every gate state: whenever the read path would
// show a member the document, the write path accepts their signature — and
// whenever the read path shows nothing, the write path refuses. One rule,
// asked twice, agreeing by construction (5.10).

type World = {
  requiredAt: Date | null;
  lastSignedAt: Date | null;
  paidRows: number;
  participationStatus: "ACTIVE" | "CLOSED";
  cycleStatus: "ACTIVE" | "CLOSED";
};

let world: World;

const AT = new Date("2026-08-10T14:00:00Z");

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["user-agent", "test"]])),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => ({ sub: "auth-henok" })),
  requireAdmin: vi.fn(async () => ({ ok: true as const, userId: "admin-1" })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    person: {
      findFirst: vi.fn(async () => ({ id: "person-henok", nameEnglishFirst: "Henok" })),
    },
    participation: {
      findUnique: vi.fn(async () => ({
        id: "p-henok",
        personId: "person-henok",
        agreementRequiredAt: world.requiredAt,
        status: world.participationStatus,
        cycle: { status: world.cycleStatus },
        signatures: world.lastSignedAt ? [{ signedAt: world.lastSignedAt }] : [],
        _count: { payments: world.paidRows },
      })),
    },
  },
}));

async function signOutcome(): Promise<{ refusedNothingToSign: boolean }> {
  vi.resetModules();
  const { signMyAgreement } = await import("@/app/actions/agreement");
  const result = await signMyAgreement({
    participationId: "p-henok",
    documentHash: "any — the precondition under test fires before the hash",
  });
  // Downstream of the precondition the mocked world is too thin to sign for
  // real (no terms) — the ONLY question here is which refusal fired.
  const refusedNothingToSign = !result.ok && result.error === "There is nothing to sign.";
  return { refusedNothingToSign };
}

/** What the READ path decides for the same world — the gate's own rule. */
function readPathShowsDocument(): boolean {
  return (
    agreementRequirement({
      requiredAt: world.requiredAt,
      lastSignedAt: world.lastSignedAt,
      hasEverPaid: world.paidRows > 0,
      participationLive: world.participationStatus === "ACTIVE",
      cycleOpen: world.cycleStatus === "ACTIVE",
    }) !== null
  );
}

beforeEach(() => {
  world = {
    requiredAt: null,
    lastSignedAt: null,
    paidRows: 1,
    participationStatus: "ACTIVE",
    cycleStatus: "ACTIVE",
  };
});

describe("the write path agrees with the read path, state by state", () => {
  // HENOK'S EXACT STATE — the reported contradiction. Gated by the
  // no-payment route; the read path shows the document; the write path must
  // NOT answer "There is nothing to sign."
  it("no-payment-gated: the document shows, and the signature is accepted", async () => {
    world.paidRows = 0;
    expect(readPathShowsDocument()).toBe(true);
    expect((await signOutcome()).refusedNothingToSign).toBe(false);
  });

  it("welcome-gated: both halves say sign", async () => {
    world.requiredAt = AT;
    expect(readPathShowsDocument()).toBe(true);
    expect((await signOutcome()).refusedNothingToSign).toBe(false);
  });

  it("nothing owed (paid, never welcomed): both halves say nothing to sign", async () => {
    expect(readPathShowsDocument()).toBe(false);
    expect((await signOutcome()).refusedNothingToSign).toBe(true);
  });

  it("already signed against the requirement: both halves say nothing to sign", async () => {
    world.requiredAt = AT;
    world.lastSignedAt = new Date("2026-08-11T09:00:00Z");
    expect(readPathShowsDocument()).toBe(false);
    expect((await signOutcome()).refusedNothingToSign).toBe(true);
  });

  it("stopped member, never paid: the no-payment route does not reach them — both agree", async () => {
    world.paidRows = 0;
    world.participationStatus = "CLOSED";
    expect(readPathShowsDocument()).toBe(false);
    expect((await signOutcome()).refusedNothingToSign).toBe(true);
  });

  // THE PLANT, as the organizer asked: force the two states true
  // simultaneously — a world where the old welcome-only rule and the new
  // two-route rule disagree — and confirm the DOCUMENTED WINNER (the gate's
  // rule) is what the write path follows. This is exactly the world that
  // rendered both states at once, so if someone reverts signMyAgreement to
  // the timestamp check, this fails with the contradiction by name.
  it("PLANT: where the old rule and the gate disagree, the gate wins", async () => {
    world.paidRows = 0; // gate: sign. old timestamp-only rule: nothing to sign.
    world.requiredAt = null;
    const { refusedNothingToSign } = await signOutcome();
    expect(
      refusedNothingToSign,
      "the write path answered 'nothing to sign' for a member the gate is showing the document — " +
        "the contradictory-states defect is back",
    ).toBe(false);
  });
});
