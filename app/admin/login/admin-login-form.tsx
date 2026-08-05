"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signInAdmin } from "@/app/actions/auth";

// Sign-in happens in a SERVER ACTION (audit H2), not in the browser: a
// session cookie written by JavaScript can never be httpOnly, and this is
// the organizer's session. The server action routes the write through the
// hardened cookie policy, exactly like the member sign-in paths.

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await signInAdmin({ email, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The server action already set the session cookie on its response, so
      // this navigation and the refresh both carry it.
      router.push("/admin/cycle");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setPending(false);
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
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="w-full rounded border border-gray-400 px-3 py-2"
        />
      </label>
      {error && (
        <p role="alert" className="rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !email || !password}
        className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
