-- DESTRUCTIVE: wipes ALL row data including users and audit_logs.
-- Run via: npm run db:clean:all
-- Local dev only. Bypasses HIPAA append-only audit retention guard
-- by temporarily dropping triggers, truncating, then restoring them.
-- NEVER point this at production.

BEGIN;

-- 1. Drop append-only triggers so audit_logs can be truncated.
DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;

-- 2. Wipe everything. CASCADE handles FK chain.
TRUNCATE TABLE
  user_bucket_access,
  generated_links,
  access_policies,
  audit_logs,
  documents,
  buckets,
  users
RESTART IDENTITY CASCADE;

-- 3. Restore triggers (mirrors migration 20260417175504_rereview_hardening).
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();
ALTER TABLE audit_logs ENABLE ALWAYS TRIGGER audit_logs_no_update;

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();
ALTER TABLE audit_logs ENABLE ALWAYS TRIGGER audit_logs_no_delete;

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();
ALTER TABLE audit_logs ENABLE ALWAYS TRIGGER audit_logs_no_truncate;

COMMIT;
