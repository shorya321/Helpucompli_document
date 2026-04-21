# Module 11: Security & HIPAA Compliance

**Phase:** 4 (Hardening + Launch)
**Priority:** Critical — legal requirement

---

## Overview

Comprehensive security hardening and HIPAA Technical Safeguard compliance verification. Covers encryption, access controls, audit controls, integrity, and transmission security.

## Features

### F11.1 — HIPAA Technical Safeguard Mapping

| HIPAA Requirement | Implementation | Verification |
|-------------------|---------------|-------------|
| Access Control (164.312(a)(1)) | Auth0 RBAC + MFA. Least-privilege IAM. No public buckets. | Auth0 config. IAM review. S3 Block Public Access. |
| Audit Controls (164.312(b)) | CloudTrail + PostgreSQL audit_logs. 6-year retention. | Trail active. DB table populated. Lifecycle set. |
| Integrity (164.312(c)(1)) | S3 versioning. Object Lock (optional). No anonymous writes. | Versioning on. IAM denies public PutObject. |
| Transmission Security (164.312(e)(1)) | TLS 1.2+. S3 policy denying non-HTTPS. Secure cookies. | Bucket policy. SSL cert. Cookie flags. |
| Encryption at Rest | SSE-KMS with CMK. Key rotation enabled. | Encryption config. KMS key. Rotation schedule. |
| Person/Entity Auth (164.312(d)) | MFA for admins. 30-min session timeout. No shared accounts. | MFA policy. Session config. User audit trail. |

### F11.2 — Security Headers
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
```

### F11.3 — Rate Limiting
- 100 requests/minute per authenticated user
- 10 requests/minute for link generation
- Rate limit via `@upstash/ratelimit` with Redis backend
- Return `429 Too Many Requests` when exceeded

### F11.4 — Input Validation
- Zod schemas on every API route
- Validate: file names, bucket names, CIDR ranges, domains, UUIDs
- Reject malformed input with 400 Bad Request
- No sensitive information in error responses

#### Validated environment at boot (follow-up from F2.2)
- Wire `src/lib/prisma.ts` through `getConfig().DATABASE_URL` (validated by `src/lib/config.ts` — see F1.6) instead of reading `process.env` directly. Fail-fast if any required env missing or malformed.
- Add `vitest.setup.ts` with `beforeAll` stubs for every validated key (`AUTH0_*`, `AWS_*`, `DATABASE_URL`, `APP_BASE_URL`, `NODE_ENV`) so unit tests don't blow up at `getConfig()` cache-populate.
- Runbook entry: on boot failure, check the aggregated per-field error list from `ConfigError` and cross-reference with `.env.example`.

### F11.5 — CSRF Protection
- SameSite=Lax cookies (Auth0 default)
- Auth0 state parameter on OAuth flow
- No CSRF tokens needed for API routes (session cookie + SameSite)

### F11.6 — AWS Security Configuration
- **CloudTrail:** Data events enabled on all document buckets
- **GuardDuty:** Enabled for threat detection
- **AWS Config Rules:** Monitor S3 bucket compliance
- **CloudWatch Alarms:**
  - Unauthorized API calls
  - Failed login attempts > threshold
  - S3 policy changes
  - IAM role modifications

### F11.7 — Dependency Security
- GitHub Dependabot enabled
- `npm audit` in CI pipeline
- No known critical vulnerabilities at deploy

### F11.8 — Data Classification
- Platform stores compliance docs, templates, regulatory content
- Does NOT store patient records or direct ePHI
- No PHI collection in any form or input
- File content is opaque — not parsed or indexed

### F11.9 — Incident Response Plan
- Detection: CloudWatch alerts, GuardDuty findings
- Containment: Revoke compromised credentials, disable affected users
- Notification: 60-day HIPAA breach notification requirement
- Review: Post-incident analysis and remediation

### F11.10a — Perpetual ("Never Expires") Share Links and Policies

Links and policies can be created with `expiresAt = NULL` / `linkTtlSeconds = NULL`, meaning they remain valid until explicitly revoked or the download cap is hit. This is a HIPAA-relevant footgun — a bearer token that never expires widens the attack surface for token-leak incidents. The platform gates the capability as follows.

**Superadmin-only — enforced at three layers:**

1. **UI** — `"Never expires"` option is hidden from the TTL `<select>` for non-superadmins.
   - `src/components/links/generate-link-form.tsx` — conditional `<option value="never">` gated on `canNeverExpire`.
   - `src/components/policies/policy-form.tsx` — same pattern.
2. **API** — server 403s regardless of UI:
   - `POST /api/links` — rejects `neverExpires: true` when role ≠ `superadmin`.
   - `POST /api/policies` + `PUT /api/policies/[id]` — rejects `linkTtlSeconds: null` when role ≠ `superadmin`.
   - `src/lib/link-create.ts` `PerpetualLinkForbiddenError` — thrown when the *resolved* link TTL ends up null (e.g. inherited from a null-TTL policy with no override) and the caller isn't superadmin. Closes the null-policy inheritance hole.
3. **Confirm dialog** — on the UI, picking `"Never expires"` fires a HIPAA warning and reverts on cancel.

**Compliance filter — surface perpetual creations:**

```sql
-- Every perpetual-link issuance
SELECT id, user_id, created_at, metadata
FROM audit_logs
WHERE action = 'LINK_GENERATE'
  AND metadata->>'neverExpires' = 'true'
ORDER BY created_at DESC;

-- Every perpetual-policy creation / update
SELECT id, user_id, created_at, metadata
FROM audit_logs
WHERE action IN ('POLICY_CREATE', 'POLICY_UPDATE')
  AND metadata->>'linkTtlSeconds' = 'null'
ORDER BY created_at DESC;
```

**Incident response:** revoke the link via `DELETE /api/links/admin/[id]` (sets `isRevoked = true`, writes `LINK_REVOKE` audit). For policies, flip `linkTtlSeconds` back to a finite value via `PUT /api/policies/[id]` — existing links already materialized against the policy keep their stored TTL, so you must revoke each one individually.

### F11.10b — Link Token Re-Reveal (Share-Info Endpoint)

`GET /api/links/admin/[id]/share-info` (step 3 of the never-expires feature) lets an admin copy a link's URL or iframe HTML after leaving the generate-link page. Every call **re-reveals a bearer token** so it is audited per-call.

- **Guards:** admin+, UUID-only, 30/min rate limit per user, 410 on revoked/expired/cap-hit.
- **Audit:** every successful call writes a `LINK_SHARE_INFO_VIEW` row. Audit-write failure returns 500 — no silent reveals.

**Compliance filter:**

```sql
-- Who re-copied which link, when, from where
SELECT created_at, user_id, target_id, ip_address, user_agent
FROM audit_logs
WHERE action = 'LINK_SHARE_INFO_VIEW'
ORDER BY created_at DESC;
```

### F11.10 — AWS BAA Checklist
- [ ] Sign AWS BAA via AWS Artifact console (self-service)
- [ ] Confirm all services used are HIPAA-eligible
- [ ] If Auth0 handles ePHI: sign Auth0 BAA (Enterprise plan required)
- [ ] Document BAA status and dates

## Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/app/proxy.ts` | Add security headers |
| `src/lib/rate-limit.ts` | Rate limiting configuration |
| `src/lib/validation.ts` | Shared Zod schemas |
| `docs/HIPAA-COMPLIANCE-CHECKLIST.md` | Compliance evidence document |
| `docs/INCIDENT-RESPONSE-PLAN.md` | Incident response playbook |

## Acceptance Criteria

- [ ] All HIPAA Technical Safeguards implemented and verified
- [ ] Security headers set on all responses
- [ ] Rate limiting active on all API endpoints
- [ ] Input validation on every API route
- [ ] No secrets in client-side code
- [ ] AWS BAA signed and documented
- [ ] CloudTrail active on all document buckets
- [ ] GuardDuty enabled
- [ ] Incident response plan documented
- [ ] Dependency scan shows no critical vulnerabilities
