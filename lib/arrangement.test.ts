import { describe, expect, it } from "vitest";
import {
  addSlot,
  deleteSlot,
  emptySlotToUnassigned,
  isDirty,
  moveNumber,
  toSavePayload,
  validateArrangement,
  type Draft,
  type NumberLocks,
} from "./arrangement";

const NO_LOCKS: NumberLocks = { frozenIds: new Set(), anchoredIds: new Set() };

function draft(): Draft {
  return {
    slots: [
      { key: "s1", id: "s1", luckyNumberIds: ["a", "b"], locked: false },
      { key: "s2", id: "s2", luckyNumberIds: ["c"], locked: false },
      { key: "s3", id: "s3", luckyNumberIds: ["drawn", "partner"], locked: true },
    ],
    unassigned: ["u1"],
  };
}

describe("moveNumber — between slots and the tray", () => {
  it("moves a number from one slot to another", () => {
    const result = moveNumber(draft(), "a", { kind: "slot", key: "s2" }, NO_LOCKS);
    expect(result.error).toBeNull();
    expect(result.draft!.slots.find((s) => s.key === "s1")!.luckyNumberIds).toEqual(["b"]);
    expect(result.draft!.slots.find((s) => s.key === "s2")!.luckyNumberIds).toEqual(["c", "a"]);
  });

  it("moves a number OUT of a slot into the unassigned tray", () => {
    const result = moveNumber(draft(), "a", { kind: "unassigned" }, NO_LOCKS);
    expect(result.error).toBeNull();
    expect(result.draft!.slots.find((s) => s.key === "s1")!.luckyNumberIds).toEqual(["b"]);
    expect(result.draft!.unassigned).toEqual(["u1", "a"]);
  });

  it("moves a number from the tray into a slot", () => {
    const result = moveNumber(draft(), "u1", { kind: "slot", key: "s2" }, NO_LOCKS);
    expect(result.error).toBeNull();
    expect(result.draft!.unassigned).toEqual([]);
    expect(result.draft!.slots.find((s) => s.key === "s2")!.luckyNumberIds).toEqual(["c", "u1"]);
  });

  it("moves a number into a brand-new slot", () => {
    const result = moveNumber(draft(), "u1", { kind: "new-slot" }, NO_LOCKS);
    expect(result.error).toBeNull();
    const created = result.draft!.slots[result.draft!.slots.length - 1];
    expect(created.id).toBeNull();
    expect(created.luckyNumberIds).toEqual(["u1"]);
  });

  it("dropping onto its own slot is a harmless no-op", () => {
    const result = moveNumber(draft(), "a", { kind: "slot", key: "s1" }, NO_LOCKS);
    expect(result.error).toBeNull();
    expect(result.draft).toEqual(draft());
  });
});

describe("locked numbers cannot be moved by ANY path (2.3)", () => {
  const locks: NumberLocks = { frozenIds: new Set(["drawn", "committed1"]), anchoredIds: new Set(["anchor"]) };
  const lockedDraft: Draft = {
    slots: [
      { key: "s1", id: "s1", luckyNumberIds: ["committed1", "committed2"], locked: true },
      { key: "s2", id: "s2", luckyNumberIds: ["free1"], locked: false },
      { key: "s3", id: "s3", luckyNumberIds: ["anchor"], locked: false },
    ],
    unassigned: [],
  };

  it("a frozen number refuses every destination", () => {
    for (const dest of [
      { kind: "slot", key: "s2" } as const,
      { kind: "unassigned" } as const,
      { kind: "new-slot" } as const,
    ]) {
      const result = moveNumber(lockedDraft, "committed1", dest, locks);
      expect(result.draft).toBeNull();
      expect(result.error).toMatch(/locked/);
    }
  });

  it("a FREE number inside a locked slot cannot leave — that would re-pair the lock", () => {
    const result = moveNumber(lockedDraft, "committed2", { kind: "slot", key: "s2" }, {
      frozenIds: new Set(["committed1"]),
      anchoredIds: new Set(),
    });
    expect(result.draft).toBeNull();
    expect(result.error).toMatch(/re-pair/);
  });

  it("nothing can be dropped INTO a locked slot", () => {
    const result = moveNumber(lockedDraft, "free1", { kind: "slot", key: "s1" }, locks);
    expect(result.draft).toBeNull();
    expect(result.error).toMatch(/locked/);
  });

  it("an anchored number may change slots but never leave the wheel", () => {
    const toSlot = moveNumber(lockedDraft, "anchor", { kind: "slot", key: "s2" }, locks);
    expect(toSlot.error).toBeNull();
    const toTray = moveNumber(lockedDraft, "anchor", { kind: "unassigned" }, locks);
    expect(toTray.draft).toBeNull();
    expect(toTray.error).toMatch(/stay on the wheel/);
  });
});

describe("slot management — empty slots persist", () => {
  it("addSlot creates an immediately visible empty slot", () => {
    const next = addSlot(draft());
    const created = next.slots[next.slots.length - 1];
    expect(created.luckyNumberIds).toEqual([]);
    expect(created.id).toBeNull();
  });

  it("an EMPTY slot survives into the save payload — never silently dropped", () => {
    const next = addSlot(draft());
    const payload = toSavePayload(next);
    expect(payload).toHaveLength(4);
    expect(payload[3]).toEqual({ id: null, luckyNumberIds: [] });
  });

  it("deleteSlot refuses a non-empty slot and says why", () => {
    const result = deleteSlot(draft(), "s1");
    expect(result.draft).toBeNull();
    expect(result.error).toMatch(/2 number\(s\).*Unassigned first/);
  });

  it("emptySlotToUnassigned then deleteSlot is the offered path", () => {
    const emptied = emptySlotToUnassigned(draft(), "s1", NO_LOCKS);
    expect(emptied.error).toBeNull();
    expect(emptied.draft!.unassigned).toEqual(["u1", "a", "b"]);
    const deleted = deleteSlot(emptied.draft!, "s1");
    expect(deleted.error).toBeNull();
    expect(deleted.draft!.slots.map((s) => s.key)).toEqual(["s2", "s3"]);
  });

  it("a locked slot can be neither emptied nor deleted", () => {
    expect(emptySlotToUnassigned(draft(), "s3", NO_LOCKS).error).toMatch(/locked/);
    expect(deleteSlot(draft(), "s3").error).toMatch(/locked/);
  });
});

describe("validateArrangement — the server backstop (2.3) holds on its own", () => {
  // Saved state: slot S1 is DRAWN holding d1+d2; S2 holds committed c1; S3 free f1.
  const base = {
    existingSlots: [
      { id: "S1", memberIds: ["d1", "d2"] },
      { id: "S2", memberIds: ["c1"] },
      { id: "S3", memberIds: ["f1"] },
    ],
    knownNumberIds: new Set(["d1", "d2", "c1", "f1", "u1", "anchor"]),
    drawnNumberIds: new Set(["d1", "d2"]),
    committedNumberIds: new Set(["c1"]),
    anchoredNumberIds: new Set<string>(),
    label: (id: string) => id,
  };
  const S1 = { id: "S1", luckyNumberIds: ["d1", "d2"] };
  const S2 = { id: "S2", luckyNumberIds: ["c1"] };
  const S3 = { id: "S3", luckyNumberIds: ["f1"] };

  it("accepts the unchanged arrangement, including added empty slots", () => {
    expect(validateArrangement({ ...base, slots: [S1, S2, S3] })).toBeNull();
    expect(
      validateArrangement({ ...base, slots: [S1, S2, S3, { id: null, luckyNumberIds: [] }] }),
    ).toBeNull();
  });

  it("rejects re-housing a DRAWN slot's members under a new id — that would cascade-delete the Draw", () => {
    const error = validateArrangement({
      ...base,
      slots: [{ id: null, luckyNumberIds: ["d1", "d2"] }, S2, S3],
    });
    expect(error).toMatch(/DRAWN.*history/);
  });

  it("rejects re-housing a COMMITTED slot under a different existing id", () => {
    const error = validateArrangement({
      ...base,
      slots: [S1, { id: "S3", luckyNumberIds: ["c1"] }, { id: "S2", luckyNumberIds: ["f1"] }],
    });
    expect(error).toMatch(/COMMITTED/);
  });

  it("rejects duplicate slot ids — the entries would merge into one DB slot, re-pairing it", () => {
    const error = validateArrangement({
      ...base,
      slots: [S1, { id: "S1", luckyNumberIds: ["f1"] }, S2],
    });
    expect(error).toMatch(/same slot appears twice/);
  });

  it("rejects slot ids that do not belong to this cycle", () => {
    const error = validateArrangement({
      ...base,
      slots: [S1, S2, S3, { id: "other-cycle-slot", luckyNumberIds: ["u1"] }],
    });
    expect(error).toMatch(/Unknown slot/);
  });

  it("rejects changing a frozen slot's composition (add or remove)", () => {
    expect(
      validateArrangement({ ...base, slots: [{ id: "S1", luckyNumberIds: ["d1", "d2", "f1"] }, S2] }),
    ).toMatch(/DRAWN|COMMITTED/);
    expect(
      validateArrangement({ ...base, slots: [{ id: "S1", luckyNumberIds: ["d1"] }, S2, S3] }),
    ).toMatch(/DRAWN/);
  });

  it("rejects duplicate and unknown numbers, and a missing anchored number", () => {
    expect(
      validateArrangement({ ...base, slots: [S1, S2, S3, { id: null, luckyNumberIds: ["f1"] }] }),
    ).toMatch(/appears twice/);
    expect(
      validateArrangement({ ...base, slots: [S1, S2, S3, { id: null, luckyNumberIds: ["nope"] }] }),
    ).toMatch(/Unknown lucky number/);
    expect(
      validateArrangement({
        ...base,
        anchoredNumberIds: new Set(["anchor"]),
        slots: [S1, S2, S3],
      }),
    ).toMatch(/stay on the wheel/);
  });
});

describe("isDirty — Save enables only on real change", () => {
  it("ignores in-slot ordering, sees membership changes", () => {
    const a = draft();
    const reordered: Draft = {
      ...a,
      slots: a.slots.map((s) => ({ ...s, luckyNumberIds: [...s.luckyNumberIds].reverse() })),
    };
    expect(isDirty(a, reordered)).toBe(false);
    const moved = moveNumber(a, "a", { kind: "unassigned" }, NO_LOCKS).draft!;
    expect(isDirty(a, moved)).toBe(true);
  });
});
