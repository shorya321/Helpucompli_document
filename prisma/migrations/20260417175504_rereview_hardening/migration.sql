-- ============================================================================
-- Module 02 re-review hardening
-- Research sources:
--   - Prisma 6 scalar lists on PostgreSQL (String[] -> text[])
--     https://www.prisma.io/docs/orm/reference/prisma-schema-reference#scalar-list-support
--   - Prisma @@index(type: Gin) native support for JSONB
--     https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes#gin
--   - PostgreSQL ALTER TRIGGER ... ENABLE ALWAYS (replica safety)
--     https://www.postgresql.org/docs/current/sql-altertable.html
-- ============================================================================

-- --------------------------------------------------------------------------
-- F2.1 hardening — trigger ENABLE ALWAYS so rds_superuser setting
-- session_replication_role='replica' cannot silently suppress the
-- audit-log append-only enforcement during a bulk migration script.
-- DROP + CREATE preserves behaviour while allowing the new ENABLE ALWAYS
-- clause to be set atomically.
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS audit_logs_no_update ON "audit_logs";
DROP TRIGGER IF EXISTS audit_logs_no_delete ON "audit_logs";
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON "audit_logs";

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();
ALTER TABLE "audit_logs" ENABLE ALWAYS TRIGGER audit_logs_no_update;

CREATE TRIGGER audit_logs_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_mutation();
ALTER TABLE "audit_logs" ENABLE ALWAYS TRIGGER audit_logs_no_delete;

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_mutation();
ALTER TABLE "audit_logs" ENABLE ALWAYS TRIGGER audit_logs_no_truncate;

-- --------------------------------------------------------------------------
-- F8 policy engine preparation — switch allowed_domains / allowed_ip_ranges
-- from jsonb to text[]. Native arrays give us GIN-friendly @>, unnest(),
-- and per-element indexability without a JSON path fragment. USING clause
-- reads existing jsonb arrays element-wise so dev data survives the move.
-- --------------------------------------------------------------------------
ALTER TABLE "access_policies"
  ALTER COLUMN "allowed_domains" TYPE TEXT[]
    USING (
      CASE
        WHEN "allowed_domains" IS NULL THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text("allowed_domains"))
      END
    );

ALTER TABLE "access_policies"
  ALTER COLUMN "allowed_ip_ranges" TYPE TEXT[]
    USING (
      CASE
        WHEN "allowed_ip_ranges" IS NULL THEN NULL
        ELSE ARRAY(SELECT jsonb_array_elements_text("allowed_ip_ranges"))
      END
    );

-- --------------------------------------------------------------------------
-- F7 audit-log query performance — GIN index on metadata. audit_logs is the
-- largest table under 6y retention; future filters like
-- `metadata @> '{"bucket":"..."}'::jsonb` would seq-scan otherwise.
-- --------------------------------------------------------------------------
CREATE INDEX "audit_logs_metadata_gin_idx" ON "audit_logs" USING GIN ("metadata");

-- --------------------------------------------------------------------------
-- F10 user-disable UX — reverse index on user_bucket_access.bucket_id so
-- the "who has access to bucket X" query avoids a seq-scan. The composite
-- PK (user_id, bucket_id) indexes user_id first, so bucket_id alone is
-- uncovered.
-- --------------------------------------------------------------------------
CREATE INDEX "user_bucket_access_bucket_id_idx" ON "user_bucket_access" ("bucket_id");
