CREATE TABLE "CancellationAssessment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "paidMinor" BIGINT NOT NULL,
  "workValueMinor" BIGINT NOT NULL,
  "employeeDueMinor" BIGINT NOT NULL,
  "documentedCostMinor" BIGINT NOT NULL,
  "retainedMinor" BIGINT NOT NULL,
  "returnFeeMinor" BIGINT NOT NULL,
  "refundMinor" BIGINT NOT NULL,
  "agreementRef" TEXT NOT NULL,
  "workEvidenceRef" TEXT NOT NULL,
  "employeeEvidenceRef" TEXT,
  "costEvidenceRef" TEXT,
  "feeEvidenceRef" TEXT,
  "reason" TEXT NOT NULL,
  "assessedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CancellationAssessment_amounts" CHECK (
    "currency" IN ('EGP','SAR') AND "paidMinor" > 0 AND
    "workValueMinor" >= 0 AND "employeeDueMinor" >= 0 AND "documentedCostMinor" >= 0 AND
    "retainedMinor" >= 0 AND "returnFeeMinor" >= 0 AND "refundMinor" >= 0 AND
    "retainedMinor" + "returnFeeMinor" + "refundMinor" = "paidMinor" AND
    ("returnFeeMinor" = 0 OR "refundMinor" > 0)
  )
);
CREATE UNIQUE INDEX "CancellationAssessment_orderId_key" ON "CancellationAssessment"("orderId");
ALTER TABLE "CancellationAssessment" ADD CONSTRAINT "CancellationAssessment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER finance_cancellation_assessment_immutable BEFORE UPDATE OR DELETE ON "CancellationAssessment" FOR EACH ROW EXECUTE FUNCTION finance_immutable();
ALTER TABLE "CancellationAssessment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "CancellationAssessment" FROM PUBLIC, anon, authenticated;
