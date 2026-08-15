import { avatarPaint, nameInitials } from "@/lib/avatar-color";

// THE MEMBER'S DISC — initials on a colour that is theirs everywhere.
//
// COLOUR IS AN AID, NEVER THE IDENTIFIER. The disc is `aria-hidden`, and every
// caller renders the name as text beside it. Someone who cannot see the colour
// loses nothing; someone scanning a list of twenty-seven finds their row
// faster. That is the whole job.
//
// The colour is solved per hue for one fixed perceived luminance, so no member
// shouts and none whispers, and white initials clear WCAG AA on every hue at
// 5.25:1 or better (lib/avatar-color.ts explains why a constant lightness
// cannot). The hue itself rides in a CSS variable because dark mode is a
// class on <html> — an inline style cannot answer `.dark`, so the two paints
// live together in globals.css under `.initial-avatar`.

const SIZES = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-xl",
} as const;

export function InitialAvatar({
  /** The LATIN display name — personDisplayName(person), never the Amharic. */
  name,
  size = "md",
  className = "",
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const paint = avatarPaint(name);
  return (
    <span
      aria-hidden="true"
      className={`initial-avatar ${SIZES[size]} ${className}`}
      style={
        {
          "--avatar-h": paint.hue,
          "--avatar-l": `${paint.light}%`,
          "--avatar-l-end": `${paint.lightEnd}%`,
          "--avatar-l-dark": `${paint.dark}%`,
          "--avatar-l-dark-end": `${paint.darkEnd}%`,
        } as React.CSSProperties
      }
    >
      {nameInitials(name)}
    </span>
  );
}
