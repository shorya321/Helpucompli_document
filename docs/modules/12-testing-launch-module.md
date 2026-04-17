# Module 12: Testing & Launch

**Phase:** 4 (Hardening + Launch)
**Priority:** Critical — final quality gate

---

## Overview

Comprehensive testing (unit, integration, E2E), performance validation, documentation, and production launch procedures.

## Features

### F12.1 — Unit Tests
- Test all utility functions (`src/lib/*`)
- Test policy enforcement logic
- Test audit logging helper
- Test Zod validation schemas
- Framework: Jest or Vitest
- Target: 80%+ code coverage on `lib/` directory

### F12.2 — Integration Tests
- Test API routes with mocked Auth0 session and real database
- Test S3 operations with LocalStack or mocked S3
- Test policy enforcement end-to-end (create policy → generate link → access link)
- Test user role enforcement (admin actions rejected for viewer)

### F12.3 — E2E Tests (Playwright)
- **Critical flows:**
  - [ ] Login via Auth0 → dashboard loads
  - [ ] Navigate to buckets → create bucket → verify in list
  - [ ] Navigate to documents → upload file → verify appears
  - [ ] Download document → verify presigned URL works
  - [ ] Create policy → apply to document
  - [ ] Generate link → copy → access → verify download
  - [ ] Invite user → assign role → verify access level
  - [ ] View audit log → filter → export CSV
  - [ ] Hard delete document → verify superadmin required
  - [ ] Disable user → verify cannot log in

### F12.4 — Performance Testing
| Metric | Target |
|--------|--------|
| Dashboard page load | < 2 seconds |
| Document browser load | < 2 seconds |
| Presigned URL generation | < 500ms |
| File upload (browser to S3) | Limited by network, not server |
| Audit log query (filtered) | < 1 second |

### F12.5 — Error Handling
- React Error Boundaries on all route groups
- Friendly error pages: 403 (Forbidden), 404 (Not Found), 500 (Server Error)
- No sensitive information in error responses (no stack traces, no file paths)
- Toast notifications for client-side errors

### F12.6 — Monitoring Setup
- **Sentry:** Error tracking and performance monitoring
- **Vercel Analytics** or **CloudWatch:** Request metrics
- **Uptime monitoring:** External ping to `/api/health` endpoint

### F12.7 — Documentation
| Document | Purpose |
|----------|---------|
| Admin User Guide | How to use the dashboard (for HelpUcompli admins) |
| API Documentation | Endpoint reference for developers |
| Runbook | Common operations and troubleshooting |
| Incident Response Playbook | Security incident procedures |
| HIPAA Compliance Evidence | Completed checklist with evidence |

### F12.8 — Launch Checklist
- [ ] All E2E tests passing
- [ ] Performance targets met
- [ ] Security headers verified
- [ ] HIPAA checklist complete
- [ ] AWS BAA signed
- [ ] DNS configured (`docs.helpucompli.com`)
- [ ] SSL certificate valid
- [ ] Environment variables set in production
- [ ] Database migrations applied
- [ ] CloudTrail active
- [ ] Sentry configured
- [ ] Backup strategy documented
- [ ] Rollback procedure documented

### F12.9 — Post-Launch Monitoring
- 48-hour monitoring period after launch
- Watch for: error spikes, performance degradation, auth failures
- On-call contact identified
- Rollback procedure ready

## Files to Create

| File | Purpose |
|------|---------|
| `jest.config.ts` or `vitest.config.ts` | Test framework configuration |
| `src/__tests__/lib/*.test.ts` | Unit tests for lib functions |
| `src/__tests__/api/*.test.ts` | Integration tests for API routes |
| `e2e/*.spec.ts` | Playwright E2E tests |
| `playwright.config.ts` | Playwright configuration |
| `src/app/api/health/route.ts` | Health check endpoint |
| `src/app/error.tsx` | Global error boundary |
| `src/app/not-found.tsx` | 404 page |

## Dependencies

- `vitest` or `jest` + `ts-jest` — unit/integration testing
- `@playwright/test` — E2E testing
- `@sentry/nextjs` — error tracking

## Acceptance Criteria

- [ ] 80%+ unit test coverage on `lib/` directory
- [ ] All integration tests passing
- [ ] All E2E critical flows passing
- [ ] Performance targets met
- [ ] Error pages render correctly
- [ ] Health check endpoint responds
- [ ] Monitoring alerts configured
- [ ] All documentation written
- [ ] Launch checklist complete
- [ ] 48-hour post-launch monitoring completed
