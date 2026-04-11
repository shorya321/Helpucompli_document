# HelpUcompli Document Repository — Master Implementation Plan

**Domain:** docs.helpucompli.com
**Client:** HelpUcompli (Laura / Miranda Spinelli)
**Prepared by:** Fanatic Coders Pvt. Ltd.
**Date:** April 2026 | Version 1.0

---

## Overview

A HIPAA-compliant document repository connecting AWS S3 storage to a branded admin interface. Manages compliance toolkits, policies, templates, and regulatory content for healthcare practice clients.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Next.js (App Router) + shadcn/ui + Tailwind CSS | 16.x |
| Auth | Auth0 Next.js SDK (`@auth0/nextjs-auth0`) | v4.16+ |
| API | Next.js API Routes (App Router) | — |
| Storage | AWS S3 (SSE-KMS encryption) | SDK v3 |
| Database | AWS RDS PostgreSQL + Prisma ORM | Prisma v6+ |
| Rate Limiting | `@upstash/ratelimit` (Redis) | — |
| Validation | Zod | — |
| Logging | Pino (structured JSON) | — |
| Icons | Lucide React | — |

## Brand Identity

| Element | Value |
|---------|-------|
| Primary Color | `#E91E8C` (HelpUcompli Pink) |
| Secondary Color | `#2563EB` (HelpUcompli Blue) |
| Dark Background | `#1E293B` (Slate 800) |
| Typography | Inter (via next/font/google) |
| Radius | 0.5rem (shadcn default) |

## Module Index

| # | Module | Doc | Phase |
|---|--------|-----|-------|
| 1 | Authentication & Authorization | [01-auth-module.md](modules/01-auth-module.md) | Phase 1 |
| 2 | Database Schema | [02-database-module.md](modules/02-database-module.md) | Phase 1 |
| 3 | AWS S3 Integration | [03-s3-module.md](modules/03-s3-module.md) | Phase 1 |
| 4 | Dashboard Home | [04-dashboard-module.md](modules/04-dashboard-module.md) | Phase 2 |
| 5 | Bucket Manager | [05-bucket-manager-module.md](modules/05-bucket-manager-module.md) | Phase 2 |
| 6 | Document Browser | [06-document-browser-module.md](modules/06-document-browser-module.md) | Phase 2 |
| 7 | Audit Logging | [07-audit-module.md](modules/07-audit-module.md) | Phase 2 |
| 8 | Policy Engine | [08-policy-engine-module.md](modules/08-policy-engine-module.md) | Phase 3 |
| 9 | Link Generator | [09-link-generator-module.md](modules/09-link-generator-module.md) | Phase 3 |
| 10 | User Management | [10-user-management-module.md](modules/10-user-management-module.md) | Phase 3 |
| 11 | Security & HIPAA | [11-security-hipaa-module.md](modules/11-security-hipaa-module.md) | Phase 4 |
| 12 | Testing & Launch | [12-testing-launch-module.md](modules/12-testing-launch-module.md) | Phase 4 |

## Phase Timeline

| Phase | Weeks | Focus | Modules |
|-------|-------|-------|---------|
| Phase 1: Foundation | 1-2 | Infrastructure, Auth, DB, S3 | 1, 2, 3 |
| Phase 2: Core Features | 3-4 | Dashboard, Documents, Buckets, Audit | 4, 5, 6, 7 |
| Phase 3: Policy Engine + Users | 5-6 | Policies, Links, User Mgmt | 8, 9, 10 |
| Phase 4: Hardening + Launch | 7-8 | Security, HIPAA, Testing, Deploy | 11, 12 |

## Project Structure

```
src/
├── app/
│   ├── proxy.ts                    # Auth0 proxy (replaces middleware.ts)
│   ├── layout.tsx                  # Root layout with Auth0Provider
│   ├── page.tsx                    # Redirect to dashboard or login
│   ├── (auth)/                     # Public auth pages
│   │   └── access-denied/page.tsx
│   ├── (dashboard)/                # Protected admin routes
│   │   ├── layout.tsx              # Sidebar + topbar layout
│   │   ├── page.tsx                # Dashboard home (Module 4)
│   │   ├── buckets/                # Bucket manager (Module 5)
│   │   ├── documents/              # Document browser (Module 6)
│   │   ├── policies/               # Policy builder (Module 8)
│   │   ├── links/                  # Link generator (Module 9)
│   │   ├── users/                  # User management (Module 10)
│   │   └── audit/                  # Audit log viewer (Module 7)
│   └── api/
│       ├── s3/                     # S3 operations
│       ├── policies/               # Policy CRUD
│       ├── links/                  # Presigned URL generation
│       ├── users/                  # Auth0 user management
│       └── audit/                  # Audit log queries
├── lib/
│   ├── auth0.ts                    # Auth0 client singleton
│   ├── config.ts                   # Zod env validation
│   ├── prisma.ts                   # Prisma client singleton
│   ├── s3.ts                       # S3 client singleton
│   ├── audit.ts                    # Audit logging helper
│   └── utils.ts                    # Shared utilities
├── components/
│   ├── ui/                         # shadcn/ui primitives
│   ├── layout/                     # Sidebar, Topbar, BrandLogo
│   ├── documents/                  # Document browser components
│   ├── policies/                   # Policy builder components
│   └── shared/                     # Reusable components
├── types/
│   └── index.ts                    # TypeScript interfaces
└── prisma/
    └── schema.prisma               # Database schema
```

## Reusable Code from Existing Projects

| What | Source Project | File Path |
|------|--------------|-----------|
| Zod env validation pattern | HelpUcompli SSO | `/Volumes/shorya/apps/helpucompli-sso/lib/config.ts` |
| DB client singleton | HelpUcompli SSO | `/Volumes/shorya/apps/helpucompli-sso/lib/supabase.ts` |
| Type definitions pattern | HelpUcompli SSO | `/Volumes/shorya/apps/helpucompli-sso/types/index.ts` |
| Security headers | HelpUcompli SSO | `/Volumes/shorya/apps/helpucompli-sso/.claude/rules/security.md` |
| Auth0 Action RBAC | HelpUcompli SSO | `/Volumes/shorya/apps/helpucompli-sso/docs/AUTH0_SETUP.md` |
| Admin dashboard layout | SchemaForge Web | `/Volumes/shorya/apps/schemaforge-web/app/(admin)/` |
| TanStack Table patterns | SchemaForge Web | Various admin pages |
| Jest test config | HelpUcompli SSO | `/Volumes/shorya/apps/helpucompli-sso/jest.config.ts` |

## Cost Estimate (Monthly at Launch)

| Service | Est. Cost |
|---------|-----------|
| AWS RDS PostgreSQL (db.t3.micro) | $15-25 |
| AWS S3 (50 GB) | ~$1.50 |
| AWS KMS (1 CMK) | ~$1 |
| AWS CloudTrail | ~$0.10 |
| Hosting (Vercel Pro or AWS) | $20 |
| Upstash Redis (free tier) | $0 |
| Auth0 (free or Enterprise for BAA) | $0+ |
| **Total** | **~$38-48/month** |

## Research Sources

- [Auth0 Next.js SDK v4 Docs](https://auth0.com/docs/quickstart/webapp/nextjs)
- [Auth0 Next.js SDK v4 API Reference](https://auth0.github.io/nextjs-auth0/)
- [Next.js 16 + Auth0 Blog](https://auth0.com/blog/whats-new-nextjs-16/)
- [AWS S3 Presigned URL Best Practices](https://docs.aws.amazon.com/prescriptive-guidance/latest/presigned-url-best-practices/overview.html)
- [shadcn/ui Installation](https://ui.shadcn.com/docs/installation/next)
- [Prisma + AWS RDS PostgreSQL](https://www.prisma.io/dataguide/postgresql/setting-up-postgresql-on-rds)
