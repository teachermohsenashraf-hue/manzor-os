CREATE UNIQUE INDEX "EmployeeEarning_subscriptionCycleId_key" ON "EmployeeEarning"("subscriptionCycleId");
ALTER TABLE "SubscriptionCycleClosure" ADD CONSTRAINT "SubscriptionCycleClosure_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionCycleClosure" ADD CONSTRAINT "SubscriptionCycleClosure_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
