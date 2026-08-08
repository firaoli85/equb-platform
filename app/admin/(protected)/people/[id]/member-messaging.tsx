"use client";

import { useState, useTransition } from "react";
import { sendToMember, type MemberMessagingView } from "@/app/actions/member-messaging";
import { Card, CardHeader, EmptyState, Pill } from "@/components/ui/primitives";
import { TruncationNotice } from "@/components/ui/pager";
import { CAPS, truncationNotice } from "@/lib/paging";

// SEND ONE MESSAGE TO ONE MEMBER, FROM THEIR OWN PAGE.
//
// The shape follows what the organizer is actually doing: he is looking at
// someone who is behind, and the question is "what can I send her, and what
// would it say". So the applicable types are listed with their REAL rendered
// text already visible — not behind a preview button — because reading them
// IS the decision. The ones that do not apply stay on screen with the reason,
// since a type that silently disappears looks like a missing feature.

export function MemberMessaging({
  view,
  personName,
}: {
  view: MemberMessagingView;
  personName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; status: string; reason: string | null } | null>(
    null,
  );

  function send(key: string) {
    if (!view.participationId) return;
    setSendingKey(key);
    setResult(null);
    startTransition(async () => {
      const outcome = await sendToMember({ participationId: view.participationId!, key });
      setSendingKey(null);
      if (!outcome.ok) {
        setResult({ key, status: "ERROR", reason: outcome.error });
        return;
      }
      setResult({ key, status: outcome.data.status, reason: outcome.data.reason });
    });
  }

  const applicable = view.types.filter((t) => t.applicable);
  const notApplicable = view.types.filter((t) => !t.applicable);

  return (
    <div className="space-y-4">
      {/* Stated once, at the top. Repeating it on every button would make the
          buttons unreadable and would still not be clearer. */}
      {view.blockedReason && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 dark:border-amber-900 dark:bg-amber-950/25">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
            Statements cannot send yet
          </p>
          <p className="mt-1 text-sm text-amber-900/90 dark:text-amber-200/90 text-pretty">
            {view.blockedReason} Everything below is ready and will work the moment Meta approves
            the templates — pressing send now records an honest skip rather than a delivery.
            Login codes are unaffected.
          </p>
        </div>
      )}

      {view.participationId === null ? (
        <Card className="px-5 py-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {personName} is not in the running cycle, so there is no current position to state.
            Messages are always about where a member stands right now (2.21).
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title={`Send ${personName} a statement`}
              sub="Their real figures, rendered now. Nothing leaves until you press send (2.20)."
            />
            <div className="space-y-3 px-5 pb-5">
              {applicable.length === 0 ? (
                <EmptyState
                  title="Nothing applies right now."
                  hint={`${personName} is current, and their number has not been drawn. The reasons are listed below.`}
                />
              ) : (
                applicable.map((type) => (
                  <div
                    key={type.key}
                    className="rounded-xl border border-gray-200 dark:border-gray-800"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                        {type.label}
                      </h3>
                      {type.chasing && <Pill tone="attention">chases for money</Pill>}
                    </div>
                    {/* The real text, not a description of it. */}
                    <p className="mx-4 mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-800 dark:bg-white/5 dark:text-gray-200">
                      {type.preview}
                    </p>
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => send(type.key)}
                        disabled={pending}
                        className="inline-flex min-h-11 items-center rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white transition-[background-color,transform] duration-150 ease-out hover:bg-indigo-700 active:scale-[0.97] disabled:opacity-50 md:min-h-9"
                      >
                        {sendingKey === type.key ? "Sending…" : `Send this to ${personName}`}
                      </button>
                      {result?.key === type.key && (
                        <p
                          role="status"
                          className={`text-sm ${
                            result.status === "SENT"
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-amber-800 dark:text-amber-300"
                          }`}
                        >
                          {/* A SKIP IS NOT A FAILURE AND IS NOT A SUCCESS. The
                              organizer pressed send and nothing left; he is
                              told which, in the engine's own words. */}
                          {result.status === "SENT"
                            ? "Sent."
                            : `Not sent — ${result.reason ?? "no reason given."}`}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {notApplicable.length > 0 && (
            <Card>
              <CardHeader
                title="Not applicable right now"
                sub="Kept on screen with the reason — a type that simply vanishes looks like a missing feature."
              />
              <ul className="border-t border-gray-100 dark:border-gray-800/60">
                {notApplicable.map((type) => (
                  <li
                    key={type.key}
                    className="border-b border-gray-100 px-5 py-3 last:border-b-0 dark:border-gray-800/60"
                  >
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {type.label}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">{type.reason}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {/* WHAT WAS LAST SENT, AND WHEN — before sending again. Without it the
          organizer has no way to tell whether he already chased this member
          this week, and the honest answer to that is on the Messages screen
          three clicks away. */}
      <Card>
        <CardHeader
          title="Already sent to them"
          sub="Every message this member has received, automatic or manual. Append-only."
        />
        {view.history.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState
              title="Nothing has been sent to them yet."
              hint="Anything sent from here or from the batch appears in this list."
            />
          </div>
        ) : (
          <>
            <ul className="border-t border-gray-100 dark:border-gray-800/60">
              {view.history.map((entry) => (
                <li
                  key={entry.id}
                  className="border-b border-gray-100 px-5 py-3 last:border-b-0 dark:border-gray-800/60"
                >
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="text-xs font-bold text-gray-900 dark:text-white">
                      {entry.templateKey}
                    </span>
                    <Pill tone={entry.trigger === "AUTOMATIC" ? "accent" : "neutral"}>
                      {entry.trigger === "AUTOMATIC" ? "Automatic" : "Manual"}
                    </Pill>
                    <Pill tone={entry.status === "SENT" ? "good" : "problem"}>
                      {entry.status === "SENT" ? "Sent" : entry.status}
                    </Pill>
                    <span className="ml-auto text-xs tabular-nums text-gray-600 dark:text-gray-400">
                      {new Date(entry.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300">
                    {entry.body}
                  </p>
                  {entry.error && (
                    <p className="mt-1 text-xs text-red-700 dark:text-red-400">{entry.error}</p>
                  )}
                </li>
              ))}
            </ul>
            <div className="px-5 pb-4">
              <TruncationNotice
                notice={truncationNotice({
                  shown: view.history.length,
                  cap: CAPS.memberMessages,
                  noun: "messages",
                  fullListAt: "the Messages screen",
                })}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
