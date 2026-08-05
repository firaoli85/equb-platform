import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_EVENT_WHERE,
  SETTLEMENT_KEY_PREFIX,
  isReservedSettlementKey,
  settlementKey,
} from "./draw-settlement";

// SECURITY REGRESSION (audit C6). A settlement receipt used to be identified
// by the PREFIX of its idempotency key — a value recordPayment takes from the
// client. Forging that prefix let an ordinary receipt be treated as payout
// money: deletable by deletePayout, creditable onto a payout net by moveDraw,
// and countable as "already received" by the terms settlement.

describe("isReservedSettlementKey — recordPayment must refuse the engine's namespace", () => {
  it("rejects the exact prefix the engine writes", () => {
    expect(isReservedSettlementKey(settlementKey("draw123", "payout456"))).toBe(true);
    expect(isReservedSettlementKey("draw-settle:anything:at-all")).toBe(true);
  });

  it("rejects case and whitespace variations — the check is not bypassable by casing", () => {
    expect(isReservedSettlementKey("DRAW-SETTLE:x:y")).toBe(true);
    expect(isReservedSettlementKey("Draw-Settle:x:y")).toBe(true);
    expect(isReservedSettlementKey("  draw-settle:x:y  ")).toBe(true);
  });

  it("allows ordinary keys, including ones that merely mention the word", () => {
    expect(isReservedSettlementKey(crypto.randomUUID())).toBe(false);
    expect(isReservedSettlementKey("catch-up for weeks 7-12")).toBe(false);
    expect(isReservedSettlementKey("my-draw-settle:x")).toBe(false);
    expect(isReservedSettlementKey("draw-settlement")).toBe(false);
    expect(isReservedSettlementKey("")).toBe(false);
  });
});

describe("SETTLEMENT_EVENT_WHERE — identification is by the pinned column, not the key", () => {
  it("selects on pinnedWeekId, which no client input can set", () => {
    expect(SETTLEMENT_EVENT_WHERE).toEqual({ pinnedWeekId: { not: null } });
    // The filter must not mention the client-controlled key at all.
    expect(JSON.stringify(SETTLEMENT_EVENT_WHERE)).not.toContain("idempotencyKey");
    expect(JSON.stringify(SETTLEMENT_EVENT_WHERE)).not.toContain(SETTLEMENT_KEY_PREFIX);
  });
});
