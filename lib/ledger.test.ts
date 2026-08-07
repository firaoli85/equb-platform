import { describe, expect, it } from "vitest";
import {
  forgivenessRefusal,
  ledgerBalance,
  ledgerStory,
  totalForgiven,
  totalRaised,
  totalRepaid,
} from "./ledger";

// 2.18: the carried balance belongs to the PERSON and survives every cycle.
// It must be readable two years later, so the story — not just the number —
// is the deliverable, and a write-off must never be mistaken for a payment.

describe("ledgerBalance — what is still owed", () => {
  it("debts raise it and payments clear it", () => {
    expect(ledgerBalance([{ type: "DEBT", amount: 200_000 }])).toBe(200_000);
    expect(
      ledgerBalance([
        { type: "DEBT", amount: 200_000 },
        { type: "PAYMENT", amount: 50_000 },
      ]),
    ).toBe(150_000);
  });

  it("a write-off clears it exactly like a payment", () => {
    expect(
      ledgerBalance([
        { type: "DEBT", amount: 200_000 },
        { type: "FORGIVEN", amount: 200_000 },
      ]),
    ).toBe(0);
  });

  it("never goes negative — overpaying settles, it does not create credit", () => {
    expect(
      ledgerBalance([
        { type: "DEBT", amount: 100_000 },
        { type: "PAYMENT", amount: 150_000 },
      ]),
    ).toBe(0);
  });

  it("is zero for a person who has never carried anything", () => {
    expect(ledgerBalance([])).toBe(0);
  });
});

describe("forgiveness is recorded DISTINCTLY from payment", () => {
  const entries = [
    { type: "DEBT" as const, amount: 200_000 },
    { type: "PAYMENT" as const, amount: 50_000 },
    { type: "FORGIVEN" as const, amount: 150_000 },
  ];

  it("the balance is clear, but the two are never added together", () => {
    expect(ledgerBalance(entries)).toBe(0);
    expect(totalRepaid(entries)).toBe(50_000); // money actually received
    expect(totalForgiven(entries)).toBe(150_000); // money written off
    expect(totalRaised(entries)).toBe(200_000);
  });

  it("a balance cleared entirely by forgiveness shows ZERO repaid", () => {
    const written = [
      { type: "DEBT" as const, amount: 200_000 },
      { type: "FORGIVEN" as const, amount: 200_000 },
    ];
    expect(ledgerBalance(written)).toBe(0);
    expect(totalRepaid(written)).toBe(0);
    expect(totalForgiven(written)).toBe(200_000);
  });
});

describe("ledgerStory — readable two years later", () => {
  const story = ledgerStory([
    { type: "DEBT" as const, amount: 200_000, description: "Cycle 1 2026 — 8 weeks unpaid" },
    { type: "PAYMENT" as const, amount: 50_000, description: "Zelle" },
    { type: "PAYMENT" as const, amount: 25_000, description: "Cash" },
    { type: "FORGIVEN" as const, amount: 125_000, description: "written off" },
  ]);

  it("carries the running total after every entry", () => {
    expect(story.entries.map((e) => e.balanceAfter)).toEqual([200_000, 150_000, 125_000, 0]);
  });

  it("keeps each entry's own description — where it came from", () => {
    expect(story.entries[0].description).toBe("Cycle 1 2026 — 8 weeks unpaid");
  });

  it("separates the totals so the history can be read at a glance", () => {
    expect(story.raised).toBe(200_000);
    expect(story.repaid).toBe(75_000);
    expect(story.forgiven).toBe(125_000);
    expect(story.balance).toBe(0);
  });

  it("preserves the order it was given — occurredAt is the caller's fact", () => {
    expect(story.entries.map((e) => e.type)).toEqual(["DEBT", "PAYMENT", "PAYMENT", "FORGIVEN"]);
  });

  it("a running total never displays as negative", () => {
    const over = ledgerStory([
      { type: "DEBT", amount: 100_000 },
      { type: "PAYMENT", amount: 150_000 },
    ]);
    expect(over.entries.map((e) => e.balanceAfter)).toEqual([100_000, 0]);
  });

  it("an empty ledger is an empty story, not a crash", () => {
    const none = ledgerStory([]);
    expect(none.entries).toEqual([]);
    expect(none.balance).toBe(0);
  });

  it("a SECOND cycle's debt stacks on what is left of the first", () => {
    const twoCycles = ledgerStory([
      { type: "DEBT" as const, amount: 200_000, description: "Cycle 1 2026" },
      { type: "PAYMENT" as const, amount: 80_000, description: "Zelle" },
      { type: "DEBT" as const, amount: 90_000, description: "Cycle 2 2026" },
    ]);
    expect(twoCycles.entries.map((e) => e.balanceAfter)).toEqual([200_000, 120_000, 210_000]);
    expect(twoCycles.balance).toBe(210_000);
  });
});

describe("forgivenessRefusal — the organizer's number is never quietly changed", () => {
  it("allows writing off part of a balance", () => {
    expect(forgivenessRefusal({ balance: 200_000, amount: 50_000 })).toBeNull();
  });

  it("allows writing off the whole balance", () => {
    expect(forgivenessRefusal({ balance: 200_000, amount: 200_000 })).toBeNull();
  });

  it("refuses MORE than is carried rather than capping it silently", () => {
    const r = forgivenessRefusal({ balance: 200_000, amount: 250_000 });
    expect(r).toContain("more than");
  });

  it("refuses when there is nothing to forgive", () => {
    expect(forgivenessRefusal({ balance: 0, amount: 10_000 })).toContain("no balance");
  });

  it("refuses a missing, zero or fractional amount", () => {
    for (const amount of [0, -1, 100.5]) {
      expect(forgivenessRefusal({ balance: 200_000, amount })).not.toBeNull();
    }
  });
});
