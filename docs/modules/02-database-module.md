# Module 2: Database Schema

**Phase:** 1 (Foundation)
**Priority:** Critical — stores metadata, policies, and audit trail

---

## Overview

PostgreSQL database on AWS RDS managed via Prisma ORM. Stores document metadata, access policies, user records, generated links, and immutable audit logs. Does NOT store actual documents (those live in S3).

## Features

### F2.1 — Prisma Schema with 7 Core Tables

#### `users`
- Synced from Auth0
- Fields: `id` (UUID), `auth0_id` (unique), `email`, `name`, `role` (enum: superadmin/admin/viewer), `status` (**UserStatus enum**: active/disabled — typed, not free-text), `created_at`, `last_login_at`

#### `buckets`
- Registered S3 buckets
- Fields: `id` (UUID), `name` (unique), `aws_region`, `description`, `created_by` (FK users), `created_at`, `is_active`

#### `documents`
- Document metadata (not content)
- Fields: `id` (UUID), `bucket_id` (FK), `s3_key`, `filename`, `content_type`, `size_bytes` (BigInt), `uploaded_by` (FK users), `uploaded_at`, `is_deleted`, `deleted_at`, `deleted_by` (FK users nullable)

#### `access_policies`
- Policy definitions
- Fields: `id` (UUID), `name`, `target_type` (enum: bucket/prefix/object), `target_value`, `allowed_domains` (JSON string array), `allowed_ip_ranges` (JSON string array), `link_ttl_seconds` (Int), `max_downloads` (Int nullable), `require_auth` (Boolean), `created_by` (FK users), `created_at`, `updated_at`

#### `generated_links`
- Presigned URL tracking
- Fields: `id` (UUID), `document_id` (FK), `policy_id` (FK nullable), `generated_by` (FK users), `presigned_url_hash` (String, **UNIQUE** — prevents hash-collision serving wrong file), `expires_at`, `download_count` (Int default 0), `max_downloads` (Int nullable), `is_revoked` (Boolean default false), `created_at`

#### `audit_logs`
- Immutable audit trail
- Fields: `id` (UUID), `user_id` (FK nullable, **ON DELETE SET NULL** — preserve audit trail when user deleted), `action` (enum), `target_type` (String), `target_id` (String), `metadata` (JSONB), `ip_address` (String), `user_agent` (String), `created_at`
- **No UPDATE or DELETE operations** — enforced at **DB layer** via PL/pgSQL `BEFORE UPDATE/DELETE/TRUNCATE` triggers (`audit_logs_reject_mutation()` raises `ERRCODE insufficient_privilege`). Application-layer sentinel alone is bypassable via `$executeRaw`, aliased clients, or bracket-dispatch.

#### HIPAA-safe FK semantics
- `audit_logs.user_id` → SET NULL (preserve trail)
- `generated_links.document_id` → RESTRICT (no orphaned links)
- `documents.uploaded_by` / `buckets.created_by` → RESTRICT (HIPAA model: disable, not delete)
- `documents.deleted_by` → SET NULL
- **No `ON DELETE CASCADE` anywhere** — would silently destroy audit trail.

#### Enums
- `Role` — superadmin/admin/viewer
- `AuditAction` — 21 actions (see module 07)
- `PolicyTargetType` — bucket/prefix/object
- `UserStatus` — active/disabled (typed; no free-text `status` column)

#### `user_bucket_access`
- Junction table for viewer role bucket assignments
- Fields: `user_id` (FK), `bucket_id` (FK), `granted_by` (FK users), `granted_at`
- Composite primary key: (user_id, bucket_id)

### F2.2 — Prisma Client Singleton
- Prevent connection pool exhaustion in Next.js dev mode
- Pattern: global singleton with `globalThis` cache (HMR-safe: reuses client across hot-reload module re-evaluations)
- **Security hardening** (sec-review):
  - Route Prisma error events to `event` emit (not `stdout`) — prevents DATABASE_URL connection-string leakage in CloudWatch/Datadog log scraping.
  - Deployment comment: singleton assumes long-lived Node runtime. Lambda/serverless needs per-invocation lifecycle; revisit if deploy target changes.
- **Test pattern**: `afterEach` calls `prisma.$disconnect()` **before** dropping `globalThis` ref (prevents orphan pool). Use duck-typing (`$connect`/`$disconnect`/`$transaction` functions) not `instanceof` — Prisma v6 proxy triggers vitest serializer stack-overflow on `toBeInstanceOf`; class name minified to `'r'`.
- **Follow-up (Module 11, F11.4)**: wire `src/lib/prisma.ts` through validated `getConfig().DATABASE_URL` for fail-fast boot. Requires `vitest.setup.ts` env stubs for all validated keys (AUTH0_*, AWS_*, DATABASE_URL).
- **Follow-up (Module 12, F12.5)**: register `SIGTERM` → `prisma.$disconnect()` handler in server bootstrap to flush pool on graceful shutdown.

### F2.3 — Database Indexes
- `users.auth0_id` — unique index for Auth0 sync
- `users.email` — unique index
- `documents.bucket_id` — for bucket document listing
- `documents.s3_key` — for S3 key lookups
- `audit_logs.created_at` — for time-range queries
- `audit_logs.user_id` — for user activity queries
- `audit_logs.action` — for action-type filtering
- `generated_links.document_id` — for link lookups
- `generated_links.presigned_url_hash` — for URL validation

### F2.4 — Audit Log Retention
- 6-year minimum retention (HIPAA requirement)
- Table partitioning by month recommended for large-scale
- Archive older partitions to S3 Glacier (future phase)

## Files to Create

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Full Prisma schema with all 7 tables |
| `prisma/migrations/<ts>_init/migration.sql` | Init migration; append-only triggers appended manually (see below) |
| `src/lib/prisma.ts` | Prisma client singleton with event-emit error routing |
| `prisma.config.ts` | **Prisma 6.4+ native config** — loads `.env.local` via `dotenv` at CLI init so `prisma migrate/studio/generate/seed` all resolve `DATABASE_URL` without shell sourcing. Chosen over `dotenv-cli` (12 MB tree) — `prisma.config.ts` covers every CLI invocation and is the v7 default. |

## Environment Variables

```env
# .env.local (preferred — Next.js convention; loaded by Prisma via prisma.config.ts)
DATABASE_URL=postgresql://user:password@host:5432/helpucompli_docs
```

**Convention note**: this repo uses `.env.local` (Next.js standard). Prisma CLI reads `.env` by default — do NOT rename. Instead, `prisma.config.ts` uses `dotenv` to load `.env.local` explicitly from `__dirname` so every Prisma CLI command resolves envs correctly.

## Prisma Client Singleton Pattern

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

## Migration Commands

```bash
npx prisma migrate dev --name init      # Development
npx prisma migrate deploy               # Production
npx prisma generate                     # Generate client
```

## Dependencies

- `prisma` (devDependency) — CLI + config
- `@prisma/client` — runtime
- `dotenv` — loads `.env.local` from `prisma.config.ts`
- `tsx` (devDependency) — executes `prisma/seed.ts` via `prisma.config.ts → migrations.seed`

## Acceptance Criteria

- [ ] All 7 tables created with correct types and constraints
- [ ] Foreign key relationships properly defined (SET NULL on `audit_logs.user_id`, RESTRICT elsewhere, NO CASCADE)
- [ ] Indexes created on frequently queried columns
- [ ] Prisma client works as singleton (no connection leaks in dev HMR)
- [ ] `prisma.config.ts` auto-loads `.env.local` — `unset DATABASE_URL; npm run db:generate` succeeds
- [ ] Migrations run cleanly on AWS RDS PostgreSQL
- [ ] Audit logs table is append-only **at DB layer** — direct UPDATE/DELETE/TRUNCATE via `psql` raises `insufficient_privilege` (not just app-layer protection)
- [ ] `generated_links.presigned_url_hash` UNIQUE constraint enforced
- [ ] No live-DB required for schema tests (hermetic regex/DMMF scans over `schema.prisma` + `migration.sql`)
