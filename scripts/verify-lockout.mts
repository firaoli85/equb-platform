// Behavioral check (2.24) for PIN lockout, against the LIVE database and
// the REAL sign-in action:
//   1. The CONFIGURED attempt limit trips the lock (2 here, not the default 5).
//   2. The lock lasts the CONFIGURED duration (~7 minutes here, not 30).
//   3. The correct PIN is refused while locked.
//   4. The lockout notice respects the hardship flag — the probe person is
//      "no messages", so NOTHING is sent and nothing is logged.
//   5. Unlock clears the state; the correct PIN evaluates OK again.
//   6. PIN reset restores the phone-digit default path.
// Touches: a PROBE person (deleted at the end) and the two lockout settings
// (restored at the end). No real member and no real message is involved.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const { prisma } = await import("../lib/prisma");
const { getSetting, setSetting } = await import("../lib/settings");
const { defaultPinForPhone, evaluatePinAttempt, hashPin } = await import("../lib/pin");
const { signInWithPin } = await import("../app/actions/auth");

const PROBE_PHONE = "+1 999 555 0001";

const prevMax = await getSetting("pinMaxAttempts");
const prevMinutes = await getSetting("pinLockMinutes");

let probeId: string | null = null;
try {
  await setSetting("pinMaxAttempts", 2);
  await setSetting("pinLockMinutes", 7);

  const probe = await prisma.person.create({
    data: {
      nameAmharic: "የሙከራ ሰው",
      nameEnglishFirst: "LockoutProbe",
      phone: PROBE_PHONE,
      pinHash: await hashPin("7777"),
      noMessages: true, // hardship — the lockout notice must NOT send
    },
  });
  probeId = probe.id;

  // 1 — first wrong attempt: counted, not locked.
  const wrong1 = await signInWithPin({ phone: PROBE_PHONE, pin: "1111" });
  if (wrong1.ok) throw new Error("wrong PIN was accepted");
  let row = await prisma.person.findUniqueOrThrow({ where: { id: probe.id } });
  if (row.pinFailedAttempts !== 1 || row.pinLockedUntil !== null) {
    throw new Error(
      `after 1 wrong attempt: attempts=${row.pinFailedAttempts}, locked=${row.pinLockedUntil}`,
    );
  }
  console.log("OK: first wrong attempt counted, no lock yet.");

  // 2 — the second wrong attempt trips the CONFIGURED limit (2, not 5).
  const wrong2 = await signInWithPin({ phone: PROBE_PHONE, pin: "1111" });
  if (wrong2.ok) throw new Error("wrong PIN was accepted");
  if (!/locked/i.test(wrong2.error)) {
    throw new Error(`expected a locked message, got: ${wrong2.error}`);
  }
  row = await prisma.person.findUniqueOrThrow({ where: { id: probe.id } });
  if (!row.pinLockedUntil) throw new Error("the lock did not trip at the configured limit");
  const minutes = (row.pinLockedUntil.getTime() - Date.now()) / 60_000;
  if (minutes < 6 || minutes > 8) {
    throw new Error(`lock duration ~${minutes.toFixed(1)}min — expected ~7 (configured)`);
  }
  console.log("OK: lock tripped at 2 attempts (configured), lasts ~7 minutes (configured).");

  // 3 — the CORRECT PIN is refused while locked.
  const correctWhileLocked = await signInWithPin({ phone: PROBE_PHONE, pin: "7777" });
  if (correctWhileLocked.ok) throw new Error("correct PIN was accepted WHILE LOCKED");
  if (!/locked/i.test(correctWhileLocked.error)) {
    throw new Error(`expected a locked message, got: ${correctWhileLocked.error}`);
  }
  console.log("OK: the correct PIN is refused while locked.");

  // 4 — hardship respected: no lockout notice sent or logged for the probe.
  const logged = await prisma.messageLog.count({ where: { personId: probe.id } });
  if (logged !== 0) {
    throw new Error(`expected no message log rows for the hardship probe, found ${logged}`);
  }
  console.log("OK: lockout notice respected the hardship flag — nothing sent, nothing logged.");

  // 5 — unlock clears the state (the same write unlockMemberPin performs);
  // the correct PIN evaluates OK again. (The action's full success path
  // needs a browser session, so the evaluation is checked pure.)
  await prisma.person.update({
    where: { id: probe.id },
    data: { pinFailedAttempts: 0, pinLockedUntil: null },
  });
  row = await prisma.person.findUniqueOrThrow({ where: { id: probe.id } });
  const afterUnlock = await evaluatePinAttempt(row, "7777", new Date());
  if (afterUnlock.outcome !== "ok") {
    throw new Error(`after unlock the correct PIN gives: ${afterUnlock.outcome}`);
  }
  console.log("OK: unlock clears the lock — the correct PIN works again.");

  // 6 — PIN reset (resetMemberPin's write) restores the phone-digit default.
  await prisma.person.update({
    where: { id: probe.id },
    data: { pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null },
  });
  row = await prisma.person.findUniqueOrThrow({ where: { id: probe.id } });
  const viaDefault = await evaluatePinAttempt(
    row,
    defaultPinForPhone(PROBE_PHONE)!,
    new Date(),
    { allowDefaultFromPhone: true },
  );
  if (viaDefault.outcome !== "ok" || viaDefault.usedDefault !== true) {
    throw new Error(`default path after reset: ${JSON.stringify(viaDefault)}`);
  }
  console.log("OK: PIN reset restores the phone-digit default path.");
} finally {
  await setSetting("pinMaxAttempts", prevMax);
  await setSetting("pinLockMinutes", prevMinutes);
  if (probeId) await prisma.person.delete({ where: { id: probeId } });
  await prisma.$disconnect();
}
console.log("All lockout behaviors verified — settings restored, probe removed.");
