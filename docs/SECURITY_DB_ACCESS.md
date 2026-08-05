# Database access — what should change (audit H6, infrastructure)

**Status: REPORT ONLY. Nothing here has been changed by code. Oli rotates.**
Written August 5 2026 alongside the audit fixes.

## What is true today

Both connection strings in `.env.local` were inspected (role and host only — the
password itself was never printed):

| | `DATABASE_URL` (app runtime) | `DIRECT_URL` (migrations) |
|---|---|---|
| Role | `postgres.vextbcktmbbvcctelzvy` | `postgres.vextbcktmbbvcctelzvy` |
| Host | `aws-0-ca-central-1.pooler.supabase.com` | same |
| Port | 6543 (transaction pooler) | 5432 (session pooler) |
| Password | 12 characters | **the same 12 characters** |

Three things follow, and the audit understated one of them.

1. **The role is the `postgres` superuser.** On Supabase's pooler,
   `postgres.<project-ref>` is the project's superuser. It **bypasses RLS
   entirely** — `BYPASSRLS` is inherent to superuser, and no policy can
   constrain it.

2. **The audit named `DIRECT_URL`, but `DATABASE_URL` is the same role.** The
   *running application* also connects as superuser. So the RLS-with-no-policies
   posture set up in `20260804172404_enable_rls` protects the Supabase Data API
   path only; it constrains the Prisma path not at all. That is a deliberate
   design (server actions do the authorization, and Prisma is the table owner),
   but it means **the 12-character password is the only thing between the public
   internet and every payment, payout, phone number, and PIN hash.**

3. **The host is publicly reachable.** `aws-0-ca-central-1.pooler.supabase.com`
   accepts connections from anywhere; there is no network boundary in front of
   it. A 12-character password is the entire control.

## What should change, in priority order

### 1. Rotate the password now, to something long
The current secret is 12 characters and has been shared between two variables
and pasted into at least two projects' env files during the rebuild. Replace it
with **32+ random characters** (Supabase Dashboard → Project Settings →
Database → Reset database password). Update `.env.local` locally and the Vercel
project environment variables at deploy time.

Treat the current password as **already exposed** — it has lived in plaintext in
two working trees.

### 2. Stop using the superuser for the application runtime
Create a dedicated, least-privilege role for `DATABASE_URL` and leave the
superuser for migrations only:

```sql
-- Run as the superuser, once.
CREATE ROLE equb_app WITH LOGIN PASSWORD '<a different 32+ char secret>';

-- Exactly what the app needs, and nothing else.
GRANT USAGE ON SCHEMA public TO equb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO equb_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO equb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO equb_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO equb_app;

-- NOT granted on purpose: DDL, DROP, TRUNCATE, CREATEROLE, superuser.
-- A compromised app credential can then read and write rows, but cannot drop a
-- table, disable RLS, mint a role, or read pg_authid.
```

Then point `DATABASE_URL` at `equb_app` and keep `DIRECT_URL` on the superuser
(Prisma needs DDL to migrate). Verify with
`npx tsx scripts/verify-member-privileges.mts` and the existing test suite
before trusting it.

**Note the trade-off, so it is a decision and not a surprise:** `equb_app` is a
non-owner role, so RLS *will* apply to it. Every table currently has RLS enabled
with **no policies**, which means a non-superuser role sees nothing. Either add
policies for `equb_app`, or (simpler and consistent with today's design) mark it
`BYPASSRLS` — which keeps the current authorization model while still removing
DDL and role-management power:

```sql
ALTER ROLE equb_app WITH BYPASSRLS;
```

That single change is the bulk of the benefit: an attacker with the app
credential can no longer alter the schema or escalate.

### 3. Restrict the network, if Supabase's plan allows it
Check whether the project offers IP allow-listing / network restrictions on the
current plan. Allow-listing the Vercel egress range and Oli's own address turns
a leaked password from "instant total compromise" into "needs the right network
too". If the free tier does not offer it, record that and move on — items 1 and
2 carry most of the risk reduction.

### 4. Never reuse one secret across two variables
After the rotation, `DATABASE_URL` and `DIRECT_URL` should hold **different**
credentials for **different** roles. Sharing one secret means rotating either
one forces both, which is exactly why rotations get postponed.

## Verification after rotating

```bash
npx prisma migrate status     # DIRECT_URL still works (superuser)
npx vitest run                # unchanged
npx tsx scripts/verify-member-privileges.mts   # column grants intact
npx tsx scripts/verify-presentation-setting.mts
```

If the app cannot read after switching to `equb_app`, the cause is almost
certainly RLS — apply the `BYPASSRLS` line above.
