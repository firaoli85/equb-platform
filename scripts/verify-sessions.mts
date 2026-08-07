// BEHAVIOURAL VERIFICATION against the LIVE database (2.24).
//
// The unit tests prove the arithmetic. This proves the parts only the real
// database can: that the table accepts the rows, that the unique token index
// holds, that "sign out everywhere else" selects the right rows in SQL, and —
// the one that matters most — that deleting a person takes their sessions
// with them rather than leaving orphans (2.9).
//
//   npx tsx scripts/verify-sessions.mts
//
// Creates a synthetic person, exercises everything against it, then deletes
// it. Nothing real is touched and nothing is left behind.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { PrismaPg } = await import("@prisma/adapter-pg");
const { PrismaClient } = await import("../lib/generated/prisma/client");
// The app role is blocked by RLS; verification runs as the owner.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL! }),
});
const { createHash, randomUUID } = await import("node:crypto");
const { evaluateSession, sessionLimits } = await import("../lib/session-policy");

const NAME = "Session Verify";
const LAST = "Fixture";
let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// ————————————————— Setup —————————————————

// Leftovers from an interrupted run must not poison this one.
await prisma.person.deleteMany({ where: { nameEnglishFirst: NAME, nameEnglishLast: LAST } });

const authUserId = randomUUID();
const person = await prisma.person.create({
  data: {
    nameAmharic: "የክፍለ ጊዜ ሙከራ",
    nameEnglishFirst: NAME,
    nameEnglishLast: LAST,
    phone: "+15550008888",
    authUserId,
  },
});
console.log(`Synthetic person ${person.id} (auth ${authUserId})\n`);

const now = new Date();
const base = {
  authUserId,
  personId: person.id,
  role: "MEMBER",
  method: "PIN",
  fingerprint: "fp-current",
  userAgent: "verify",
  browser: "Chrome",
  os: "Windows",
  deviceType: "Computer",
  ip: "203.0.113.10",
};

// ————————————————— 1. Rows are recorded —————————————————

console.log("1. A sign-in is recorded");
const current = await prisma.signInSession.create({
  data: { ...base, tokenHash: hash("token-current"), createdAt: now, lastSeenAt: now },
});
const phone = await prisma.signInSession.create({
  data: {
    ...base,
    fingerprint: "fp-phone",
    ip: "198.51.100.7",
    deviceType: "Phone",
    browser: "Safari",
    os: "iPhone",
    tokenHash: hash("token-phone"),
    createdAt: new Date(now.getTime() - 2 * DAY),
    lastSeenAt: new Date(now.getTime() - 60 * MINUTE),
    isNewDevice: true,
  },
});
check("both sessions exist", Boolean(current.id && phone.id));
check("the token is stored HASHED, never raw", current.tokenHash === hash("token-current"));
check("the raw token is nowhere in the row", !JSON.stringify(current).includes("token-current"));

// ————————————————— 2. The token index is unique —————————————————

console.log("\n2. The token index refuses a duplicate");
let duplicateRefused = false;
try {
  await prisma.signInSession.create({
    data: { ...base, tokenHash: hash("token-current") },
  });
} catch {
  duplicateRefused = true;
}
check("a second row with the same tokenHash is refused by the database", duplicateRefused);

// ————————————————— 3. Lookup by token —————————————————

console.log("\n3. The proxy's lookup finds the right row");
const found = await prisma.signInSession.findUnique({
  where: { tokenHash: hash("token-current") },
  select: { id: true },
});
check("a valid token resolves to its session", found?.id === current.id);
const missing = await prisma.signInSession.findUnique({
  where: { tokenHash: hash("not-a-real-token") },
  select: { id: true },
});
check("an unknown token resolves to nothing (the gate then allows)", missing === null);

// ————————————————— 4. Sign out everywhere else —————————————————

console.log("\n4. Sign out everywhere else");
const revoked = await prisma.signInSession.updateMany({
  where: { authUserId, revokedAt: null, id: { not: current.id } },
  data: { revokedAt: new Date(), revokedReason: "Signed out from another device" },
});
check("exactly the OTHER session was ended", revoked.count === 1, `ended ${revoked.count}`);

const after = await prisma.signInSession.findMany({
  where: { authUserId },
  select: { id: true, revokedAt: true, createdAt: true, lastSeenAt: true },
});
const currentAfter = after.find((r) => r.id === current.id)!;
const phoneAfter = after.find((r) => r.id === phone.id)!;
check("THIS device is still signed in", currentAfter.revokedAt === null);
check("the other device is ended", phoneAfter.revokedAt !== null);

const limits = sessionLimits("MEMBER", {
  memberIdleDays: 7,
  memberMaxDays: 30,
  adminIdleMinutes: 25,
  adminMaxHours: 8,
});
check(
  "the gate agrees: this device active, the other revoked",
  evaluateSession({ ...currentAfter, now: new Date(), limits }).state === "active" &&
    evaluateSession({ ...phoneAfter, now: new Date(), limits }).state === "expired",
);

// ————————————————— 5. History survives, for new-device detection —————————————————

console.log("\n5. An ENDED session still counts as history");
const history = await prisma.signInSession.findMany({
  where: { personId: person.id },
  select: { fingerprint: true, ip: true },
});
check("the revoked row is still readable as history", history.length === 2);
check(
  "so a return to that device is NOT reported as new",
  history.some((h) => h.fingerprint === "fp-phone"),
);

// ————————————————— 6. Clean delete (2.9) —————————————————

console.log("\n6. Deleting the person takes the sessions with them");
await prisma.person.delete({ where: { id: person.id } });
const orphans = await prisma.signInSession.count({ where: { authUserId } });
check("no session rows are left behind", orphans === 0, `${orphans} orphan(s)`);

// ————————————————— Result —————————————————

const leftover = await prisma.person.count({
  where: { nameEnglishFirst: NAME, nameEnglishLast: LAST },
});
console.log(`\nFixtures remaining: ${leftover}`);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
