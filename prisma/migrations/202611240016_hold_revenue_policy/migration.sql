UPDATE "FinancialRule"
SET "status" = 'PENDING',
    "source" = 'Phase 5E requires a separate accounting recognition decision',
    "detail" = '{"reason":"Owner approved profit availability after accepted delivery, not accounting revenue recognition timing","scope":"recognition journal remains blocked","needed":"recognition basis for individual and subscription services, partial delivery, cancellations and unpaid balances"}'::jsonb
WHERE "code" = 'REVENUE_RECOGNITION' AND "version" = 2;
