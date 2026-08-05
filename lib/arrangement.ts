// Pure draft-arrangement logic for the wheel setup. The organizer arranges
// a LOCAL draft (drag, click-move, add/delete slots) and saves once; every
// operation here is a pure function so the locking rules (2.3) are
// unit-testable and identical for drag and click paths.

export type DraftSlot = {
  /** Stable client key (existing slot id, or a draft key for new slots). */
  key: string;
  /** DB id, or null for a slot created in this draft. */
  id: string | null;
  luckyNumberIds: string[];
  /** Contains a drawn or committed number: composition immutable (2.3). */
  locked: boolean;
};

export type Draft = {
  slots: DraftSlot[];
  unassigned: string[];
};

export type NumberLocks = {
  /** Drawn or ALONE/TOGETHER-committed: cannot move at all. */
  frozenIds: ReadonlySet<string>;
  /** OPEN_PARTNER anchors: may move between slots, never off the wheel. */
  anchoredIds: ReadonlySet<string>;
};

export type MoveDestination =
  | { kind: "slot"; key: string }
  | { kind: "unassigned" }
  | { kind: "new-slot" };

export type MoveResult = { draft: Draft; error: null } | { draft: null; error: string };

let draftCounter = 0;
function freshKey(): string {
  draftCounter += 1;
  return `draft-${draftCounter}`;
}

function findSlotOf(draft: Draft, numberId: string): DraftSlot | null {
  return draft.slots.find((s) => s.luckyNumberIds.includes(numberId)) ?? null;
}

/**
 * Move one number. Every locking rule lives here, shared by drag and click:
 *   - a frozen number (drawn/committed) never moves, by any path;
 *   - a number sitting in a locked slot never moves (that would re-pair the
 *     locked number's slot);
 *   - nothing may be dropped INTO a locked slot;
 *   - an anchored (open-partner) number may change slots but never leave
 *     the wheel.
 */
export function moveNumber(
  draft: Draft,
  numberId: string,
  destination: MoveDestination,
  locks: NumberLocks,
): MoveResult {
  if (locks.frozenIds.has(numberId)) {
    return { draft: null, error: "That number is locked (drawn or committed) — it cannot move." };
  }
  const sourceSlot = findSlotOf(draft, numberId);
  if (sourceSlot?.locked) {
    return {
      draft: null,
      error: "That number sits with a locked number — moving it would re-pair a locked slot.",
    };
  }
  if (destination.kind === "unassigned" && locks.anchoredIds.has(numberId)) {
    return {
      draft: null,
      error: "That number is committed (open partner) — it must stay on the wheel.",
    };
  }
  if (destination.kind === "slot") {
    const target = draft.slots.find((s) => s.key === destination.key);
    if (!target) return { draft: null, error: "That slot no longer exists." };
    if (target.locked) {
      return { draft: null, error: "That slot is locked — nothing may be added to it." };
    }
    if (target.key === sourceSlot?.key) return { draft, error: null }; // no-op
  }

  const without: Draft = {
    slots: draft.slots.map((s) => ({
      ...s,
      luckyNumberIds: s.luckyNumberIds.filter((id) => id !== numberId),
    })),
    unassigned: draft.unassigned.filter((id) => id !== numberId),
  };

  if (destination.kind === "unassigned") {
    return { draft: { ...without, unassigned: [...without.unassigned, numberId] }, error: null };
  }
  if (destination.kind === "new-slot") {
    return {
      draft: {
        ...without,
        slots: [...without.slots, { key: freshKey(), id: null, luckyNumberIds: [numberId], locked: false }],
      },
      error: null,
    };
  }
  return {
    draft: {
      ...without,
      slots: without.slots.map((s) =>
        s.key === destination.key ? { ...s, luckyNumberIds: [...s.luckyNumberIds, numberId] } : s,
      ),
    },
    error: null,
  };
}

/** Add an empty slot — visible and droppable immediately. */
export function addSlot(draft: Draft): Draft {
  return {
    ...draft,
    slots: [...draft.slots, { key: freshKey(), id: null, luckyNumberIds: [], locked: false }],
  };
}

/** Delete a slot: only when empty and unlocked. */
export function deleteSlot(draft: Draft, key: string): MoveResult {
  const slot = draft.slots.find((s) => s.key === key);
  if (!slot) return { draft: null, error: "That slot no longer exists." };
  if (slot.locked) return { draft: null, error: "That slot is locked and cannot be deleted." };
  if (slot.luckyNumberIds.length > 0) {
    return {
      draft: null,
      error: `That slot still holds ${slot.luckyNumberIds.length} number(s) — move them to Unassigned first.`,
    };
  }
  return { draft: { ...draft, slots: draft.slots.filter((s) => s.key !== key) }, error: null };
}

/** Empty a slot into the tray (the offered path before deleting). */
export function emptySlotToUnassigned(draft: Draft, key: string, locks: NumberLocks): MoveResult {
  const slot = draft.slots.find((s) => s.key === key);
  if (!slot) return { draft: null, error: "That slot no longer exists." };
  if (slot.locked) return { draft: null, error: "That slot is locked and cannot be emptied." };
  const anchored = slot.luckyNumberIds.find((id) => locks.anchoredIds.has(id));
  if (anchored !== undefined) {
    return {
      draft: null,
      error: "A committed (open partner) number sits in that slot — it must stay on the wheel.",
    };
  }
  return {
    draft: {
      slots: draft.slots.map((s) => (s.key === key ? { ...s, luckyNumberIds: [] } : s)),
      unassigned: [...draft.unassigned, ...slot.luckyNumberIds],
    },
    error: null,
  };
}

// ————— Server-side backstop (2.3) — pure so every hole is unit-testable —————

export type ArrangementSlotInput = { id: string | null; luckyNumberIds: string[] };

/**
 * Validate a full arrangement payload against saved state. Returns a plain-
 * language error, or null when the arrangement is safe. This is the SERVER
 * backstop behind the drag-and-drop UI: it must hold on its own even against
 * a buggy or malicious client, because a hole here can rewrite draw history.
 *
 * Beyond membership rules, it pins slot IDENTITY: a slot holding a drawn or
 * committed number must arrive under its exact existing id — re-housing the
 * same members under a new id would delete the original slot and cascade-
 * delete its Draw, resurrecting already-drawn numbers.
 */
export function validateArrangement(input: {
  slots: ArrangementSlotInput[];
  existingSlots: { id: string; memberIds: string[] }[];
  knownNumberIds: ReadonlySet<string>;
  drawnNumberIds: ReadonlySet<string>;
  committedNumberIds: ReadonlySet<string>;
  anchoredNumberIds: ReadonlySet<string>;
  /** Display label for a lucky number id (its number), for messages. */
  label: (id: string) => string;
}): string | null {
  for (const slot of input.slots) {
    for (const id of slot.luckyNumberIds) {
      if (!input.knownNumberIds.has(id)) return "Unknown lucky number in the arrangement.";
    }
  }

  const seenNumbers = new Set<string>();
  for (const slot of input.slots) {
    for (const id of slot.luckyNumberIds) {
      if (seenNumbers.has(id)) {
        return `Number ${input.label(id)} appears twice in the arrangement.`;
      }
      seenNumbers.add(id);
    }
  }

  const existingIds = new Set(input.existingSlots.map((s) => s.id));
  const seenSlotIds = new Set<string>();
  for (const slot of input.slots) {
    if (slot.id === null) continue;
    if (!existingIds.has(slot.id)) return "Unknown slot in the arrangement.";
    if (seenSlotIds.has(slot.id)) return "The same slot appears twice in the arrangement.";
    seenSlotIds.add(slot.id);
  }

  const oldSlotOfNumber = new Map<string, { id: string; set: Set<string> }>();
  for (const s of input.existingSlots) {
    const set = new Set(s.memberIds);
    for (const id of s.memberIds) oldSlotOfNumber.set(id, { id: s.id, set });
  }
  const newSlotOfNumber = new Map<string, { id: string | null; set: Set<string> }>();
  for (const s of input.slots) {
    const set = new Set(s.luckyNumberIds);
    for (const id of s.luckyNumberIds) newSlotOfNumber.set(id, { id: s.id, set });
  }
  const sameSet = (a: Set<string>, b?: Set<string>) =>
    !!b && a.size === b.size && [...a].every((x) => b.has(x));

  const frozen = (id: string, why: string): string | null => {
    const oldSlot = oldSlotOfNumber.get(id);
    const newSlot = newSlotOfNumber.get(id);
    // Composition identical AND under the very same slot id — identity matters:
    // the transaction deletes slots absent from the payload, and deleting a
    // drawn slot cascades to its Draw.
    if (!oldSlot || !newSlot || !sameSet(oldSlot.set, newSlot.set) || newSlot.id !== oldSlot.id) {
      return why;
    }
    return null;
  };
  for (const id of input.drawnNumberIds) {
    if (!oldSlotOfNumber.has(id)) continue;
    const err = frozen(
      id,
      `Number ${input.label(id)} has already been DRAWN — its slot is history and cannot be changed.`,
    );
    if (err) return err;
  }
  for (const id of input.committedNumberIds) {
    if (!oldSlotOfNumber.has(id)) continue;
    const err = frozen(
      id,
      `Number ${input.label(id)} is COMMITTED to a winner plan — its slot is locked. Cancel the plan first if you really mean to move it.`,
    );
    if (err) return err;
  }
  for (const id of input.anchoredNumberIds) {
    if (!newSlotOfNumber.has(id)) {
      return `Number ${input.label(id)} is committed (open partner) — it must stay on the wheel. Cancel the plan first to remove it.`;
    }
  }
  return null;
}

/** The exact payload for saveSlots — EMPTY slots included, never dropped. */
export function toSavePayload(draft: Draft): { id: string | null; luckyNumberIds: string[] }[] {
  return draft.slots.map((s) => ({ id: s.id, luckyNumberIds: [...s.luckyNumberIds] }));
}

/** Order-insensitive within slots, order-sensitive across the slot list. */
export function isDirty(a: Draft, b: Draft): boolean {
  const canon = (d: Draft) =>
    JSON.stringify({
      slots: d.slots.map((s) => ({ id: s.id ?? s.key, members: [...s.luckyNumberIds].sort() })),
      unassigned: [...d.unassigned].sort(),
    });
  return canon(a) !== canon(b);
}
