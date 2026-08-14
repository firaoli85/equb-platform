import { readFileSync } from "node:fs";
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

// ————————————————————————————————————————————————————————————————
// EVERY ENUM VALUE THE SCHEMA KNOWS MUST BE WRITABLE.
//
// THE DEFECT THIS EXISTS FOR, and the reason it belongs HERE and not in a unit
// test. `ACCEPTED` was added to MessageSendStatus in schema.prisma and the
// generated client accepted it happily. The DATABASE had not had the migration
// applied. So:
//
//   * 1,503 tests stayed green — every one of them mocks Prisma, and a mock
//     will cheerfully store any string you hand it.
//   * `npx tsc --noEmit` was clean — the type was real, it was the TABLE that
//     was not.
//   * Then a real BEHIND_NOTICE went out, Twilio accepted it, and
//     messageLog.create THREW on the way to recording it. The message reached
//     the member; the row that proves it did not exist.
//
// No amount of mocked testing can see that gap, because the gap IS the
// difference between the mock and the database. 2.24 names behavioural
// verification against the live DB for exactly this class.
//
// Every value is attempted for real and rolled back, so this leaves nothing
// behind while proving the write would have worked.
// ————————————————————————————————————————————————————————————————

/**
 * The enum's values read from schema.prisma itself — NOT from a list typed
 * here. A hand-kept copy would have to be updated by the same person who adds
 * a value, which is precisely the step that gets missed; reading the schema
 * means a new value is covered the moment it is declared.
 */
function schemaEnumValues(enumName: string): string[] {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  // Located by INDEX, not by a regex built from a template literal. `\s` in a
  // template literal is not an escape — it collapses to a bare "s" — so
  // `enum\s+${name}` silently becomes `enum s+MessageSendStatus` and matches
  // nothing. The first version of this did exactly that and threw "enum not
  // found" against a schema that plainly contained it.
  const start = schema.indexOf(`enum ${enumName} {`);
  if (start === -1) throw new Error(`enum ${enumName} not found in prisma/schema.prisma`);
  const open = schema.indexOf("{", start);
  const close = schema.indexOf("}", open);
  if (close === -1) throw new Error(`enum ${enumName} block is unterminated`);

  return schema
    .slice(open + 1, close)
    .split("\n")
    .map((line) => line.trim())
    // Doc comments (/** … */, /// …) and blank lines are not values.
    .filter((line) => /^[A-Z_][A-Z0-9_]*$/.test(line));
}

describe("the DATABASE accepts every MessageSendStatus the schema declares", () => {
  const values = schemaEnumValues("MessageSendStatus");

  it("finds the enum values in the schema", () => {
    // A guard that silently tested nothing would be the same failure again.
    expect(values.length, "No MessageSendStatus values parsed from schema.prisma.").toBeGreaterThan(
      0,
    );
    expect(values).toContain("ACCEPTED");
    expect(values).toContain("SENT");
    expect(values).toContain("FAILED");
  });

  for (const value of values) {
    it(`${value} is writable against the live database`, async () => {
      // A real person and template, so the insert is refused for the RIGHT
      // reason if it is refused at all — a foreign-key error would tell us
      // nothing about the enum.
      const person = await prisma.person.findFirst({ select: { id: true } });
      const template = await prisma.messageTemplate.findFirst({ select: { id: true, key: true } });
      expect(person, "No Person row to attach a test MessageLog to.").not.toBeNull();
      expect(template, "No MessageTemplate row to attach a test MessageLog to.").not.toBeNull();

      // ROLLED BACK. The write is proven and then undone, so this never adds a
      // row to the organizer's message log — a test that leaves debris in the
      // record of what was said to whom would be its own 2.10 problem.
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.messageLog.create({
            data: {
              personId: person!.id,
              templateId: template!.id,
              templateKey: template!.key,
              body: `enum writability probe — ${value}`,
              channel: "WHATSAPP",
              toPhone: "+10000000000",
              trigger: "MANUAL",
              status: value as "SENT" | "ACCEPTED" | "FAILED",
              providerSid: null,
              error: null,
            },
          });
          // Force the rollback. The insert above has already been executed by
          // Postgres, so a refusal of the enum value would have thrown before
          // reaching this line.
          throw new RollbackProbe();
        }),
      ).rejects.toThrow(RollbackProbe);
    });
  }
});

// THE SAME DRIFT CLASS, FOR THE GROUP BROADCAST (Cycle-2 build, feature D).
//
// `channel` is TEXT, not an enum, so 'TELEGRAM' cannot hit enum drift — but
// the broadcast's row has NO PERSON, and that is a schema-vs-database gap of
// exactly the ACCEPTED shape: schema.prisma says `personId String?`, and if
// the DROP NOT NULL migration is ever missing from a database, the first real
// announcement posts to the group and then THROWS on the way to recording it
// — message delivered, no row to prove it. Attempted for real, rolled back.
describe("the DATABASE accepts a group-broadcast row: channel TELEGRAM, no person", () => {
  it("a null-person TELEGRAM row is writable against the live database", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.messageLog.create({
          data: {
            personId: null,
            templateId: null,
            templateKey: "TELEGRAM_BROADCAST",
            body: "group-broadcast writability probe",
            channel: "TELEGRAM",
            toPhone: "-1000000000000",
            trigger: "MANUAL",
            status: "SENT",
            providerSid: null,
            error: null,
          },
        });
        // The insert has already been executed by Postgres — a NOT NULL
        // refusal would have thrown before this line.
        throw new RollbackProbe();
      }),
    ).rejects.toThrow(RollbackProbe);
  });
});

/** Thrown to roll a probe transaction back. Never an error worth reporting. */
class RollbackProbe extends Error {
  constructor() {
    super("rollback");
    this.name = "RollbackProbe";
  }
}
