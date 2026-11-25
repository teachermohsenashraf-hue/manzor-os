DROP INDEX "RevenueRecognition_orderId_key";
ALTER TABLE "RevenueRecognition" ADD COLUMN "projectId" TEXT NOT NULL;
CREATE UNIQUE INDEX "RevenueRecognition_projectId_key" ON "RevenueRecognition"("projectId");
CREATE INDEX "RevenueRecognition_orderId_idx" ON "RevenueRecognition"("orderId");
ALTER TABLE "RevenueRecognition" ADD CONSTRAINT "RevenueRecognition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "FinancialRule" ("id","code","version","status","source","marketCode","detail") VALUES
('phase5f-individual-revenue-v1','INDIVIDUAL_REVENUE_RECOGNITION',1,'APPROVED','Owner Phase 5F request 2026-11-24',NULL,
'{"basis":"contracted unit price for an individual service after final accepted delivery and valid confirmed collection","receipt_allocation":"cumulative recognized amount plus this unit may not exceed confirmed collection","subscription":"blocked pending approved allocation of 1300 SAR","cancellation":"blocked pending final settlement","accounting":"customer advances debited and service revenue credited in contract currency"}')
ON CONFLICT ("code","version") DO NOTHING;
