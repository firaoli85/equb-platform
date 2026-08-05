-- The readable archive of a closed cycle (2.9). No foreign key to cycles —
-- the archive must survive the cycle's clean delete.

CREATE TABLE "cycle_archives" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "cycleName" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycle_archives_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cycle_archives_cycleId_key" ON "cycle_archives"("cycleId");

-- Organizer-only: the archive is names and money (2.4/2.8).
ALTER TABLE "cycle_archives" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "cycle_archives" FROM anon, authenticated;
