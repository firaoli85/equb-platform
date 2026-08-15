"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  updateEqubTimezone,
  updateMessageAutoSend,
  updateMessageSchedule,
} from "@/app/actions/settings";
import { SettingList, SettingSwitch } from "@/components/admin/setting-row";
import { Select } from "@/components/ui/controls";
import { Alert } from "@/components/ui/primitives";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
// Client-safe by construction — lib/messaging-config imports one TYPE and
// nothing else, so this "use client" file cannot drag Prisma into the browser
// bundle (lib/client-bundle-safety.test.ts).
import {
  CONFIGURABLE_MESSAGE_KEYS,
  isReservedMessageKey,
  isWeekday,
  messageTimingSummary,
  scheduleProblem,
  TIME_TRIGGERED_MESSAGE_KEYS,
  WEEKDAYS,
  type ConfigurableMessageKey,
  type MessagingConfig,
} from "@/lib/messaging-config";

/** What each type is called on this screen — the organizer's words, not Meta's. */
const MESSAGE_LABEL: Record<ConfigurableMessageKey, string> = {
  PAYMENT_CONFIRMED: "Payment confirmation",
  PAYMENT_CONFIRMED_WITH_PARTIAL: "Payment confirmation, with an amount still owed",
  PARTIAL_CONFIRMED: "Part-payment confirmation",
  PARTIAL_COMPLETED: "Part-paid week now complete",
  LATE_NOTICE: "Late notice",
  BEHIND_NOTICE: "Behind notice",
  WINNER_ANNOUNCEMENT: "Winner announcement",
  WEEKLY_REMINDER: "Weekly reminder",
  GROUP_ANNOUNCEMENT: "Group announcement",
};

/** What the message IS, so the switch is not the only thing explaining itself. */
const MESSAGE_DESCRIPTION: Record<ConfigurableMessageKey, string> = {
  PAYMENT_CONFIRMED: "Tells a member what arrived and which weeks it covered.",
  PAYMENT_CONFIRMED_WITH_PARTIAL:
    "Tells a member which weeks their payment settled, and how much is still due on the next one.",
  PARTIAL_CONFIRMED:
    "Tells a member a week was only part paid, and how much is still due on it.",
  PARTIAL_COMPLETED:
    "Tells a member the week they had part paid is now paid in full, and what they had already put toward it.",
  LATE_NOTICE: "Names the weeks that closed without a payment.",
  BEHIND_NOTICE: "Tells a member how far behind they are and what it takes to catch up.",
  WINNER_ANNOUNCEMENT: "Tells a member their number was drawn and what they will receive.",
  WEEKLY_REMINDER: "Will nudge members about the week that is open.",
  GROUP_ANNOUNCEMENT: "Your own words, delivered to each member individually.",
};

const DAY_OPTIONS = [
  { value: "", label: "Not scheduled" },
  ...WEEKDAYS.map((d) => ({
    value: d,
    label: { SUN: "Sunday", MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday" }[d],
  })),
];

/** Every half hour. Enough choice to be useful, few enough to scan. */
const TIME_OPTIONS = [
  { value: "", label: "Not scheduled" },
  ...Array.from({ length: 48 }, (_, i) => {
    const hh = String(Math.floor(i / 2)).padStart(2, "0");
    const mm = i % 2 === 0 ? "00" : "30";
    return { value: `${hh}:${mm}`, label: `${hh}:${mm}` };
  }),
];

/**
 * The organizer's own clock, and the handful that matter here. `Intl` knows
 * hundreds; a list this long is a scroll, and the server accepts any zone the
 * runtime knows, so a name not listed here is still savable by other means.
 */
const TIMEZONE_OPTIONS = [
  { value: "UTC", label: "UTC — the platform's current clock" },
  { value: "America/New_York", label: "America/New_York — US Eastern" },
  { value: "America/Chicago", label: "America/Chicago — US Central" },
  { value: "America/Denver", label: "America/Denver — US Mountain" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles — US Pacific" },
  { value: "Africa/Addis_Ababa", label: "Africa/Addis_Ababa — Ethiopia" },
  { value: "Europe/London", label: "Europe/London" },
];

export function MessageTimingForm({ initial }: { initial: MessagingConfig }) {
  const router = useRouter();
  const [auto, setAuto] = useState<Record<string, boolean>>(
    Object.fromEntries(CONFIGURABLE_MESSAGE_KEYS.map((k) => [k, initial.message[k].auto])),
  );
  const [days, setDays] = useState<Record<string, string>>(
    Object.fromEntries(
      TIME_TRIGGERED_MESSAGE_KEYS.map((k) => [k, initial.message[k].schedule?.day ?? ""]),
    ),
  );
  const [times, setTimes] = useState<Record<string, string>>(
    Object.fromEntries(
      TIME_TRIGGERED_MESSAGE_KEYS.map((k) => [k, initial.message[k].schedule?.time ?? ""]),
    ),
  );
  const [timezone, setTimezone] = useState(initial.timezone);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  function touched() {
    setSave({ kind: "idle" });
  }

  const dirty =
    CONFIGURABLE_MESSAGE_KEYS.some((k) => auto[k] !== initial.message[k].auto) ||
    TIME_TRIGGERED_MESSAGE_KEYS.some(
      (k) =>
        days[k] !== (initial.message[k].schedule?.day ?? "") ||
        times[k] !== (initial.message[k].schedule?.time ?? ""),
    ) ||
    timezone !== initial.timezone;

  // Judged as he chooses, with the SAME pure rule the server refuses on, so a
  // half-set schedule is caught before the first write rather than after it.
  const scheduleProblems = TIME_TRIGGERED_MESSAGE_KEYS.map((k) => ({
    key: k,
    problem: scheduleProblem(days[k] ?? "", times[k] ?? ""),
  })).filter((p) => p.problem);

  async function handleSubmit() {
    if (scheduleProblems.length > 0) {
      const first = scheduleProblems[0];
      return setSave({ kind: "err", message: `${MESSAGE_LABEL[first.key]}: ${first.problem}` });
    }
    setSave({ kind: "saving" });
    try {
      // ONE WRITE PER CHANGED SETTING, and the refusal names which one landed.
      // "Nothing was saved" would be a lie the organizer would act on.
      for (const key of CONFIGURABLE_MESSAGE_KEYS) {
        if (auto[key] === initial.message[key].auto) continue;
        const r = await updateMessageAutoSend({ key, auto: auto[key] });
        if (!r.ok) {
          return setSave({ kind: "err", message: `${MESSAGE_LABEL[key]} not saved: ${r.error}` });
        }
      }
      for (const key of TIME_TRIGGERED_MESSAGE_KEYS) {
        const before = initial.message[key].schedule;
        if (days[key] === (before?.day ?? "") && times[key] === (before?.time ?? "")) continue;
        const r = await updateMessageSchedule({ key, day: days[key], time: times[key] });
        if (!r.ok) {
          return setSave({
            kind: "err",
            message: `${MESSAGE_LABEL[key]} timing not saved: ${r.error}`,
          });
        }
      }
      if (timezone !== initial.timezone) {
        const r = await updateEqubTimezone({ timezone });
        if (!r.ok) return setSave({ kind: "err", message: `The clock was not saved: ${r.error}` });
      }
      setSave({ kind: "ok", message: "Saved. Nothing sends differently until a message phase reads this." });
      router.refresh();
    } catch {
      setSave({ kind: "err", message: "Could not reach the server — nothing was saved." });
    }
  }

  return (
    <div className="space-y-4">
      <SettingList>
        {CONFIGURABLE_MESSAGE_KEYS.map((key) => {
          const reserved = isReservedMessageKey(key);
          const timeTriggered = (TIME_TRIGGERED_MESSAGE_KEYS as readonly string[]).includes(key);
          return (
            <div key={key}>
              <SettingSwitch
                label={MESSAGE_LABEL[key]}
                description={
                  <>
                    {MESSAGE_DESCRIPTION[key]}
                    {reserved && (
                      <>
                        {" "}
                        <span className="font-semibold text-amber-800 dark:text-amber-300">
                          Not built yet — this choice is kept for when it is.
                        </span>
                      </>
                    )}
                  </>
                }
                checked={auto[key]}
                onChange={(next) => {
                  touched();
                  setAuto((a) => ({ ...a, [key]: next }));
                }}
                tone={reserved ? "attention" : "neutral"}
                // THE EFFECT, NOT THE MECHANISM. "Automatic" names a setting;
                // this names what a member experiences (2.10).
                state={messageTimingSummary(key, {
                  auto: auto[key],
                  schedule:
                    timeTriggered && isWeekday(days[key]) && times[key]
                      ? { day: days[key] as never, time: times[key] }
                      : null,
                })}
              />
              {timeTriggered && (
                <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 dark:border-gray-800/60 px-5 py-3">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    It may send on
                  </span>
                  <Select
                    value={days[key] ?? ""}
                    onChange={(v) => {
                      touched();
                      setDays((d) => ({ ...d, [key]: v }));
                    }}
                    options={DAY_OPTIONS}
                    ariaLabel={`${MESSAGE_LABEL[key]} — day`}
                    className="w-44"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">at</span>
                  <Select
                    value={times[key] ?? ""}
                    onChange={(v) => {
                      touched();
                      setTimes((t) => ({ ...t, [key]: v }));
                    }}
                    options={TIME_OPTIONS}
                    ariaLabel={`${MESSAGE_LABEL[key]} — time`}
                    className="w-40"
                  />
                </div>
              )}
            </div>
          );
        })}
      </SettingList>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141414] p-5">
        <h3 className="text-sm font-bold text-gray-900 dark:text-white">
          The clock this equb runs on
        </h3>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-gray-700 dark:text-gray-300">
          Which midnight ends a payment week. Everything is measured in UTC today, so a
          Thursday deadline turns over at 8pm on the US east coast.
        </p>
        {/* SAID PLAINLY, BECAUSE A SAVE THAT LOOKS LIKE IT MOVED A DEADLINE AND
            DID NOT IS THE WORST OUTCOME HERE. */}
        <p className="mt-2 max-w-prose text-sm font-semibold text-amber-800 dark:text-amber-300">
          Stored only for now. Nothing measures a deadline against it yet — changing it today
          moves no due date and marks nobody late.
        </p>
        <div className="mt-3">
          <Select
            value={timezone}
            onChange={(v) => {
              touched();
              setTimezone(v);
            }}
            options={TIMEZONE_OPTIONS}
            ariaLabel="The clock this equb runs on"
            className="w-full max-w-md"
          />
        </div>
      </div>

      {save.kind === "err" && <Alert kind="err">{save.message}</Alert>}
      {save.kind === "ok" && <Alert kind="ok">{save.message}</Alert>}

      <SaveButton
        state={save}
        dirty={dirty}
        notDirtyHint="Change a switch or a time first."
        onSave={handleSubmit}
      />
    </div>
  );
}
