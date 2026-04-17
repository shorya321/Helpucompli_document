# HIPAA Compliance Checklist

Living document tracking the HelpUcompli Document Repository's HIPAA Security Rule posture. Each section maps implementation to the corresponding Technical Safeguard and cites evidence (code path, commit, migration, or configuration reference).

> This file is populated incrementally as features ship. Module 11 (`docs/modules/11-security-hipaa-module.md`) consolidates the final evidence table at launch.

---

## Audit Log Retention Policy

**Regulatory anchor:** 45 CFR §164.316(b)(2)(i) — Covered entities MUST retain security-rule documentation, including audit records, for **six (6) years** from the date of creation or the date last in effect, whichever is later. Several state medical-records statutes extend this further (e.g. California HSC §123145 — 7 years; New York PHL §18 — 6 years adult / until age 21 minor). **Six years is the floor; state-law extensions apply per tenant.**

### 1. Retention floor

- **Minimum retention:** 6 years for every row in `public.audit_logs`.
- **Clock start:** `audit_logs.created_at` (UTC timestamp, set by `DEFAULT now()`).
- **No early-deletion path.** Even administrative account deletions MUST NOT cascade into audit rows — `audit_logs.user_id` uses `ON DELETE SET NULL` (see F2.1 migration `20260417100556_init`), preserving the audit row while anonymizing the FK.

### 2. Append-only enforcement (shipped F2.1)

The `audit_logs` table is strictly append-only. This is enforced at **three layers** so no application-level bug can erase or mutate history:

1. **DB-level BEFORE triggers** — `audit_logs_no_update`, `audit_logs_no_delete`, `audit_logs_no_truncate` each invoke `audit_logs_reject_mutation()` and `RAISE EXCEPTION ... ERRCODE 'insufficient_privilege'`. Any attempt to run `UPDATE`, `DELETE`, or `TRUNCATE` fails at the database for the application role. Triggers are created with `ALTER TABLE ... ENABLE ALWAYS TRIGGER ...` (migration `20260417175504_rereview_hardening`) so they still fire when a migration sets `session_replication_role = 'replica'`. Note: an account with `rds_superuser` (AWS RDS) or equivalent can still `DROP TRIGGER` or `ALTER TABLE ... DISABLE TRIGGER` — the application role MUST NOT be granted those privileges, and IAM/audit-trail controls cover the human-operator escape hatch. (See `prisma/migrations/20260417100556_init/migration.sql` for the initial definition and `20260417175504_rereview_hardening/migration.sql` for the ENABLE ALWAYS hardening.)
2. **Application-layer absence** — `src/lib/audit.ts` (Module 07) exposes only `logAudit()`; no update or delete helpers.
3. **Schema-level unique constraint on `generated_links.presigned_url_hash`** — prevents hash-collision replay that could fabricate or overwrite an audit linkage. (See F2.1 sec-review L2.)

### 3. Partitioning strategy (planned for ops scale)

For tenant scale > ~50M rows/year we will migrate to PostgreSQL declarative **RANGE partitioning by month** on `created_at`:

```sql
CREATE TABLE audit_logs (
    ...
) PARTITION BY RANGE (created_at);

-- monthly child tables, e.g.
CREATE TABLE audit_logs_2026_04
  PARTITION OF audit_logs
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
```

**Benefits:**
- Query planner prunes partitions by `created_at` range (matches the F2.1 index).
- Aged partitions can be detached and archived atomically without blocking writes.
- `BEFORE UPDATE/DELETE/TRUNCATE` triggers propagate to partitions automatically.

**Trigger on partition creation:** new monthly partitions MUST inherit the reject-mutation triggers. A migration template will be provided in Module 07 alongside the partition-rotation cron.

### 4. S3 Glacier archive (cold storage for aged partitions)

Partitions older than **18 months** (configurable per tenant, never less than the 6-year floor while still online) are:

1. **`pg_dump`'d** to newline-delimited JSON (one file per partition) with SSE-KMS on the intermediary S3 bucket.
2. **Uploaded to `s3://helpucompli-audit-archive/<tenant>/<YYYY-MM>.jsonl.gz`** with storage class `GLACIER` (deep retrieval OK — restore SLA is forensic, not interactive).
3. **Lifecycle rule** on the archive bucket: transition to `DEEP_ARCHIVE` after 1 year in GLACIER; never expire (retention is indefinite beyond the 6-year floor).
4. **Partition detached** from `audit_logs` via `ALTER TABLE ... DETACH PARTITION` + `DROP TABLE` only after:
   - archive upload checksum verified (`ETag` matches local SHA-256), AND
   - restoration test succeeded (quarterly drill — pick random archived month, restore, diff against a fresh `pg_dump` of an untouched partition).

### 5. Verification procedure

Quarterly audit drill:

- [ ] Confirm `audit_logs` rows back to at least the 6-year retention boundary are queryable (online or via archive-restore tested within 24h).
- [ ] Confirm append-only triggers are present in `information_schema.triggers` for `audit_logs` (and every partition once partitioning ships).
- [ ] Confirm S3 archive bucket has Block Public Access, SSE-KMS, and versioning enabled.
- [ ] Confirm lifecycle rule transitions to DEEP_ARCHIVE as specified.
- [ ] Confirm restoration drill succeeded and diff was clean.

### 6. Known follow-ups

- **Partition rotation automation** — Module 07. Monthly cron creates next month's partition and attaches reject-mutation triggers.
- **Archive pipeline** — Module 07 or a dedicated ops repo. Must run under an IAM role with `s3:PutObject` on archive bucket only (no `Delete*`).
- **WORM (Write-Once-Read-Many)** — Module 11 evaluates S3 Object Lock in Compliance mode on archive bucket for defense-in-depth. Compliance mode prevents even root-account deletion during the retention window.
- **Tenant-state overrides** — Module 10 or tenant config. Tenants in states with longer retention statutes (e.g. CA 7y) configure an override; the pipeline respects the larger of {federal floor, state floor}.

---

*This section owns F2.4. Expand this checklist in subsequent modules — F11 will add the consolidated Technical Safeguard Mapping table, BAA status, and post-launch evidence columns.*
