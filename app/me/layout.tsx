import { MemberPageTransition } from "@/components/member/member-page-transition";
import { MemberSidebar } from "@/components/member/member-sidebar";
import { MemberTabBar } from "@/components/member/member-tab-bar";
import { ThemeToggle } from "@/components/member/theme-toggle";
import { signOutAction } from "@/app/actions/auth";

// The member shell: top bar, desktop sidebar, mobile tab bar. Pages fetch
// their own data and redirect to /login when signed out — the chrome is
// identical on every member screen. The tab bar renders OUTSIDE the page
// transition so its fixed positioning never sits inside a transform.
export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh" style={{ background: "var(--page-bg)" }}>
      {/* Top bar */}
      <header className="fixed top-0 inset-x-0 z-40 h-14 flex items-center justify-between px-4 md:px-6 bg-white/95 dark:bg-[#0a0a0b]/95 backdrop-blur-sm border-b border-gray-100 dark:border-gray-800/60">
        <div className="flex items-center gap-2 select-none">
          <span className="w-7 h-7 rounded-xl bg-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </span>
          <span className="text-base font-black text-gray-900 dark:text-white">Equb</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {/* Mobile sign-out (desktop uses the sidebar) */}
          <form action={signOutAction} className="md:hidden">
            <button
              type="submit"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Sign out"
              title="Sign out"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
          </form>
        </div>
      </header>

      <MemberSidebar />

      {/* Content — clears the top bar, the tab bar (mobile), the sidebar (desktop) */}
      <main className="pt-14 pb-24 md:pb-10 md:pl-60">
        <div className="mx-auto max-w-md px-4 py-5 md:max-w-lg">
          <MemberPageTransition>{children}</MemberPageTransition>
        </div>
      </main>

      <MemberTabBar />
    </div>
  );
}
