# API Reference

Developer-facing reference for the HelpUcompli Document Repository HTTP API. Every endpoint is authenticated via Auth0 session cookie (SameSite=Lax) unless noted. Every mutating endpoint emits an audit row (`src/lib/audit.ts`).

Base URL: `https://docs.helpucompli.com`

---

## Authentication

- Auth0 Universal Login at `/auth/login`. Callback handled by Auth0 SDK.
- Session cookie `helpucompli_doc_session`. HttpOnly + Secure in prod + SameSite=Lax.
- Role claim: `https://docs.helpucompli.com/role`. Fallback resolution via Auth0 Management API (`src/lib/auth-guard.ts#resolveRole`).

## Common response envelope

```json
{
  "data": <payload | null>,
  "error": "<message> | null",
  "meta": { "total": 123, "page": 1, "limit": 25 }?
}
```

## Common status codes

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 201 | Resource created |
| 400 | Invalid input (Zod schema rejection) |
| 401 | Unauthenticated |
| 403 | Forbidden (wrong role or insufficient assignment) |
| 404 | Not found |
| 409 | Conflict (duplicate) |
| 415 | Unsupported Media Type (non-JSON body) |
| 429 | Too Many Requests (rate limit) — carries `Retry-After` |
| 500 | Server error (no sensitive details leaked) |

Rate limit prefixes: `docs/modules/11-security-hipaa-module.md` lists per-route quotas. Tightest is `POST /api/links` at 10 req/min.

---

## Health

### `GET /api/health`

Pre-auth liveness probe. Rate-limit excluded.

```json
{ "status": "ok", "service": "helpucompli-document-repository", "timestamp": "2026-04-20T18:30:00.000Z" }
```

---

## Buckets (`/api/s3/buckets`)

| Method | Path | Role | Body |
|--------|------|------|------|
| GET | `/api/s3/buckets` | admin+ (viewers see assigned) | — |
| POST | `/api/s3/buckets` | superadmin | `{ name, awsRegion, description? }` |
| GET | `/api/s3/buckets/:id` | admin+ | — |
| DELETE | `/api/s3/buckets/:id` | superadmin | `{ confirmName }` |
| GET | `/api/s3/buckets/:id/compliance` | admin+ | — |

Rate: list 30/30 s, create/delete 5/60 s.

---

## Documents (`/api/s3/...`)

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/api/s3/upload-url` | admin+ | Presigned PUT URL + receipt |
| POST | `/api/s3/upload-complete` | admin+ | Persist DB row after PUT succeeds |
| POST | `/api/s3/upload-abort` | admin+ | Cancel multipart upload |
| POST | `/api/s3/download-url` | viewer+ | Presigned GET URL |
| POST | `/api/s3/delete` | superadmin | Hard delete document + S3 versions |
| POST | `/api/s3/move` | admin+ | Rename / move within bucket |
| POST | `/api/s3/folders` | admin+ | Create folder (empty prefix marker) |
| GET | `/api/documents/search` | viewer+ | Search + filter (bucket/user scope enforced) |

---

## Policies (`/api/policies`)

| Method | Path | Role |
|--------|------|------|
| GET | `/api/policies` | admin+ |
| POST | `/api/policies` | admin+ |
| GET | `/api/policies/:id` | admin+ |
| PUT | `/api/policies/:id` | admin+ |
| DELETE | `/api/policies/:id` | admin+ |

Schema: `src/lib/policy-schema.ts#policyInputSchema`. TTL 60–604800 s. CIDR + domain validated by shared primitives in `src/lib/validation.ts`.

---

## Links (`/api/links`)

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/api/links` | admin+ | List generated links |
| POST | `/api/links` | admin+ | Create link (10/min quota) |
| GET | `/api/links/:token` | — | Public link resolution → 302 to S3 |
| DELETE | `/api/links/admin/:id` | admin+ | Revoke link |

---

## Users (`/api/users`)

| Method | Path | Role |
|--------|------|------|
| GET | `/api/users` | admin+ |
| POST | `/api/users` | admin+ (admin can only invite viewers) |
| PUT | `/api/users/:id` | admin+ (hierarchy rules — see F10.4) |
| PATCH | `/api/users/:id/status` | admin+ (cannot disable self) |
| GET | `/api/users/:id/buckets` | admin+ |
| PUT | `/api/users/:id/buckets` | admin+ |

---

## Audit (`/api/audit`)

### `GET /api/audit?actor=<id>&action=<enum>&from=<iso>&to=<iso>&limit=25&cursor=<id>`

Role: admin+. Pagination cursor-based. CSV export adds `?format=csv` (if implemented per F7.x).

---

## Dashboard (`/api/dashboard/*`)

| Method | Path | Role |
|--------|------|------|
| GET | `/api/dashboard/stats` | admin+ |
| GET | `/api/dashboard/activity` | admin+ |

---

## Error responses

No stack traces, no filesystem paths, no credentials. Shape:

```json
{ "data": null, "error": "Forbidden" }
```

Internal IDs (Auth0 sub, bucket id) may appear in 404 bodies during development only — never in production responses. See `docs/RUNBOOK.md` error page section for HIPAA leak guards.
