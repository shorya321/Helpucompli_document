# HelpUcompli Document Repository — Project Rules

## Module-by-Module Development Protocol

1. Read `feature_list.json` — pick the first feature with `passes: false` in the current module
2. Read the module doc at `docs/modules/XX-module.md`
3. Write test FIRST (RED) — file: `src/__tests__/<module>/<feature>.test.ts`
4. Implement minimal code to pass (GREEN)
5. Refactor if needed (IMPROVE)
6. Run tests: `npm run test`
7. If passing: update `feature_list.json` → set `passes: true`
8. Git commit: `feat(<module>): <description>`
9. Update `claude-progress.json` with session state
10. Move to next feature

## Auth0 Patterns (proxy.ts — SDK v4)

```typescript
// src/lib/auth0.ts — singleton
import { Auth0Client } from "@auth0/nextjs-auth0/server";
export const auth0 = new Auth0Client();

// src/app/proxy.ts — auto-mounts auth routes
import { auth0 } from "@/lib/auth0";
export const { middleware } = auth0;
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

// Server Component — get session
const session = await auth0.getSession();

// API Route — role guard
const session = await auth0.getSession();
const role = session?.user?.['https://docs.helpucompli.com/role'];
```

## Prisma Patterns

```typescript
// src/lib/prisma.ts — singleton (prevents connection exhaustion)
import { PrismaClient } from '@prisma/client';
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

## S3 Patterns

```typescript
// src/lib/s3.ts — singleton
import { S3Client } from '@aws-sdk/client-s3';
export const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
```

- ALL S3 operations are server-side only
- Presigned URLs are bearer tokens — short TTL (15 min default)
- Every bucket MUST have: SSE-KMS, versioning, Block Public Access, HTTPS-only policy

## Audit Logging

Every API route that mutates data MUST call `logAudit()`:
```typescript
await logAudit({
  userId: session.user.sub,
  action: 'DOCUMENT_UPLOAD',
  targetType: 'document',
  targetId: doc.id,
  metadata: { filename, bucket, key },
  ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
  userAgent: request.headers.get('user-agent') || 'unknown',
});
```

## API Route Template

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { z } from 'zod';

const schema = z.object({ /* ... */ });

export async function POST(request: NextRequest) {
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user['https://docs.helpucompli.com/role'];
  if (role !== 'superadmin' && role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  // ... business logic ...

  await logAudit({ /* ... */ });
  return NextResponse.json({ data: result });
}
```

## HIPAA Security Rules

- No PHI in any form, input, or metadata field
- File content is opaque — never parsed or indexed
- 6-year audit log retention minimum
- SSE-KMS encryption on all S3 buckets
- TLS 1.2+ enforced everywhere
- MFA for admin roles
- 30-min session timeout
- No public S3 access ever

## Component Patterns

- Use shadcn/ui components from `src/components/ui/`
- Create module-specific components in `src/components/<module>/`
- Use `"use client"` only when needed (forms, dropdowns, tables)
- Prefer Server Components for data fetching
