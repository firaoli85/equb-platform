"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { lookupMemberByPhone } from "@/app/actions/member";
import {
  requestWhatsAppCode,
  setMyPin,
  signInWithPin,
  signInWithWhatsAppCode,
} from "@/app/actions/auth";
import { motionTokens } from "@/lib/motion-tokens";

// The two-step member login, in the portal's own visual system so entry
// feels continuous: (1) phone number → (2) bilingual welcome + method
// picker. PIN is the default while it is enabled; the toggles are enforced
// server-side — this UI only reflects them (2.6).
//
// 2.28 (channel honesty): the screen offers ONLY channels that work — PIN
// and the WhatsApp code. SMS is carrier-blocked and is not offered at all.

type Lookup = {
  phone: string;
  nameEnglishFirst: string;
  nameAmharic: string;
  pinAvailable: boolean;
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
          className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
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

  const [choice, setChoice] = useState<"none" | "pin" | "otp">("none");

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
  const [newPinError, setNewPinError] = useState<string | null>(null);
  const [savingPin, startSavePin] = useTransition();

  // OTP state
  const [otpStep, setOtpStep] = useState<"idle" | "sending" | "sent" | "verifying">("idle");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  // True when the member came through "Forgot your PIN?" — after the
  // WhatsApp code signs them in, they are offered a NEW PIN (skippable).
  const [recovering, setRecovering] = useState(false);

  const welcomeName = lookup
    ? lookup.nameEnglishFirst && lookup.nameAmharic
      ? `${lookup.nameEnglishFirst} / ${lookup.nameAmharic}`
      : lookup.nameEnglishFirst || lookup.nameAmharic || "Member"
    : "";
  const avatarInitial = lookup
    ? ([...(lookup.nameEnglishFirst || lookup.nameAmharic || "?")][0] ?? "?")
    : "?";

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

  function resetToPhone() {
    setLookup(null);
    setChoice("none");
    setPin("");
    setPinError(null);
    setOtpStep("idle");
    setOtpCode("");
    setOtpError(null);
    setRecovering(false);
  }

  function backToOptions() {
    setChoice("none");
    setPin("");
    setPinError(null);
    setOtpStep("idle");
    setOtpCode("");
    setOtpError(null);
    setRecovering(false);
  }

  // "Forgot your PIN?" — the WhatsApp code is the way in (2.28); once
  // signed in, they are offered a fresh PIN.
  function startPinRecovery() {
    setRecovering(true);
    setPin("");
    setPinError(null);
    setChoice("otp");
    void sendOtp();
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
        if (result.data.needsSecondFactor) {
          // SECURITY (audit C2): the phone-digit default is not a secret —
          // it is part of the number they just typed. It gets them no
          // session on its own; the WhatsApp code must follow, and then a
          // real PIN is required rather than offered.
          setUsedDefault(true);
          setChoice("otp");
          void sendOtp();
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

  function saveOwnPin() {
    if (newPin.length < MIN_PIN || savingPin) return;
    startSavePin(async () => {
      try {
        const result = await setMyPin({ pin: newPin });
        if (!result.ok) {
          setNewPinError(result.error);
          return;
        }
        goToPortal();
      } catch {
        setNewPinError("Could not reach the server. Try again.");
      }
    });
  }

  // ── WhatsApp code (2.28: the working OTP channel) ───────────────
  async function sendOtp() {
    if (!lookup || otpStep === "sending" || otpStep === "verifying") return;
    setOtpStep("sending");
    setOtpError(null);
    setOtpCode("");
    try {
      const result = await requestWhatsAppCode({ phone: lookup.phone });
      if (!result.ok) {
        setOtpError(result.error);
        setOtpStep("idle");
        return;
      }
      setOtpStep("sent");
    } catch {
      setOtpError("Could not send the code. Try again.");
      setOtpStep("idle");
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!lookup || otpStep === "verifying") return;
    setOtpStep("verifying");
    setOtpError(null);
    try {
      const result = await signInWithWhatsAppCode({ phone: lookup.phone, code: otpCode });
      if (!result.ok) {
        setOtpError(result.error);
        setOtpStep("sent");
        setOtpCode("");
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
                <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-1.5">
                  Use the number you registered with your Equb
                </p>
              </div>

              {phoneError && <ErrorMsg msg={phoneError} />}

              <button
                type="submit"
                disabled={phonePending || !phoneInput.trim()}
                style={{ touchAction: "manipulation" }}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
              >
                {phonePending ? "Looking up…" : "Continue"}
              </button>
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

            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-500 mb-3">
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
                    <span className="block text-xs text-gray-500 dark:text-gray-500">Your code · fastest</span>
                  </span>
                  <svg className="w-4 h-4 text-indigo-400 dark:text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setChoice("otp");
                  void sendOtp();
                }}
                style={{ touchAction: "manipulation", minHeight: "56px" }}
                className="w-full flex items-center gap-3 px-4 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-[#141414] hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500 dark:text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"
                  />
                </svg>
                <span className="flex-1 text-left">
                  <span className="block text-sm font-bold text-gray-900 dark:text-white">WhatsApp me a code</span>
                  <span className="block text-xs text-gray-500 dark:text-gray-500">6-digit code on WhatsApp</span>
                </span>
                <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
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

            {pinError && (
              <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
                {pinError}
              </p>
            )}

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
                {recovering ? "You're in — set a new PIN" : "You're in — choose your own PIN"}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500">
                {recovering && !usedDefault
                  ? "You signed in with the WhatsApp code. Choose a new PIN for next time — or skip and use a WhatsApp code again."
                  : "Your phone's last 4 digits are not a secret — anyone who has your number knows them. Pick a PIN only you know to finish signing in."}
              </p>
              <div className="pt-2">
                <PinDots length={newPin.length} />
              </div>
            </div>

            {newPinError && <ErrorMsg msg={newPinError} />}

            <DigitPad
              value={newPin}
              onChange={(next) => {
                if (savingPin) return;
                setNewPin(next.slice(0, MAX_PIN));
                setNewPinError(null);
              }}
              disabled={savingPin}
            />

            <button
              type="button"
              onClick={saveOwnPin}
              disabled={savingPin || newPin.length < MIN_PIN}
              style={{ touchAction: "manipulation" }}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
            >
              {savingPin ? "Saving…" : "Save my PIN"}
            </button>

            {/* No skip after a phone-digit default (audit C2) — leaving it
                on means the number alone still opens the account. */}
            {!usedDefault && (
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
            )}
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
              <p className="text-xs text-gray-500 dark:text-gray-500">
                {otpStep === "sending"
                  ? "Sending…"
                  : otpStep === "sent" || otpStep === "verifying"
                    ? `Sent on WhatsApp to ${lookup.phone}`
                    : "We'll send a 6-digit code to your WhatsApp."}
              </p>
            </div>

            {otpError && <ErrorMsg msg={otpError} />}

            {otpStep === "idle" || otpStep === "sending" ? (
              <button
                type="button"
                onClick={() => void sendOtp()}
                disabled={otpStep === "sending"}
                style={{ touchAction: "manipulation" }}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm"
              >
                {otpStep === "sending" ? "Sending…" : "WhatsApp me a code"}
              </button>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-3">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  aria-label="Verification code"
                  style={{ fontSize: "28px", letterSpacing: "0.5em", textAlign: "center" }}
                  className="w-full font-mono py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1a1a1a] text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-600 transition-colors"
                />
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
  );
}
