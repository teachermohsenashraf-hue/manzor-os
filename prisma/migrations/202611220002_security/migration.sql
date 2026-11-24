-- Application records must never be reachable through the public Supabase Data API.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoginThrottle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "User", "Session", "LoginThrottle", "AuditLog" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "User", "Session", "LoginThrottle", "AuditLog" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "User", "Session", "LoginThrottle", "AuditLog" FROM authenticated;
  END IF;
END $$;

CREATE FUNCTION manzoor_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs are append-only';
END $$;
CREATE TRIGGER audit_no_update_delete BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION manzoor_audit_immutable();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON "AuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION manzoor_audit_immutable();

ALTER TABLE "User" ADD CONSTRAINT username_normalized CHECK ("username" = lower("username") AND "username" ~ '^[a-z0-9_.-]{3,64}$');
