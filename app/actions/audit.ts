"use server";

// READING THE AUDIT LOG — paged, filtered, and honest about what it is
// showing (D-32, 2.4, 2.14).
//
// Moved out of app/actions/edits.ts, which writes entries: reading the record
// and changing it are different jobs, and the reader has no business being in
// the same file as fourteen mutations.

import { errorMessage } from "@/lib/action-result";
import { requireAdmin } from "@/lib/auth";
import {
  auditDateWindow,
  auditFilterActive,
  auditFilterSummary,
  auditPageInfo,
  parseAuditFilter,
  personNamePattern,
  type AuditFilterInput,
} from "@/lib/audit-query";
import { Prisma } from "@/lib/generated/prisma/client";
import { PRESENTATION_HIDDEN } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";

/**
 * EVERY id that belongs to this person, so "show me Hana" finds the entries
 * about her payout and her receipts, not only the ones filed under her own
 * person row.
 *
 * An audit entry points at an entity id, and an entity id is the only exact
 * link there is — the log has no personId column, and adding one would leave
 * every entry written before today unfindable. This resolves the link the
 * other way round instead, which works on the whole history.
 */
async function ownedEntityIds(personId: string): Promise<string[]> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      participations: {
        select: {
          id: true,
          luckyNumbers: { select: { id: true, payouts: { select: { id: true } } } },
          payments: { select: { id: true } },
          paymentEvents: { select: { id: true } },
        },
      },
      ledgerEntries: { select: { id: true } },
    },
  });
  if (!person) return [];
  const ids = [person.id, ...person.ledgerEntries.map((e) => e.id)];
  for (const p of person.participations) {
    ids.push(p.id);
    for (const n of p.luckyNumbers) {
      ids.push(n.id, ...n.payouts.map((po) => po.id));
    }
    ids.push(...p.payments.map((pm) => pm.id), ...p.paymentEvents.map((e) => e.id));
  }
  return ids;
}

/**
 * The most candidates the person filter will read before filtering in JS.
 * Far above any real person's history; `truncated` says so if it is ever hit,
 * because a bound that silently drops rows is worse than a slow query.
 */
const AUDIT_CANDIDATE_CAP = 5_000;

export type AuditRow = {
  id: string;
  createdAt: string;
  entity: string;
  entityId: string;
  action: string;
  summary: string;
  before: string | null;
  after: string | null;
};

/**
 * One page of the log.
 *
 * The person filter is applied in TWO passes and the difference is stated on
 * screen rather than hidden: owned ids are exact, and a name match catches the
 * entries about rows that no longer exist — which is most deletions, and the
 * ones most worth finding.
 */
export async function listAuditLog(input: AuditFilterInput = {}) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    // The audit log narrates everything — names, money, plans (2.4).
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const filter = parseAuditFilter(input);

    const where: Prisma.AuditLogWhereInput = {};
    if (filter.action !== "all") where.action = filter.action;
    if (filter.entity !== "all") where.entity = filter.entity;
    const window = auditDateWindow(filter);
    if (window) where.createdAt = window;

    let personName: string | null = null;
    let namePattern: RegExp | null = null;
    if (filter.personId) {
      const person = await prisma.person.findUnique({
        where: { id: filter.personId },
        select: { nameEnglishFirst: true, nameEnglishLast: true, nameAmharic: true },
      });
      if (!person) return { ok: false as const, error: "That person is not in the directory." };
      personName = person.nameEnglishFirst;
      const ids = await ownedEntityIds(filter.personId);
      namePattern = personNamePattern([
        person.nameAmharic,
        person.nameEnglishLast
          ? `${person.nameEnglishFirst} ${person.nameEnglishLast}`
          : person.nameEnglishFirst,
        person.nameEnglishFirst,
      ]);
      where.OR = [
        { entityId: { in: ids } },
        // `contains` is a substring test, so it over-matches ("Hana" inside
        // "Hanan"). It narrows the query to a page's worth of candidates;
        // personNamePattern does the exact boundary check below.
        { summary: { contains: person.nameEnglishFirst } },
        ...(person.nameAmharic ? [{ summary: { contains: person.nameAmharic } }] : []),
      ];
    }

    // The person filter's name half cannot be counted in SQL — the boundary
    // check happens in JS — so paging a person's story reads the matching
    // candidates and filters them. Bounded: a single person's entries are
    // hundreds, not millions.
    if (filter.personId && namePattern) {
      const candidates = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: AUDIT_CANDIDATE_CAP,
      });
      const ownedIds = new Set(await ownedEntityIds(filter.personId));
      const matched = candidates.filter(
        (row) => ownedIds.has(row.entityId) || namePattern!.test(row.summary),
      );
      // THE CAP IS FINE UNTIL IT BITES, AND THEN IT LIES.
      //
      // This reads the most recent N candidates and filters them in JS,
      // because the name half of a person filter cannot be expressed in SQL.
      // N is far above a real person's history — but if it is ever reached,
      // the rows BELOW it are silently absent and the page count is computed
      // from a truncated set. The organizer looking for something from cycle
      // one would find nothing and conclude it was never recorded.
      //
      // So it says so, on screen, only when it has actually happened.
      const capReached = candidates.length === AUDIT_CANDIDATE_CAP;
      const info = auditPageInfo(matched.length, filter.page);
      return {
        ok: true as const,
        data: {
          rows: matched.slice(info.skip, info.skip + info.take).map(toRow),
          info,
          filter,
          personName,
          filtered: auditFilterActive(filter),
          summary: auditFilterSummary(filter, info, personName),
          entities: await listAuditEntities(),
          truncated: capReached
            ? `Only the most recent ${AUDIT_CANDIDATE_CAP.toLocaleString("en-US")} entries were ` +
              `searched for this person, and there are more. Narrow the filter — by entity or ` +
              `by date — to reach the older ones.`
            : null,
        },
      };
    }

    // The other branch counts in SQL and pages properly, so nothing is ever
    // cut: the field is present and null so both shapes match.
    const total = await prisma.auditLog.count({ where });
    const info = auditPageInfo(total, filter.page);
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: info.skip,
      take: info.take,
    });

    return {
      ok: true as const,
      data: {
        rows: rows.map(toRow),
        info,
        filter,
        personName,
        filtered: auditFilterActive(filter),
        summary: auditFilterSummary(filter, info, personName),
        entities: await listAuditEntities(),
        truncated: null,
      },
    };
  } catch (e) {
    console.error("listAuditLog failed:", e);
    return { ok: false as const, error: `Could not load the audit log. ${errorMessage(e)}` };
  }
}

function toRow(row: {
  id: string;
  createdAt: Date;
  entity: string;
  entityId: string;
  action: string;
  summary: string;
  before: string | null;
  after: string | null;
}): AuditRow {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** The entity kinds that actually appear, so the filter offers only real ones. */
async function listAuditEntities(): Promise<string[]> {
  const rows = await prisma.auditLog.groupBy({ by: ["entity"], _count: true });
  return rows.map((r) => r.entity).sort((a, b) => a.localeCompare(b));
}

/** People who appear in the log, for the person filter's picker. */
export async function auditPeopleOptions() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;
  try {
    if (await getSetting("presentationMode")) {
      return { ok: false as const, error: PRESENTATION_HIDDEN };
    }
    const people = await prisma.person.findMany({
      select: { id: true, nameEnglishFirst: true, nameEnglishLast: true, nameAmharic: true },
      orderBy: [{ nameEnglishFirst: "asc" }],
    });
    return {
      ok: true as const,
      data: people.map((p) => ({
        id: p.id,
        label:
          `${p.nameEnglishFirst}${p.nameEnglishLast ? ` ${p.nameEnglishLast}` : ""}` +
          (p.nameAmharic ? ` / ${p.nameAmharic}` : ""),
      })),
    };
  } catch (e) {
    console.error("auditPeopleOptions failed:", e);
    return { ok: false as const, error: `Could not load the people. ${errorMessage(e)}` };
  }
}
