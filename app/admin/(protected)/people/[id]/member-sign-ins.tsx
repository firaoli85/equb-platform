import { Pill } from "@/components/ui/primitives";
import type { AdminSignInRow } from "@/app/actions/sessions";

// "WAS THAT YOU?" (ruling 6).
//
// A member rings up worried, or the organizer notices something odd. This is
// the answer: which device, which network, when — including sessions that
// have already ended, because the question is almost always about one that is
// over.
//
// READ-ONLY on purpose. The organizer can see a member's sign-ins so he can
// help; ending them is the member's own switch (/me/security), and resetting
// their PIN — which he can already do on the Settings tab — is the real
// remedy if something is wrong. Giving him a revoke button here would be a
// second, weaker way to do the same thing.

const METHOD_LABEL: Record<string, string> = {
  PIN: "PIN",
  WHATSAPP: "WhatsApp code",
  SMS: "Text code",
  PASSWORD: "Password",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MemberSignIns({ rows }: { rows: AdminSignInRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        No sign-ins recorded yet. Sessions have been recorded since the security change — anything
        earlier than that is not here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {["When", "Device", "Where", "IP", "How", "Status"].map((h) => (
              <th
                key={h}
                className="border-b border-gray-200 dark:border-gray-800 py-2 pr-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 whitespace-nowrap tabular-nums text-gray-700 dark:text-gray-300">
                {when(r.startedAt)}
              </td>
              <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 font-semibold text-gray-900 dark:text-white">
                {r.label}
                {r.isNewDevice && (
                  <span className="ml-2 align-middle">
                    {/* The same fact the member was shown in their portal, so
                        the two of them are looking at one story. */}
                    <Pill tone="attention">New device</Pill>
                  </span>
                )}
              </td>
              <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 text-gray-700 dark:text-gray-300">
                {r.location ?? "—"}
              </td>
              <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 tabular-nums text-gray-600 dark:text-gray-400">
                {r.ip}
              </td>
              <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3 text-gray-700 dark:text-gray-300">
                {METHOD_LABEL[r.method] ?? r.method}
              </td>
              <td className="border-b border-gray-100 dark:border-gray-800/60 py-2 pr-3">
                {r.isActive ? (
                  <Pill tone="good">Signed in</Pill>
                ) : (
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {r.endedReason ?? "Ended"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
