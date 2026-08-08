import { config } from "dotenv";
import { afterAll, describe, expect, it } from "vitest";
import {
  APPROVED_TEMPLATES,
  APPROVED_TEMPLATE_KEYS,
  driftMessage,
  toApprovedBody,
} from "./whatsapp-templates";

config({ path: ".env.local", quiet: true });

// THE LIVE HALF OF THE DRIFT GUARD.
//
// lib/whatsapp-templates.test.ts checks the registry against itself. This
// checks the DATABASE against the registry, because that is where drift
// actually comes from: the template editor lets the organizer rewrite any
// body (2.20), and for these five that freedom is a trap. Twilio sends by
// ContentSid, so an edit does not change what members receive — it only makes
// the app show wording that is not what went out.
//
// SEPARATE FILE, ON PURPOSE. Every other test in this repo is pure; this one
// opens a connection. Keeping it apart means it can be excluded in an
// environment without a database without silencing the 1,200 tests that need
// none. It does NOT skip when the connection is missing: a guard that quietly
// does nothing is the failure mode this whole build is about (2.24).

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("./generated/prisma/client");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the database bodies still match what Meta approved", () => {
  it("has a database to check against — a skipped guard is not a guard", () => {
    expect(
      connectionString,
      "No DIRECT_URL or DATABASE_URL. This guard cannot run, and passing it silently " +
        "would mean the approved wording is unprotected.",
    ).toBeTruthy();
  });

  for (const key of APPROVED_TEMPLATE_KEYS) {
    const t = APPROVED_TEMPLATES[key];

    it(`${key}: the stored body reproduces the approved wording exactly`, async () => {
      const row = await prisma.messageTemplate.findUnique({ where: { key } });
      expect(row, `No MessageTemplate row for ${key}.`).not.toBeNull();

      // Substituting the stored {name} tokens back into {{n}} must give the
      // approved sentence, character for character — em dash included.
      expect(
        toApprovedBody(row!.body, t.variableOrder),
        driftMessage(key, "The stored database body"),
      ).toBe(t.approvedBody);
    });

    it(`${key}: the stored ContentSid is the approved one`, async () => {
      const row = await prisma.messageTemplate.findUnique({ where: { key } });
      expect(
        row?.metaTemplateSid,
        driftMessage(key, "The stored metaTemplateSid"),
      ).toBe(t.contentSid);
    });
  }

  it("LOCKOUT_NOTICE has NO ContentSid — it is undeliverable by design", async () => {
    const row = await prisma.messageTemplate.findUnique({ where: { key: "LOCKOUT_NOTICE" } });
    expect(row, "No MessageTemplate row for LOCKOUT_NOTICE.").not.toBeNull();
    expect(
      row?.metaTemplateSid,
      "LOCKOUT_NOTICE has gained a ContentSid. It has no approved template — a lockout " +
        "notice is a security message, and Twilio Verify is the channel for it. If this " +
        "was deliberate, it needs a decision, not a merge.",
    ).toBeNull();
  });
});
