-- Explicitly block final postings until accounting decisions are documented
INSERT INTO "FinancialRule" ("id", "code", "version", "status", "source", "marketCode", "detail") VALUES
('phase5d-revenue-pending-v1', 'REVENUE_RECOGNITION', 1, 'PENDING', 'Phase 5D accounting decision required', NULL, '{"block":"No final revenue journal until timing, amount, partial performance and reversal policy are approved"}'),
('phase5d-fx-clearing-pending-v1', 'FX_CLEARING', 1, 'PENDING', 'Phase 5D accounting decision required', 'SA', '{"block":"No exchange gain or loss or clearing journal until functional currency and historical settlement treatment are approved"}'),
('phase5d-refund-pending-v1', 'REFUND_SETTLEMENT', 1, 'PENDING', 'Phase 5D accounting decision required', 'SA', '{"block":"No refund payout or reversal until started work, conversion and return fee treatment are approved per case"}'),
('phase5d-distribution-pending-v1', 'PROFIT_DISTRIBUTION', 1, 'PENDING', 'Phase 5D accounting decision required', NULL, '{"block":"No distributable profit or final payout until revenue, FX, refunds, expense allocation and reserve policies are approved"}')
ON CONFLICT ("code", "version") DO NOTHING;
