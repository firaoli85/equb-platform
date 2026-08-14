"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from "firebase/auth";
import { lookupMemberByPhone } from "@/app/actions/member";
import {
  requestWhatsAppCode,
  setMyPin,
  signInWithFirebaseSms,
  signInWithPin,
  signInWithWhatsAppCode,
} from "@/app/actions/auth";
import { SaveButton, type SaveState } from "@/components/ui/save-button";
import { auth, firebaseMissingClientConfig, RECAPTCHA_CONTAINER_ID } from "@/lib/firebase/client";
import { CodeInput } from "@/components/member/code-input";
import { motionTokens } from "@/lib/motion-tokens";
import {
  RESEND_COOLDOWN_SECONDS,
  resendBypassesCooldown,
  resendIsTheRemedy,
  resendState,
} from "@/lib/resend-countdown";
import {
  isValidE164,
  smsErrorLogLine,
  smsErrorMessage,
  SMS_SEND_TIMEOUT_MS,
  withTimeout,
} from "@/lib/sms-login";

// The two-step member login, in the portal's own visual system so entry
// feels continuous: (1) phone number → (2) bilingual welcome + method
// picker. PIN is the default while it is enabled; the toggles are enforced
// server-side — this UI only reflects them (2.6).
//
// 2.28 (channel honesty): the screen offers ONLY channels that are actually
// configured, and the server decides which those are — this UI never guesses.
// Today that is PIN, the WhatsApp code (Twilio Verify sends a pre-approved
// template, so it needs no 24-hour service window and works), and SMS where
// Firebase is configured.
//
// UI_STANDARDS RULE 6 — WHAT IS A SAVE ON THIS SCREEN, AND WHAT IS NOT.
//
// SIGNING IN IS NOT A SAVE, so the phone lookup, the PIN pad, the WhatsApp
// code and the SMS code are all EXEMPT from `SaveButton`. Two of its four
// beats have no meaning on them: nothing is being edited, so there is no
// dirty state to gate a button on (beat 1), and SUCCESS IS THE NEXT PAGE
// (beat 3) — `goToPortal()` replaces the whole document, so a "✓ Saved"
// beside the button would confirm a screen the member has already left.
//
// What they DO owe is beat 4 / rule 6b: THE REFUSAL, AT THE CONTROL, in the
// server's own words — the lockout sentence from signInWithPin, the Twilio
// refusal from requestWhatsAppCode, the Firebase mapping in lib/sms-login.
// That is what `ErrorMsg` carries, and it now renders directly UNDER the
// button that was pressed rather than above it: an alert that appears above
// a button pushes the button down, out from under the thumb, at the exact
// moment it appears.
//
// EXACTLY ONE THING HERE IS A SAVE: "Save my PIN" on the last step writes a
// credential that outlives this session and every later sign-in reads. It
// gets the real thing — `SaveButton`, which owns all four beats and leaves
// nowhere else to put the message (components/ui/save-button.tsx).

type Lookup = {
  phone: string;
  nameEnglishFirst: string;
  nameAmharic: string;
  pinAvailable: boolean;
  /** 2.28: the server says which CHANNELS are configured on this deployment. */
  whatsAppAvailable: boolean;
  smsAvailable: boolean;
};

const PAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", "back"],
] as const;

const MAX_PIN = 8;
const MIN_PIN = 4;

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <p
      role="alert"
      className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg border border-red-100 dark:border-red-900"
    >
      {msg}
    </p>
  );
}

function DigitPad({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {PAD_ROWS.flat().map((key, idx) => {
        if (key === "") return <div key={idx} />;
        const isBackspace = key === "back";
        const keyDisabled =
          disabled || (isBackspace ? value.length === 0 : value.length >= MAX_PIN);
        return (
          <button
            key={idx}
            type="button"
            onClick={() =>
              isBackspace ? onChange(value.slice(0, -1)) : onChange(value + key)
            }
            disabled={keyDisabled}
            aria-label={isBackspace ? "Delete last digit" : key}
            style={{ touchAction: "manipulation" }}
            className="flex items-center justify-center h-14 rounded-2xl text-xl font-bold transition-colors active:scale-95 disabled:opacity-40 select-none text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            {isBackspace ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414 6.414a2 2 0 001.414.586H19a2 2 0 002-2V7a2 2 0 00-2-2h-8.172a2 2 0 00-1.414.586L3 12z"
                />
              </svg>
            ) : (
              key
            )}
          </button>
        );
      })}
    </div>
  );
}

function PinDots({ length }: { length: number }) {
  // Exactly the digits entered: 4 slots by default (a 4-digit PIN reads as
  // COMPLETE), growing only when a 5th+ digit is actually typed — never a
  // phantom empty slot trailing the input.
  const slots = Math.max(MIN_PIN, Math.min(length, MAX_PIN));
  return (
    <div className="flex justify-center gap-4" aria-label={`${length} digits entered`}>
      {Array.from({ length: slots }).map((_, i) => (
        <div
          key={i}
          // Named properties, never `transition-all`: `all` animates every
          // computed property the class flip touches, including layout ones,
          // and the three that actually change here are cheap and composited.
          className={`w-4 h-4 rounded-full border-2 transition-[background-color,border-color,transform] duration-150 ease-out motion-reduce:transition-none ${
            length > i ? "bg-indigo-600 border-indigo-600 scale-110" : "border-gray-300 dark:border-gray-600"
          }`}
        />
      ))}
    </div>
  );
}

export function LoginFlow() {
  const reduce = useReducedMotion();

  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phonePending, startLookup] = useTransition();

  // Three doors (2.28): PIN, WhatsApp code, SMS code. Only configured ones
  // are ever offered — a member must never reach a dead end.
  const [choice, setChoice] = useState<"none" | "pin" | "otp" | "sms">("none");

  // PIN state
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifying, startVerify] = useTransition();

  // Post-login "set your own PIN" prompt. Skippable after PIN RECOVERY;
  // REQUIRED after a phone-digit default sign-in (audit C2) — that default
  // is not a secret and must not survive the sign-in that used it.
  const [promptSetPin, setPromptSetPin] = useState(false);
  const [usedDefault, setUsedDefault] = useState(false);
  const [newPin, setNewPin] = useState("");
  // THE ONE SAVE ON THIS SCREEN (rule 6). ONE state, where there used to be a
  // (savingPin, newPinError) pair: "is it saving?" is DERIVED from it below,
  // never kept a second time. Two records of one fact are two records that can
  // disagree — the pad staying live while the button says "Saving…" is exactly
  // that disagreement.
  const [pinSave, setPinSave] = useState<SaveState>({ kind: "idle" });
  const savingPin = pinSave.kind === "saving";
  /** The first of the two entries, held while the pad collects the second. */
  const [firstPin, setFirstPin] = useState<string | null>(null);

  // OTP state
  const [otpStep, setOtpStep] = useState<"idle" | "sending" | "sent" | "verifying">("idle");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  // True when the member came through "Forgot your PIN?" — after the
  // code signs them in, they are offered a NEW PIN (skippable).
  const [recovering, setRecovering] = useState(false);
  /** WHICH failure the last check was — decides whether resend is the remedy. */
  const [otpOutcome, setOtpOutcome] = useState<string | null>(null);
  /** Seconds until "Send it again" becomes pressable. */
  const [otpCooldown, setOtpCooldown] = useState(0);
  /** Bumped to pull focus back to the first digit box. */
  const [otpFocusToken, setOtpFocusToken] = useState(0);
  /** Live-region text — the only confirmation a screen reader gets on resend. */
  const [otpAnnounce, setOtpAnnounce] = useState("");

  // SMS state (Firebase Phone Auth — Google sends the code, so no carrier
  // A2P registration is involved).
  const [smsStep, setSmsStep] = useState<"idle" | "sending" | "sent" | "verifying">("idle");
  const [smsCode, setSmsCode] = useState("");
  const [smsError, setSmsError] = useState<string | null>(null);
  const confirmation = useRef<ConfirmationResult | null>(null);
  // useState, not a ref — matching equb-app, where the verifier lives in
  // component state. A ref would avoid a re-render, but a re-render is a
  // difference in how the page behaves around the widget, and that is exactly
  // the class of difference this port stops guessing about.
  const [recaptchaVerifier, setRecaptchaVerifier] = useState<RecaptchaVerifier | null>(null);

  const welcomeName = lookup
    ? lookup.nameEnglishFirst && lookup.nameAmharic
      ? `${lookup.nameEnglishFirst} / ${lookup.nameAmharic}`
      : lookup.nameEnglishFirst || lookup.nameAmharic || "Member"
    : "";
  const avatarInitial = lookup
    ? ([...(lookup.nameEnglishFirst || lookup.nameAmharic || "?")][0] ?? "?")
    : "?";

  // The resend cooldown, ticking down once per second and stopping at zero.
  // One interval, cleared on unmount — a timer left running after the member
  // has signed in would keep the component alive for nothing.
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const id = setInterval(() => setOtpCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [otpCooldown]);

  // ── Step 1: phone lookup ────────────────────────────────────────
  function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhoneError(null);
    startLookup(async () => {
      try {
        const result = await lookupMemberByPhone({ phone: phoneInput });
        if (!result.ok) {
          setPhoneError(result.error);
          return;
        }
        setLookup(result.data);
        setChoice(result.data.pinAvailable ? "none" : "otp");
      } catch {
        setPhoneError("Could not reach the server. Try again.");
      }
    });
  }

  function clearCodeState() {
    setOtpStep("idle");
    setOtpCode("");
    setOtpError(null);
    setSmsStep("idle");
    setSmsCode("");
    setSmsError(null);
    confirmation.current = null;
    // The verifier is deliberately NOT touched here. equb-app's three reset
    // paths (backToOptions, handlePhoneAction, resetAll) all clear
    // confirmationResult and leave recaptchaVerifier alone — it is cleared at
    // the start of the next send instead. Matched.
  }

  function resetToPhone() {
    setLookup(null);
    setChoice("none");
    setPin("");
    setPinError(null);
    clearCodeState();
    setRecovering(false);
  }

  function backToOptions() {
    setChoice("none");
    setPin("");
    setPinError(null);
    clearCodeState();
    setRecovering(false);
  }

  // "Forgot your PIN?" — a code is the way in; once signed in, they are
  // offered a fresh PIN.
  //
  // STRAIGHT TO WHATSAPP, ALWAYS. This used to route through a helper that
  // PREFERRED SMS whenever it was configured — under a button that says "Get
  // a WhatsApp code". SMS is §6.1's parked channel: it fails locally with
  // auth/invalid-app-credential and is unproven in production, so recovery
  // rode the one channel known to be broken while promising the one known to
  // work. WhatsApp is the sole primary recovery channel; SMS stays where it
  // already lives — the general sign-in picker — labelled as maybe
  // unavailable, and nothing routes to it implicitly.
  function startPinRecovery() {
    if (!lookup) return;
    setRecovering(true);
    setPin("");
    setPinError(null);
    setChoice("otp");
    void sendOtp(lookup);
  }

  // ── PIN ─────────────────────────────────────────────────────────
  function submitPin() {
    if (!lookup || pin.length < MIN_PIN || verifying) return;
    startVerify(async () => {
      try {
        const result = await signInWithPin({ phone: lookup.phone, pin });
        if (!result.ok) {
          setPinError(result.error);
          setPin("");
          return;
        }
        // ORGANIZER'S RULING: the phone-digit default signs in DIRECTLY —
        // they are already in by the time this runs. What follows is an
        // INVITATION to set their own PIN, never a wall: friction a member
        // does not understand is worse than the risk, and the risk is
        // answered by the session layer instead.
        if (result.data.usedDefaultPin) {
          setUsedDefault(true);
          setPromptSetPin(true);
          return;
        }
        goToPortal();
      } catch {
        setPinError("Could not reach the server. Try again.");
        setPin("");
      }
    });
  }

  function goToPortal() {
    // Hard navigation for the login handoff: a router.push fired inside an
    // async transition can fail to commit, and a full load starts the portal
    // on a fresh session anyway.
    window.location.assign("/me");
  }

  /**
   * The save (rule 6). Every message it produces renders at the button, which
   * is the only place `SaveButton` can put one.
   */
  async function saveOwnPin() {
    if (newPin.length < MIN_PIN || savingPin) return;
    // TWICE, ON ONE PAD (organizer, Aug 2026). The first press stashes the
    // entry and clears the pad for the confirmation; only a matching second
    // entry reaches the server. A mismatch is a typing problem, said at the
    // control, and starts the pair over — masked digits cannot be proofread,
    // so re-entry IS the proofreading.
    if (firstPin === null) {
      setFirstPin(newPin);
      setNewPin("");
      setPinSave({ kind: "idle" });
      return;
    }
    if (newPin !== firstPin) {
      setFirstPin(null);
      setNewPin("");
      setPinSave({
        kind: "err",
        message: "The two PINs don't match — start again and enter the same PIN twice.",
      });
      return;
    }
    setPinSave({ kind: "saving" });
    try {
      const result = await setMyPin({ pin: newPin });
      if (!result.ok) {
        // THE SERVER'S OWN REASON, prefixed so the state is unmistakable
        // ("PIN must be 4 to 8 digits.", "Not signed in."). The digits stay
        // in the pad: a refusal costs a retry, never a retype.
        setPinSave({ kind: "err", message: `Not saved: ${result.error}` });
        return;
      }
      // WHAT HAPPENED, WITH THE FIGURE — how many digits are now their PIN.
      // Never the digits themselves, and a member-facing count rather than
      // any cycle week number (8c).
      setPinSave({
        kind: "ok",
        message:
          (usedDefault
            ? `Saved — your new ${newPin.length}-digit PIN is set. Your phone's last 4 digits will not sign you in any more.`
            : `Saved — your new ${newPin.length}-digit PIN is set. Use it the next time you sign in.`) +
          " Anywhere else you were signed in has been signed out.",
      });
      // The confirmation is set BEFORE the handoff on purpose: the portal is a
      // full document load, so the message stands at the button for as long as
      // the member is still looking at this screen. Success is then the portal
      // itself — see the note above `goToPortal`.
      goToPortal();
    } catch {
      setPinSave({ kind: "err", message: "Not saved: could not reach the server. Try again." });
    }
  }

  // ── SMS code (Firebase Phone Auth) ──────────────────────────────
  //
  // Google sends the message, so no carrier A2P registration is involved —
  // which is why this channel works where our own SMS never could. The code
  // is confirmed IN THE BROWSER by Firebase, then the resulting ID TOKEN goes
  // to the server, which verifies it with Google before minting a session.
  // The server never trusts a bare phone number here.

  /**
   * NEVER SWALLOW THE REASON. Logs the real error FIRST — code, name, message,
   * plus the object itself so the stack is expandable — then returns the text
   * the member sees. The mapping and the log line are tested in lib/sms-login.
   */
  function reportSmsError(stage: "send" | "verify", error: unknown): string {
    console.error(smsErrorLogLine(stage, error), error);
    return smsErrorMessage(error);
  }

  async function sendSms(l: Lookup) {
    if (smsStep === "sending" || smsStep === "verifying") return;
    setSmsStep("sending");
    setSmsError(null);
    setSmsCode("");
    try {
      // 1. Is the client actually configured? Say WHICH value is missing —
      //    "not available" with no detail is another silent failure.
      const missing = firebaseMissingClientConfig();
      if (missing.length > 0) {
        console.error(
          `[SMS send] Firebase is not configured in the browser bundle. Missing: ${missing.join(", ")}. ` +
            `NEXT_PUBLIC_ values are inlined at BUILD time — restart the dev server after editing .env.local.`,
        );
        setSmsError("Text-message codes aren't available. Use WhatsApp or your PIN.");
        setSmsStep("idle");
        return;
      }

      // 2. The number must be E.164 before Firebase sees it. An invalid value
      //    is rejected client-side with no network call — indistinguishable
      //    from every other silent failure unless it is named here.
      if (!isValidE164(l.phone)) {
        console.error(
          `[SMS send] Phone number is not valid E.164: ${JSON.stringify(l.phone)}. ` +
            `Firebase rejects this before making any request.`,
        );
        setSmsError("That phone number is not in a valid format. Contact the organizer.");
        setSmsStep("idle");
        return;
      }

      // 3. VERBATIM PORT of equb-app handleSendSms — the five lines below are
      //    character-for-character what the working build does:
      //
      //        if (recaptchaVerifier) {
      //          recaptchaVerifier.clear();
      //          setRecaptchaVerifier(null);
      //        }
      //        const verifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
      //        setRecaptchaVerifier(verifier);
      //        const result = await signInWithPhoneNumber(auth, phone, verifier);
      //
      //    UNDONE TO GET HERE, because each touched how the widget is mounted
      //    and mounting is what reCAPTCHA scores when it mints a token:
      //      - the verifier was passed an HTMLElement; it is now the container
      //        ID STRING, as there.
      //      - each attempt rendered into a freshly created child node; it now
      //        renders into #recaptcha-container itself, as there.
      //      - the verifier lived in a ref; it is now useState, as there.
      //      - the catch block cleared the verifier; it no longer does. The
      //        working app clears at the START of the next attempt instead, and
      //        that ordering is now matched.
      //
      //    The ONE addition is the innerHTML reset directly below. On a first
      //    attempt the container is empty, so it is a no-op and the ported path
      //    is untouched; it exists only so a SECOND attempt does not die on
      //    "reCAPTCHA has already been rendered in this element", which clear()
      //    alone does not prevent.
      const container = document.getElementById(RECAPTCHA_CONTAINER_ID);
      if (!container) {
        console.error(
          `[SMS send] #${RECAPTCHA_CONTAINER_ID} is not in the DOM — RecaptchaVerifier cannot mount.`,
        );
        setSmsError("SMS sign-in could not start on this page. Reload and try again.");
        setSmsStep("idle");
        return;
      }
      if (recaptchaVerifier) {
        recaptchaVerifier.clear();
        setRecaptchaVerifier(null);
        container.innerHTML = "";
      }
      const verifier = new RecaptchaVerifier(auth, RECAPTCHA_CONTAINER_ID, { size: "invisible" });
      setRecaptchaVerifier(verifier);

      console.info(`[SMS send] requesting a code for ${l.phone}…`);

      // A HANG IS ALSO A SILENT FAILURE — and it is the one that was
      // happening here.
      //
      // signInWithPhoneNumber awaits RecaptchaVerifier.verify(), which
      // resolves ONLY when reCAPTCHA hands back a token. When reCAPTCHA
      // decides to challenge the visitor (the "select all…" overlay), that
      // token arrives only after a human solves it — and if the visitor never
      // does, or dismisses the overlay, the promise NEVER settles. No
      // rejection, no request, no console error: the button just says
      // "Sending…" forever.
      //
      // KEPT despite not being in the working app, because it provably cannot
      // affect token minting: withTimeout races a timer against the SAME
      // promise and touches neither the verifier, the container, nor the
      // token. It changes only how long we are willing to wait before saying
      // what happened.
      confirmation.current = await withTimeout(
        signInWithPhoneNumber(auth, l.phone, verifier),
        SMS_SEND_TIMEOUT_MS,
      );
      console.info("[SMS send] code request accepted by Firebase.");
      setSmsStep("sent");
    } catch (err) {
      // The working app does NOT clear the verifier here — it clears at the
      // start of the next attempt. Matched.
      setSmsError(reportSmsError("send", err));
      setSmsStep("idle");
    }
  }

  async function verifySms(e: React.FormEvent) {
    e.preventDefault();
    if (!lookup || smsStep === "verifying" || !confirmation.current) return;
    setSmsStep("verifying");
    setSmsError(null);
    try {
      // Firebase checks the code and hands back a signed identity.
      const credential = await confirmation.current.confirm(smsCode);
      const idToken = await credential.user.getIdToken();
      const result = await signInWithFirebaseSms({ phone: lookup.phone, idToken });
      if (!result.ok) {
        setSmsError(result.error);
        setSmsStep("sent");
        setSmsCode("");
        return;
      }
      if (recovering || usedDefault) {
        setPromptSetPin(true);
        return;
      }
      goToPortal();
    } catch (err) {
      setSmsError(reportSmsError("verify", err));
      setSmsStep("sent");
      setSmsCode("");
    }
  }

  // ── WhatsApp code (Twilio Verify) ───────────────────────────────
  async function sendOtp(l: Lookup) {
    if (otpStep === "sending" || otpStep === "verifying") return;
    setOtpStep("sending");
    setOtpError(null);
    setOtpOutcome(null);
    setOtpCode("");
    setOtpAnnounce("");
    try {
      const result = await requestWhatsAppCode({ phone: l.phone });
      if (!result.ok) {
        setOtpError(result.error);
        setOtpStep("idle");
        return;
      }
      setOtpStep("sent");
      // The cooldown restarts from every send, including a resend.
      setOtpCooldown(RESEND_COOLDOWN_SECONDS);
      // Announced rather than only shown: a member on a screen reader who
      // presses "Send it again" gets no other confirmation that anything
      // happened, because the button simply returns to its countdown.
      setOtpAnnounce("Code sent");
      setOtpFocusToken((n) => n + 1);
    } catch {
      setOtpError("Could not send the code. Try again.");
      setOtpStep("idle");
    }
  }

  async function verifyOtp(e?: React.FormEvent) {
    e?.preventDefault();
    // The single guard against a double check. Auto-submit fires from the
    // sixth digit and the button is still pressable, so both routes land here
    // — and a second check spends one of the verification's limited attempts.
    if (!lookup || otpStep === "verifying") return;
    setOtpStep("verifying");
    setOtpError(null);
    setOtpOutcome(null);
    try {
      const result = await signInWithWhatsAppCode({ phone: lookup.phone, code: otpCode });
      if (!result.ok) {
        setOtpError(result.error);
        // Not every refusal carries an outcome — the throttle and the
        // "enter the code" guard return before Twilio is ever reached, and
        // neither has a Verify outcome to report. Those leave it null, which
        // offers no remedy rather than the wrong one.
        setOtpOutcome("outcome" in result ? result.outcome : null);
        setOtpStep("sent");
        // Cleared and refocused: the member retypes without hunting for the
        // box, and a stale wrong code cannot be resubmitted by accident.
        setOtpCode("");
        setOtpFocusToken((n) => n + 1);
        return;
      }
      if (recovering || usedDefault) {
        // Recovery: signed in now, offer a new PIN (skippable).
        // After a phone-digit default: setting a real PIN is REQUIRED — the
        // default must not survive the sign-in that used it (audit C2).
        setPromptSetPin(true);
        return;
      }
      goToPortal();
    } catch {
      setOtpError("Could not reach the server. Try again.");
      setOtpStep("sent");
    }
  }

  const step = promptSetPin
    ? "setpin"
    : lookup === null
      ? "phone"
      : choice === "none"
        ? "picker"
        : choice;

  return (
    <>
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        initial={{ opacity: 0, x: reduce ? 0 : motionTokens.distance.sm }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: reduce ? 0 : -motionTokens.distance.sm }}
        transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
      >
        {/* ── STEP 1 — phone ── */}
        {step === "phone" && (
          <div>
            <div className="flex flex-col items-center gap-3 mb-7">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-sm">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="text-center">
                <h1 className="text-xl font-black text-gray-900 dark:text-white leading-tight">Equb</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Sign in to your account</p>
              </div>
            </div>

            <form onSubmit={handlePhoneSubmit} className="space-y-3">
              <div>
                <label htmlFor="login-phone" className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  Phone number
                </label>
                <input
                  id="login-phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  placeholder="(555) 000-0000"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  style={{ fontSize: "16px", fontVariantNumeric: "tabular-nums" }}
                  className="w-full px-3.5 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-600 transition-colors"
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                  Use the number you registered with your Equb
                </p>
              </div>

              <button
                type="submit"
                disabled={phonePending || !phoneInput.trim()}
                style={{ touchAction: "manipulation" }}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
              >
                {phonePending ? "Looking up…" : "Continue"}
              </button>

              {/* EXEMPT from SaveButton (no save here) but not from rule 6b:
                  the reason sits UNDER the button that was pressed. Above it,
                  the alert appearing shoved the button down out from under
                  the thumb at the moment it appeared. */}
              {phoneError && <ErrorMsg msg={phoneError} />}
            </form>
          </div>
        )}

        {/* ── STEP 2 — method picker ── */}
        {step === "picker" && lookup && (
          <div>
            <div className="flex flex-col items-center gap-2 mb-5">
              <div className="w-10 h-10 rounded-full bg-blue-200/60 dark:bg-white/15 flex items-center justify-center select-none" aria-hidden="true">
                <span className="text-base font-black text-blue-800 dark:text-white leading-none">{avatarInitial}</span>
              </div>
              <div className="text-center">
                <p className="text-base font-black text-gray-900 dark:text-white leading-tight text-balance">
                  Welcome back, {welcomeName}
                </p>
              </div>
            </div>

            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
              Choose how to sign in
            </p>

            <div className="space-y-2">
              {lookup.pinAvailable && (
                <button
                  type="button"
                  onClick={() => setChoice("pin")}
                  style={{ touchAction: "manipulation", minHeight: "56px" }}
                  className="w-full flex items-center gap-3 px-4 rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 hover:border-indigo-300 dark:hover:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                >
                  <svg className="w-5 h-5 text-indigo-500 dark:text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                    />
                  </svg>
                  <span className="flex-1 text-left">
                    <span className="block text-sm font-bold text-gray-900 dark:text-white">Enter my PIN</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">Your code · fastest</span>
                  </span>
                  <svg className="w-4 h-4 text-indigo-400 dark:text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}

              {/* 2.28 — a channel appears only when it is CONFIGURED. An
                  option that dead-ends is worse than no option. */}
              {lookup.smsAvailable && (
                <button
                  type="button"
                  onClick={() => {
                    setChoice("sms");
                    void sendSms(lookup);
                  }}
                  style={{ touchAction: "manipulation", minHeight: "56px" }}
                  className="w-full flex items-center gap-3 px-4 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#141414] hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  <svg className="w-5 h-5 text-gray-500 dark:text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 10.5h8m-8 3h5m-9 3.75V6.75A2.25 2.25 0 015.25 4.5h13.5A2.25 2.25 0 0121 6.75v7.5a2.25 2.25 0 01-2.25 2.25H7.5L3 20.25z"
                    />
                  </svg>
                  <span className="flex-1 text-left">
                    <span className="block text-sm font-bold text-gray-900 dark:text-white">Text me a code</span>
                    {/* HONEST ABOUT §6.1: the SMS channel is parked — it fails
                        locally and is unproven in production. It stays on this
                        picker rather than being deleted, and it says so. */}
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      6-digit code by SMS — may not be available yet
                    </span>
                  </span>
                  <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}

              {lookup.whatsAppAvailable && (
                <button
                  type="button"
                  onClick={() => {
                    setChoice("otp");
                    void sendOtp(lookup);
                  }}
                  style={{ touchAction: "manipulation", minHeight: "56px" }}
                  className="w-full flex items-center gap-3 px-4 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#141414] hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  <svg className="w-5 h-5 text-gray-500 dark:text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
                    />
                  </svg>
                  <span className="flex-1 text-left">
                    <span className="block text-sm font-bold text-gray-900 dark:text-white">WhatsApp me a code</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">6-digit code on WhatsApp</span>
                  </span>
                  <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}

              {!lookup.pinAvailable && !lookup.smsAvailable && !lookup.whatsAppAvailable && (
                <p
                  role="alert"
                  className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg border border-red-100 dark:border-red-900"
                >
                  No sign-in method is available for you right now. Contact the organizer.
                </p>
              )}
            </div>

            <div className="text-center pt-4">
              <button
                type="button"
                onClick={resetToPhone}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                ← Use a different number
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3a — PIN pad ── */}
        {step === "pin" && lookup && (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Enter your PIN</p>
              {/* The hint that used to appear here was driven by hasOwnPin,
                  which the UNAUTHENTICATED lookup had to disclose — a public
                  list of who was still on the default (audit C2). Members who
                  have no PIN are guided after the attempt instead. */}
              <PinDots length={pin.length} />
            </div>

            <DigitPad
              value={pin}
              onChange={(next) => {
                if (verifying) return;
                setPin(next.slice(0, MAX_PIN));
                setPinError(null);
              }}
              disabled={verifying}
            />

            <button
              type="button"
              onClick={submitPin}
              disabled={verifying || pin.length < MIN_PIN}
              style={{ touchAction: "manipulation" }}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
            >
              {verifying ? "Signing in…" : "Sign in"}
            </button>

            {/* Rule 6b at the control that was pressed: the server's own
                sentence — a wrong PIN, a locked account and when it lifts,
                PIN sign-in switched off. It used to render above the pad,
                one full digit pad away from the button. */}
            {pinError && (
              <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
                {pinError}
              </p>
            )}

            <div className="space-y-2 text-center">
              <button
                type="button"
                onClick={startPinRecovery}
                disabled={verifying}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors disabled:opacity-50"
              >
                Forgot your PIN? Get a WhatsApp code
              </button>
              <br />
              <button
                type="button"
                onClick={backToOptions}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                ← Back to sign-in options
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4 — set your own PIN (after a default sign-in) ── */}
        {step === "setpin" && (
          <div className="space-y-4">
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                You&apos;re in{recovering ? " — set a new PIN" : ""}
              </p>
              {/* ENCOURAGING, NOT A WALL. They already have a session; this
                  screen asks for something better and takes no for an
                  answer. The reason is stated plainly so the ask makes sense
                  to someone who has never thought about passwords. */}
              <p className="text-xs text-gray-500 dark:text-gray-400 text-pretty">
                {firstPin !== null
                  ? "Enter the same PIN once more, to make sure it is what you meant."
                  : recovering && !usedDefault
                    ? "You signed in with the code. Choose a PIN for next time — or skip and use a code again."
                    : "This PIN is your phone's last 4 digits — anyone who knows your number could use it. Set your own PIN so only you can get in."}
              </p>
              <div className="pt-2">
                <PinDots length={newPin.length} />
              </div>
            </div>

            <DigitPad
              value={newPin}
              onChange={(next) => {
                if (savingPin) return;
                setNewPin(next.slice(0, MAX_PIN));
                // Typing again retracts a refusal: it was about digits that
                // are no longer the ones on screen.
                setPinSave({ kind: "idle" });
              }}
              disabled={savingPin}
            />

            {/* THE SAVE. `SaveButton` owns all four beats and renders its own
                message inside this control group, so the confirmation cannot
                end up above the pad where a thumb on the button never sees it.
                `flex-col` + `[&>button]:w-full` keeps the portal's full-width
                button shape and stacks the message directly under it. */}
            <SaveButton
              state={pinSave}
              onSave={() => void saveOwnPin()}
              label={firstPin === null ? "Next — enter it again" : "Save my PIN"}
              savingLabel="Saving…"
              dirty={newPin.length >= MIN_PIN}
              notDirtyHint={`Enter at least ${MIN_PIN} digits first.`}
              className="flex-col [&>button]:w-full [&>button]:py-3"
            />

            {/* ALWAYS skippable, including after a phone-digit default. The
                ruling is explicit: never forced. A member who skips is
                signed in, sees the amber badge on the organizer's side, and
                gets asked again next time. */}
            <div className="text-center">
              <button
                type="button"
                onClick={goToPortal}
                disabled={savingPin}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
              >
                Skip for now — take me to my account
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3b — OTP ── */}
        {step === "otp" && lookup && (
          <div className="space-y-4">
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {otpStep === "sent" || otpStep === "verifying"
                  ? "Enter the code from WhatsApp"
                  : "WhatsApp code"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {otpStep === "sending"
                  ? "Sending…"
                  : otpStep === "sent" || otpStep === "verifying"
                    ? `Sent on WhatsApp to ${lookup.phone}`
                    : "We'll send a 6-digit code to your WhatsApp."}
              </p>
            </div>

            {otpStep === "idle" || otpStep === "sending" ? (
              <button
                type="button"
                onClick={() => void sendOtp(lookup)}
                disabled={otpStep === "sending"}
                style={{ touchAction: "manipulation" }}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
              >
                {otpStep === "sending" ? "Sending…" : "WhatsApp me a code"}
              </button>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-3">
                <CodeInput
                  value={otpCode}
                  onChange={setOtpCode}
                  // Auto-submit on the sixth digit — a member who has just
                  // typed the last digit should not have to find a button.
                  // verifyOtp's own in-flight guard makes the button harmless.
                  onComplete={() => void verifyOtp()}
                  disabled={otpStep === "verifying"}
                  focusToken={otpFocusToken}
                />
                {/* KEPT ALONGSIDE THE AUTO-SUBMIT, not replaced by it: a
                    keyboard or screen-reader user needs a real control to
                    activate, and auto-submit alone leaves them nothing. */}
                <button
                  type="submit"
                  disabled={otpStep === "verifying" || otpCode.length !== 6}
                  style={{ touchAction: "manipulation" }}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
                >
                  {otpStep === "verifying" ? "Checking…" : "Sign in"}
                </button>
              </form>
            )}

            {/* ── Resend ───────────────────────────────────────────────
                Only once a code has actually been sent. The wording is
                "Send it again" and never "new code": inside Twilio's
                10-minute window a re-request re-sends the SAME digits, and
                a member promised a new code who receives the old one
                concludes the system is broken. */}
            {(otpStep === "sent" || otpStep === "verifying") && lookup && (() => {
              const state = resendState({
                secondsLeft: otpCooldown,
                sending: false,
                // A dead verification cannot be waited out — the error that
                // says "request a new one" has to be able to offer it.
                bypassCooldown: resendBypassesCooldown(otpOutcome),
              });
              return (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => void sendOtp(lookup)}
                    disabled={!state.enabled || otpStep === "verifying"}
                    data-testid="otp-resend"
                    style={{ touchAction: "manipulation" }}
                    className="text-xs font-semibold text-indigo-700 transition-colors hover:text-indigo-800 disabled:cursor-default disabled:font-normal disabled:text-gray-500 dark:text-indigo-400 dark:hover:text-indigo-300 dark:disabled:text-gray-400"
                  >
                    {state.label}
                  </button>
                </div>
              );
            })()}

            {/* Rule 6b — under whichever button was pressed, the send or the
                verify, because the two swap places in the same slot. */}
            {otpError && <ErrorMsg msg={otpError} />}

            {/* NO ERROR MAY NAME AN ACTION THE SCREEN DOES NOT OFFER (2.10).
                "unavailable" is our outage, our credentials or our config —
                resending cannot fix any of it, so the remedy offered is to
                wait, not to press a button that will fail the same way. */}
            {otpError && otpOutcome === "unavailable" && (
              <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                Nothing is wrong with your code. Try again in a moment, or use your PIN.
              </p>
            )}
            {otpError && resendIsTheRemedy(otpOutcome) && (
              <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                {otpOutcome === "rate-limited"
                  ? "You can send it again once the timer above runs out."
                  : "Use “Send it again” above to get a fresh code."}
              </p>
            )}

            {/* The ONLY confirmation a screen-reader user gets when they press
                "Send it again" — the button just returns to its countdown. */}
            <p className="sr-only" role="status" aria-live="polite">
              {otpAnnounce}
            </p>

            <div className="text-center">
              <button
                type="button"
                onClick={backToOptions}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                ← Back to sign-in options
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3c — SMS code (Firebase Phone Auth) ── */}
        {step === "sms" && lookup && (
          <div className="space-y-4">
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {smsStep === "sent" || smsStep === "verifying"
                  ? "Enter the code from the text message"
                  : "Text-message code"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {smsStep === "sending"
                  ? "Sending…"
                  : smsStep === "sent" || smsStep === "verifying"
                    ? `Sent by SMS to ${lookup.phone}`
                    : "We'll text a 6-digit code to your number."}
              </p>
            </div>

            {smsStep === "idle" || smsStep === "sending" ? (
              <button
                type="button"
                onClick={() => void sendSms(lookup)}
                disabled={smsStep === "sending"}
                style={{ touchAction: "manipulation" }}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
              >
                {smsStep === "sending" ? "Sending…" : "Text me a code"}
              </button>
            ) : (
              <form onSubmit={verifySms} className="space-y-3">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  aria-label="Verification code"
                  style={{ fontSize: "28px", letterSpacing: "0.5em", textAlign: "center" }}
                  className="w-full font-mono py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-600 transition-colors"
                />
                <button
                  type="submit"
                  disabled={smsStep === "verifying" || smsCode.length !== 6}
                  style={{ touchAction: "manipulation" }}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
                >
                  {smsStep === "verifying" ? "Checking…" : "Sign in"}
                </button>
              </form>
            )}

            {/* Rule 6b — the mapped Firebase reason (lib/sms-login), under
                whichever button was pressed. */}
            {smsError && <ErrorMsg msg={smsError} />}

            <div className="text-center">
              <button
                type="button"
                onClick={backToOptions}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
              >
                ← Back to sign-in options
              </button>
            </div>
          </div>
        )}

      </motion.div>
    </AnimatePresence>

    {/* The reCAPTCHA HOST. Nothing renders into this node itself — each send
        attempt puts a disposable child inside it and takes that child away
        afterwards, because grecaptcha refuses to render twice into the same
        element (lib/sms-login.ts).

        It sits OUTSIDE the AnimatePresence on purpose: the animated wrapper is
        keyed by step, so anything inside it unmounts on every transition — and
        a verifier whose container disappeared mid-flow throws. React owns this
        node but never its children, so the manual child churn cannot fight
        React's own DOM reconciliation. */}
    <div id={RECAPTCHA_CONTAINER_ID} />
    </>
  );
}
