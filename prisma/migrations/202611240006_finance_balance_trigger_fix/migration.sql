-- Select the identifier by row shape so either trigger table is handled safely
CREATE OR REPLACE FUNCTION finance_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text;
BEGIN
  IF to_jsonb(NEW) ? 'journalId' THEN
    target_id := NEW."journalId";
  ELSE
    target_id := NEW."id";
  END IF;
  IF (SELECT COALESCE(SUM("debitMinor"), 0) <> COALESCE(SUM("creditMinor"), 0) OR COUNT(*) < 2 FROM "LedgerPosting" WHERE "journalId" = target_id) THEN
    RAISE EXCEPTION 'journal % is not balanced', target_id;
  END IF;
  RETURN NEW;
END $$;
