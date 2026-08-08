import { redirect } from "next/navigation";

// MOVED — docs/ADMIN_IA.md §4.2.
//
// `received`, `paid-out` and `held` were three lists of the same ledger seen
// from three angles, each reachable only by clicking a dashboard stat card and
// none of them answering the question 2.1 names: what is the group holding,
// over time. They are now three tabs of /admin/cash, under one chart.
//
// This redirect stays permanently rather than the route being deleted: the
// organizer has these URLs in his history and his bookmarks, and a 404 for a
// money screen he has used for months is not an acceptable way to move it.
export default function PaidOutRedirect() {
  redirect("/admin/cash?view=paid-out");
}
