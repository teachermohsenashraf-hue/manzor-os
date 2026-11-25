CREATE TABLE "RefundOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'APPROVED',
  "destinationRef" TEXT NOT NULL,
  "decisionRef" TEXT NOT NULL,
  "approvedById" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "transferRef" TEXT,
  "executedAt" TIMESTAMP(3),
  "bankConfirmationRef" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "journalId" TEXT,
  CONSTRAINT "RefundOrder_positive" CHECK ("amountMinor" > 0 AND "currency" = 'EGP'),
  CONSTRAINT "RefundOrder_state" CHECK (
    ("status" = 'APPROVED' AND "transferRef" IS NULL AND "executedAt" IS NULL AND "bankConfirmationRef" IS NULL AND "confirmedAt" IS NULL AND "journalId" IS NULL) OR
    ("status" = 'EXECUTED' AND "transferRef" IS NOT NULL AND "executedAt" IS NOT NULL AND "bankConfirmationRef" IS NULL AND "confirmedAt" IS NULL AND "journalId" IS NULL) OR
    ("status" = 'CONFIRMED' AND "transferRef" IS NOT NULL AND "executedAt" IS NOT NULL AND "bankConfirmationRef" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "journalId" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "RefundOrder_orderId_key" ON "RefundOrder"("orderId");
CREATE UNIQUE INDEX "RefundOrder_assessmentId_key" ON "RefundOrder"("assessmentId");
CREATE UNIQUE INDEX "RefundOrder_transferRef_key" ON "RefundOrder"("transferRef");
CREATE UNIQUE INDEX "RefundOrder_bankConfirmationRef_key" ON "RefundOrder"("bankConfirmationRef");
CREATE UNIQUE INDEX "RefundOrder_journalId_key" ON "RefundOrder"("journalId");
CREATE INDEX "RefundOrder_status_approvedAt_idx" ON "RefundOrder"("status","approvedAt");
ALTER TABLE "RefundOrder" ADD CONSTRAINT "RefundOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundOrder" ADD CONSTRAINT "RefundOrder_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "CancellationAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundOrder" ADD CONSTRAINT "RefundOrder_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION finance_refund_assessment_match() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CancellationAssessment" a WHERE a."id" = NEW."assessmentId" AND a."orderId" = NEW."orderId" AND a."refundMinor" = NEW."amountMinor" AND a."currency" = NEW."currency" AND a."returnFeeMinor" = 0) THEN
    RAISE EXCEPTION 'refund order does not match a zero-fee cancellation assessment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_refund_assessment_guard BEFORE INSERT OR UPDATE ON "RefundOrder" FOR EACH ROW EXECUTE FUNCTION finance_refund_assessment_match();
CREATE FUNCTION finance_refund_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."orderId" <> OLD."orderId" OR NEW."assessmentId" <> OLD."assessmentId" OR
     NEW."amountMinor" <> OLD."amountMinor" OR NEW."currency" <> OLD."currency" OR
     NEW."destinationRef" <> OLD."destinationRef" OR NEW."decisionRef" <> OLD."decisionRef" OR
     NEW."approvedById" <> OLD."approvedById" OR NEW."approvedAt" <> OLD."approvedAt" THEN
    RAISE EXCEPTION 'refund approval is immutable';
  END IF;
  IF NOT ((OLD."status" = 'APPROVED' AND NEW."status" = 'EXECUTED') OR
          (OLD."status" = 'EXECUTED' AND NEW."status" = 'CONFIRMED')) THEN
    RAISE EXCEPTION 'refund state transition is invalid';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_refund_transition_guard BEFORE UPDATE ON "RefundOrder" FOR EACH ROW EXECUTE FUNCTION finance_refund_transition();
ALTER TABLE "RefundOrder" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "RefundOrder" FROM PUBLIC, anon, authenticated;
