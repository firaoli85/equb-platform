// Delete a Supabase auth user by id — used to clean up the temporary admin a
// self-test loop created. Refuses without an explicit id argument.
//
//   npx tsx scripts/remove-auth-user.mts <auth-user-id>
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

const [id] = process.argv.slice(2);
if (!id) {
  console.error("Usage: npx tsx scripts/remove-auth-user.mts <auth-user-id>");
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { error } = await admin.auth.admin.deleteUser(id);
if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}
console.log(`Deleted auth user ${id}.`);
