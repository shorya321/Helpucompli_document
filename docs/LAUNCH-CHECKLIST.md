# Launch Checklist

Gate for production cutover (`docs.helpucompli.com`). Every row MUST be checked before the DNS switch. Owner per row. Date of completion recorded on merge of the launch PR.

Derived from F12.7 step list + cross-module carry-forwards.

---

## Code quality gates

- [ ] All unit + integration tests green on `main` (current: 1399/1399 + 1 skipped as of F12.6).
- [ ] Coverage threshold met: ≥ 80% lines / functions / branches / statements on `src/lib/**` (vitest enforces).
- [ ] Typecheck clean (`npm run build` or `tsc --noEmit`).
- [ ] Lint clean (`npm run lint`).
- [ ] Dependabot baseline: 0 HIGH + 0 CRITICAL per `npm audit --audit-level=high` (F11.7 CI enforces).

## E2E gates (F12.3)

- [ ] All 10 critical-flow specs authored + passing against the staging deployment (see `docs/E2E-TEST-MATRIX.md`).
- [ ] Auth0 test tenant provisioned with superadmin / admin / viewer seed users.
- [ ] AWS e2e sandbox account isolated from prod (`env=e2e` tag).
- [ ] CI run green for 3 consecutive commits.

## Performance gates (F12.4)

- [ ] Presigned URL generation p95 < 500 ms against staging Postgres + S3.
- [ ] Audit query p95 < 1 s at 10 000+ row seed.
- [ ] Dashboard LCP p95 < 2 s via Lighthouse.
- [ ] Documents browser LCP p95 < 2 s.
- [ ] Concurrency drill: 50+ concurrent users without rate-limit saturation.

## Security gates (F11)

- [ ] F11.1 — CSP + HSTS + XFO + XCTO + XXSS + Referrer-Policy visible on every response (curl `docs.helpucompli.com` + `staging.helpucompli.com`).
- [ ] F11.2 — rate limiting active on 23/24 API routes; `POST /api/links` at 10/min.
- [ ] F11.3 — prisma wired through `getConfig().DATABASE_URL`; boot fails cleanly without env (verify in staging restart).
- [ ] F11.4 — HIPAA Technical Safeguard Mapping reviewed by Security Officer + dated.
- [ ] F11.5 — SameSite=Lax + Secure session cookies in prod (inspect via `docs.helpucompli.com` cookie jar).
- [ ] F11.6 — CloudTrail data events, GuardDuty, Config rules, Access Analyzer, Macie, CloudWatch alarms provisioned in the prod AWS account. Each carry-forward in `docs/AWS-SECURITY-CONFIG.md` §Ownership table has an owner + date.
- [ ] F11.7 — Dependabot active; CI security-scan workflow enabled.
- [ ] F11.9 — Incident response plan reviewed; on-call rotation published; Slack `#inc-` channel template ready.
- [ ] F11.10 — AWS BAA signed via Artifact; date recorded in `docs/HIPAA-COMPLIANCE-CHECKLIST.md` §BAA Status. Auth0 BAA decision recorded. Resend DPA obtained OR migration to SES completed.

## Infrastructure

- [ ] **DNS** — `docs.helpucompli.com` CNAME to the production host (Vercel / ALB). Propagation verified with `dig`.
- [ ] **SSL** — certificate valid, auto-renewal enabled (ACM / Let's Encrypt). Chain checked via `openssl s_client`.
- [ ] **Environment variables** — every key in `.env.example` set in production via the chosen secrets manager. `getConfig()` passes at boot.
- [ ] **Database migrations** — `npx prisma migrate deploy` on prod RDS. Migration history matches `prisma/migrations/`. No pending.
- [ ] **CloudTrail** — active on all `helpucompli-docs-*` buckets (data events selector, per F11.6 §1).
- [ ] **KMS key rotation** — automatic rotation enabled on the tenant CMK.
- [ ] **S3 Access Analyzer** — 0 active external-access findings.
- [ ] **Backups** — RDS automated backups ≥ 35 day retention; daily snapshot lifecycle verified.

## Observability

- [ ] **Sentry** — DSN configured, staging test event received end-to-end (per F12.5 runbook).
- [ ] **Request metrics** — Vercel Analytics or CloudWatch dashboards provisioned; p95 / error rate panels visible.
- [ ] **Uptime monitor** — external ping on `/api/health` every 60 s; alert on 3 consecutive failures.
- [ ] **Graceful shutdown** — `kill -TERM <pid>` in staging shows RDS connection count returning to baseline within 30 s (F12.5 instrumentation.ts).

## Operations

- [ ] **Backup strategy documented** — RDS snapshot schedule, S3 versioning, audit-log archive plan in `docs/HIPAA-COMPLIANCE-CHECKLIST.md` §4.
- [ ] **Rollback procedure documented** — rollback PR template, DB migration reversal plan, CDN flush. Owner: Engineering Manager.
- [ ] **On-call rotation** — PagerDuty (or equivalent) schedule for next 30 days published.
- [ ] **Tabletop drill** — at least 1 scenario from `docs/INCIDENT-RESPONSE-PLAN.md` §6.1 executed in the last 90 days.

## Product readiness

- [ ] Admin guide walkthrough completed with product owner (F12.6).
- [ ] API reference reviewed by consumer team (if API is external).
- [ ] Smoke test in prod post-deploy: login + bucket create + document upload + link generate + audit query.
- [ ] Customer support channels ready (`security@helpucompli.com` routing + `support@` inbox).

## Sign-off

| Role | Name | Signed | Date |
|------|------|--------|------|
| Engineering Manager | | | |
| Security Officer | | | |
| Product Owner | | | |
| Legal | | | |

Cutover only proceeds when all boxes above are checked AND the four sign-off rows are filled.

---

### Post-launch window (F12.8)

Move to `docs/POST-LAUNCH-OBSERVATIONS.md` (created at launch) for the 48-hour monitoring period.
