import { describe, expect, it } from "vitest";
import {
  canRemovePerson,
  personRemovalBlockers,
  personRemovalConsequences,
  phoneChange,
  type PersonRemovalFacts,
} from "./person-record";

// ————————————————————————— The phone —————————————————————————

const HANA = { name: "Hana", pinState: "default" as const };

describe("editing a phone number is a credential change", () => {
  it("says nothing when only the FORMATTING moved", () => {
    // These all canonicalise to +12405550187, so nothing about sign-in moves.
    for (const after of [
      "+1 240-555-0187",
      "(240) 555-0187",
      "2405550187",
      "1-240-555-0187",
      "  240 555 0187  ",
    ]) {
      const c = phoneChange({ ...HANA, before: "2405550187", after });
      expect(c.changed, after).toBe(false);
      expect(c.consequence, after).toBeNull();
    }
  });

  it("names the NEW PIN when they are still on the phone default", () => {
    const c = phoneChange({ ...HANA, before: "2405550187", after: "2405554219" });
    expect(c.changed).toBe(true);
    expect(c.newDefaultPin).toBe("4219");
    expect(c.consequence).toContain("4219");
    expect(c.consequence).toContain("last 4 digits");
    // And the identity half, which is true regardless of the PIN.
    expect(c.consequence).toContain("old one stops working");
  });

  it("does NOT invent a PIN change for someone who set their own", () => {
    const c = phoneChange({ name: "Hana", pinState: "own", before: "2405550187", after: "2405554219" });
    expect(c.changed).toBe(true);
    expect(c.newDefaultPin).toBeNull();
    expect(c.consequence).toContain("old one stops working");
    expect(c.consequence).not.toContain("last 4 digits");
  });

  it("does not invent one for someone who cannot use a PIN at all", () => {
    const c = phoneChange({ name: "Hana", pinState: "none", before: "2405550187", after: "2405554219" });
    expect(c.newDefaultPin).toBeNull();
  });

  it("EMPTYING the box is a lockout, and says so in those terms", () => {
    const c = phoneChange({ ...HANA, before: "2405550187", after: "" });
    expect(c.locksOut).toBe(true);
    expect(c.consequence).toContain("signs Hana out of the product for good");
    // All three doors, because losing one is survivable and losing all three
    // is not — that distinction is the whole point of the warning.
    expect(c.consequence).toContain("PIN");
    expect(c.consequence).toContain("WhatsApp");
    expect(c.consequence).toContain("SMS");
  });

  it("treats a number with no digits as no number, both ways", () => {
    expect(phoneChange({ ...HANA, before: null, after: "" }).changed).toBe(false);
    expect(phoneChange({ ...HANA, before: "  ", after: null }).changed).toBe(false);
  });

  it("ADDING a first number is a change, but not a lockout", () => {
    const c = phoneChange({ ...HANA, before: null, after: "2405554219" });
    expect(c.changed).toBe(true);
    expect(c.locksOut).toBe(false);
    expect(c.newDefaultPin).toBe("4219");
  });
});

// ————————————————— Removing someone from the directory —————————————————

const CLEAN: PersonRemovalFacts = {
  name: "Hana",
  participationCount: 0,
  ledgerEntryCount: 0,
  carriedBalance: 0,
  messageCount: 0,
  sessionCount: 0,
};

describe("what actually blocks a directory removal", () => {
  it("nothing blocks a person with no history", () => {
    expect(personRemovalBlockers(CLEAN)).toEqual([]);
    expect(canRemovePerson(CLEAN)).toBe(true);
  });

  it("MESSAGE HISTORY blocks it — the blocker the dialog never mentioned", () => {
    const f = { ...CLEAN, messageCount: 12 };
    const blockers = personRemovalBlockers(f);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reason).toContain("12 messages");
    // Append-only by design: promising a fix would send them hunting for a
    // button that must not exist.
    expect(blockers[0].clearable).toBe(false);
    expect(canRemovePerson(f)).toBe(false);
  });

  it("counts a FAILED send too — the row is written either way", () => {
    expect(personRemovalBlockers({ ...CLEAN, messageCount: 1 })[0].reason).toContain(
      "1 message has been sent",
    );
  });

  it("a ledger record blocks it, and settling the balance does NOT clear it", () => {
    const paidOff = { ...CLEAN, ledgerEntryCount: 4, carriedBalance: 0 };
    const blockers = personRemovalBlockers(paidOff);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].clearable).toBe(false);
    expect(blockers[0].reason).toContain("does NOT clear this");
  });

  it("being in a cycle blocks it, and that one CAN be cleared", () => {
    const blockers = personRemovalBlockers({ ...CLEAN, participationCount: 1 });
    expect(blockers[0].clearable).toBe(true);
    expect(blockers[0].reason).toContain("1 cycle");
  });

  it("lists ALL the blockers, not just the first — three refusals in a row is not a workflow", () => {
    const blockers = personRemovalBlockers({
      ...CLEAN,
      participationCount: 2,
      ledgerEntryCount: 3,
      messageCount: 40,
    });
    expect(blockers).toHaveLength(3);
  });
});

describe("what a removal takes with it", () => {
  it("names the sign-in history, which cascades away silently", () => {
    const lines = personRemovalConsequences({ ...CLEAN, sessionCount: 7 });
    expect(lines.join(" ")).toContain("7 device and IP records");
    expect(lines.join(" ")).toContain("was that really them?");
  });

  it("says the audit log KEEPS their name — the opposite surprise", () => {
    expect(personRemovalConsequences(CLEAN).join(" ")).toContain("audit log");
  });

  it("says nothing about sessions when there are none", () => {
    expect(personRemovalConsequences(CLEAN).some((l) => l.includes("device"))).toBe(false);
  });
});
