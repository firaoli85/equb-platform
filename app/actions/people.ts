"use server";

import { CAPS } from "@/lib/paging";
import { agreementRequirement } from "@/lib/agreement";
import { signingState } from "@/lib/agreement-view";
import { duplicatePhoneRefusal } from "@/lib/person-record";
import { revalidatePath } from "next/cache";
import { totalContributed } from "@/lib/contribution";
import { ledgerBalance } from "@/lib/ledger";
import { errorMessage } from "@/lib/action-result";
import { requireAdmin } from "@/lib/auth";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";

/**
 * The permanent Member Directory (2.5): everyone ever, with which cycles they
 * have been in and whether they are already in the active cycle.
 */
export async function listPeople(searchTerm?: string) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // The directory is names and phones — nothing is sent (2.4).
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const q = searchTerm?.trim();
    // A CEILING, NOT PAGING. The directory grows one row per person the
    // group has ever had — slow growth, but unbounded, and 2.5 keeps people
    // for good. Search narrows it, so paging would add machinery for a case
    // the search box already handles; the cap only exists so one query can
    // never load an arbitrary number of rows. `truncationNotice` is what
    // stops it lying when it is actually reached.
    const people = await prisma.person.findMany({
      take: CAPS.people,
      where: q
        ? {
            OR: [
              { nameAmharic: { contains: q } },
              { nameEnglishFirst: { contains: q, mode: "insensitive" } },
              { nameEnglishLast: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : undefined,
      orderBy: [{ nameEnglishFirst: "asc" }, { createdAt: "asc" }],
      include: {
        // 2.18: a carried balance must SURFACE when adding someone to a new
        // cycle — never silently carried, deducted or ignored.
        ledgerEntries: { select: { type: true, amount: true, description: true } },
        participations: {
          orderBy: { createdAt: "asc" },
          include: {
            cycle: { select: { id: true, name: true, status: true } },
            // 2.1/2.14: what they have contributed to the ACTIVE cycle, summed
            // from the receipts. Derived on every read, never stored.
            paymentEvents: { select: { amount: true } },
          },
        },
      },
    });
    const active = await prisma.cycle.findFirst({
      where: { status: "ACTIVE" },
      select: { id: true },
    });

    // ONE GROUPED READ FOR THE WHOLE DIRECTORY, not a query per person.
    //
    // The chip needs the LATEST signature against each participation, which is
    // exactly what a `_max` on a grouped read answers — the same shape
    // `listMessageThreads` uses for its per-person counts. Fetching signatures
    // inside the `person` include would be one join per row and would carry
    // `documentText` — the whole signed document, per signature — across for a
    // four-word chip.
    const signatures = await prisma.agreementSignature.groupBy({
      by: ["participationId"],
      _max: { signedAt: true },
    });
    const lastSignedAt = new Map(signatures.map((s) => [s.participationId, s._max.signedAt]));

    // HAS ANYTHING EVER BEEN PAID — the second route into the gate, read the
    // same way and for the same reason: one grouped query for the directory,
    // not a join per row.
    //
    // OFF `Payment.amountPaid`, NOT off the `paymentEvents` already loaded
    // above. Those are the receipts for the ACTIVE cycle only, summed for the
    // contributed column; the gate asks about a participation's whole life,
    // and about the same column every money derivation reads (2.14). Two
    // sources for one question is how the chip and the portal come to disagree.
    const paid = await prisma.payment.groupBy({
      by: ["participationId"],
      _sum: { amountPaid: true },
    });
    const paidTotal = new Map(paid.map((p) => [p.participationId, p._sum.amountPaid ?? 0]));

    const data = people.map((person) => {
      const here = active
        ? (person.participations.find((p) => p.cycleId === active.id) ?? null)
        : null;
      // THE OUTSTANDING PARTICIPATION, NOT THE LATEST ONE.
      //
      // Both this and `getMemberAgreementState` used to read a single
      // participation while the GATE reads all of them — so a member welcomed
      // in cycle 1, never signed, then added to cycle 2 was locked out of the
      // portal while this chip said "not asked". The chip has to answer the
      // same question the gate does, and the answer that matters is "does this
      // person owe a signature anywhere", not "what did their newest
      // participation say".
      //
      // Only when nothing is owed does the most recent one answer, so a member
      // who has signed still shows when and against what.
      const signingFacts = (p: (typeof person.participations)[number]) => ({
        requiredAt: p.agreementRequiredAt,
        signedAt: lastSignedAt.get(p.id) ?? null,
        hasEverPaid: (paidTotal.get(p.id) ?? 0) > 0,
        participationLive: p.status === "ACTIVE",
        cycleOpen: p.cycle.status === "ACTIVE",
      });
      const owing =
        person.participations.find((p) => {
          const f = signingFacts(p);
          return agreementRequirement({ ...f, lastSignedAt: f.signedAt }) !== null;
        }) ?? null;
      const latest = owing ?? person.participations[person.participations.length - 1] ?? null;
      return {
        ...person,
        inActiveCycle: here !== null,
        /** Cents they still carry from earlier cycles (2.18). */
        carriedBalance: ledgerBalance(person.ledgerEntries),
        /** Where it came from, for the add-to-cycle warning. */
        carriedFrom: person.ledgerEntries
          .filter((e) => e.type === "DEBT")
          .map((e) => e.description),
        /** Cents contributed to the active cycle; 0 when they are not in it. */
        contributedThisCycle: here
          ? totalContributed(here.paymentEvents.map((e) => ({ amount: e.amount })))
          : 0,
        /**
         * Signed / waiting / not asked (the ruling's states, derived).
         *
         * Null `agreementRequiredAt` means no welcome was ever sent, which is
         * "not asked" — not "not signed". Everyone already mid-cycle is there.
         */
        agreementSigning: latest
          ? signingState(signingFacts(latest))
          : signingState({ requiredAt: null, signedAt: null }),
      };
    });
    return { ok: true as const, data };
  } catch (e) {
    console.error("listPeople failed:", e);
    return { ok: false as const, error: `Could not load the directory. ${errorMessage(e)}` };
  }
}

export type DirectoryPerson = Extract<
  Awaited<ReturnType<typeof listPeople>>,
  { ok: true }
>["data"][number];

export type CreatePersonInput = {
  nameAmharic: string;
  nameEnglishFirst: string;
  nameEnglishLast?: string;
  phone?: string;
};

/** Add a person to the permanent directory (2.5), in no cycle yet. */
export async function createPerson(input: CreatePersonInput) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // Amharic is OPTIONAL (14 Aug 2026, Latin-primary ruling) — stored as ""
    // when absent, because the column is non-null and "" is what every
    // renderer treats as "nothing to show".
    const nameAmharic = input.nameAmharic?.trim() ?? "";
    const nameEnglishFirst = input.nameEnglishFirst?.trim();
    if (!nameEnglishFirst) return { ok: false as const, error: "First name is required." };

    // Same rule at creation: a number that already belongs to someone
    // else makes both of them unable to sign in reliably.
    const others = await prisma.person.findMany({
      where: { phone: { not: null } },
      select: { id: true, nameEnglishFirst: true, phone: true },
    });
    const phoneClash = duplicatePhoneRefusal({ phone: input.phone, others });
    if (phoneClash) return { ok: false as const, error: phoneClash };

    const person = await prisma.person.create({
      data: {
        nameAmharic,
        nameEnglishFirst,
        nameEnglishLast: input.nameEnglishLast?.trim() || null,
        phone: input.phone?.trim() || null,
      },
    });

    revalidatePath("/admin/people");
    revalidatePath("/admin/cycle/add");
    return { ok: true as const, data: person };
  } catch (e) {
    console.error("createPerson failed:", e);
    return { ok: false as const, error: `Could not save the person. ${errorMessage(e)}` };
  }
}
