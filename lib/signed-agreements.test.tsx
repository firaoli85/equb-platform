import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGREEMENT_V1_BODY } from "./agreement";
import {
  SignedAgreements,
  type SignedAgreement,
} from "@/components/member/signed-agreements";

// /me/documents — the member's own signed copies (Cycle-2 build, feature B).
//
// Three properties, one per defect this page could grow:
//   the STORED text renders, never a re-render of the current version —
//     wording moves on; what they signed does not;
//   an unsigned member gets the honest empty state, not a blank;
//   the query is scoped to the signed-in member by construction — it takes
//     no input, and its only filter is the personId from their own session.

const signed = (over: Partial<SignedAgreement> = {}): SignedAgreement => ({
  id: "sig-1",
  signedAt: "2026-08-14T02:10:00.000Z",
  version: 1,
  cycleName: "Cycle 1 2026",
  // DELIBERATELY NOT the current body: this is the 10-clause wording as it
  // stood the day they signed, with their figures already substituted.
  documentText:
    "1. Your commitment\nYou, Henok Tesfaye, are saving $1,000 a week for 10 weeks in Cycle 1 2026, " +
    "from Sunday, August 16, 2026 to Sunday, October 18, 2026.\n\n2. The fee\nThe organizer's fee is " +
    "$200, which is 2% of your $10,000 payout.",
  ...over,
});

describe("what a signed member sees", () => {
  it("renders the STORED text — their figures, their wording — with version and moment", () => {
    const out = renderToStaticMarkup(<SignedAgreements agreements={[signed()]} />);
    expect(out).toContain("Your Equb agreement — Cycle 1 2026");
    expect(out).toContain("Henok Tesfaye");
    expect(out).toContain("$1,000 a week for 10 weeks");
    expect(out).toContain("v1");
    expect(out).toContain("Signed August 13, 2026"); // the member's own clock (UTC-5/6 of the ISO above)
  });

  // FALSIFIABLE: render `renderAgreement(currentVersion.body, terms)` instead
  // of the stored column — the tempting "fresher" implementation — and this
  // fails: the fixture's text deliberately differs from AGREEMENT_V1_BODY,
  // exactly as a real signature predating a wording change would.
  it("shows what they SIGNED, not what the current version would say", () => {
    const older = signed({
      documentText: "OLD WORDING: you agreed to the 2026 terms as they stood on signing day.",
    });
    const out = renderToStaticMarkup(<SignedAgreements agreements={[older]} />);
    expect(out).toContain("OLD WORDING");
    // Nothing from the live template body leaks in beside it.
    expect(AGREEMENT_V1_BODY).toContain("{memberName}");
    expect(out).not.toContain("{memberName}");
  });

  it("lists every signature, newest first as the action orders them", () => {
    const out = renderToStaticMarkup(
      <SignedAgreements
        agreements={[
          signed({ id: "sig-2", version: 2, cycleName: "Cycle 2 2027" }),
          signed(),
        ]}
      />,
    );
    expect(out.indexOf("Cycle 2 2027")).toBeLessThan(out.indexOf("Cycle 1 2026"));
    expect(out).toContain("v2");
  });
});

describe("what an unsigned member sees", () => {
  it("the honest empty state — what will appear here, and what puts it there", () => {
    const out = renderToStaticMarkup(<SignedAgreements agreements={[]} />);
    expect(out).toContain("No documents yet");
    expect(out).toContain("your own copy appears here");
    expect(out).toContain("the exact words you signed".replace(" ", " "));
  });
});

// ————— The action's scoping, driven through a fake database —————

const findManyArgs = vi.fn();
let sessionSub: string | null = "auth-henok";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => (sessionSub ? { sub: sessionSub } : null)),
  requireAdmin: vi.fn(async () => ({ ok: true as const, userId: "admin-1" })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    person: {
      // Resolves the SESSION's person only — the mock honours the where.
      findFirst: vi.fn(async (args: { where?: { authUserId?: string } }) =>
        args?.where?.authUserId === "auth-henok" ? { id: "person-henok" } : null,
      ),
    },
    agreementSignature: {
      findMany: vi.fn(async (args: unknown) => {
        findManyArgs(args);
        return [];
      }),
    },
  },
}));

beforeEach(() => {
  findManyArgs.mockClear();
  sessionSub = "auth-henok";
});

describe("getMySignedAgreements is scoped to the session, structurally", () => {
  it("filters by the session's OWN personId — there is no caller input to widen it", async () => {
    vi.resetModules();
    const { getMySignedAgreements } = await import("@/app/actions/agreement");
    const result = await getMySignedAgreements();
    expect(result.ok).toBe(true);
    expect(findManyArgs).toHaveBeenCalledTimes(1);
    const args = findManyArgs.mock.calls[0][0] as { where: { personId: string } };
    // The one and only filter: the person resolved from their own claims.
    expect(args.where).toEqual({ personId: "person-henok" });
    // …and the action's signature takes NO parameters, so no request can name
    // somebody else. The scan belt to the mock's braces:
    const src = readFileSync(
      join(import.meta.dirname, "..", "app", "actions", "agreement.ts"),
      "utf8",
    );
    expect(src).toMatch(/export async function getMySignedAgreements\(\)/);
  });

  it("a signed-out caller gets a refusal, never rows", async () => {
    sessionSub = null;
    vi.resetModules();
    const { getMySignedAgreements } = await import("@/app/actions/agreement");
    const result = await getMySignedAgreements();
    expect(result.ok).toBe(false);
    expect(findManyArgs).not.toHaveBeenCalled();
  });
});
