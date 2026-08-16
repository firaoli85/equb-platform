// RESET EVERY MEMBER'S PIN TO THE LAST FOUR DIGITS OF THEIR PHONE.
//
// WHY THIS IS SAFE TO RUN. The platform accepted 4-to-8-digit PINs for months
// and six longer hashes existed — all of them the organizer's own test data.
// No member has been sent the portal link, so no member has ever chosen a PIN.
// Nothing of value is being overwritten. That is the organizer's confirmation,
// and it is the whole basis for a script that destroys credentials.
//
// DRY RUN BY DEFAULT. It prints counts and changes nothing. Overwriting every
// member's credential is not something a script should do because it was run;
// it needs --apply, said out loud.
//
//   npx tsx scripts/reset-pins-to-phone-default.mts
//   npx tsx scripts/reset-pins-to-phone-default.mts --apply
//
// LOG HYGIENE. This never prints a PIN, not even a resolved default, and not
// even in dry run. The whole point of the value is that it opens an account;
// a terminal scrollback, a CI log or a screenshot is exactly where it must not
// end up. Rows are reported by NAME and COUNT — "reset to last-4-of-phone" —
// and the phone is shown masked so a row can still be identified.
//
// Reads DIRECT_URL: the pooled app role sees no rows under RLS.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
const { hashPin } = await import("../lib/pin");
const { defaultPinForPhone, phoneDigits } = await import("../lib/phone");

const APPLY = process.argv.includes("--apply");

/**
 * "1301541••••" — enough to identify a row, not enough to derive the PIN.
 *
 * THE LAST FOUR ARE THE SECRET, so they are what gets hidden. The usual habit
 * is to mask the middle and show the tail, which here would print every PIN
 * this script sets, in a terminal scrollback, for the whole group.
 */
function maskPhone(phone: string | null): string {
  const digits = phoneDigits(phone ?? "");
  if (digits.length < 4) return "(no usable number)";
  return `${digits.slice(0, -4)}••••`;
}

async function main() {
  const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Missing DIRECT_URL in .env.local.");
    process.exit(1);
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  const people = await prisma.person.findMany({
    orderBy: { nameEnglishFirst: "asc" },
    select: { id: true, nameAmharic: true, nameEnglishFirst: true, phone: true, pinHash: true },
  });

  const resettable: typeof people = [];
  const skipped: { person: (typeof people)[number]; why: string }[] = [];

  for (const p of people) {
    // `defaultPinForPhone` is the SAME function the login door uses to resolve
    // a default. Deriving the value any other way here would let the script
    // and the door disagree about what a member's PIN is.
    if (defaultPinForPhone(p.phone) === null) {
      skipped.push({
        person: p,
        why: (p.phone?.trim() ?? "") === "" ? "no phone on file" : "fewer than 4 usable digits",
      });
      continue;
    }
    resettable.push(p);
  }

  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — ${people.length} people in the directory\n`);
  console.log(
    "  " +
      "name".padEnd(28) +
      "phone".padEnd(22) +
      "has own hash".padEnd(14) +
      "action",
  );
  console.log("  " + "-".repeat(78));

  for (const p of resettable) {
    console.log(
      "  " +
        `${p.nameAmharic} — ${p.nameEnglishFirst}`.slice(0, 27).padEnd(28) +
        maskPhone(p.phone).padEnd(22) +
        (p.pinHash === null ? "no" : "YES").padEnd(14) +
        "reset to last-4-of-phone",
    );
  }
  for (const s of skipped) {
    console.log(
      "  " +
        `${s.person.nameAmharic} — ${s.person.nameEnglishFirst}`.slice(0, 27).padEnd(28) +
        maskPhone(s.person.phone).padEnd(22) +
        (s.person.pinHash === null ? "no" : "YES").padEnd(14) +
        `SKIPPED — ${s.why}`,
    );
  }

  const overwriting = resettable.filter((p) => p.pinHash !== null).length;
  console.log(
    `\n  ${resettable.length} to reset (${overwriting} overwriting an existing hash), ` +
      `${skipped.length} skipped.`,
  );

  // THE CONSEQUENCE, STATED WHERE IT IS ACTED ON.
  //
  // A member with NO pinHash already signs in with their phone's last four —
  // `defaultPinFromPhone` is on, and the login door resolves it. Writing a
  // hash produces the same sign-in, but it changes what the SYSTEM BELIEVES:
  // `pinState` reads "own" rather than "default", so the organizer's amber
  // "still on the default — anyone who has their number could use it" badge
  // goes dark, and `verifyPin` stops returning `usedDefault`, which is what
  // triggers the "set your own PIN" prompt after sign-in.
  //
  // Net: every member ends up with a PIN derivable from their own phone
  // number, and the two safeguards built for exactly that risk stop firing.
  console.log(
    "\n  NOTE — writing a hash marks these members as having chosen their own PIN.\n" +
      "  The organizer's amber 'still on the default' badge and the post-sign-in\n" +
      "  'set your own PIN' prompt both key off pinHash being NULL, so both go\n" +
      "  quiet for everyone reset here. Clearing pinHash instead would give the\n" +
      "  same sign-in and keep both — see the note at the top of this file.\n",
  );

  if (!APPLY) {
    console.log("DRY RUN — nothing was changed. Re-run with --apply.\n");
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (const p of resettable) {
    const pin = defaultPinForPhone(p.phone);
    if (pin === null) continue; // unreachable; the filter above guarantees it
    await prisma.person.update({
      where: { id: p.id },
      data: {
        pinHash: await hashPin(pin),
        // A credential reset clears the lockout state with it. Leaving a lock
        // in place would refuse the very PIN this script just set.
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });
    done++;
  }

  console.log(`Reset ${done} PIN${done === 1 ? "" : "s"} to last-4-of-phone.\n`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
