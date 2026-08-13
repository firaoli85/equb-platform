"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signInAdmin } from "@/app/actions/auth";
import { SaveFeedback, type SaveState } from "@/components/ui/save-button";

// Sign-in happens in a SERVER ACTION (audit H2), not in the browser: a
// session cookie written by JavaScript can never be httpOnly, and this is
// the organizer's session. The server action routes the write through the
// hardened cookie policy, exactly like the member sign-in paths.

// EXEMPT FROM SaveButton — A SIGN-IN IS NOT A SAVE (UI_STANDARDS rule 6).
//
// Nothing on this screen is a record he is editing, so two of the four beats
// have no meaning here: there is no dirty state to gate the button on (beat
// 1), and SUCCESS IS THE NEXT PAGE (beat 3) — `router.push("/admin/cycle")`
// takes the form off screen, so a "✓ Saved" beside the button would be a
// confirmation for a screen he has already left. It also stays a real
// <form onSubmit>: Enter is how anyone finishes typing a password.
//
// What it DOES owe is beat 4 / rule 6b — THE REFUSAL, AT THE CONTROL, in the
// server's own words ("Email or password is incorrect.", "This account is not
// the organizer."). That is the `SaveFeedback` directly under the Sign in
// button, and it is why a `SaveState` is used here at all. It used to be a
// hand-rolled `role="alert"` paragraph ABOVE the button, which pushed the
// button down out from under the cursor at the moment it appeared.

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // ONE state for the attempt. `busy` is DERIVED from it — a second boolean
  // for the same fact is a second thing that can disagree with the message.
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const busy = save.kind === "saving";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSave({ kind: "saving" });
    try {
      const result = await signInAdmin({ email, password });
      if (!result.ok) {
        // Both fields keep what he typed: a refusal costs him a retry, never
        // a retype (beat 4 — "the state left intact").
        setSave({ kind: "err", message: `Not signed in: ${result.error}` });
        return;
      }
      // The server action already set the session cookie on its response, so
      // this navigation and the refresh both carry it.
      //
      // Deliberately still "saving" here: the navigation is in flight and the
      // button must not take a second press that would open a second session.
      // It is released only by this page being replaced.
      router.push("/admin/cycle");
      router.refresh();
    } catch {
      setSave({
        kind: "err",
        message: "Not signed in: could not reach the server. Try again.",
      });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="w-full rounded border border-gray-400 px-3 py-2"
        />
      </label>
      <div className="block">
        {/* A LABEL CANNOT WRAP TWO CONTROLS.
            The reveal is a real <button>, so it needs its own accessible name
            and must not inherit the field's — hence htmlFor/id rather than the
            wrapping <label> the email field uses. */}
        <label htmlFor="admin-password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <div className="relative">
          <input
            id="admin-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            // Room for the button, so a long password never runs under it.
            className="w-full rounded border border-gray-400 py-2 pl-3 pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            // The NAME says what pressing it does; `aria-pressed` carries the
            // current state. A button labelled only "Show password" that has
            // already been pressed tells a screen-reader user nothing about
            // whether the password is visible right now.
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            aria-controls="admin-password"
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r text-gray-600 transition-colors duration-150 ease-out hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            {showPassword ? (
              // Eye with a slash — the state it will move TO is never guessed
              // from the icon alone; the label above carries the meaning.
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.98 8.22A10.5 10.5 0 001.5 12s3.75 7.5 10.5 7.5a10.4 10.4 0 004.02-.8M6.23 6.23A10.4 10.4 0 0112 4.5c6.75 0 10.5 7.5 10.5 7.5a18.7 18.7 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M3 3l18 18"
                />
              </svg>
            ) : (
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.04 12.32a1 1 0 010-.64C3.42 7.51 7.36 4.5 12 4.5s8.58 3.01 9.96 7.18a1 1 0 010 .64C20.58 16.49 16.64 19.5 12 19.5s-8.58-3.01-9.96-7.18z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
          </button>
        </div>
        {/* Announced on change, so the state is known without re-reading the
            button. `role="status"` is polite — it waits rather than cutting
            across whatever is being read. */}
        <span role="status" aria-live="polite" className="sr-only">
          {showPassword ? "Password is visible" : "Password is hidden"}
        </span>
      </div>
      <button
        type="submit"
        disabled={busy || !email || !password}
        aria-busy={busy}
        className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {/* THE REASON, AT THE BUTTON THAT WAS PRESSED (rule 6b) — below it, so
          it cannot move the button as it appears. `SaveFeedback` is the same
          slot every other refusal on the platform uses, and a failure never
          auto-clears: it stays until he acts on it. */}
      <SaveFeedback state={save} />
    </form>
  );
}
