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
