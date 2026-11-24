-- CreateTable
CREATE TABLE "FxReceipt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "claimId" TEXT,
    "paidSarMinor" BIGINT NOT NULL,
    "grossEgpMinor" BIGINT,
    "feeEgpMinor" BIGINT,
    "netEgpMinor" BIGINT NOT NULL,
    "rate" DECIMAL(24,12) NOT NULL,
    "rateBasis" TEXT NOT NULL,
    "rateSource" TEXT NOT NULL,
    "convertedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "bankAccountRef" TEXT NOT NULL,
    "transferRef" TEXT NOT NULL,
    "confirmedById" TEXT NOT NULL,
    "sarJournalId" TEXT NOT NULL,
    "egpJournalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FxReceipt_claimId_key" ON "FxReceipt"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "FxReceipt_transferRef_key" ON "FxReceipt"("transferRef");

-- CreateIndex
CREATE UNIQUE INDEX "FxReceipt_sarJournalId_key" ON "FxReceipt"("sarJournalId");

-- CreateIndex
CREATE UNIQUE INDEX "FxReceipt_egpJournalId_key" ON "FxReceipt"("egpJournalId");

-- CreateIndex
CREATE INDEX "FxReceipt_orderId_receivedAt_idx" ON "FxReceipt"("orderId", "receivedAt");

-- AddForeignKey
ALTER TABLE "FxReceipt" ADD CONSTRAINT "FxReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxReceipt" ADD CONSTRAINT "FxReceipt_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "PaymentClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxReceipt" ADD CONSTRAINT "FxReceipt_sarJournalId_fkey" FOREIGN KEY ("sarJournalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxReceipt" ADD CONSTRAINT "FxReceipt_egpJournalId_fkey" FOREIGN KEY ("egpJournalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FxReceipt" ADD CONSTRAINT "FxReceipt_positive" CHECK ("paidSarMinor" > 0 AND "netEgpMinor" > 0 AND "rate" > 0);
ALTER TABLE "FxReceipt" ADD CONSTRAINT "FxReceipt_rate_basis" CHECK ("rateBasis" IN ('GROSS_CONVERSION','NET_EFFECTIVE'));
ALTER TABLE "FxReceipt" ADD CONSTRAINT "FxReceipt_fee_consistency" CHECK (("grossEgpMinor" IS NULL AND "feeEgpMinor" IS NULL) OR ("grossEgpMinor" > 0 AND "feeEgpMinor" >= 0 AND "grossEgpMinor" = "netEgpMinor" + "feeEgpMinor"));
CREATE TRIGGER finance_fx_immutable BEFORE UPDATE OR DELETE ON "FxReceipt" FOR EACH ROW EXECUTE FUNCTION finance_immutable();
ALTER TABLE "FxReceipt" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE "FxReceipt" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE "FxReceipt" FROM authenticated; END IF;
END $$;
