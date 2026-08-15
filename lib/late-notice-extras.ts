// WHAT LATE_NOTICE_V4 NEEDS, LOADED — the analogue of lib/winner-extras.ts.
//
// A TEMPLATE THAT CANNOT BE COMPOSED IS A TRAP. `stillDueOnWeek` is a required
// extra, and a required extra nobody supplies is refused at the boundary and
// written as a FAILED row on a real member's log. The winner announcement
// taught this the expensive way: the per-member path called sendStatement with
// no extras at all, and a member received "your payout is —".
//
// BOTH MANUAL PATHS CALL THIS ONE FUNCTION. The per-member send and the batch
// each need the figure, and a helper only one of them used is exactly how the
// two came to disagree last time.

import { lateNoticeExtras } from "./payment-message";
import { loadStandingFacts } from "./messaging-engine";
import type { MessageExtras } from "./messages";

/**
 * The chased week's remainder as a sentence, or null when nothing is chaseable.
 *
 * Null is a real answer, not a failure: the send gate refuses the notice for the
 * same reason, so the caller passing undefined lets that refusal happen with its
 * own honest wording rather than a composition error.
 */
export async function lateNoticeExtrasForParticipation(
  participationId: string,
): Promise<MessageExtras | null> {
  const loaded = await loadStandingFacts(participationId);
  if (!loaded) return null;
  return lateNoticeExtras({
    weeks: loaded.standing.weeks,
    startWeek: loaded.participation.startWeek,
  });
}
