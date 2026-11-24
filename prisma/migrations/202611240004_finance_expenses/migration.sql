-- CreateEnum
CREATE TYPE "DevelopmentStatus" AS ENUM ('RESERVED', 'FUNDED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('PROJECT_DIRECT', 'GENERAL', 'SOFTWARE', 'AI_TOOLS', 'HOSTING', 'BANK_FEES', 'DEVELOPMENT', 'EXCEPTIONAL');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "DevelopmentAllocation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "policyCode" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "status" "DevelopmentStatus" NOT NULL DEFAULT 'RESERVED',
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservationJournalId" TEXT NOT NULL,
    "fundingJournalId" TEXT,
    "fundedAt" TIMESTAMP(3),

    CONSTRAINT "DevelopmentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "projectId" TEXT,
    "developmentAllocationId" TEXT,
    "proofRef" TEXT,
    "paymentRef" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidById" TEXT,
    "accrualJournalId" TEXT,
    "paymentJournalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentAllocation_orderItemId_key" ON "DevelopmentAllocation"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentAllocation_reservationJournalId_key" ON "DevelopmentAllocation"("reservationJournalId");

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentAllocation_fundingJournalId_key" ON "DevelopmentAllocation"("fundingJournalId");

-- CreateIndex
CREATE INDEX "DevelopmentAllocation_orderId_status_idx" ON "DevelopmentAllocation"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_paymentRef_key" ON "Expense"("paymentRef");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_accrualJournalId_key" ON "Expense"("accrualJournalId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_paymentJournalId_key" ON "Expense"("paymentJournalId");

-- CreateIndex
CREATE INDEX "Expense_status_dueAt_idx" ON "Expense"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Expense_projectId_category_idx" ON "Expense"("projectId", "category");

-- AddForeignKey
ALTER TABLE "DevelopmentAllocation" ADD CONSTRAINT "DevelopmentAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentAllocation" ADD CONSTRAINT "DevelopmentAllocation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentAllocation" ADD CONSTRAINT "DevelopmentAllocation_reservationJournalId_fkey" FOREIGN KEY ("reservationJournalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevelopmentAllocation" ADD CONSTRAINT "DevelopmentAllocation_fundingJournalId_fkey" FOREIGN KEY ("fundingJournalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_developmentAllocationId_fkey" FOREIGN KEY ("developmentAllocationId") REFERENCES "DevelopmentAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_accrualJournalId_fkey" FOREIGN KEY ("accrualJournalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paymentJournalId_fkey" FOREIGN KEY ("paymentJournalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DevelopmentAllocation" ADD CONSTRAINT "DevelopmentAllocation_amount" CHECK ("amountMinor" > 0 AND "currency" = 'EGP' AND "policyVersion" > 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount" CHECK ("amountMinor" > 0 AND "currency" IN ('EGP','SAR'));
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_source" CHECK (("category" = 'DEVELOPMENT' AND "developmentAllocationId" IS NOT NULL AND "currency" = 'EGP') OR ("category" <> 'DEVELOPMENT' AND "developmentAllocationId" IS NULL));
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_project_scope" CHECK (("category" = 'PROJECT_DIRECT' AND "projectId" IS NOT NULL) OR ("category" NOT IN ('PROJECT_DIRECT','GENERAL','SOFTWARE','AI_TOOLS','HOSTING','BANK_FEES') OR "projectId" IS NULL));

CREATE FUNCTION finance_expense_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'expense cannot be deleted'; END IF;
  IF OLD."status" IN ('PAID','CANCELLED') THEN RAISE EXCEPTION 'final expense cannot be edited'; END IF;
  IF OLD."status" <> 'DRAFT' AND ROW(NEW."category",NEW."description",NEW."amountMinor",NEW."currency",NEW."projectId",NEW."developmentAllocationId",NEW."dueAt") IS DISTINCT FROM ROW(OLD."category",OLD."description",OLD."amountMinor",OLD."currency",OLD."projectId",OLD."developmentAllocationId",OLD."dueAt") THEN RAISE EXCEPTION 'approved expense basis is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_expense_guard_trigger BEFORE UPDATE OR DELETE ON "Expense" FOR EACH ROW EXECUTE FUNCTION finance_expense_guard();

CREATE FUNCTION finance_development_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."status" = 'FUNDED' THEN RAISE EXCEPTION 'funded allocation is immutable'; END IF;
  IF ROW(NEW."orderId",NEW."orderItemId",NEW."amountMinor",NEW."currency",NEW."policyCode",NEW."policyVersion",NEW."reservationJournalId") IS DISTINCT FROM ROW(OLD."orderId",OLD."orderItemId",OLD."amountMinor",OLD."currency",OLD."policyCode",OLD."policyVersion",OLD."reservationJournalId") THEN RAISE EXCEPTION 'development basis is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_development_guard_trigger BEFORE UPDATE OR DELETE ON "DevelopmentAllocation" FOR EACH ROW EXECUTE FUNCTION finance_development_guard();

ALTER TABLE "DevelopmentAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE "DevelopmentAllocation", "Expense" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE "DevelopmentAllocation", "Expense" FROM authenticated; END IF;
END $$;
