import { describe, expect, it } from "vitest";
import { closingLine, fullDate, mine, notInCurrentCycleLine } from "./member-history";

// This is the member's ONLY copy of their financial record. Two things have to
// hold: it must agree with the organizer's archive to the cent, and it must
// never be readable as the current cycle.

const CLOSED = JSON.stringify({
  version: 1,
  cycleName: "2026 Equb",
  startDate: "2026-05-17",
  closedAt: "2026-10-02T14:00:00.000Z",
  plannedWeeks: 20,
  weeks: [
    { weekNumber: 1, date: "2026-05-17", isSkipped: false, received: 0, draw: null },
    { weekNumber: 20, date: "2026-09-27", isSkipped: false, received: 0, draw: null },
  ],
  members: [
    {
      personId: "p-alem",
      name: "Alem",
      weeklyAmount: 50_000,
      weeksCommitted: 20,
      weeksPaid: 20,
      outstanding: 0,
      drawnWeek: 7,
      receivedNet: 980_000,
      pendingNet: 0,
      totalPaid: 1_000_000,
    },
    {
      personId: "p-birhanu",
      name: "Birhanu",
      weeklyAmount: 50_000,
      weeksCommitted: 20,
      weeksPaid: 16,
      outstanding: 200_000,
      drawnWeek: 3,
      receivedNet: 980_000,
      pendingNet: 0,
      totalPaid: 800_000,
    },
  ],
});

const FALLBACK = {
  cycleName: "2026 Equb",
  startDate: new Date("2026-05-17"),
  closedAt: new Date("2026-10-02"),
};

describe("a member's own row out of the frozen archive", () => {
  const alem = mine({ cycleId: "c1", raw: CLOSED, personId: "p-alem", fallback: FALLBACK });

  it("spells the dates out in full — a week number means nothing months later", () => {
    expect(alem.startLabel).toBe("May 17, 2026");
    // The last WEEK, not the day the organizer pressed close — those are five
    // days apart here, and the member remembers the week.
    expect(alem.finishLabel).toBe("September 27, 2026");
  });

  it("carries the figures the organizer's archive carries, to the cent", () => {
    expect(alem.totalPaid).toBe(1_000_000);
    expect(alem.receivedNet).toBe(980_000);
    expect(alem.drawnWeek).toBe(7);
    expect(alem.weeksPaid).toBe(20);
    expect(alem.outstanding).toBe(0);
  });

  it("tells someone who finished that they finished", () => {
    // A bare "$0" on a money screen reads as missing data.
    expect(alem.closing).toBe("$0 outstanding — complete.");
  });

  it("names the debt and where it came from when money is still owed", () => {
    const birhanu = mine({ cycleId: "c1", raw: CLOSED, personId: "p-birhanu", fallback: FALLBACK });
    expect(birhanu.outstanding).toBe(200_000);
    expect(birhanu.closing).toContain("$2,000 outstanding");
    expect(birhanu.closing).toContain("2026 Equb");
    // 2.18: the carried balance IS this money, not a second debt on top.
    expect(birhanu.closing).toContain("not a second debt");
  });

  it("returns ONLY the caller's row", () => {
    // The stored snapshot holds every member's figures. Handing the blob to a
    // client component would leak the whole group's money (2.8).
    const birhanu = mine({ cycleId: "c1", raw: CLOSED, personId: "p-birhanu", fallback: FALLBACK });
    expect(JSON.stringify(birhanu)).not.toContain("1000000");
    expect(JSON.stringify(alem)).not.toContain("800000");
  });

  it("says an uncollected payout out loud rather than calling the cycle clean", () => {
    const raw = JSON.parse(CLOSED);
    raw.members[0].pendingNet = 980_000;
    raw.members[0].receivedNet = 0;
    const p = mine({
      cycleId: "c1",
      raw: JSON.stringify(raw),
      personId: "p-alem",
      fallback: FALLBACK,
    });
    expect(p.closing).toContain("Complete — nothing owed");
    expect(p.closing).toContain("$9,800");
    expect(p.closing).toContain("not been handed over");
  });
});

describe("when the record cannot be read", () => {
  it("still lists the cycle rather than making it disappear", () => {
    // A missing entry looks like the record was lost. It was not.
    const broken = mine({
      cycleId: "c1",
      raw: "{ this is not json",
      personId: "p-alem",
      fallback: FALLBACK,
    });
    expect(broken.unreadable).toBe(true);
    expect(broken.cycleName).toBe("2026 Equb");
    expect(broken.startLabel).toBe("May 17, 2026");
    expect(broken.closing).toContain("could not be read");
    expect(broken.closing).toContain("figures still exist");
  });

  it("never shows zeroes as if they were the member's real figures", () => {
    const broken = mine({
      cycleId: "c1",
      raw: "{ this is not json",
      personId: "p-alem",
      fallback: FALLBACK,
    });
    // The numbers are zero, but `unreadable` is what the screen must branch on
    // — "$0 paid in" would be a lie about a member who paid for twenty weeks.
    expect(broken.unreadable).toBe(true);
  });

  it("handles a snapshot with no row for this person", () => {
    const stranger = mine({
      cycleId: "c1",
      raw: CLOSED,
      personId: "p-nobody",
      fallback: FALLBACK,
    });
    expect(stranger.unreadable).toBe(true);
    expect(stranger.startLabel).toBe("May 17, 2026");
  });

  it("survives a missing or unparseable date without crashing the page", () => {
    expect(fullDate(null)).toBeNull();
    expect(fullDate("not-a-date")).toBeNull();
    const noDates = mine({
      cycleId: "c1",
      raw: JSON.stringify({ cycleName: "Old", members: [] }),
      personId: "p-alem",
      fallback: { cycleName: "Old", startDate: null, closedAt: null },
    });
    expect(noDates.startLabel).toBe("date not recorded");
  });
});

describe("the home screen for someone not in the running cycle", () => {
  it("says nothing is due, because nothing is", () => {
    // The old behaviour rendered their LAST cycle's ring, week grid and "next
    // payment due" with no label, so a finished member read it as a live bill.
    const line = notInCurrentCycleLine(true);
    expect(line).toContain("finished cycle");
    expect(line).toContain("Nothing is due");
    expect(line).toContain("nothing here is a bill");
  });

  it("says something useful to someone with no history at all", () => {
    expect(notInCurrentCycleLine(false)).toContain("organizer adds you");
  });
});

describe("closingLine on its own", () => {
  it("puts the amount before the explanation", () => {
    const line = closingLine({ outstanding: 200_000, pendingNet: 0, cycleName: "X" });
    expect(line.indexOf("$2,000")).toBeLessThan(line.indexOf("outstanding —"));
  });

  it("formats cents exactly", () => {
    expect(closingLine({ outstanding: 250_037, pendingNet: 0, cycleName: "X" })).toContain(
      "$2,500.37",
    );
  });
});
