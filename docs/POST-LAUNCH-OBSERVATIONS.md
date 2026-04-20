# Post-Launch Observations (F12.8)

Template for the first 48 hours after cutover of `docs.helpucompli.com`. Complete every row — empty cells are not "no issue," they are "no observation recorded." Attach SNS / CloudWatch / Sentry links in each row.

Copy this file on launch day, rename to `POST-LAUNCH-<YYYY-MM-DD>.md`, fill in per hour.

---

## Pre-cutover dry run

- [ ] Staging smoke pass replicated on prod subdomain with DNS TTL lowered to 60 s.
- [ ] Rollback plan reviewed by on-call.
- [ ] On-call handoff logged in incident Slack channel.
- [ ] Monitoring dashboards pre-opened (Sentry / CloudWatch / Vercel Analytics / RDS Performance Insights).

## Smoke run on prod (T+0)

| Flow | Owner | Result | Notes |
|------|-------|--------|-------|
| Login via Auth0 | | | |
| Dashboard loads + renders stats | | | |
| Create bucket | | | |
| Upload document | | | |
| Download document via presigned URL | | | |
| Create policy + apply | | | |
| Generate share link + access | | | |
| Invite user + assign role | | | |
| Audit log filter + CSV export | | | |
| Superadmin hard-delete document | | | |
| Disable user + verify denied login | | | |

## 48-hour monitoring window

Record each observation with timestamp + screenshot reference + action taken.

### Error spikes

| T+ (h) | Source | Rate | Action |
|--------|--------|------|--------|
| | Sentry | | |
| | CloudWatch error metric | | |
| | Application audit log anomaly | | |

### Performance

| T+ (h) | Metric | p95 | Target | Pass? |
|--------|--------|-----|--------|-------|
| | Presigned URL gen | | < 500 ms | |
| | Audit query | | < 1 s | |
| | Dashboard LCP | | < 2 s | |
| | Documents browser LCP | | < 2 s | |

### Auth failures

| T+ (h) | Metric | Count | Anomaly? |
|--------|--------|-------|----------|
| | Auth0 failed logins | | |
| | 401 rate on /api/* | | |
| | 403 rate on /api/* | | |

### Infra health

| T+ (h) | Metric | Value | Threshold | Status |
|--------|--------|-------|-----------|--------|
| | RDS connections | | < 60% of max | |
| | RDS CPU | | < 70% | |
| | S3 5xx rate | | < 0.1% | |
| | CloudTrail data-event delivery | | ≤ 15 min lag | |

## On-call roster

| Shift | Primary | Secondary | Pager |
|-------|---------|-----------|-------|
| T+00 to T+08 | | | |
| T+08 to T+16 | | | |
| T+16 to T+24 | | | |
| T+24 to T+32 | | | |
| T+32 to T+40 | | | |
| T+40 to T+48 | | | |

## Incidents opened

| Time | Severity | Description | Resolution | Follow-up |
|------|----------|-------------|------------|-----------|
| | | | | |

## Rollback readiness check

- [ ] Previous release tag identified + artifact available.
- [ ] Database rollback plan confirmed — migrations reversible OR forward-only with data recovery path.
- [ ] CDN cache flush command tested.
- [ ] DNS revert TTL still at 60 s.
- [ ] Dry-run rollback walkthrough recorded in incident channel.

## T+48 review

| Item | Finding | Action-item owner |
|------|---------|-------------------|
| Error budget consumed | | |
| Performance budget consumed | | |
| New carry-forwards | | |
| Auto-remediation candidates | | |
| Launch retrospective scheduled | | |

## Sign-off

| Role | Name | Signed | Date |
|------|------|--------|------|
| Incident Commander | | | |
| Security Officer | | | |
| Engineering Manager | | | |

Launch is considered complete when all 48-hour rows are filled + all three sign-offs recorded. Any unresolved P0/P1 incidents block sign-off.
