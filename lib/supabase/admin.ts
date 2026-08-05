import { createClient } from "@supabase/supabase-js";

/**
 * SERVER-ONLY service-role client for auth admin operations (creating users,
 * setting app_metadata, the PIN session bridge). The service role key must
 * NEVER reach a client bundle — import this only from server actions and
 * scripts.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
