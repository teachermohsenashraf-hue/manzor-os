INSERT INTO "FinancialRule" ("id","code","version","status","source","marketCode","detail") VALUES
('phase5e-revenue-full-v2','REVENUE_RECOGNITION',2,'APPROVED','Owner Phase 5E request 2026-11-24',NULL,
'{"basis":"full fixed-scope order after accepted final delivery or complete closed subscription cycle","scope":"one approved item, quantity one, no approved scope change, fully collected","partial_and_cancelled":"blocked pending case settlement","separate_from":"cash collection and profit distribution"}')
ON CONFLICT ("code","version") DO NOTHING;
