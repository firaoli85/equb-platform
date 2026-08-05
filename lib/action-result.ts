// Every mutating server action returns this shape instead of throwing, so the
// UI can always show an unmistakable success or a visible reason for failure
// (ground truth 2.10).
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** A human-readable reason from an unknown thrown value. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}
