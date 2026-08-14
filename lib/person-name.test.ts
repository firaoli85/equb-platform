import { describe, expect, it } from "vitest";
import { byPersonName, personDisplayName, personSecondaryName, personSortKey } from "./person-name";

// LATIN PRIMARY, AMHARIC SECONDARY (14 Aug 2026). The module is the single
// owner of the order; these pin the two ordered behaviours: sorting is
// Latin-alphabetical, and a member with no Amharic name renders cleanly.

describe("primary display is the Latin name", () => {
  it("first + last when both exist", () => {
    expect(
      personDisplayName({ nameEnglishFirst: "Firaoli", nameEnglishLast: "Seboka" }),
    ).toBe("Firaoli Seboka");
  });

  it("first alone when last is absent", () => {
    expect(personDisplayName({ nameEnglishFirst: "Henok", nameEnglishLast: null })).toBe("Henok");
    expect(personDisplayName({ nameEnglishFirst: "Henok" })).toBe("Henok");
  });
});

describe("the Amharic name is secondary, and absent means NOTHING renders", () => {
  it("returns the Amharic name when present", () => {
    expect(
      personSecondaryName({ nameEnglishFirst: "Henok", nameAmharic: "ሄኖክ" }),
    ).toBe("ሄኖክ");
  });

  it("returns null — not an empty string — when absent, empty, or whitespace", () => {
    // Null is the contract: a caller renders nothing on null, while an empty
    // string would produce an empty styled span and stray separators.
    expect(personSecondaryName({ nameEnglishFirst: "Henok", nameAmharic: null })).toBeNull();
    expect(personSecondaryName({ nameEnglishFirst: "Henok", nameAmharic: "" })).toBeNull();
    expect(personSecondaryName({ nameEnglishFirst: "Henok", nameAmharic: "   " })).toBeNull();
    expect(personSecondaryName({ nameEnglishFirst: "Henok" })).toBeNull();
  });
});

describe("alphabetical means the LATIN alphabet order", () => {
  const people = [
    { nameEnglishFirst: "Meheret", nameAmharic: "ምህረት" },
    { nameEnglishFirst: "abel", nameAmharic: "አቤል" }, // lower-case on purpose
    { nameEnglishFirst: "Henok", nameAmharic: "" },
    { nameEnglishFirst: "Tizita", nameAmharic: "ትዝታ" },
  ];

  it("sorts case-insensitively on the Latin name, never the Amharic", () => {
    const sorted = [...people].sort(byPersonName).map((p) => p.nameEnglishFirst);
    expect(sorted).toEqual(["abel", "Henok", "Meheret", "Tizita"]);
  });

  it("ties on first name break on last name", () => {
    const a = { nameEnglishFirst: "Sara", nameEnglishLast: "Abebe" };
    const b = { nameEnglishFirst: "Sara", nameEnglishLast: "Bekele" };
    expect(byPersonName(a, b)).toBeLessThan(0);
    expect(personSortKey(a)).toBe("sara abebe");
  });
});
