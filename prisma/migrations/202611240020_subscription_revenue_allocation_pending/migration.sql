INSERT INTO "FinancialRule" ("id","code","version","status","source","marketCode","detail") VALUES
('phase5f-subscription-revenue-allocation-v1','SUBSCRIPTION_REVENUE_ALLOCATION',1,'PENDING','Owner Phase 5F request 2026-11-24','SA',
'{"contractSarMinor":130000,"outputs":{"VIDEO":3,"POSTER":3},"needed":"approved allocation of the 1300 SAR transaction price to six distinct accepted works","no_inference_from":"individual cancellation refund prices","recognition":"blocked until allocation is approved and matched to each project"}')
ON CONFLICT ("code","version") DO NOTHING;
