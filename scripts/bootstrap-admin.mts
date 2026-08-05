// One-time organizer bootstrap. Creates (or updates) the single ADMIN user
// with app_metadata.is_admin = true — the claim only the service role can
// set, which is why members can never grant it to themselves.
//
// Run:  npx tsx scripts/bootstrap-admin.mts you@example.com "your-password"
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local", quiet: true });

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: npx tsx scripts/bootstrap-admin.mts <email> "<password>"');
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { is_admin: true },
});

if (created.data.user) {
  console.log(`Admin created: ${created.data.user.id} (${email})`);
  process.exit(0);
}

if (!/already been registered/i.test(created.error?.message ?? "")) {
  console.error("Failed:", created.error?.message);
  process.exit(1);
}

// User exists — find them and ensure the claim + password.
const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const user = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error("User exists but could not be found via listUsers.");
  process.exit(1);
}
const updated = await admin.auth.admin.updateUserById(user.id, {
  password,
  app_metadata: { ...user.app_metadata, is_admin: true },
});
if (updated.error) {
  console.error("Failed to update:", updated.error.message);
  process.exit(1);
}
console.log(`Admin updated: ${user.id} (${email})`);
