import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { AdminLoginForm } from "./admin-login-form";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const gate = await requireAdmin();
  if (gate.ok) redirect("/admin/cycle");

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-6 text-xl font-semibold">Organizer sign-in</h1>
      <AdminLoginForm />
    </main>
  );
}
