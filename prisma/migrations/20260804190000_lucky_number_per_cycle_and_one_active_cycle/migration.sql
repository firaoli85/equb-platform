-- AlterTable
ALTER TABLE "lucky_numbers" ADD COLUMN     "cycleId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "lucky_numbers_cycleId_number_key" ON "lucky_numbers"("cycleId", "number");

-- AddForeignKey
ALTER TABLE "lucky_numbers" ADD CONSTRAINT "lucky_numbers_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most ONE cycle may be ACTIVE at a time. Prisma cannot express a partial
-- unique index, so it lives here as raw SQL (also noted on the Cycle model in
-- schema.prisma — never let a generated migration drop it).
CREATE UNIQUE INDEX "one_active_cycle" ON "cycles" ((status)) WHERE "status" = 'ACTIVE';
