CREATE UNIQUE INDEX "expense_active_proof_unique"
ON "Expense" (lower(btrim("proofRef")))
WHERE "proofRef" IS NOT NULL AND btrim("proofRef") <> '' AND "status" <> 'CANCELLED';
