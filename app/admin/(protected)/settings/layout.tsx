import type { ReactNode } from "react";
import { SettingsNav } from "./settings-nav";

// The settings shell. The rail is always visible, so all four pages are
// discoverable from any one of them — which is the whole point of the split.
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-black text-gray-900 dark:text-white">Settings</h1>
        <p className="mt-1 max-w-prose text-sm text-gray-600 dark:text-gray-400">
          Separate decisions, kept separate: who can get in, how the platform talks to members,
          the rules a cycle runs by, the agreement members sign, and your own account.
        </p>
      </header>
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <SettingsNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </main>
  );
}
