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

*This section owns F2.4 and F7.5 — Module 07's retention requirement is fully satisfied by the policy above (6-year floor, append-only triggers, monthly RANGE partitioning plan, S3 Glacier archive, quarterly drill). Expand this checklist in subsequent modules — F11 will add the consolidated Technical Safeguard Mapping table, BAA status, and post-launch evidence columns.*

### 7. F7.5 verification (Module 07)

Sign-off that the retention policy is enforced today:

- [x] **6-year floor** — documented in §1, sourced to 45 CFR §164.316(b)(2)(i).
- [x] **Append-only enforcement live** — three-layer defense in §2: DB triggers (`audit_logs_no_update/delete/truncate`, ENABLE ALWAYS), application surface (`src/lib/audit.ts` exposes only `logAudit()`), and schema-level uniqueness constraints. Migrations: `20260417100556_init`, `20260417175504_rereview_hardening`.
- [x] **Partitioning plan documented** — §3 (monthly RANGE on `created_at`), follow-up tracked in §6.
- [x] **Glacier archive plan documented** — §4 with lifecycle to DEEP_ARCHIVE, restoration drill, and `s3:PutObject`-only IAM scope.
- [x] **Verification cadence defined** — §5 quarterly drill checklist.

No-deletion guard tests:
- `src/__tests__/audit/log-audit.test.ts` — confirms `logAudit()` is the only write path; `AuditPrisma` interface exposes `auditLog.create` only (no `update`/`delete`/`upsert`/`deleteMany`).
- F2.4 migration test exercises trigger rejections at the DB layer.

---

## Technical Safeguard Mapping (F11.4)

Consolidated mapping of HIPAA Security Rule Technical Safeguards (45 CFR §164.312) onto the implementation + verification in this codebase. Every row cites a concrete code path OR a configuration anchor (AWS/Auth0 tenant) plus the test or runbook that proves the control is active.

| § | HIPAA Requirement | Implementation | Verification |
|---|-------------------|----------------|--------------|
| 164.312(a)(1) | **Access Control** — Unique user identification, emergency access, automatic logoff | Auth0 RBAC (superadmin/admin/viewer) + per-user bucket access junction (F10.5) + MFA policy for admins + 30-min session timeout. Least-privilege IAM policies in `docs/IAM-POLICIES.md`. S3 Block Public Access on every bucket. | Auth0 tenant config review. IAM access-analyzer scan (F11.6 carry). `src/lib/s3-buckets.ts` `createHipaaBucket` applies `PublicAccessBlockConfiguration { BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets }`. Test: `src/__tests__/s3/buckets.test.ts`. |
| 164.312(a)(2)(i) | Unique User Identification | Auth0 `sub` is the primary user key; DB `users.auth0_id` unique. | `src/lib/ensure-user.ts` upsert keyed on `auth0Id`. |
| 164.312(a)(2)(iii) | Automatic Logoff | Auth0 SDK `absoluteDuration` = 30 min via tenant rolling-session config; idle logout via cookie `Max-Age` 8 h cap. | Runbook: tenant-config checklist. Cookie `SameSite=Lax`, `HttpOnly`, `Secure` in prod. |
| 164.312(a)(2)(iv) | Encryption / Decryption (Encryption at Rest) | SSE-KMS with per-tenant CMK on all document buckets. Key rotation enabled. | `src/lib/s3-buckets.ts` applies `ServerSideEncryptionConfiguration { Rule { ApplyServerSideEncryptionByDefault { SSEAlgorithm: "aws:kms" } } }`. |
| 164.312(b) | **Audit Controls** — Hardware, software, procedural mechanisms recording access | Immutable `audit_logs` table. Every mutating API route calls `logAudit()`. 6-year retention (see §1). CloudTrail data events active on document buckets (F3.2 + F11.6 carry). | DB-level triggers `audit_logs_no_update`, `audit_logs_no_delete`, `audit_logs_no_truncate` (`ENABLE ALWAYS`). Migrations `20260417100556_init` + `20260417175504_rereview_hardening`. Test: `src/__tests__/audit/log-audit.test.ts`. |
| 164.312(c)(1) | **Integrity** — Protect ePHI from improper alteration / destruction | S3 versioning `Status: "Enabled"` on every bucket. No anonymous writes (Block Public Access). Append-only audit log (§2). Future: S3 Object Lock (Compliance mode) on audit-archive bucket (§4). | `src/lib/s3-buckets.ts` applies `VersioningConfiguration { Status: "Enabled" }`. Test: `src/__tests__/s3/buckets.test.ts`. |
| 164.312(c)(2) | Authenticate ePHI | Presigned URL requires server-signed request + short TTL + per-link audit row. `generated_links.presigned_url_hash` UNIQUE prevents replay. | `src/lib/link-create.ts` + schema migration `20260417100556_init`. |
| 164.312(d) | **Person or Entity Authentication** | MFA required for admin roles (Auth0 tenant rule). No shared accounts. Session TTL enforced. | Runbook: Auth0 tenant MFA policy screenshot. Session timeout documented above. |
| 164.312(e)(1) | **Transmission Security** | TLS 1.2+ required. Bucket policy `Condition: { Bool: { "aws:SecureTransport": "false" } }` denies plain HTTP. Strict CSP (F11.1). HSTS preload (F11.1). Secure cookies. | `src/lib/s3-buckets.ts` TLS-deny policy statement. Security headers in `src/lib/security-headers.ts` + `src/proxy.ts`. Test: `src/__tests__/security/security-headers.test.ts`. |
| 164.312(e)(2)(i) | Integrity Controls in Transit | HTTPS only. Presigned PUT uploads carry `x-amz-server-side-encryption` header directive. | `src/lib/document-upload.ts` enforces upload path. |
| 164.312(e)(2)(ii) | Encryption in Transit | TLS 1.2+ at CloudFront/ALB. Strict-Transport-Security header. | F11.1 header config. |

### Carry-forwards to AWS tenant config (F11.6)

These controls are infrastructure, not application code:

- [ ] **S3 Object Lock** (Compliance mode) on `helpucompli-audit-archive/*` partitions older than 1y — WORM compliance, prevents even root deletion.
- [ ] **S3 Access Analyzer** enabled at account level — detects cross-account / public exposure drift.
- [ ] **Amazon Macie** job on document buckets — automated PHI/PII discovery as a defense-in-depth to the `no PHI in any form` policy (see Data Classification).
- [ ] **CloudTrail data events** on every document bucket + management events at account level.
- [ ] **MFA enforcement** for admin + superadmin Auth0 roles via tenant rule.
- [ ] **30-min rolling session timeout** configured in Auth0 tenant.
- [ ] **AWS Config Rules** for S3 bucket-compliance drift (SSE, BPA, versioning).
- [ ] **GuardDuty** enabled account-wide.

---

## Data Classification (F11.8)

| Class | Handled? | Notes |
|-------|----------|-------|
| **Patient records / direct ePHI** | **NO** | Platform does not store clinical records. No PHI is collected in any form, input, or upload metadata. File content is treated as opaque — never parsed, indexed, or echoed back. |
| **Compliance documents / templates / regulatory content** | YES | Core use-case. Buckets are per-tenant, access controlled. |
| **User PII** (name, email) | MINIMAL | Auth0 source of truth; mirrored locally for UI + audit joins. No SSN, DOB, address, phone. |
| **Audit trail** | YES | 6-year append-only retention (§1–§5). No PHI in `audit_logs.metadata` — schema review at F7 ensures only actor + action + target identifiers. |
| **Presigned URLs / tokens** | TRANSIENT | Bearer credentials, short-TTL (15 min default). `generated_links.presigned_url_hash` is a SHA-256 of the URL, never the URL itself. |

Because no PHI is collected or stored as content, a narrow BAA scope applies: storage + compute only.

---

## BAA Status (F11.10)

| Vendor | BAA required? | Status | Notes |
|--------|---------------|--------|-------|
| AWS | YES | Pending signature via AWS Artifact console (self-service) | Covers S3, RDS, KMS, CloudTrail, CloudWatch, IAM. All services used are on the HIPAA-eligible list. |
| Auth0 | CONDITIONAL | Evaluate if any ePHI touches Auth0 metadata | Current design: only user identifiers (email, name) in Auth0 — no clinical data. Enterprise plan required if BAA needed. |
| Resend | EVALUATE | Transactional email for invites | Content limited to invitation links + product branding. No ePHI in email body. Review vendor DPA. |
| Upstash | YES | Evaluate | Rate-limit counters only — no PHI. Metadata may include hashed user identifier. |
| Vercel (if used) | YES | Evaluate | Edge/Node runtime. Platform BAA available on Enterprise plan. |

### Action items

- [ ] Download AWS BAA via Artifact, store countersigned copy in shared legal drive, record signature date here.
- [ ] Confirm with Legal whether Auth0 BAA is triggered given the no-ePHI-in-Auth0 design.
- [ ] Obtain Resend DPA or migrate to SES (already under AWS BAA).
- [ ] Record all BAA signature dates in this table.

---

*F11.4 sign-off: Every Technical Safeguard row above maps to a code path or a documented tenant-config carry-forward. The row-by-row verification column cites the authoritative test or migration. This section will be re-reviewed at launch (Module 12) with signed-off dates.*
