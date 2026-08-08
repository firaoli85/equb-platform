import { prisma } from "./prisma";
import { samePhone } from "./phone";

/**
 * Everyone whose stored phone refers to the same line as `input`, however
 * either side was formatted. The directory is small (one group of friends),
 * so comparing in application code is simpler and safer than SQL string
 * gymnastics — and lookup and PIN sign-in MUST agree on matching.
 */
export async function findPeopleByPhone(input: string) {
  const withPhones = await prisma.person.findMany({
    where: { phone: { not: null } },
    // DETERMINISTIC. Both OTP doors take candidates[0], and an unordered
    // findMany let the database decide who that was. Duplicates are now
    // refused at the source, but a stable order means the fallback is at
    // least the same person every time rather than whoever Postgres felt like.
    orderBy: { createdAt: "asc" },
  });
  return withPhones.filter((p) => p.phone !== null && samePhone(p.phone, input));
}
