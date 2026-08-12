import { redirect } from "next/navigation";
import { AccountMenu } from "@/components/admin/account-menu";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { PresentationToggle } from "@/components/presentation-toggle";
import { requireAdmin } from "@/lib/auth";
import { getSetting } from "@/lib/settings";

// Server-side gate for every protected admin page. The proxy redirects
// first; this is defense in depth — /admin/login lives OUTSIDE this route
// group so it stays reachable. The shell: grouped sidebar, quiet top bar,
// wide content column for dense data.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const gate = await requireAdmin();
  if (!gate.ok) redirect("/admin/login");
  const presentation = await getSetting("presentationMode");

  return (
    <div className="min-h-dvh" style={{ background: "var(--page-bg)" }}>
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0a0a0b] md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-gray-100 dark:border-gray-800/60 px-5 select-none">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-indigo-600">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </span>
          <span className="text-base font-black text-gray-900 dark:text-white">Equb</span>
          <span className="rounded bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
            Admin
          </span>
        </div>
        <AdminSidebar />
        {/* The foot of the rail: the screen-share switch, then the account
            menu (ADMIN_IA §3) that holds the four settings pages and
            sign-out. Sign-out is no longer a sibling here — it is the last
            item of that menu, so there is exactly one of it. */}
        <div className="space-y-2 border-t border-gray-100 dark:border-gray-800/60 p-3">
          <PresentationToggle on={presentation} />
          <AccountMenu />
        </div>
      </aside>

      {/* Mobile fallback bar (admin is desktop-first; keep it usable) */}
      {/* The one piece of admin chrome that overlays scrolling content, so it
          gets the same restrained glass as the member header — translucent
          with a blur, never the full liquid-glass look. Opaque underneath, so
          a browser without backdrop-filter gets a solid bar rather than a
          smear of the rows beneath it. */}
      <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-gray-200 bg-white px-4 backdrop-blur-sm supports-[backdrop-filter]:bg-white/85 dark:border-gray-800 dark:bg-[#0a0a0b] dark:supports-[backdrop-filter]:bg-[#0a0a0b]/85 md:hidden">
        <span className="text-sm font-black text-gray-900 dark:text-white">Equb Admin</span>
        <div className="flex items-center gap-2">
          <PresentationToggle on={presentation} />
          {/* Same menu, compact. Settings were unreachable on a phone too. */}
          <AccountMenu compact />
        </div>
      </header>

      {/* Content */}
      <main className="md:pl-56">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
