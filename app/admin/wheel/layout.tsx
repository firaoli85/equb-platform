import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

// The wheel lives OUTSIDE the admin nav layout on purpose (2.4): the draw
// screen is shared on Zoom and must carry nothing but the wheel. Admin-gated
// exactly like everything else.
export default async function WheelLayout({ children }: { children: React.ReactNode }) {
  const gate = await requireAdmin();
  if (!gate.ok) redirect("/admin/login");
  return <>{children}</>;
}
