import { Prisma } from "./generated/prisma/client";

// D-32: every organizer correction records what changed, from what to what,
// and when — written inside the SAME transaction as the change itself, so an
// audited change and its audit entry can never exist without each other.

export type AuditAction = "create" | "update" | "delete" | "move";

export async function logAudit(
  tx: Prisma.TransactionClient,
  input: {
    entity: string;
    entityId: string;
    action: AuditAction;
    summary: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      summary: input.summary,
      before: input.before === undefined ? null : JSON.stringify(input.before),
      after: input.after === undefined ? null : JSON.stringify(input.after),
    },
  });
}
