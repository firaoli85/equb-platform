"use client";

import { useState, useTransition } from "react";
import { dismissNewDeviceNotice } from "@/app/actions/sessions";

// "NEW SIGN-IN FROM…" (ruling 5).
//
// The whole security benefit of the awareness model lands here. The member
// signed in with four digits anyone who has their number could guess; this is
// how they find out if someone did. So it sits at the TOP of the portal, in
// amber, above the money — not in a settings page nobody opens.
//
// It appears once per unfamiliar device and network combination, and stays
// until they dismiss it (lib/device.ts keeps that combination rare enough
// that the notice is still worth reading when it does appear).
//
// IN-PORTAL ONLY for now — there is no working push channel. The wording is
// produced by a pure function in lib/device.ts that takes no request context,
// so a WhatsApp or SMS job can send the identical sentence later without any
// of this component changing.

export function NewDeviceNotice({
  sessionId,
  message,
}: {
  sessionId: string;
  message: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [pending, start] = useTransition();

  if (dismissed) return null;

  return (
    <section
      role="status"
      className="rounded-2xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3.5 animate-fade-in-up"
    >
      <div className="flex items-start gap-3">
        <svg
          className="w-5 h-5 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.008v.008H12v-.008z"
          />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
            New sign-in on your account
          </p>
          <p className="mt-1 text-xs text-amber-900/90 dark:text-amber-200/90 text-pretty">
            {message}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <a
              href="/me/security"
              // amber-700, not amber-600: white on amber-600 measures 3.2:1,
              // and at 12px bold this is normal-size text needing 4.5:1.
              className="inline-flex items-center rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white hover:bg-amber-800 active:scale-[0.98] transition-colors"
              style={{ touchAction: "manipulation", minHeight: "36px" }}
            >
              Check my sign-ins
            </a>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  // Hidden immediately — waiting on a round-trip to dismiss a
                  // notice reads as a broken button.
                  setDismissed(true);
                  await dismissNewDeviceNotice({ sessionId });
                })
              }
              className="rounded-lg px-3 py-2 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50"
              style={{ touchAction: "manipulation", minHeight: "36px" }}
            >
              That was me
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
