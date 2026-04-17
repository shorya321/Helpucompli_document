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
- Fields: `id` (UUID), `auth0_id` (unique), `email`, `name`, `role` (enum: superadmin/admin/viewer), `status` (active/disabled), `created_at`, `last_login_at`

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
- Fields: `id` (UUID), `document_id` (FK), `policy_id` (FK nullable), `generated_by` (FK users), `presigned_url_hash` (String), `expires_at`, `download_count` (Int default 0), `max_downloads` (Int nullable), `is_revoked` (Boolean default false), `created_at`

#### `audit_logs`
- Immutable audit trail
- Fields: `id` (UUID), `user_id` (FK nullable), `action` (enum), `target_type` (String), `target_id` (String), `metadata` (JSONB), `ip_address` (String), `user_agent` (String), `created_at`
- **No UPDATE or DELETE operations** — append-only

#### `user_bucket_access`
- Junction table for viewer role bucket assignments
- Fields: `user_id` (FK), `bucket_id` (FK), `granted_by` (FK users), `granted_at`
- Composite primary key: (user_id, bucket_id)

### F2.2 — Prisma Client Singleton
- Prevent connection pool exhaustion in Next.js dev mode
- Pattern: global singleton with `globalThis` cache

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
| `src/lib/prisma.ts` | Prisma client singleton |

## Environment Variables

```env
DATABASE_URL=postgresql://user:password@host:5432/helpucompli_docs
```

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

- `prisma` (devDependency)
- `@prisma/client`

## Acceptance Criteria

- [ ] All 7 tables created with correct types and constraints
- [ ] Foreign key relationships properly defined
- [ ] Indexes created on frequently queried columns
- [ ] Prisma client works as singleton (no connection leaks)
- [ ] Migrations run cleanly on AWS RDS PostgreSQL
- [ ] Audit logs table is append-only (no update/delete in application code)
