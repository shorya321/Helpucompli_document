# E2E Test Matrix

Critical-flow coverage for the HelpUcompli Document Repository. Each row identifies a journey, its fixture requirement, and current Playwright status. Rows tagged `launch` MUST have a green run before production cutover (F12.7 gate).

---

## Current Playwright specs

| File | Flow | Auth | Status |
|------|------|------|--------|
| `e2e/smoke.spec.ts` | public-edge smoke (health, redirects, security headers, CSP, 401) | none | ✓ |
| `e2e/link-access.spec.ts` | generated-link access + referer check | presigned token | ✓ |
| `e2e/policy-edit-form.spec.ts` | policy edit form client behavior | stubbed | ✓ |
| `e2e/policy-enforcement.spec.ts` | policy-enforcement request flow | stubbed | ✓ |

## Critical-flow matrix (F12.3 — full coverage for launch)

| # | Journey | Role | Fixture needed | Spec to add |
|---|---------|------|----------------|-------------|
| 1 | Login via Auth0 → dashboard renders | superadmin | Auth0 test tenant + seeded user + storageState | `login-dashboard.spec.ts` |
| 2 | Create bucket → appears in bucket list | superadmin | AWS sandbox credentials | `bucket-create.spec.ts` |
| 3 | Upload document → appears in browser | admin | bucket fixture + test file | `document-upload.spec.ts` |
| 4 | Download document → presigned URL redirect | admin | uploaded doc fixture | `document-download.spec.ts` |
| 5 | Create policy → apply to document | admin | policy schema + target doc | `policy-apply.spec.ts` |
| 6 | Generate link → copy → access → download | admin | `e2e/link-access.spec.ts` (partial) | extend existing spec |
| 7 | Invite user → assign role → verify access | superadmin | Auth0 Management API + Resend fixture | `user-invite.spec.ts` |
| 8 | Audit log → filter → export CSV | admin | seeded audit rows | `audit-export.spec.ts` |
| 9 | Hard delete document → superadmin required | admin + superadmin | upload fixture | `document-delete.spec.ts` |
| 10 | Disable user → cannot log in | superadmin | target-user fixture | `user-disable.spec.ts` |

## Fixture strategy

### Auth0 storageState

1. Provision a dedicated test tenant (`dev-helpucompli-test.us.auth0.com`).
2. Seed one user per role (`e2e-superadmin@example.com`, `e2e-admin@example.com`, `e2e-viewer@example.com`) with known passwords stored in a GitHub Actions secret or local `.env.test`.
3. One-time Playwright setup runs login once per role and dumps `storageState` JSON to `e2e/.auth/<role>.json`. Subsequent tests reuse via `test.use({ storageState })`.

### AWS sandbox

- Separate AWS account tagged `env=e2e` — different from staging + prod.
- Separate KMS CMK for SSE-KMS.
- CloudTrail writes to a sandbox log bucket — quarterly lifecycle purge.
- Test buckets prefixed `helpucompli-docs-e2e-` — filterable in `createHipaaBucket` allow-list.

### DB seeding

- `prisma/seed-e2e.ts` resets the test DB before each run — idempotent inserts for users, buckets, policies, audit rows.
- Test DB separate connection string, never shares credentials with staging/prod.

## CI integration

- Playwright runs on PR via a dedicated workflow job (not in `security-scan.yml` — Playwright container requires browser binaries).
- Artifact upload on failure: video, trace, screenshots.
- Slack notification on red run — must be green before merge to `main`.

## Launch readiness criteria (F12.7)

- [ ] Specs 1–10 in the critical-flow matrix authored + passing locally.
- [ ] Auth0 storageState fixtures provisioned.
- [ ] AWS sandbox account verified + CloudTrail seeded.
- [ ] CI runs green for 3 consecutive builds.
- [ ] Artifact archive retained for 30 days.

## Carry-forwards

- Visual regression via Playwright `expect(page).toHaveScreenshot()` — needs baseline capture once final UI stabilized.
- Mobile viewport coverage once design confirms mobile scope.
- Accessibility axe-core scan in E2E flow.
