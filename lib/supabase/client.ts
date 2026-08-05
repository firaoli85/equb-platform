"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser client — safe to expose; carries only the publishable key. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
