import { redirect } from "next/navigation";
import { getCurrentUser, isAdminClaims } from "@/lib/auth";

export const dynamic = "force-dynamic";

// "/" routes people to their world: admin -> the command center, a signed-in
// member -> their portal, everyone else -> member sign-in.
export default async function RootPage() {
  const claims = await getCurrentUser();
  if (isAdminClaims(claims)) redirect("/admin");
  if (claims) redirect("/me");
  redirect("/login");
}
