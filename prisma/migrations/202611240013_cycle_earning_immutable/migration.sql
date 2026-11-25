CREATE OR REPLACE FUNCTION finance_earning_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'earning records cannot be deleted'; END IF;
  IF ROW(NEW."entitlementKey", NEW."kind", NEW."recipientId", NEW."orderId", NEW."projectId", NEW."assignmentId", NEW."subscriptionCycleId", NEW."amountMinor", NEW."currency", NEW."policyCode", NEW."policyVersion", NEW."basisRef") IS DISTINCT FROM ROW(OLD."entitlementKey", OLD."kind", OLD."recipientId", OLD."orderId", OLD."projectId", OLD."assignmentId", OLD."subscriptionCycleId", OLD."amountMinor", OLD."currency", OLD."policyCode", OLD."policyVersion", OLD."basisRef") THEN
    RAISE EXCEPTION 'earning basis is immutable; record a settlement';
  END IF;
  IF OLD."status" IN ('PAID','ADJUSTED') AND NEW."status" <> OLD."status" THEN RAISE EXCEPTION 'final earning status cannot be changed'; END IF;
  RETURN NEW;
END $$;
