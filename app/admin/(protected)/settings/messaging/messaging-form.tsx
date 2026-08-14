"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  updateNotifyOnLockout,
  updatePortalUrl,
  updateWhatsappEnabled,
} from "@/app/actions/settings";
import { SettingList, SettingSwitch } from "@/components/admin/setting-row";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { Alert, inputCls } from "@/components/ui/primitives";
// From setting-defaults, NOT lib/settings: the latter imports Prisma, which
// imports `pg`, which imports node:dns — pulling that into a client bundle is
// a hard build failure that takes this whole page down with it.
import { WHATSAPP_DISABLED_REASON } from "@/lib/setting-defaults";
// COUNTED, NOT ASSERTED. The registry is client-safe (it imports only types
// and a leaf module — see lib/client-bundle-safety.test.ts), so the panel below
// can read what is actually approved rather than repeat a sentence about it.
import { APPROVED_TEMPLATE_KEYS, DRAFT_TEMPLATE_KEYS } from "@/lib/whatsapp-templates";
// The same pure rule the send path asks. lib/welcome-send.ts has no database
// import for exactly this reason — see the note above.
import { portalUrlProblem, portalUrlValue, welcomeSendCheck } from "@/lib/welcome-send";

export function MessagingForm({
  initial,
}: {
  initial: {
    whatsappEnabled: boolean;
    notifyOnLockout: boolean;
    portalUrl: string;
    /**
     * Read-only here. Its switch lives on Settings → Access, and it is shown
     * because it is half of whether the welcome can send — the organizer
     * should not have to discover that from a refusal.
     */
    defaultPinFromPhone: boolean;
    /**
     * Also read-only, also from Settings → Access, and the WIDER of the two.
     *
     * `defaultPinFromPhone` decides whether the phone digits work for a member
     * with no PIN; this decides whether a PIN works at all. With it off the
     * welcome's whole sign-in sentence is false — including for a member who
     * set their own PIN — so it has to be visible here beside the other half.
     */
    pinLoginEnabled: boolean;
  };
}) {
  const router = useRouter();
  const portalId = useId();
  const [whatsappEnabled, setWhatsappEnabled] = useState(initial.whatsappEnabled);
  const [notifyOnLockout, setNotifyOnLockout] = useState(initial.notifyOnLockout);
  // Coerced at the boundary for the same reason the send path does it: a
  // settings row holding anything but a string would put a non-string into a
  // controlled input, which React turns into an uncontrolled one mid-edit.
  const savedPortalUrl = portalUrlValue(initial.portalUrl);
  const [portalUrl, setPortalUrl] = useState(savedPortalUrl);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  function touched() {
    setSave({ kind: "idle" });
  }

  // Compared TRIMMED, because that is what the server stores — otherwise
  // adding a trailing space makes the form dirty and the save a no-op.
  const portalChanged = portalUrl.trim() !== savedPortalUrl;
  const dirty =
    whatsappEnabled !== initial.whatsappEnabled ||
    notifyOnLockout !== initial.notifyOnLockout ||
    portalChanged;

  // Judged as the organizer types, from the same function the server validates
  // with — so the box can never accept something the save then refuses.
  const urlProblem = portalUrlProblem(portalUrl);
  // What the welcome would do RIGHT NOW, against the typed value rather than
  // the saved one: the question the organizer is actually asking on this page
  // is "will the welcome go once I press save?".
  // The platform's own readiness. A member-specific override cannot show here
  // — this screen is about settings, not about one person — and `deliver()`
  // asks the same rule again with the member in hand.
  const welcome = welcomeSendCheck({
    portalUrl,
    defaultPinFromPhone: initial.defaultPinFromPhone,
    pinLoginEnabled: initial.pinLoginEnabled,
  });

  async function handleSubmit() {
    // REFUSED BEFORE THE FIRST WRITE, not after. Two of the three settings save
    // ahead of the address, so submitting a bad address would land those two
    // and then fail — leaving the organizer reading "not saved" about a form
    // that had partly saved.
    if (urlProblem) return setSave({ kind: "err", message: urlProblem });
    setSave({ kind: "saving" });
    try {
      // THREE SETTINGS, THREE WRITES. Any one can succeed and the next fail,
      // so the refusal names which one landed — "nothing was saved" would be
      // a lie the organizer would act on.
      if (whatsappEnabled !== initial.whatsappEnabled) {
        const r = await updateWhatsappEnabled({ enabled: whatsappEnabled });
        if (!r.ok) return setSave({ kind: "err", message: `WhatsApp not saved: ${r.error}` });
      }
      if (notifyOnLockout !== initial.notifyOnLockout) {
        const r = await updateNotifyOnLockout({ enabled: notifyOnLockout });
        if (!r.ok)
          return setSave({ kind: "err", message: `The lockout notice was not saved: ${r.error}` });
      }
      if (portalChanged) {
        const r = await updatePortalUrl({ url: portalUrl });
        if (!r.ok)
          return setSave({ kind: "err", message: `The sign-in address was not saved: ${r.error}` });
      }
      setSave({
        kind: "ok",
        message:
          `Saved — sign-in codes are ${whatsappEnabled ? "ON" : "OFF"}` +
          (portalChanged
            ? portalUrl.trim() === ""
              ? ", and there is no member sign-in address — the welcome will not send."
              : `, and members are sent to ${portalUrl.trim()}.`
            : "."),
      });
      router.refresh();
    } catch {
      setSave({ kind: "err", message: "Could not reach the server — nothing was saved." });
    }
  }

  return (
    <div className="space-y-6">
      <SettingList>
        <SettingSwitch
          label="WhatsApp"
          tone={whatsappEnabled ? "neutral" : "danger"}
          checked={whatsappEnabled}
          onChange={(v) => {
            setWhatsappEnabled(v);
            touched();
          }}
          description={
            <>
              The switch for WhatsApp <strong>sign-in codes</strong>. While it is off nothing
              is attempted: sends are refused before they reach Twilio, so none are billed and
              no member is offered a code that cannot arrive.
              <br />
              {/* ALSO FALSE SINCE 7 AUGUST. This said statements and payment
                  confirmations were "blocked for a different reason that no
                  setting can change" — they are not blocked, they send. What
                  is true is the opposite and more useful: this switch is the
                  master, and turning it off stops those too. */}
              <span className="mt-1 block">
                It is the <strong>master</strong> switch. Statements and payment confirmations
                use approved templates and send normally, but nothing at all leaves over
                WhatsApp while this is off.
              </span>
            </>
          }
          state={
            whatsappEnabled ? (
              <span className="text-emerald-700 dark:text-emerald-400">
                ON — sign-in codes are sent
              </span>
            ) : (
              <span className="text-red-800 dark:text-red-400">
                OFF — no codes are sent, and the sign-in screen does not offer it
              </span>
            )
          }
        />
        {/* DISABLED, NOT REMOVED (reconciliation Build 1, item 5). The switch
            promised a send that cannot happen: LOCKOUT_NOTICE deliberately has
            no Meta-approved template — it is a security message, and
            submitting one risks the whole sender — so with this ON the
            organizer believed locked-out members were being told, and nobody
            was. The setting row stays (the value survives; nothing forgets
            his choice) but the control refuses until the notice has a real
            channel, which is Twilio Verify. Disabled rather than hidden:
            UI_STANDARDS 6b, a control that vanishes leaves him hunting for
            something he used yesterday. */}
        <SettingSwitch
          label="Notice when a member locks themselves out"
          checked={notifyOnLockout}
          disabled
          onChange={() => {}}
          description={
            <>
              Cannot send yet, so it cannot be switched on: the Lockout notice has no
              Meta-approved template — deliberately, because it is a security message and
              submitting one risks the whole sender. Its intended channel is Twilio Verify,
              which is not built. Until then a lockout sends nothing, whatever this switch says.
            </>
          }
        />
        {/* A TEXT ROW, HAND-BUILT. components/admin/setting-row.tsx offers a
            switch and a number and no text field; this matches SettingNumber's
            shape so the list stays one list (UI_STANDARDS rule 3). The right
            home for it is a SettingText in that file, and the next text setting
            should move it there rather than make a third copy. */}
        <div className="px-5 py-4">
          <label
            htmlFor={portalId}
            className="block text-sm font-bold text-gray-900 dark:text-white"
          >
            Member sign-in address
          </label>
          <p
            id={`${portalId}-desc`}
            className="mt-1 max-w-prose text-sm leading-relaxed text-gray-700 dark:text-gray-300"
          >
            The address the <strong>welcome message</strong> tells a new member to open. It is
            the only place this is written down, so it is typed once and in full — exactly as a
            member would open it, starting with <code>https://</code>. There is no default: a
            guess taken from whatever host is serving this page would end up in a message that
            cannot be recalled.
          </p>
          <input
            id={portalId}
            type="url"
            inputMode="url"
            value={portalUrl}
            placeholder="https://…"
            aria-describedby={`${portalId}-desc`}
            aria-invalid={urlProblem !== null}
            onChange={(e) => {
              setPortalUrl(e.target.value);
              touched();
            }}
            className={inputCls + " mt-2 max-w-md"}
          />
          {urlProblem && (
            <p className="mt-1.5 text-sm font-semibold text-red-800 dark:text-red-400">
              {urlProblem}
            </p>
          )}
        </div>
      </SettingList>

      {/* THE WELCOME'S STATE, STATED WHERE IT CAN BE FIXED.
          Both halves are settings, and one of them lives on another page — so
          without this the organizer discovers the problem as a refused send
          after he has already decided to welcome someone. */}
      {welcome.ok ? (
        <Alert kind="info">
          <strong>Nothing on this page is stopping the welcome message.</strong>
          <span className="mt-1 block">
            It still has no approved WhatsApp template of its own, which is the same kind of
            block the notice below describes and is not something a setting can change. What
            these two answer for is the message being TRUE when it does send: an address a member
            can open, and a PIN that works. Sending it to someone is what requires their
            signature; they read and sign their agreement the next time they sign in.
          </span>
        </Alert>
      ) : (
        <Alert kind="err">
          <strong>The welcome message would not be true, so it will not send.</strong>
          {welcome.reasons.map((reason) => (
            <span key={reason} className="mt-1 block">
              {reason}
            </span>
          ))}
          {!initial.defaultPinFromPhone && (
            <span className="mt-1 block">
              <Link
                href="/admin/settings/access"
                className="font-semibold text-indigo-700 dark:text-indigo-300 hover:underline"
              >
                Open Access settings →
              </Link>
            </span>
          )}
        </Alert>
      )}

      {/* WHAT IS ACTUALLY TRUE ABOUT TEMPLATES, COUNTED FROM THE REGISTRY.
          This said "Statements need Meta-approved templates, and none are
          registered" — unconditionally, in red, since before Meta approved
          five of them on 7 August 2026. A reason string that outlives its
          cause is a lie the organizer cannot check, and this one had been
          contradicting the platform's own behaviour for days: statements were
          sending while the settings screen said they could not.

          Counted rather than stated, so it cannot go stale a second time —
          registering a ContentSid changes this paragraph by itself. */}
      <Alert kind={APPROVED_TEMPLATE_KEYS.length > 0 ? "info" : "err"}>
        <strong>
          {APPROVED_TEMPLATE_KEYS.length === 0
            ? "No message type is approved, so no statement can be delivered."
            : `${APPROVED_TEMPLATE_KEYS.length} message types are approved by Meta and send normally.`}
          {DRAFT_TEMPLATE_KEYS.length > 0 &&
            ` ${DRAFT_TEMPLATE_KEYS.length} more ${
              DRAFT_TEMPLATE_KEYS.length === 1 ? "is drafted and waiting" : "are drafted and waiting"
            } to be submitted.`}
        </strong>
        <span className="mt-1 block">
          Each approved type sends Meta&apos;s own wording with this member&apos;s figures in
          it — which is why the wording is read-only under Messages. A drafted type cannot
          send at all until it is submitted and its ContentSid recorded.
        </span>
        <span className="mt-1 block">
          What is still not possible is a <strong>freeform</strong> message. Meta accepts one
          only within 24 hours of the member&apos;s own last reply to the Equb sender, and this
          account has had one inbound message ever (19 May 2026) — so that window is open for
          nobody. Sign-in codes are unaffected: Twilio Verify sends a pre-approved template,
          which needs no window.
        </span>
      </Alert>

      {!whatsappEnabled && (
        <Alert kind="info">
          <strong>Why codes are off:</strong> {WHATSAPP_DISABLED_REASON}
        </Alert>
      )}

      {/* Both switches are a long scroll above this; the confirmation stays
          with the button that was pressed (rule 6). */}
      <SaveButton
        state={save}
        onSave={() => void handleSubmit()}
        onStateSettled={() => setSave({ kind: "idle" })}
        label="Save changes"
        dirty={dirty}
        notDirtyHint="Nothing has changed yet."
      />
    </div>
  );
}
