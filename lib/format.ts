// Display and parsing helpers for the UI edge. Money stays in integer cents
// everywhere else (ground truth 2.14); these convert only at the boundary.

/** "$1,250" for whole dollars, "$1,250.50" otherwise. */
export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const base =
    rem === 0
      ? `$${dollars.toLocaleString("en-US")}`
      : `$${dollars.toLocaleString("en-US")}.${String(rem).padStart(2, "0")}`;
  return negative ? `-${base}` : base;
}

/**
 * Parse a dollars input ("1250", "$1,250", "1,250.50") to integer cents.
 * Returns null when the input is not a valid money amount. The format is
 * validated BEFORE separators are stripped, so commas are accepted only in
 * legal thousands positions — a decimal-comma slip like "1250,50" is
 * rejected instead of silently parsing as 100x the amount. Integer math
 * only — no floating point on money.
 */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const cleaned = trimmed.replace(/[$,]/g, "");
  const [dollarPart, centPart = ""] = cleaned.split(".");
  const cents = Number(dollarPart) * 100 + Number(centPart.padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "May 17, 2026" — rendered on the UTC calendar day, matching week math. */
export function formatDateUTC(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Parse an <input type="date"> value ("2026-05-17") to a UTC-midnight Date. */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // JS rolls impossible dates over (2026-02-30 becomes March 2) — reject
  // anything that does not round-trip to the exact day that was typed.
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  ) {
    return null;
  }
  return date;
}
