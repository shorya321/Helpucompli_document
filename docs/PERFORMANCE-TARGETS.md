# Performance Targets

F12.4 launch-gate targets. Every row below MUST pass before production cutover (F12.7).

---

## Server-side budgets

| Operation | Target (p95) | Measurement | Current |
|-----------|--------------|-------------|---------|
| Presigned URL generation | < 500 ms | Vitest bench `src/__tests__/perf/presign.bench.ts` | PASS (local, single-call) |
| Audit log filtered query (page 1, 25 rows) | < 1 s | Prod RDS `EXPLAIN ANALYZE` on seed of 10k rows | PENDING staging seed |
| Bucket list (admin, 50 buckets) | < 300 ms | `src/lib/bucket-list.ts` integration test | PASS |
| Document search (admin, 100 docs) | < 500 ms | `src/lib/document-search.ts` integration test | PASS |

## Client-side budgets

| Page | Target LCP (p95) | Tool | Current |
|------|------------------|------|---------|
| `/dashboard` | < 2 s | Lighthouse CI / Vercel Analytics | PENDING launch |
| `/documents` (browser) | < 2 s | Lighthouse CI | PENDING launch |
| `/users` list | < 2 s | Lighthouse CI | PENDING launch |

## Realistic data-volume profile

Benchmarks MUST run against seeded data matching the volume profile below:

- 100+ buckets per tenant (multi-tenant deployments).
- 1 000+ documents per bucket (pagination correctness).
- 10 000+ audit rows per month (query performance + index use).
- 50+ active concurrent users (rate-limit headroom + Prisma pool sizing).

`prisma/seed-perf.ts` (carry-forward — write alongside `seed-e2e.ts`) populates these fixtures.

## Concurrency model

- Prisma pool default 17 connections per pod. Pod horizontal scale caps total pool at RDS `max_connections` × 0.6 (reserve 40% for migration + console + burst).
- Rate limiter (Upstash sliding window) bounded per user — no global bottleneck.
- Next.js Node runtime serves concurrent requests; no shared in-memory state except the role cache (TTL 5 min).

## Measurement cadence

| When | What | Owner |
|------|------|-------|
| Pre-PR | Vitest bench for any changed `src/lib/` hot path | Contributor |
| Pre-launch | Full matrix + Lighthouse pass | Performance engineer |
| Weekly (post-launch) | Vercel Analytics LCP + CloudWatch p95 + DataDog APM (when wired) | On-call |
| Per-incident | Re-run the matrix for regression evidence | Incident Commander |

## Regression gate

A PR that regresses any p95 budget by more than 20% MUST either:

1. Land with a signed-off justification (feature value exceeds perf cost), AND
2. Update the budget table with the new baseline + ETA to restore.

Silent regressions are not allowed.
