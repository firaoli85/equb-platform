import { LoginFlow } from "@/components/member/login-flow";
import { ThemeToggle } from "@/components/member/theme-toggle";

export const dynamic = "force-dynamic";

// The member entrance, in the portal's own light system so signing in feels
// continuous with what follows. Which methods are OFFERED comes from the
// phone lookup (per person); every PIN attempt is re-checked server-side
// against both toggles (2.6) regardless of what this page shows.
export default function MemberLoginPage() {
  return (
    <main className="min-h-dvh flex flex-col" style={{ background: "var(--page-bg)" }}>
      <div className="flex justify-end p-3">
        <ThemeToggle />
      </div>
      <div className="flex-1 flex items-start justify-center pt-10 px-5 pb-16">
        <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#141414] border border-gray-100 dark:border-gray-800 shadow-sm px-6 py-8">
          <LoginFlow />
        </div>
      </div>
    </main>
  );
}
