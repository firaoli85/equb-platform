-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'COLLECTED');

-- AlterTable
ALTER TABLE "payouts" DROP COLUMN "amount",
ADD COLUMN     "feeAmount" INTEGER NOT NULL,
ADD COLUMN     "grossAmount" INTEGER NOT NULL,
ADD COLUMN     "netAmount" INTEGER NOT NULL,
ADD COLUMN     "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "paidAt" DROP NOT NULL,
ALTER COLUMN "paidAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Lock the new table away from the Supabase Data API like every other table;
-- the organizer's admin JWT may read the audit trail.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON "audit_logs" FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
