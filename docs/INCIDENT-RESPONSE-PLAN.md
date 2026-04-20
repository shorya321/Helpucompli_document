# Incident Response Plan

HelpUcompli Document Repository — HIPAA Security Rule §164.308(a)(6) response procedures. Every reported or detected incident follows this plan. Owners + cadence listed in §6.

> Companion documents:
> - `docs/AWS-SECURITY-CONFIG.md` — detection wiring (CloudTrail, GuardDuty, Config, CloudWatch)
> - `docs/HIPAA-COMPLIANCE-CHECKLIST.md` — Technical Safeguard evidence
> - `docs/RUNBOOK.md` — operational playbooks

---

## 1. Severity Scale

| Severity | Definition | Example |
|----------|------------|---------|
| **P0 / Critical** | Confirmed ePHI exposure, unauthorized account access, or ongoing exfiltration. | Public S3 bucket with document objects; GuardDuty `UnauthorizedAccess:IAMUser/ConsoleLoginSuccess.B` from a TOR exit. |
| **P1 / High** | Strong evidence of compromise risk; no confirmed exposure. | `audit_logs_no_update` trigger disabled; S3 bucket policy drift to public-read. |
| **P2 / Medium** | Control degradation without access exposure. | Config rule NON_COMPLIANT for > 24 h; MFA disabled on admin account. |
| **P3 / Low** | Policy violations or near-miss. | Failed login spike below alarm threshold. |

Declare upward — prefer P0 when ambiguous. De-escalation happens in §5 review.

---

## 2. Detection

Automated sources (wired per `docs/AWS-SECURITY-CONFIG.md`):

- **CloudWatch Alarms** — `unauthorized-api-calls`, `failed-console-logins`, `s3-policy-changes`, `iam-role-mutations`, `kms-disable-or-delete`
- **GuardDuty findings** — streamed to EventBridge → on-call SNS topic
- **AWS Config non-compliance** — S3 bucket drift rules
- **IAM Access Analyzer** — external-access findings
- **Amazon Macie** — PHI/PII canary (any finding = P0 until triaged)
- **Application audit log** — anomaly queries on `audit_logs` (failed action spikes, off-hours admin action)
- **Dependabot + `npm audit`** — supply-chain advisories (F11.7)

Manual sources:

- User report via `security@helpucompli.com`
- Operator discovery during routine review
- Vendor advisory / CVE notification

### 2.1 Triage on-call receives

1. Acknowledge page within **15 minutes** (P0/P1) or next business day (P2/P3).
2. Open incident channel `#inc-<short-id>` in Slack.
3. Assign **Incident Commander** (IC) — separate from the responder running commands.
4. IC opens an incident ticket with severity + scope so subsequent updates are one place.

---

## 3. Containment

Sequenced by incident class. Containment is **blast-radius reduction**, not root cause fix.

### 3.1 Compromised credential (IAM user, access key, long-lived token)

```bash
# Disable the access key
aws iam update-access-key --user-name <user> --access-key-id <id> --status Inactive

# Delete after forensic capture
aws iam delete-access-key --user-name <user> --access-key-id <id>

# Rotate any service-account secrets the user could have exfiltrated
```

### 3.2 Compromised Auth0 user / admin

1. **Block the user:** Auth0 Dashboard → User → Block, OR `PATCH /api/v2/users/{id}` `{blocked: true}` (F10.6 uses the same endpoint).
2. **Invalidate session cookies immediately** — blocking prevents new auth, but existing cookies (8 h absolute cap) still work; if confirmed compromise, rotate `AUTH0_SECRET` to invalidate all sessions.
3. Review `audit_logs` for the compromised `auth0Id` for the cookie TTL window.

### 3.3 Public bucket policy / object exposure

1. **Immediately restore Block Public Access:**
   ```bash
   aws s3api put-public-access-block \
     --bucket <bucket> \
     --public-access-block-configuration \
       BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
   ```
2. Snapshot bucket policy + ACL state for forensics.
3. Query CloudTrail data events for `GetObject` calls with anonymous principal during exposure window.
4. Enumerate affected objects via `s3api list-objects-v2` — each goes into the notification scope (§4).

### 3.4 ePHI exposure via application bug

1. Gate the vulnerable route with an allow-list / feature flag rollback.
2. Revoke any presigned URLs issued during the window — rotate the per-tenant KMS CMK if short-TTL rotation is not sufficient (per AWS docs a CMK rotation does not invalidate existing data keys, so URL revocation is what matters, not key rotation).
3. Capture the audit log rows for the window in a WORM location for the investigation file.

### 3.5 Denial of service / rate-limit bypass

1. Scale Upstash rate-limit tier if legitimate traffic spike.
2. Add IP allow-list / deny-list via edge WAF if attack pattern.
3. If saturation persists, gate the API behind Cloudflare / AWS WAF rate-based rule.

---

## 4. Notification (HIPAA §164.400-414 Breach Notification Rule)

> **60-day clock** begins the moment we discover (or reasonably should have discovered) a breach involving unsecured ePHI. The platform design stores no direct ePHI, but a successful compromise that could expose customer-uploaded documents still triggers the rule.

### 4.1 Internal escalation (same day as P0)

- Incident Commander
- Security Officer (HIPAA §164.308(a)(2))
- Engineering Manager
- Legal counsel
- Executive sponsor

### 4.2 External notification

| Audience | Timeline | Channel | Drafting owner |
|----------|----------|---------|----------------|
| **Affected individuals** | Within 60 days of discovery | First-class mail (default) or email if opt-in to electronic notice | Legal + Security Officer |
| **HHS** | Within 60 days (breaches ≥ 500 individuals); annually by Mar 1 (breaches < 500 the prior year) | HHS OCR Breach Portal | Security Officer |
| **Media** | Within 60 days (only for breaches ≥ 500 residents of a single state / jurisdiction) | Press release | Comms + Legal |
| **Business Associates** | Immediately upon discovery; contractual SLA governs | BAA-specified contact | Legal |
| **Customers / Covered Entities** | Per BAA — typically ≤ 10 business days | Direct outreach | Account + Security Officer |

### 4.3 Required notice content (§164.404(c))

1. Brief description of the breach.
2. Types of unsecured ePHI involved (if any — for this platform, customer-uploaded document categories).
3. Steps individuals should take to protect themselves.
4. What the covered entity is doing to investigate, mitigate, and prevent recurrence.
5. Contact procedures for questions (toll-free number, email, website, postal address).

---

## 5. Post-Incident Review

Within **14 days** of containment, the Incident Commander runs a blameless post-mortem.

### 5.1 Required deliverables

- **Timeline** — detection → ack → containment → notification → remediation. Timestamps to the minute.
- **Root cause** — contributing factors identified. No single "person fault" — always a system/process gap.
- **Impact** — users, records, external parties affected; regulatory reporting outcome.
- **Action items** — owner + ETA per item. Track in the standard work-tracker (Linear / Jira). Preventive and detective controls both required.
- **Documentation updates** — runbook, CSP, IAM, incident-plan itself if the response exposed a gap.

### 5.2 HIPAA documentation retention

Post-mortem + all artifacts (logs, screenshots, notifications) retain for **6 years** alongside the corresponding audit-log evidence (§164.530(j)(2)). Store in the same WORM archive as monthly `audit_logs` partitions.

---

## 6. Ownership + Drill Cadence

| Activity | Owner | Cadence |
|----------|-------|---------|
| Maintain on-call rotation | Engineering Manager | Quarterly review |
| Run tabletop exercise (pick a scenario from §3) | Security Officer | Semi-annually |
| Validate SNS / paging delivery end-to-end | Infra | Quarterly |
| Review this document for drift | Security Officer | Annually + after each P0/P1 |
| HHS annual filing (breaches < 500) | Security Officer | By March 1 |

### 6.1 Tabletop scenarios (rotate each drill)

1. Compromised superadmin Auth0 account — run §3.2.
2. S3 bucket set public via console — run §3.3.
3. `audit_logs_no_update` trigger disabled via DB console — detect + restore.
4. Dependabot surfaces CRITICAL advisory with 0-day exploit — emergency upgrade + rollback readiness.
5. Macie detects SSN-pattern content in a document bucket — confirm upstream classification regression + notify customer if real.

Drill artifacts (Slack transcript, command output, retrospective notes) attach to the quarterly compliance review.

---

*Owner of this document: Security Officer. Updated: 2026-04-20.*
