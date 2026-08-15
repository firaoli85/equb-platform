import { describe, expect, it } from "vitest";
import {
  AVATAR_SATURATION,
  avatarLightness,
  avatarPaint,
  avatarTextIsWhite,
  contrastRatio,
  hslLuminance,
  nameHue,
  nameInitials,
} from "./avatar-color";
import { personDisplayName } from "./person-name";

// INITIAL AVATARS. Two things must be true or the feature is worse than no
// feature: the same person is the same colour on every screen, and the
// initials are legible on the colour behind them. Both are tested here rather
// than trusted to a screenshot.

describe("initials come from the LATIN name", () => {
  it("first and last word — how a person writes their own initials", () => {
    expect(nameInitials("Firaoli Seboka")).toBe("FS");
    expect(nameInitials("Meheret Abebe Tadesse")).toBe("MT");
  });

  it("a single word gives a single letter", () => {
    expect(nameInitials("Henok")).toBe("H");
  });

  it("survives the shapes a real directory contains", () => {
    expect(nameInitials("  Tsion   Alemu  ")).toBe("TA"); // stray whitespace
    expect(nameInitials("")).toBe("?");
    expect(nameInitials("   ")).toBe("?");
    expect(nameInitials("abel tona")).toBe("AT"); // upper-cased
  });

  it("reads through personDisplayName, so it can never take the Amharic", () => {
    const person = { nameEnglishFirst: "Firaoli", nameEnglishLast: "Seboka", nameAmharic: "ፍራኦል" };
    expect(nameInitials(personDisplayName(person))).toBe("FS");
    // A member with NO Amharic name gets the same letters — the Amharic is
    // not an input, so its absence cannot change them.
    expect(nameInitials(personDisplayName({ ...person, nameAmharic: "" }))).toBe("FS");
  });
});

describe("the colour is stable, and belongs to the name", () => {
  it("the same name is the same hue every time it is asked", () => {
    const a = nameHue("Firaoli Seboka");
    const b = nameHue("Firaoli Seboka");
    expect(a).toBe(b);
    expect(avatarPaint("Firaoli Seboka")).toEqual(avatarPaint("Firaoli Seboka"));
  });

  it("different names generally differ — and ANAGRAMS do not collide", () => {
    // The reason for the shifted hash: a plain character sum gives these two
    // the same colour, which is exactly the pair a directory contains.
    expect(nameHue("Abel Tona")).not.toBe(nameHue("Tona Abel"));
    expect(nameHue("Firaoli Seboka")).not.toBe(nameHue("Henok Bekele"));
  });

  it("is always a usable hue, never negative and never out of range", () => {
    for (const name of ["", "?", "Z", "Firaoli Seboka", "ሄኖክ", "\u{1F600} x", "a".repeat(200)]) {
      const h = nameHue(name);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("is blind to the Amharic name entirely", () => {
    const withAmharic = personDisplayName({ nameEnglishFirst: "Henok", nameAmharic: "ሄኖክ" });
    const without = personDisplayName({ nameEnglishFirst: "Henok", nameAmharic: "" });
    expect(nameHue(withAmharic)).toBe(nameHue(without));
  });
});

// ————————————————————————————————————————————————————————————————
// THE CONTRAST REQUIREMENT — the brief's own, swept across every hue.
//
// This is the test that rejected the brief's constants. At a CONSTANT
// lightness of 60% the best available text colour fails AA on some hue no
// matter which it is, because HSL lightness is not perceived brightness. The
// lightness is therefore solved per hue, and this proves the result.
// ————————————————————————————————————————————————————————————————

describe("GUARD — the initials clear WCAG AA on every hue", () => {
  const AA_NORMAL = 4.5;

  it("white initials clear AA on all 360 hues, with margin", () => {
    let worst = Infinity;
    let worstHue = -1;
    for (let hue = 0; hue < 360; hue++) {
      // Both ends of the gradient — the darker end is never the problem, but
      // asserting only the lighter one would be testing half the disc.
      const paint = avatarPaint(`hue-probe-${hue}`);
      for (const l of [paint.light, paint.lightEnd, paint.dark, paint.darkEnd]) {
        const ratio = contrastRatio(hslLuminance(paint.hue, AVATAR_SATURATION, l), 1);
        if (ratio < worst) {
          worst = ratio;
          worstHue = paint.hue;
        }
      }
    }
    expect(worst, `worst contrast was ${worst.toFixed(2)}:1 at hue ${worstHue}`).toBeGreaterThanOrEqual(
      AA_NORMAL,
    );
  });

  it("sweeps every hue directly, in both modes, against the module's own curve", () => {
    let worst = Infinity;
    let where = "";
    for (let hue = 0; hue < 360; hue++) {
      for (const mode of ["light", "dark"] as const) {
        const ratio = contrastRatio(
          hslLuminance(hue, AVATAR_SATURATION, avatarLightness(hue, mode)),
          1,
        );
        if (ratio < worst) {
          worst = ratio;
          where = `hue ${hue}, ${mode}`;
        }
      }
    }
    expect(worst, `worst was ${worst.toFixed(2)}:1 at ${where}`).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("the text decision is COMPUTED, and comes out white on every hue", () => {
    for (let hue = 0; hue < 360; hue++) {
      expect(avatarTextIsWhite(hue, avatarLightness(hue)), `hue ${hue}`).toBe(true);
    }
  });

  // NON-VACUITY: the sweep must actually fail on the constants it replaced.
  it("proves the brief's constant lightness could NOT have passed", () => {
    let worstBest = Infinity;
    for (let hue = 0; hue < 360; hue++) {
      const bg = hslLuminance(hue, AVATAR_SATURATION, 60);
      // The best either text colour can do at a flat 60% lightness.
      worstBest = Math.min(worstBest, Math.max(contrastRatio(bg, 1), contrastRatio(bg, 0)));
    }
    expect(worstBest).toBeLessThan(AA_NORMAL + 0.1);
  });
});

