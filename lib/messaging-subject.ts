// WHAT A MEMBER'S STATEMENTS ARE ABOUT — resolved ONCE, from BOTH statuses.
//
// THE DEFECT THIS EXISTS FOR (2.18 / 2.20). app/actions/member-messaging.ts
// asked one question — "is there an ACTIVE participation inside an ACTIVE
// cycle?" — and then spent the single answer on two different facts:
//
//     cycleClosed:      active === null
//     participationId:  active?.id ?? null
//
// Those two lines are mutually exclusive BY CONSTRUCTION, so the closing
// statement could never leave a member's profile in EITHER state. While the
// cycle ran, `active` was non-null, `cycleClosed` was false, and applicableTypes
// refused with "the cycle is still running — the closing statement is sent when
// it ends". The moment it ended, `active` was null: `cycleClosed` became true
// and there was no participationId to send with, no standing to render a
// preview from, and the screen replaced the whole send card with "is not in the
// running cycle". 2.18 requires a closing statement for every member at cycle
// end, and the one surface that speaks to a single member could not produce one
// at any point in a cycle's life. The organizer was told to wait for a moment
// at which nothing could be sent.
//
// THE FIX IS NOT A SECOND QUESTION — it is one function that returns all three
// facts together, so they cannot contradict each other. The invariant it holds
// is the one that was missing: a participation id exists exactly when there is
// a position to state, and `cycleClosed` reports the CYCLE's own status (2.9)
// rather than being inferred from the absence of a participation.
//
// THE PRIORITY IS THE BATCH'S RULE, NOT A NEW ONE. app/actions/messages.ts
// prepares against the ACTIVE cycle and drops the ACTIVE-participation filter
// for CYCLE_CLOSING_STATEMENT alone — so a member who stopped early still
// receives the statement (2.18: closed members stay visible) and is still left
// out of the chasing (rule 17: stopped is not behind). The only state the
// profile ADDS is the one the batch has no path to at all — a cycle that has
// already been closed, whose rows survive until the clean delete (2.9). Without
// it the organizer could never send a statement to the one member he missed.

/**
 * The participation rows this needs — satisfied by a Prisma `select`.
 *
 * DRAFT cycles are deliberately not in the union: nothing has happened in one,
 * so there is no position to state. The caller filters them out in SQL.
 */
export type MessagingParticipationRow = {
  id: string;
  /** ParticipationStatus — ACTIVE while they are still contributing. */
  status: "ACTIVE" | "CLOSED";
  cycle: { status: "DRAFT" | "ACTIVE" | "CLOSED"; closedAt: Date | null };
};

/**
 * The three facts every messaging surface needs, derived together.
 *
 * `participation` is what applicableTypes reads, and it is NOT the same
 * question as `cycleClosed`:
 *  - "live"  — an ACTIVE participation inside the running cycle. Everything
 *              applies: the chasing types, the winner announcement, the
 *              closing statement.
 *  - "ended" — there is a participation, but it is over: they stopped early
 *              (rule 17) or the whole cycle has closed (2.9). Only the closing
 *              statement still has something true to say.
 *  - "none"  — no participation anywhere. Nothing can be stated at all.
 */
export type MessagingSubject = {
  /** The participation every send from this screen is about, or null. */
  participationId: string | null;
  participation: "live" | "ended" | "none";
  /** The CYCLE's own status. Never inferred from the participation. */
  cycleClosed: boolean;
};

/** Most recently closed first; a cycle with no closedAt sorts last. */
function byMostRecentlyClosed(
  a: MessagingParticipationRow,
  b: MessagingParticipationRow,
): number {
  return (b.cycle.closedAt?.getTime() ?? 0) - (a.cycle.closedAt?.getTime() ?? 0);
}

/**
 * Which participation a member's statements are about, right now.
 *
 * THE INVARIANT, which is the whole point of this function:
 * `participationId === null` if and only if `participation === "none"`. The
 * defect was exactly the state that violates it — a screen saying a closing
 * statement applied while holding no id to send it with — and there is now no
 * way to construct that, because both come out of the same `return`.
 */
export function messagingSubject(
  rows: readonly MessagingParticipationRow[],
): MessagingSubject {
  // The running cycle first: "where does this member stand" means today.
  const live = rows.find((r) => r.cycle.status === "ACTIVE" && r.status === "ACTIVE");
  if (live) {
    return { participationId: live.id, participation: "live", cycleClosed: false };
  }

  // Stopped early, cycle still running (2.18). The batch sends this member the
  // closing statement and nothing else; so does the profile.
  const stopped = rows.find((r) => r.cycle.status === "ACTIVE");
  if (stopped) {
    return { participationId: stopped.id, participation: "ended", cycleClosed: false };
  }

  // The cycle itself has ended. Its rows are still here until the clean delete
  // (2.9), which is what makes a per-member closing statement possible after
  // the flip — the state the batch cannot reach, because it starts by looking
  // for an ACTIVE cycle and gives up.
  const closed = rows.filter((r) => r.cycle.status === "CLOSED").sort(byMostRecentlyClosed)[0];
  if (closed) {
    return { participationId: closed.id, participation: "ended", cycleClosed: true };
  }

  // Nothing at all: a person in the directory who has never joined a cycle, or
  // one whose only cycle has been deleted (2.9). `cycleClosed` is false because
  // there is no cycle to report the status of — and it is unread in this state,
  // since "none" refuses every type before any of them look at it.
  return { participationId: null, participation: "none", cycleClosed: false };
}
