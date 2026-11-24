-- Resolve finance rows in the schema that owns the triggering table
CREATE OR REPLACE FUNCTION finance_posting_currency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_currency text;
DECLARE journal_currency text;
BEGIN
  EXECUTE format('SELECT "currency" FROM %I."LedgerAccount" WHERE "id" = $1', TG_TABLE_SCHEMA)
    INTO account_currency USING NEW."accountId";
  EXECUTE format('SELECT "currency" FROM %I."JournalEntry" WHERE "id" = $1', TG_TABLE_SCHEMA)
    INTO journal_currency USING NEW."journalId";
  IF account_currency IS DISTINCT FROM journal_currency THEN
    RAISE EXCEPTION 'posting currency differs from journal currency';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION finance_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text;
DECLARE unbalanced boolean;
BEGIN
  IF to_jsonb(NEW) ? 'journalId' THEN
    target_id := NEW."journalId";
  ELSE
    target_id := NEW."id";
  END IF;
  EXECUTE format('SELECT COALESCE(SUM("debitMinor"), 0) <> COALESCE(SUM("creditMinor"), 0) OR COUNT(*) < 2 FROM %I."LedgerPosting" WHERE "journalId" = $1', TG_TABLE_SCHEMA)
    INTO unbalanced USING target_id;
  IF unbalanced THEN
    RAISE EXCEPTION 'journal % is not balanced', target_id;
  END IF;
  RETURN NEW;
END $$;
