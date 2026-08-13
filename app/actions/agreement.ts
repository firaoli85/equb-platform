"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { errorMessage } from "@/lib/action-result";
import {
  AGREEMENT_V1_BODY,
  agreementClauses,
  agreementHash,
  agreementRequirement,
  renderAgreement,
  requirementReason,
  unknownAgreementTokens,
  type AgreementClause,
  type AgreementRequirement,
  type AgreementTerms,
} from "@/lib/agreement";
import { logAudit } from "@/lib/audit";
import { getCurrentUser, requireAdmin } from "@/lib/auth";
import { calculateFinishWeek } from "@/lib/money";
import { resolveWeekDate, storedWeekDates } from "@/lib/commitment";
import { feePreview } from "@/lib/fee-preview";
import { approximateLocation, describeDevice } from "@/lib/device";
import { callerIp } from "@/lib/lookup-throttle";
import { prisma } from "@/lib/prisma";

// SIGNING THE AGREEMENT — the one hard gate in front of the member portal.
//
// SENDING THE WELCOME IS WHAT REQUIRES A SIGNATURE (organizer ruling). This
// file never decides who must sign on its own: it reads
// `Participation.agreementRequiredAt`, which only the welcome send writes. The
// 27 members already mid-cycle have null there and are therefore not gated,
// with no exemption list and no date comparison anywhere.
//
// THE DOCUMENT IS ALWAYS LIVE. Terms are read fresh every time it is shown, so
// changing someone from 10 weeks to 12 changes their agreement. A second
// welcome sets a later `agreementRequiredAt`, their old signature stops
// answering it, and they sign the current terms. There is no re-sign flow
// because a new send IS the new requirement.

/** The wording in force. Seeds version 1 the first time anyone needs it. */
async function currentVersion() {
  const latest = await prisma.agreementVersion.findFirst({ orderBy: { version: "desc" } });
  if (latest) return latest;
  // FIRST RUN. The default body ships in lib/agreement.ts; this is the moment
  // it becomes an editable record (2.6) rather than a constant.
  return prisma.agreementVersion.create({
    data: { version: 1, body: AGREEMENT_V1_BODY, note: "The first version." },
  });
}

/**
 * ONE MEMBER'S TERMS, from the same functions the portal uses.
 *
 * Every figure is derived here rather than stored on the agreement, so the
 * document cannot disagree with what the member is shown later — and so that
 * changing their terms changes their agreement, which is the ruling.
 */
async function termsFor(participationId: string): Promise<AgreementTerms | null> {
  const participation = await prisma.participation.findUnique({
    where: { id: participationId },
    include: {
      person: true,
      cycle: { include: { weeks: { orderBy: { weekNumber: "asc" } } } },
    },
  });
  if (!participation) return null;

  const { cycle } = participation;
  const stored = storedWeekDates(cycle.weeks);
  const finishWeek = calculateFinishWeek(participation.startWeek, participation.weeksCommitted);
  const lastWeek = cycle.weeks[cycle.weeks.length - 1];

  // The SAME preview the fee calculator and the profile use, so the agreement
  // cannot quote a gross, fee or net that differs from theirs by a cent.
  const preview = feePreview({
    weeklyAmount: participation.weeklyAmount,
    weeksCommitted: participation.weeksCommitted,
    unitAmount: cycle.unitAmount,
    feePercent: cycle.feePercent,
  });
  if (!preview) return null;

  // The stored week row wins over any projection (rule 7). A null here means
  // the cycle has no row for that week AND no readable start date — the
  // document cannot state a date it does not have, so it refuses to render at
  // all rather than printing a guess into something somebody signs.
  const startDate = resolveWeekDate({
    weekNumber: participation.startWeek,
    stored,
    cycleStartDate: cycle.startDate,
  });
  const finishDate = resolveWeekDate({
    weekNumber: finishWeek,
    stored,
    cycleStartDate: cycle.startDate,
  });
  const cycleEndDate =
    lastWeek?.date ??
    resolveWeekDate({
      weekNumber: cycle.plannedWeeks,
      stored,
      cycleStartDate: cycle.startDate,
    })?.date ??
    null;
  if (!startDate || !finishDate || !cycleEndDate) return null;

  const organizerName = (await prisma.person.findFirst({
    where: { authUserId: { not: null } },
    select: { nameEnglishFirst: true },
    orderBy: { createdAt: "asc" },
  }))?.nameEnglishFirst;

  return {
    memberName: `${participation.person.nameEnglishFirst} ${participation.person.nameEnglishLast ?? ""}`.trim(),
    // Falls back to the name the messages already use rather than "the
    // organizer" — a document should name a person.
    organizerName: organizerName ?? "Firaoli",
    cycleName: cycle.name,
    weeklyAmount: participation.weeklyAmount,
    weeksCommitted: participation.weeksCommitted,
    startDate: startDate.date,
    finishDate: finishDate.date,
    // The equb's own end — the day a return is settled, which for a member
    // who commits to part of a cycle is NOT their finish date.
    cycleEndDate,
    totalContribution: participation.weeklyAmount * participation.weeksCommitted,
    payoutGross: preview.gross,
    feeAmount: preview.fee,
    payoutNet: preview.net,
    feePercent: cycle.feePercent,
  };
}

export type AgreementToSign = {
  participationId: string;
  version: number;
  clauses: AgreementClause[];
  /** The exact text the hash is taken over — echoed back on signing. */
  documentText: string;
  documentHash: string;
  memberFirstName: string;
  /** Their terms in one sentence, for the welcome line above the document. */
  welcome: string;
  /**
   * Which route required this, and the sentence that goes with it. A member
   * gated for having paid nothing was never sent a message, and telling them
   * to check one would send them looking for something that does not exist.
   */
  requirement: AgreementRequirement;
  requirementReason: string;
};

/**
 * The agreement THIS member has to sign, or null when they owe none.
 *
 * Null is the ordinary answer for most members: it means no welcome was sent.
 */
export async function getMyAgreement(): Promise<
  { ok: true; data: AgreementToSign | null } | { ok: false; error: string }
> {
  try {
    const claims = await getCurrentUser();
    if (!claims) return { ok: false as const, error: "Not signed in." };

    const person = await prisma.person.findFirst({
      where: { authUserId: claims.sub },
      select: { id: true, nameEnglishFirst: true },
    });
    if (!person) return { ok: true as const, data: null };

    // EVERY PARTICIPATION, NOT ONLY THE ASKED ONES.
    //
    // The `agreementRequiredAt: { not: null }` filter that used to be here was
    // the whole gate: a member the welcome had never reached could not be
    // returned by this query, so no rule downstream could gate them however it
    // was written. The second route (nothing ever paid) is about members in
    // exactly that state, so the row has to arrive here first.
    //
    // Bounded by the domain rather than by a take(): one row per cycle this
    // person has ever been in, and cycles are a handful, ever — the same
    // exemption app/actions/member-history.ts carries in
    // lib/bounded-queries.test.ts.
    //
    // `payments` is narrowed to money IN THE DATABASE rather than counted in
    // memory: `_count` on a filtered relation is the cheapest honest answer to
    // "has anything ever landed here", and it reads the same column every
    // money derivation reads (2.14), so the gate cannot disagree with the
    // portal it is standing in front of.
    const participations = await prisma.participation.findMany({
      where: { personId: person.id, cycle: { status: { in: ["ACTIVE", "CLOSED"] } } },
      orderBy: [{ agreementRequiredAt: "asc" }, { id: "asc" }],
      include: {
        signatures: { orderBy: { signedAt: "desc" }, take: 1 },
        cycle: { select: { status: true } },
        _count: { select: { payments: { where: { amountPaid: { gt: 0 } } } } },
      },
    });

    // Oldest requirement first — someone in two cycles signs one at a time
    // rather than being shown a pile. `findMany`'s ordering puts the asked
    // ones first (nulls last in Postgres ASC), so a welcome that was actually
    // sent is answered before a no-payment requirement the member may not
    // even know about.
    let owing: (typeof participations)[number] | undefined;
    let requirement: AgreementRequirement | undefined;
    for (const p of participations) {
      const found = agreementRequirement({
        requiredAt: p.agreementRequiredAt,
        lastSignedAt: p.signatures[0]?.signedAt ?? null,
        hasEverPaid: p._count.payments > 0,
        participationLive: p.status === "ACTIVE",
        cycleOpen: p.cycle.status === "ACTIVE",
      });
      if (found) {
        owing = p;
        requirement = found;
        break;
      }
    }
    if (!owing || !requirement) return { ok: true as const, data: null };

    const terms = await termsFor(owing.id);
    if (!terms) {
      return {
        ok: false as const,
        error: "Your terms are not complete yet, so your agreement cannot be prepared. Contact Firaoli.",
      };
    }

    const version = await currentVersion();
    const documentText = renderAgreement(version.body, terms);

    return {
      ok: true as const,
      data: {
        participationId: owing.id,
        version: version.version,
        clauses: agreementClauses(documentText),
        documentText,
        documentHash: agreementHash(documentText),
        memberFirstName: person.nameEnglishFirst,
        requirement,
        requirementReason: requirementReason(requirement),
        welcome:
          `You are saving ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(terms.weeklyAmount / 100)} ` +
          `a week for ${terms.weeksCommitted} ${terms.weeksCommitted === 1 ? "week" : "weeks"}, ` +
          `from ${terms.startDate.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" })} ` +
          `to ${terms.finishDate.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric" })}.`,
      },
    };
  } catch (e) {
    console.error("getMyAgreement failed:", e);
    return { ok: false as const, error: `Could not load your agreement. ${errorMessage(e)}` };
  }
}

/**
 * Sign it.
 *
 * THE DOCUMENT IS RE-RENDERED AND RE-HASHED HERE. The client sends the hash it
 * displayed, and this compares it to what the server computes from live terms:
 * if they differ, the terms changed between the screen loading and the button
 * being pressed, and the member would otherwise sign something they never saw.
 * That is refused, not reconciled.
 *
 * Unlike `recordSignIn`, this must NOT swallow its errors. A sign-in that
 * fails to record still lets someone in; a signature that fails to record and
 * reports success would open the portal with no evidence behind it.
 */
export async function signMyAgreement(input: {
  participationId: string;
  /** The hash the member's screen displayed — proof of what they read. */
  documentHash: string;
  /** From the browser: honest, and the only three it can give. */
  screen?: string;
  timezone?: string;
}) {
  try {
    const claims = await getCurrentUser();
    if (!claims) return { ok: false as const, error: "Not signed in." };

    const person = await prisma.person.findFirst({
      where: { authUserId: claims.sub },
      select: { id: true, nameEnglishFirst: true },
    });
    if (!person) return { ok: false as const, error: "No member record found for this account." };

    const participation = await prisma.participation.findUnique({
      where: { id: input.participationId },
      select: { id: true, personId: true, agreementRequiredAt: true },
    });
    if (!participation || participation.personId !== person.id) {
      return { ok: false as const, error: "That agreement is not yours." };
    }
    if (participation.agreementRequiredAt === null) {
      return { ok: false as const, error: "There is nothing to sign." };
    }

    const terms = await termsFor(participation.id);
    if (!terms) {
      return { ok: false as const, error: "Your terms are not complete, so nothing can be signed." };
    }
    const version = await currentVersion();
    const documentText = renderAgreement(version.body, terms);
    const documentHash = agreementHash(documentText);

    if (documentHash !== input.documentHash) {
      return {
        ok: false as const,
        error:
          "Your terms changed while this page was open, so this is no longer the agreement you " +
          "were reading. Reload the page to see the current one.",
      };
    }

    const header = await headers();
    const device = describeDevice({
      userAgent: header.get("user-agent") ?? "",
      chUa: header.get("sec-ch-ua"),
      chPlatform: header.get("sec-ch-ua-platform"),
      chMobile: header.get("sec-ch-ua-mobile"),
    });

    const signature = await prisma.$transaction(async (tx) => {
      const created = await tx.agreementSignature.create({
        data: {
          participationId: participation.id,
          personId: person.id,
          agreementVersionId: version.id,
          documentHash,
          documentText,
          ip: callerIp(header),
          userAgent: header.get("user-agent") ?? "",
          browser: device.browser,
          os: device.os,
          deviceType: device.deviceType,
          // Trimmed to something a column can hold and a person can read; a
          // hostile client cannot make this a paragraph.
          screen: input.screen?.slice(0, 32) || null,
          timezone: input.timezone?.slice(0, 64) || null,
          location: approximateLocation({
            city: header.get("x-vercel-ip-city"),
            region: header.get("x-vercel-ip-country-region"),
            country: header.get("x-vercel-ip-country"),
          }),
        },
      });
      await logAudit(tx, {
        entity: "AgreementSignature",
        entityId: created.id,
        action: "create",
        summary:
          `${person.nameEnglishFirst} signed the member agreement (version ${version.version}) ` +
          `from ${device.browser} on ${device.os}`,
        after: {
          version: version.version,
          documentHash,
          signedAt: created.signedAt.toISOString(),
          ip: created.ip,
        },
      });
      return created;
    });

    revalidatePath("/me");
    revalidatePath("/admin/people");
    return { ok: true as const, data: { signedAt: signature.signedAt.toISOString() } };
  } catch (e) {
    console.error("signMyAgreement failed:", e);
    return { ok: false as const, error: `Your signature was NOT recorded. ${errorMessage(e)}` };
  }
}

export type MemberAgreementState = {
  /** Null when no welcome has ever been sent — they are not gated. */
  requiredAt: string | null;
  signedAt: string | null;
  version: number | null;
  device: string | null;
  ip: string | null;
  outstanding: boolean;
  /**
   * WHICH ROUTE is holding them, or null. `outstanding` says whether the
   * portal is shut; this says why, and the two answers come from one call so
   * they cannot drift apart.
   */
  requirement: AgreementRequirement | null;
  /** Have they replaced the phone-digit PIN with one of their own? */
  hasOwnPin: boolean;
};

/** ADMIN: where one member stands on signing, for their profile. */
export async function getMemberAgreementState(input: { personId: string }): Promise<
  { ok: true; data: MemberAgreementState } | { ok: false; error: string }
> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const person = await prisma.person.findUnique({
      where: { id: input.personId },
      select: {
        pinHash: true,
        // EVERY PARTICIPATION, NOT THE MOST RECENT ONE.
        //
        // This took `take: 1` while the GATE (getMyAgreement above) looks
        // across all of them — so the two could state opposite things about
        // the same member. Welcome someone in cycle 1, they do not sign, then
        // add them to cycle 2: the gate keeps them out of the portal for the
        // cycle-1 requirement, and this screen reads only cycle 2 and reports
        // "no agreement has been asked for". The organizer would be looking at
        // a locked-out member and told nothing was owed.
        //
        // The two answers now come from the same set of rows and the same
        // predicate.
        participations: {
          orderBy: { createdAt: "desc" },
          select: {
            agreementRequiredAt: true,
            status: true,
            cycle: { select: { status: true } },
            // The same filtered count the gate takes, off the same column, so
            // "has this member ever paid" is one question with one answer.
            _count: { select: { payments: { where: { amountPaid: { gt: 0 } } } } },
            signatures: {
              orderBy: { signedAt: "desc" },
              take: 1,
              select: {
                signedAt: true,
                browser: true,
                os: true,
                ip: true,
                agreementVersion: { select: { version: true } },
              },
            },
          },
        },
      },
    });
    if (!person) return { ok: false as const, error: "Person not found." };

    // THE OUTSTANDING ONE WINS. A member owing a signature is the fact the
    // organizer has to see, whichever cycle it belongs to; only when nothing
    // is owed does the most recent participation answer.
    //
    // ASKED THROUGH `agreementRequirement`, exactly as the gate asks it. When
    // this read the welcome route alone and the gate read both, the profile
    // could report "nothing owed" about a member the portal was refusing —
    // the same class of contradiction the take(1) above already caused once.
    const requirementOf = (p: (typeof person.participations)[number]) =>
      agreementRequirement({
        requiredAt: p.agreementRequiredAt,
        lastSignedAt: p.signatures[0]?.signedAt ?? null,
        hasEverPaid: p._count.payments > 0,
        participationLive: p.status === "ACTIVE",
        cycleOpen: p.cycle.status === "ACTIVE",
      });
    const outstandingOne = person.participations.find((p) => requirementOf(p) !== null);
    const participation = outstandingOne ?? person.participations[0];
    const signature = participation?.signatures[0];
    const requirement = outstandingOne ? requirementOf(outstandingOne) : null;
    return {
      ok: true as const,
      data: {
        requiredAt: participation?.agreementRequiredAt?.toISOString() ?? null,
        signedAt: signature?.signedAt.toISOString() ?? null,
        version: signature?.agreementVersion.version ?? null,
        device: signature ? `${signature.browser} on ${signature.os}` : null,
        ip: signature?.ip ?? null,
        outstanding: requirement !== null,
        requirement,
        hasOwnPin: person.pinHash !== null,
      },
    };
  } catch (e) {
    console.error("getMemberAgreementState failed:", e);
    return { ok: false as const, error: `Could not load the signing state. ${errorMessage(e)}` };
  }
}

/** ADMIN: the wording in force, and every version behind it. */
export async function getAgreementVersions() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const current = await currentVersion();
    const [versions, signatureCounts] = await Promise.all([
      prisma.agreementVersion.findMany({ orderBy: { version: "desc" } }),
      prisma.agreementSignature.groupBy({ by: ["agreementVersionId"], _count: { _all: true } }),
    ]);
    const counted = new Map(signatureCounts.map((c) => [c.agreementVersionId, c._count._all]));
    return {
      ok: true as const,
      data: {
        currentVersion: current.version,
        currentBody: current.body,
        versions: versions.map((v) => ({
          id: v.id,
          version: v.version,
          note: v.note,
          createdAt: v.createdAt.toISOString(),
          signatures: counted.get(v.id) ?? 0,
        })),
      },
    };
  } catch (e) {
    console.error("getAgreementVersions failed:", e);
    return { ok: false as const, error: `Could not load the agreement. ${errorMessage(e)}` };
  }
}

/**
 * ADMIN: change the wording — which MINTS A NEW VERSION.
 *
 * Never an update. A signature is bound by hash to the text it was shown, so
 * rewriting a row in place would leave every past signature pointing at
 * wording that no longer exists. Versions accumulate; that is what makes
 * editing safe rather than dangerous.
 */
export async function publishAgreementVersion(input: { body: string; note?: string }) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    const body = input.body?.trim();
    if (!body) return { ok: false as const, error: "The agreement text cannot be empty." };
    if (body.length > 20_000) {
      return { ok: false as const, error: "The agreement text is too long (20,000 characters max)." };
    }
    const unknown = unknownAgreementTokens(body);
    if (unknown.length > 0) {
      return {
        ok: false as const,
        error:
          `{${unknown.join("}, {")}} ${unknown.length === 1 ? "is not a value" : "are not values"} ` +
          `the agreement can fill, so it would appear in the document exactly as written. ` +
          `Correct it or remove it.`,
      };
    }

    const current = await currentVersion();
    if (current.body === body) {
      return { ok: false as const, error: "That is the wording already in force — nothing changed." };
    }

    const published = await prisma.$transaction(async (tx) => {
      const created = await tx.agreementVersion.create({
        data: {
          version: current.version + 1,
          body,
          note: input.note?.trim() || null,
        },
      });
      await logAudit(tx, {
        entity: "AgreementVersion",
        entityId: created.id,
        action: "create",
        summary:
          `Published member agreement version ${created.version}. Signatures already taken stay ` +
          `bound to the version they were shown.`,
        before: { version: current.version },
        after: { version: created.version, note: created.note },
      });
      return created;
    });

    revalidatePath("/admin/settings");
    return { ok: true as const, data: { version: published.version } };
  } catch (e) {
    console.error("publishAgreementVersion failed:", e);
    return { ok: false as const, error: `Could not publish. ${errorMessage(e)}` };
  }
}
