"use server";

import { revalidatePath } from "next/cache";
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
    const people = await prisma.person.findMany({
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
        participations: {
          orderBy: { createdAt: "asc" },
          include: { cycle: { select: { id: true, name: true, status: true } } },
        },
      },
    });
    const active = await prisma.cycle.findFirst({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    const data = people.map((person) => ({
      ...person,
      inActiveCycle: active
        ? person.participations.some((p) => p.cycleId === active.id)
        : false,
    }));
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
    const nameAmharic = input.nameAmharic?.trim();
    const nameEnglishFirst = input.nameEnglishFirst?.trim();
    if (!nameAmharic) return { ok: false as const, error: "Amharic name is required." };
    if (!nameEnglishFirst) return { ok: false as const, error: "English first name is required." };

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
