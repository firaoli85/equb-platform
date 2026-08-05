-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMethod_new" AS ENUM ('ZELLE', 'CASH', 'OTHER');
ALTER TABLE "payments" ALTER COLUMN "method" TYPE "PaymentMethod_new" USING ("method"::text::"PaymentMethod_new");
ALTER TABLE "payouts" ALTER COLUMN "method" TYPE "PaymentMethod_new" USING ("method"::text::"PaymentMethod_new");
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
ALTER TYPE "PaymentMethod_new" RENAME TO "PaymentMethod";
DROP TYPE "public"."PaymentMethod_old";
COMMIT;

-- CreateIndex
CREATE UNIQUE INDEX "draws_weekId_key" ON "draws"("weekId");
