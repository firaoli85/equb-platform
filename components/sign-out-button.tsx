"use client";

import { useTransition } from "react";
import { signOutAction } from "@/app/actions/auth";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => signOutAction())}
      disabled={pending}
      className="inline-flex min-h-11 md:min-h-9 w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 dark:text-red-400 transition-[background-color,transform] duration-150 ease-out hover:bg-red-50 dark:hover:bg-red-950/40 active:scale-[0.98] disabled:opacity-40"
    >
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
        />
      </svg>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
