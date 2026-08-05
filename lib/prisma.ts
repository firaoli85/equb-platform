import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

// Reuse one client across Next.js dev hot reloads to avoid connection pile-up.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Run a transaction at SERIALIZABLE isolation, retrying on write conflicts.
 * Check-then-write invariants (one ACTIVE cycle, unique lucky numbers within
 * a cycle) are enforced by Postgres SSI instead of hoping two saves never
 * interleave. P2034 is Prisma's serialization-conflict code.
 */
export async function serializableTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}
