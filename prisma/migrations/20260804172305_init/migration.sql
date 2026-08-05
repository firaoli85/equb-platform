-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'ZELLE', 'CASHAPP', 'VENMO', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "WinnerPlanMode" AS ENUM ('ALONE', 'TOGETHER');

-- CreateEnum
CREATE TYPE "WinnerPlanStatus" AS ENUM ('PLANNED', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DEBT', 'PAYMENT');

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "nameAmharic" TEXT NOT NULL,
    "nameEnglishFirst" TEXT NOT NULL,
    "nameEnglishLast" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "plannedWeeks" INTEGER NOT NULL,
    "unitAmount" INTEGER NOT NULL DEFAULT 100000,
    "feePercent" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "status" "CycleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weeks" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "isSkipped" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participations" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "weeklyAmount" INTEGER NOT NULL,
    "startWeek" INTEGER NOT NULL DEFAULT 1,
    "weeksCommitted" INTEGER NOT NULL,
    "status" "ParticipationStatus" NOT NULL DEFAULT 'ACTIVE',
    "closedAtWeek" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lucky_numbers" (
    "id" TEXT NOT NULL,
    "participationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "lucky_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "participationId" TEXT NOT NULL,
    "amountPaid" INTEGER NOT NULL DEFAULT 0,
    "isDeferred" BOOLEAN NOT NULL DEFAULT false,
    "method" "PaymentMethod",
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slots" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_members" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "luckyNumberId" TEXT NOT NULL,

    CONSTRAINT "slot_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winner_plans" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "weekId" TEXT,
    "mode" "WinnerPlanMode" NOT NULL DEFAULT 'ALONE',
    "status" "WinnerPlanStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "winner_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "winner_plan_numbers" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "luckyNumberId" TEXT NOT NULL,

    CONSTRAINT "winner_plan_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draws" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "drawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "draws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "luckyNumberId" TEXT NOT NULL,
    "drawId" TEXT,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod",
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weeks_cycleId_weekNumber_key" ON "weeks"("cycleId", "weekNumber");

-- CreateIndex
CREATE UNIQUE INDEX "participations_cycleId_personId_key" ON "participations"("cycleId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_weekId_participationId_key" ON "payments"("weekId", "participationId");

-- CreateIndex
CREATE UNIQUE INDEX "slots_cycleId_position_key" ON "slots"("cycleId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "slot_members_slotId_luckyNumberId_key" ON "slot_members"("slotId", "luckyNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "winner_plan_numbers_planId_luckyNumberId_key" ON "winner_plan_numbers"("planId", "luckyNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "draws_slotId_key" ON "draws"("slotId");

-- AddForeignKey
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lucky_numbers" ADD CONSTRAINT "lucky_numbers_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "participations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "participations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_members" ADD CONSTRAINT "slot_members_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_members" ADD CONSTRAINT "slot_members_luckyNumberId_fkey" FOREIGN KEY ("luckyNumberId") REFERENCES "lucky_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner_plans" ADD CONSTRAINT "winner_plans_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner_plans" ADD CONSTRAINT "winner_plans_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner_plan_numbers" ADD CONSTRAINT "winner_plan_numbers_planId_fkey" FOREIGN KEY ("planId") REFERENCES "winner_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "winner_plan_numbers" ADD CONSTRAINT "winner_plan_numbers_luckyNumberId_fkey" FOREIGN KEY ("luckyNumberId") REFERENCES "lucky_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draws" ADD CONSTRAINT "draws_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draws" ADD CONSTRAINT "draws_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_luckyNumberId_fkey" FOREIGN KEY ("luckyNumberId") REFERENCES "lucky_numbers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "draws"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
