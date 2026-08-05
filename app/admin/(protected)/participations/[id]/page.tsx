import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// The participation view merged into the member page — one page shows the
// whole person (2.5: person + per-cycle participation together). This route
// stays alive so every old link keeps working.
export default async function ParticipationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const participation = await prisma.participation.findUnique({
    where: { id },
    select: { personId: true },
  });
  if (!participation) notFound();
  redirect(`/admin/people/${participation.personId}`);
}
