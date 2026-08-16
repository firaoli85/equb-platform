// KEEPING THE DATABASE AWAKE.
//
// Supabase pauses a free-tier project after ~7 days without activity. This
// group's traffic is bursty by nature — between cycles, and through slow
// weeks, nobody opens the app at all. The next person to arrive then meets a
// cold wake or an outright error, and the first thing they were doing was
// looking at their own money.
//
// So once a day this route touches the database. That is the whole feature.
//
// IT MUST ACTUALLY REACH POSTGRES. A route that returns a static string keeps
// nothing awake — Supabase counts database activity, not HTTP traffic. The
// query below is a real round trip over a real connection, which is the only
// thing that counts.
//
// `SELECT 1` RATHER THAN A COUNT. It is the lightest query there is — no
// table, no index, no rows — and, because it reads nothing, its answer cannot
// be changed by whichever role `DATABASE_URL` resolves to or by any RLS policy
// on any table. A `count()` on a member table would be the opposite: it reads
// real data, and under a restrictive policy it returns 0 whether the rows are
// there or not, which is a liveness check whose result means nothing.
//
// READ-ONLY, AND DELIBERATELY BORING. No writes, no transaction, no money
// table, no member table, nothing about a person in the response. It cannot
// change anything, and there is nothing in it to leak.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Route handlers are uncached by default in Next 16, so this is belt and
// braces rather than load-bearing — but a keep-alive that got cached would
// fail silently and invisibly, returning 200 forever while the database slept.
// Cheap insurance against exactly the failure this route exists to prevent.
export const dynamic = "force-dynamic";

/**
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when that variable is set
 * on the project. Enforced when present, skipped when not.
 *
 * WHY NOT MANDATORY. The endpoint runs one `SELECT 1` and returns no data, so
 * an unauthorised call achieves nothing an attacker could want. What it does
 * cost is a connection from the same small free-tier pool the app uses, so a
 * flood could crowd out real requests — which is a reason to set the secret,
 * not a reason to make the route fail closed before anyone has set one. A
 * keep-alive that 401s because a variable is missing is a keep-alive that
 * silently stops keeping anything alive.
 */
function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    // One round trip. `$queryRaw` with a template literal is parameterised by
    // Prisma, and this one carries no parameters at all.
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: "awake" });
  } catch (e) {
    // A failure here is worth surfacing rather than swallowing: if the ping
    // cannot reach Postgres, the thing this route exists to prevent is either
    // already happening or about to.
    console.error("keep-alive: database unreachable", e);
    return NextResponse.json({ ok: false, database: "unreachable" }, { status: 503 });
  }
}
