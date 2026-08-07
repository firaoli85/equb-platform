"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { signOutEverywhereElse } from "@/app/actions/sessions";
import type { SessionView } from "@/app/actions/sessions";

// "WHERE YOU ARE SIGNED IN" (ruling 4) — shared by the member portal and the
// organizer's settings, because the need is identical: see every live
// session, recognise the one you are holding, and be able to end the rest.
//
// The device in your hand is marked and never offered for sign-out. That is
// the entire point of recording sessions individually rather than counting
// them: "sign out everywhere" that also signs YOU out is a button nobody
// dares press.

const METHOD_LABEL: Record<string, string> = {
  PIN: "PIN",
  WHATSAPP: "WhatsApp code",
  SMS: "Text code",
  PASSWORD: "Password",
};

function DeviceIcon({ type }: { type: string }) {
  const common = {
    className: "h-4 w-4 shrink-0",
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.75,
    "aria-hidden": true as const,
  };
  if (type === "Phone" || type === "Tablet") {
    return (
      <svg {...common}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
        />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z"
      />
    </svg>
  );
}

/** "2 hours ago" — a member reads elapsed time far faster than a timestamp. */
function ago(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

export function SessionList({
  sessions,
  now,
}: {
  sessions: SessionView[];
  /** Stamped on the server so the first paint matches — no hydration drift. */
  now: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const others = sessions.filter((s) => !s.isCurrent).length;

  return (
    <div className="space-y-3">
      {msg && (
        <p
          role="status"
          className={`rounded-xl px-3 py-2 text-xs ${
            msg.kind === "ok"
              ? "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 border border-green-100 dark:border-green-900"
              : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-100 dark:border-red-900"
          }`}
        >
          {msg.text}
        </p>
      )}

      {sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 px-4 py-4 text-sm text-gray-600 dark:text-gray-400">
          No other sign-ins recorded yet. This device will appear here after your next sign-in.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100 dark:border-gray-800/60 bg-white dark:bg-[#141414] px-3.5 py-3 last:border-b-0"
            >
              <span className="text-gray-500 dark:text-gray-400">
                <DeviceIcon type={s.deviceType} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">
                    {s.label}
                  </span>
                  {s.isCurrent && (
                    <span className="rounded-full bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                      This device
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
                  {/* Location is approximate and says so — an IP is not a
                      street address and the UI must not imply it is. */}
                  {s.location ? `${s.location} (approximate)` : "Location unavailable"}
                  {" · "}
                  <span className="tabular-nums">{s.ip}</span>
                </span>
                {/* gray-600/400, not gray-500 both ways: measured 3.81:1 in
                    dark on the admin card background, which is lighter than
                    the member portal's — the same component sits on two
                    surfaces and has to clear 4.5:1 on both. */}
                <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-400">
                  Signed in with {METHOD_LABEL[s.method] ?? s.method} ·{" "}
                  <span className="tabular-nums">{ago(s.startedAt, now)}</span> · last used{" "}
                  <span className="tabular-nums">{ago(s.lastSeenAt, now)}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {others > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMsg(null);
                const result = await signOutEverywhereElse();
                if (!result.ok) {
                  setMsg({ kind: "err", text: result.error });
                  return;
                }
                setMsg({
                  kind: "ok",
                  text: `Signed out of ${result.data.endedCount} other device${
                    result.data.endedCount === 1 ? "" : "s"
                  }. You are still signed in here.`,
                });
                router.refresh();
              })
            }
            className="rounded-xl bg-gray-900 dark:bg-white px-4 py-2.5 text-xs font-bold text-white dark:text-gray-900 hover:opacity-90 active:scale-[0.98] transition-[opacity,transform] disabled:opacity-50"
            style={{ touchAction: "manipulation", minHeight: "40px" }}
          >
            {pending ? "Signing out…" : "Sign out everywhere else"}
          </button>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Ends the other {others === 1 ? "session" : `${others} sessions`} immediately. This
            device stays signed in.
          </p>
        </div>
      )}
    </div>
  );
}
