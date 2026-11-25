CREATE OR REPLACE FUNCTION finance_refund_assessment_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matches_assessment boolean;
BEGIN
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I."CancellationAssessment" a WHERE a."id" = $1 AND a."orderId" = $2 AND a."refundMinor" = $3 AND a."currency" = $4 AND a."returnFeeMinor" = 0)', TG_TABLE_SCHEMA)
  INTO matches_assessment USING NEW."assessmentId", NEW."orderId", NEW."amountMinor", NEW."currency";
  IF NOT matches_assessment THEN
    RAISE EXCEPTION 'refund order does not match a zero-fee cancellation assessment';
  END IF;
  RETURN NEW;
END $$;
