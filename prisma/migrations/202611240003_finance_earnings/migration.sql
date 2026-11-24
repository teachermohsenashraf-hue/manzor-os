-- CreateEnum
CREATE TYPE "EarningKind" AS ENUM ('COMMUNICATION', 'EXECUTION');

-- CreateEnum
CREATE TYPE "EarningStatus" AS ENUM ('PENDING', 'EARNED', 'PAYABLE', 'PAID', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('APPROVED', 'EXECUTED', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "EmployeeEarning" (
    "id" TEXT NOT NULL,
    "entitlementKey" TEXT NOT NULL,
    "kind" "EarningKind" NOT NULL,
    "status" "EarningStatus" NOT NULL DEFAULT 'PENDING',
    "recipientId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "projectId" TEXT,
    "assignmentId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "policyCode" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "basisRef" TEXT NOT NULL,
    "note" TEXT,
    "proposedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "earnedAt" TIMESTAMP(3),
    "payableAt" TIMESTAMP(3),
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeePayout" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "status" "PayoutStatus" NOT NULL DEFAULT 'APPROVED',
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedById" TEXT,
    "executedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "transferRef" TEXT,
    "confirmationRef" TEXT,
    "accountRef" TEXT,
    "note" TEXT,
    "journalId" TEXT,

    CONSTRAINT "EmployeePayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutLine" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "earningId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,

    CONSTRAINT "PayoutLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeEarning_entitlementKey_key" ON "EmployeeEarning"("entitlementKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeEarning_journalId_key" ON "EmployeeEarning"("journalId");

-- CreateIndex
CREATE INDEX "EmployeeEarning_recipientId_status_createdAt_idx" ON "EmployeeEarning"("recipientId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EmployeeEarning_orderId_kind_idx" ON "EmployeeEarning"("orderId", "kind");

-- CreateIndex
CREATE INDEX "EmployeeEarning_projectId_kind_idx" ON "EmployeeEarning"("projectId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayout_transferRef_key" ON "EmployeePayout"("transferRef");

CREATE UNIQUE INDEX "EmployeePayout_confirmationRef_key" ON "EmployeePayout"("confirmationRef");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeePayout_journalId_key" ON "EmployeePayout"("journalId");

-- CreateIndex
CREATE INDEX "EmployeePayout_recipientId_status_approvedAt_idx" ON "EmployeePayout"("recipientId", "status", "approvedAt");

-- CreateIndex
CREATE INDEX "PayoutLine_earningId_idx" ON "PayoutLine"("earningId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutLine_payoutId_earningId_key" ON "PayoutLine"("payoutId", "earningId");

-- AddForeignKey
ALTER TABLE "EmployeeEarning" ADD CONSTRAINT "EmployeeEarning_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEarning" ADD CONSTRAINT "EmployeeEarning_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEarning" ADD CONSTRAINT "EmployeeEarning_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEarning" ADD CONSTRAINT "EmployeeEarning_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ProjectAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEarning" ADD CONSTRAINT "EmployeeEarning_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayout" ADD CONSTRAINT "EmployeePayout_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeePayout" ADD CONSTRAINT "EmployeePayout_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutLine" ADD CONSTRAINT "PayoutLine_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "EmployeePayout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutLine" ADD CONSTRAINT "PayoutLine_earningId_fkey" FOREIGN KEY ("earningId") REFERENCES "EmployeeEarning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmployeeEarning" ADD CONSTRAINT "EmployeeEarning_amount" CHECK ("amountMinor" > 0 AND "currency" = 'EGP' AND "policyVersion" > 0);
ALTER TABLE "EmployeePayout" ADD CONSTRAINT "EmployeePayout_amount" CHECK ("amountMinor" > 0 AND "currency" = 'EGP');
ALTER TABLE "PayoutLine" ADD CONSTRAINT "PayoutLine_amount" CHECK ("amountMinor" > 0);
CREATE TRIGGER finance_payout_line_immutable BEFORE UPDATE OR DELETE ON "PayoutLine" FOR EACH ROW EXECUTE FUNCTION finance_immutable();

CREATE FUNCTION finance_earning_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'earning records cannot be deleted'; END IF;
  IF ROW(NEW."entitlementKey", NEW."kind", NEW."recipientId", NEW."orderId", NEW."projectId", NEW."assignmentId", NEW."amountMinor", NEW."currency", NEW."policyCode", NEW."policyVersion", NEW."basisRef") IS DISTINCT FROM ROW(OLD."entitlementKey", OLD."kind", OLD."recipientId", OLD."orderId", OLD."projectId", OLD."assignmentId", OLD."amountMinor", OLD."currency", OLD."policyCode", OLD."policyVersion", OLD."basisRef") THEN
    RAISE EXCEPTION 'earning basis is immutable; record a settlement';
  END IF;
  IF OLD."status" IN ('PAID','ADJUSTED') AND NEW."status" <> OLD."status" THEN RAISE EXCEPTION 'final earning status cannot be changed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_earning_guard_trigger BEFORE UPDATE OR DELETE ON "EmployeeEarning" FOR EACH ROW EXECUTE FUNCTION finance_earning_guard();

CREATE FUNCTION finance_payout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."status" IN ('CONFIRMED','CANCELLED') THEN RAISE EXCEPTION 'final payout cannot be changed'; END IF;
  IF ROW(NEW."recipientId",NEW."amountMinor",NEW."currency",NEW."approvedById",NEW."approvedAt") IS DISTINCT FROM ROW(OLD."recipientId",OLD."amountMinor",OLD."currency",OLD."approvedById",OLD."approvedAt") THEN RAISE EXCEPTION 'approved payout basis is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_payout_guard_trigger BEFORE UPDATE OR DELETE ON "EmployeePayout" FOR EACH ROW EXECUTE FUNCTION finance_payout_guard();

ALTER TABLE "EmployeeEarning" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmployeePayout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayoutLine" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE "EmployeeEarning", "EmployeePayout", "PayoutLine" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE "EmployeeEarning", "EmployeePayout", "PayoutLine" FROM authenticated; END IF;
END $$;
