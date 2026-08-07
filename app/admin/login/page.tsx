import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { SessionExpiredNotice } from "@/components/session-expired-notice";
import { EXPIRY_PARAM } from "@/lib/session-policy";
import { AdminLoginForm } from "./admin-login-form";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await requireAdmin();
  if (gate.ok) redirect("/admin/cycle");
  const params = await searchParams;

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-6 text-xl font-semibold">Organizer sign-in</h1>
      {/* The 25-minute idle window means this page is reached routinely, not
          exceptionally — it has to explain itself every time (ruling 3). */}
      <SessionExpiredNotice reason={params[EXPIRY_PARAM]} role="ADMIN" />
      <AdminLoginForm />
    </main>
  );
}
