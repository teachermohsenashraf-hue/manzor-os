CREATE TABLE "SubscriptionCycleClosure" (
  "id" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "executorId" TEXT NOT NULL,
  "projectIds" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "closedById" TEXT NOT NULL,
  "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionCycleClosure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubscriptionCycleClosure_cycleId_key" ON "SubscriptionCycleClosure"("cycleId");
ALTER TABLE "SubscriptionCycleClosure" ADD CONSTRAINT "SubscriptionCycleClosure_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "SubscriptionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeEarning" ADD COLUMN "subscriptionCycleId" TEXT;
ALTER TABLE "EmployeeEarning" ADD CONSTRAINT "EmployeeEarning_subscriptionCycleId_fkey" FOREIGN KEY ("subscriptionCycleId") REFERENCES "SubscriptionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionCycleClosure" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "SubscriptionCycleClosure" FROM PUBLIC, anon, authenticated;
