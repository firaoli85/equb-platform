-- EVERY SIGN-IN, AND WHAT IT IS STILL DOING.
--
-- The organizer's ruling removed the second factor from the phone-digit
-- default PIN: members sign in directly, because a door they could not pass
-- had locked out 26 of 27 people. The protection moved from the door to the
-- session — bounded lifetimes, a list the member can see, and a switch they
-- can pull. This table is where that lives.
--
-- The row is KEPT when a session ends (revokedAt is set, nothing is deleted):
-- the history is what lets a member recognise their own devices, and what
-- lets the organizer answer "was that you?" weeks later (2.14).

CREATE TABLE "sign_in_sessions" (
    "id" TEXT NOT NULL,
    -- The Supabase auth user. Set for members AND the organizer; personId is
    -- null for the organizer, who has no directory row.
    "authUserId" UUID NOT NULL,
    "personId" TEXT,
    "role" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    -- SHA-256 of the handle cookie. The cookie is the only copy of the token,
    -- so reading this table must not let anyone impersonate a live session.
    "tokenHash" TEXT NOT NULL,
    -- Awareness only — never a reason to refuse a login.
    "fingerprint" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "location" TEXT,
    "isNewDevice" BOOLEAN NOT NULL DEFAULT false,
    "noticeSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- The sliding idle clock reads this; written at most once a minute.
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "sign_in_sessions_pkey" PRIMARY KEY ("id")
);

-- The proxy's hot path: one lookup per request, by token.
CREATE UNIQUE INDEX "sign_in_sessions_tokenHash_key" ON "sign_in_sessions"("tokenHash");
CREATE INDEX "sign_in_sessions_authUserId_revokedAt_idx" ON "sign_in_sessions"("authUserId", "revokedAt");
CREATE INDEX "sign_in_sessions_personId_createdAt_idx" ON "sign_in_sessions"("personId", "createdAt");

-- 2.9: deleting a person removes their sessions with them, leaving nothing
-- orphaned behind.
ALTER TABLE "sign_in_sessions"
  ADD CONSTRAINT "sign_in_sessions_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Server-side only, like every other table here: RLS on with NO policies, so
-- the Data API roles get nothing. This one matters more than most — the token
-- hashes and every member's device and IP history live in it.
ALTER TABLE "sign_in_sessions" ENABLE ROW LEVEL SECURITY;
