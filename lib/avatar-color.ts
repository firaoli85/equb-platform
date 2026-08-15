// INITIAL AVATARS — the initials, and the colour that identifies them.
//
// Pure, so the two things that actually matter can be TESTED rather than
// eyeballed: the same person is the same colour on every screen, and the
// initials are always legible on the colour behind them.
//
// LATIN ONLY (§Latin-primary ruling, 14 Aug 2026). Initials and hue both
// come from `personDisplayName`, never from the Amharic field — a member
// whose Amharic name is blank must not change colour or lose their letters,
// and two people must not share a colour because their Amharic happens to
// match.

/**
 * "Firaoli Seboka" → "FS"; "Henok" → "H"; "" → "?".
 *
 * FIRST AND LAST WORD, not first-two: "Meheret Abebe Tadesse" reads as MT,
 * which is how a person writes their own initials. Unicode-aware via the
 * spread, so a non-ASCII Latin letter is one character, not one byte.
 */
export function nameInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * A stable hue, 0–359, from the display name.
 *
 * THE SHIFT MATTERS. A plain character sum collides on every anagram — "Abel
 * Tona" and "Tona Abel" would be the same colour, and so would far less
 * obvious pairs. `(h << 5) - h + c` is the classic string hash: position
 * changes the contribution, so anagrams separate.
 *
 * `|0` keeps it in 32-bit space; the modulo is taken on the absolute value so
 * a negative hash cannot produce a negative hue.
 */
export function nameHue(displayName: string): number {
  let hash = 0;
  for (const ch of displayName.trim()) {
    hash = ((hash << 5) - hash + ch.codePointAt(0)!) | 0;
  }
  return Math.abs(hash) % 360;
}

// ————————————————— The colour, and why it is not a constant lightness —————
//
// THE BRIEF SAID hsl(hue, 68%, 60%) WITH NEAR-BLACK TEXT ABOVE 65% LIGHTNESS.
// That cannot meet the brief's own contrast requirement, and the numbers say
// so plainly: HSL lightness is not perceived brightness. hsl(60, 68%, 60%) is
// yellow and blindingly bright; hsl(240, 68%, 60%) is blue and quite dark —
// same L, wildly different luminance. Sweeping all 360 hues at L=60%:
//
//   white text only .................. worst 1.43:1   (fails badly)
//   best of white / #0a0a0a .......... worst 4.45:1   (fails AA)
//   best of white / pure #000000 ..... worst 4.58:1   (passes by 0.08)
//
// Every fixed lightness behaves the same way, because some hue always lands
// on the crossover where neither text colour is comfortable.
//
// So the LIGHTNESS IS SOLVED PER HUE instead: each hue is given whatever
// lightness puts it at one fixed perceived luminance. Yellows come out around
// 26% lightness, blues around 62% — and every one of them carries white text
// at 5.25:1 or better. The avatars also stop looking like some members shout
// and others whisper, which is the same fix seen from the design side.

/** WCAG relative luminance of an HSL triple. Exported for the guard test. */
export function hslLuminance(h: number, s: number, l: number): number {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(f(0)) + 0.7152 * channel(f(8)) + 0.0722 * channel(f(4));
}

/** WCAG contrast ratio between two relative luminances. */
export function contrastRatio(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

export const AVATAR_SATURATION = 68;
/**
 * The luminance every avatar is pinned to. 0.15 puts white text at 5.25:1 at
 * its worst — AA is 4.5, and the margin is what stops a later tweak to the
 * saturation quietly pushing a hue under.
 */
const TARGET_LUMINANCE = 0.15;
/** Dark mode sits lower, so the disc does not glow on a near-black page. */
const TARGET_LUMINANCE_DARK = 0.11;

/** The lightness that puts this hue at a given luminance. Bisection: the
 *  relationship is monotonic in l, and 24 steps is well past float precision. */
function lightnessForLuminance(hue: number, target: number): number {
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (hslLuminance(hue, AVATAR_SATURATION, mid) > target) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** 360 hues × 2 modes, solved once at module load — the render path only reads. */
const LIGHT_BY_HUE: number[] = [];
const DARK_BY_HUE: number[] = [];
for (let h = 0; h < 360; h++) {
  LIGHT_BY_HUE.push(lightnessForLuminance(h, TARGET_LUMINANCE));
  DARK_BY_HUE.push(lightnessForLuminance(h, TARGET_LUMINANCE_DARK));
}

/** The solved lightness for a hue — exported so the guard test sweeps the
 *  REAL curve rather than a second copy of the bisection (lesson 5.6). */
export function avatarLightness(hue: number, mode: "light" | "dark" = "light"): number {
  const table = mode === "dark" ? DARK_BY_HUE : LIGHT_BY_HUE;
  return table[((hue % 360) + 360) % 360];
}

export type AvatarPaint = {
  hue: number;
  /** Base lightness, light mode. The gradient runs from here to `lightEnd`. */
  light: number;
  lightEnd: number;
  dark: number;
  darkEnd: number;
};

/** Everything the element needs, as numbers — the CSS lives in globals.css. */
export function avatarPaint(displayName: string): AvatarPaint {
  const hue = nameHue(displayName);
  const light = LIGHT_BY_HUE[hue];
  const dark = DARK_BY_HUE[hue];
  return {
    hue,
    light,
    // The 135° gradient the brief asked for, as a relative step so it reads
    // the same on a hue solved to 26% as on one solved to 62%.
    lightEnd: Math.max(0, light - 9),
    dark,
    darkEnd: Math.max(0, dark - 7),
  };
}

/**
 * The text colour that clears AA on a given avatar lightness.
 *
 * White in every case the normalisation produces — but computed, not assumed,
 * so the guard test is testing the real decision rather than a constant.
 */
export function avatarTextIsWhite(hue: number, lightness: number): boolean {
  const bg = hslLuminance(hue, AVATAR_SATURATION, lightness);
  const white = contrastRatio(bg, 1);
  const black = contrastRatio(bg, 0);
  return white >= black;
}
