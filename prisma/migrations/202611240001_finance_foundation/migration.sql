-- CreateEnum
CREATE TYPE "PaymentClaimStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "PaymentClaim" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "claimedMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "proofRef" TEXT NOT NULL,
    "note" TEXT,
    "status" "PaymentClaimStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "claimId" TEXT,
    "grossMinor" BIGINT NOT NULL,
    "feeMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "settlementCurrency" TEXT NOT NULL,
    "settlementRef" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "confirmedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "journalId" TEXT NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerPosting" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitMinor" BIGINT NOT NULL DEFAULT 0,
    "creditMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialRule" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "marketCode" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "detail" JSONB NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentClaim_orderId_status_createdAt_idx" ON "PaymentClaim"("orderId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_claimId_key" ON "Receipt"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_settlementRef_key" ON "Receipt"("settlementRef");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_journalId_key" ON "Receipt"("journalId");

-- CreateIndex
CREATE INDEX "Receipt_orderId_receivedAt_idx" ON "Receipt"("orderId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_currency_key" ON "LedgerAccount"("code", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reference_key" ON "JournalEntry"("reference");

-- CreateIndex
CREATE INDEX "LedgerPosting_journalId_idx" ON "LedgerPosting"("journalId");

-- CreateIndex
CREATE INDEX "LedgerPosting_accountId_createdAt_idx" ON "LedgerPosting"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialRule_code_version_key" ON "FinancialRule"("code", "version");

-- AddForeignKey
ALTER TABLE "PaymentClaim" ADD CONSTRAINT "PaymentClaim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "PaymentClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerPosting" ADD CONSTRAINT "LedgerPosting_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerPosting" ADD CONSTRAINT "LedgerPosting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaymentClaim" ADD CONSTRAINT "PaymentClaim_positive" CHECK ("claimedMinor" > 0);
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_amounts" CHECK ("grossMinor" > 0 AND "feeMinor" >= 0 AND "netMinor" > 0 AND "grossMinor" = "feeMinor" + "netMinor");
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_same_currency" CHECK ("settlementCurrency" = "currency");
ALTER TABLE "LedgerPosting" ADD CONSTRAINT "LedgerPosting_one_side" CHECK (("debitMinor" > 0 AND "creditMinor" = 0) OR ("creditMinor" > 0 AND "debitMinor" = 0));

CREATE FUNCTION finance_posting_currency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "currency" FROM "LedgerAccount" WHERE "id" = NEW."accountId") <> (SELECT "currency" FROM "JournalEntry" WHERE "id" = NEW."journalId") THEN
    RAISE EXCEPTION 'posting currency differs from journal currency';
  END IF;
  RETURN NEW;
END $$;

INSERT INTO "FinancialRule" ("id", "code", "version", "status", "source", "marketCode", "detail") VALUES
('phase5-eg-development-v1', 'EG_DEVELOPMENT', 1, 'APPROVED', 'User Phase 5 request 2026-11-24; BUSINESS_RULES.md EG', 'EG', '{"basis":"agreed_EGP_price","percent":10}'),
('phase5-sa-development-v1', 'SA_DEVELOPMENT', 1, 'APPROVED', 'User Phase 5 request 2026-11-24; BUSINESS_RULES.md SA', 'SA', '{"currency":"EGP","poster":100,"motion":400,"video_poster":400,"subscription":2000}'),
('phase5-profit-split-v1', 'PROFIT_SPLIT', 1, 'APPROVED', 'User Phase 5 request 2026-11-24', NULL, '{"basis":"positive eligible cash surplus after obligations and reserves","charity_percent":50,"owner_family_percent":50}'),
('phase5-partial-commission-v1', 'PARTIAL_COMMISSION_TIMING', 1, 'PENDING', 'BUSINESS_RULES.md unresolved decision', NULL, '{"reason":"partial collection, cancellation and multiple communicators need an approved earning rule"}'),
('phase5-fx-v1', 'FX_RECOGNITION', 1, 'PENDING', 'User Phase 5 request 2026-11-24', 'SA', '{"reason":"actual bank settlement currency, rate source and date must be documented before EGP allocation"}');
CREATE TRIGGER finance_posting_currency_check BEFORE INSERT ON "LedgerPosting" FOR EACH ROW EXECUTE FUNCTION finance_posting_currency();

CREATE FUNCTION finance_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text;
BEGIN
  target_id := CASE WHEN TG_TABLE_NAME = 'JournalEntry' THEN NEW."id" ELSE NEW."journalId" END;
  IF (SELECT COALESCE(SUM("debitMinor"), 0) <> COALESCE(SUM("creditMinor"), 0) OR COUNT(*) < 2 FROM "LedgerPosting" WHERE "journalId" = target_id) THEN
    RAISE EXCEPTION 'journal % is not balanced', target_id;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER finance_balance_on_journal AFTER INSERT ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_journal_balanced();
CREATE CONSTRAINT TRIGGER finance_balance_on_posting AFTER INSERT ON "LedgerPosting" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance_journal_balanced();

CREATE FUNCTION finance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'posted finance records are immutable; create a reversal';
END $$;
CREATE TRIGGER finance_journal_immutable BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION finance_immutable();
CREATE TRIGGER finance_posting_immutable BEFORE UPDATE OR DELETE ON "LedgerPosting" FOR EACH ROW EXECUTE FUNCTION finance_immutable();
CREATE TRIGGER finance_receipt_immutable BEFORE UPDATE OR DELETE ON "Receipt" FOR EACH ROW EXECUTE FUNCTION finance_immutable();

ALTER TABLE "PaymentClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Receipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerPosting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancialRule" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "PaymentClaim", "Receipt", "LedgerAccount", "JournalEntry", "LedgerPosting", "FinancialRule" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "PaymentClaim", "Receipt", "LedgerAccount", "JournalEntry", "LedgerPosting", "FinancialRule" FROM authenticated;
  END IF;
END $$;
