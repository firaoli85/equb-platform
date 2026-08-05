-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "participationId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod",
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_idempotencyKey_key" ON "payment_events"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_eventId_paymentId_key" ON "payment_allocations"("eventId", "paymentId");

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "participations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "payment_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lock the new tables away from the Supabase Data API like every other table
-- (RLS enabled, no policies; Prisma connects as table owner and is unaffected).
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
