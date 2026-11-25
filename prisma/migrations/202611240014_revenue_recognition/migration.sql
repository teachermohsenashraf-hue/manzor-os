CREATE TABLE "RevenueRecognition" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "basisRef" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "recognizedAt" TIMESTAMP(3) NOT NULL,
  "approvedById" TEXT NOT NULL,
  "journalId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RevenueRecognition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RevenueRecognition_positive" CHECK ("amountMinor" > 0 AND "currency" IN ('EGP','SAR'))
);
CREATE UNIQUE INDEX "RevenueRecognition_orderId_key" ON "RevenueRecognition"("orderId");
CREATE UNIQUE INDEX "RevenueRecognition_journalId_key" ON "RevenueRecognition"("journalId");
CREATE INDEX "RevenueRecognition_recognizedAt_idx" ON "RevenueRecognition"("recognizedAt");
ALTER TABLE "RevenueRecognition" ADD CONSTRAINT "RevenueRecognition_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RevenueRecognition" ADD CONSTRAINT "RevenueRecognition_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER finance_revenue_immutable BEFORE UPDATE OR DELETE ON "RevenueRecognition" FOR EACH ROW EXECUTE FUNCTION finance_immutable();
ALTER TABLE "RevenueRecognition" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "RevenueRecognition" FROM PUBLIC, anon, authenticated;
