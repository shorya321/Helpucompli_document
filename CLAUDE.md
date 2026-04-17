# HelpUcompli Document Repository

HIPAA-compliant document repository at `docs.helpucompli.com`. AWS S3 + Auth0 + Next.js 16.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 (App Router) + shadcn/ui + Tailwind CSS |
| Auth | Auth0 SDK v4 (`@auth0/nextjs-auth0`) with `proxy.ts` |
| API | Next.js API Routes |
| Storage | AWS S3 (SSE-KMS) via `@aws-sdk/client-s3` v3 |
| Database | AWS RDS PostgreSQL + Prisma ORM |
| Rate Limit | `@upstash/ratelimit` + Redis |
| Validation | Zod |
| Testing | Vitest + Playwright |
| Logging | Pino |

## Brand: Pink `#E91E8C` | Blue `#2563EB` | Dark `#1E293B` | Font: Inter

---

## Session Startup Protocol

**Every agent session MUST follow this sequence** (from Anthropic's agent harness research):

1. `pwd` — verify working directory is `/Volumes/shorya/apps/helpucompli_document`
2. Read `claude-progress.json` — what was done in previous sessions
3. Read `feature_list.json` — find next incomplete feature (`passes: false`)
4. Read `docs/modules/XX-module.md` — understand the module spec
5. Run `./init.sh` — ensure dev server is running (if not already)
6. Run baseline tests — verify nothing is broken
7. **Work on ONE feature at a time**
8. After each feature: test → commit → update `feature_list.json` → update `claude-progress.json`

**CRITICAL: Do NOT try to implement an entire module at once. One feature, verified, committed, then next.**

---

## Research Stack (MANDATORY before writing code for any external API)

Every feature that touches an external library, SDK, framework API, or security pattern MUST open with a documentation lookup. Query in this order — stop at the first step that answers the question:

1. **Ref MCP** — `mcp__claude_ai_ref__ref_search_documentation` then `mcp__claude_ai_ref__ref_read_url` on the top hit (fastest, token-efficient)
2. **Context7** — via `/docs <library>` skill or `docs-lookup` agent
3. **Exa** — via `exa-search` / `deep-research` skill for changelog + release notes
4. **Firecrawl** — `firecrawl_scrape` on a known URL
5. **SERP API** — last resort

**Skip ONLY** for doc-only edits or internal refactors with no new dependencies / no new API surface.

**Cite the source** (URL or `package@version`) in the commit body AND in `claude-progress.json` session notes so future sessions can trace which API snapshot the code was written against.

---

## Agent Routing

| Task | Agent | When |
|------|-------|------|
| Module planning | `planner` | Before starting a module |
| Architecture | `architect` | Design decisions |
| Feature implementation | `tdd-guide` | Every feature (RED→GREEN→REFACTOR) |
| After writing code | `code-reviewer` | Every feature |
| Auth/S3/policy code | `security-reviewer` | Modules 01, 03, 08, 09, 11 |
| Database changes | `database-reviewer` | Module 02, schema changes |
| Build failures | `build-error-resolver` | When build breaks |
| E2E tests | `e2e-runner` | Module 12 |
| Docs lookup | `docs-lookup` | When unsure about Auth0/Prisma/AWS API |

---

## Key Code Patterns

```typescript
// Auth0 session (Server Component)
import { auth0 } from '@/lib/auth0';
const session = await auth0.getSession();
if (!session) redirect('/auth/login');

// Role guard (API Route)
const role = session?.user?.['https://docs.helpucompli.com/role'];
if (role !== 'superadmin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

// Audit log (every mutation)
await logAudit({ userId, action: 'DOCUMENT_UPLOAD', targetType: 'document', targetId, metadata: { filename }, ipAddress, userAgent });

// Presigned URL
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: ttl });

// Prisma singleton
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

---

## Module Order

`01-auth` → `02-database` → `03-s3` → `04-dashboard` → `05-buckets` → `06-documents` → `07-audit` → `08-policies` → `09-links` → `10-users` → `11-security` → `12-testing`

## File Conventions

- API: `src/app/api/<resource>/route.ts`
- Pages: `src/app/(dashboard)/<page>/page.tsx`
- Components: `src/components/<module>/<component>.tsx`
- Lib: `src/lib/<name>.ts`
- Types: `src/types/index.ts`
- Tests: `src/__tests__/<module>/<file>.test.ts`
- E2E: `e2e/<flow>.spec.ts`

## Hard Rules

- NEVER store secrets in code — `.env` only
- NEVER expose AWS creds client-side — all S3 ops server-side
- ALWAYS validate with Zod on API routes
- ALWAYS log in audit trail
- ALWAYS check role before operations
- NEVER allow public S3 access
- Audit logs are append-only — NO update/delete
- Presigned URLs are bearer tokens — short TTL
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- ALWAYS research latest API via Ref / Context7 / Exa / Firecrawl / SERP before writing code that touches any external library, SDK, framework API, or security pattern
- Deprecated-API code is a BLOCKING review issue — treat like a security finding
- Cite the source (URL or `package@version`) in the commit body and `claude-progress.json` session notes

## Progress Tracking

- Features: `feature_list.json` (JSON — do NOT convert to markdown)
- Progress: `claude-progress.json` (session state)
- Module specs: `docs/modules/01-auth-module.md` through `12-testing-launch-module.md`
- Master plan: `docs/PRD-IMPLEMENTATION-PLAN.md`
