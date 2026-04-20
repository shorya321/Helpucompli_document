# Runbook

Operational troubleshooting for the HelpUcompli Document Repository.

---

## Boot failure: `ConfigError: Invalid environment configuration`

The app validates every required environment variable at boot via
`src/lib/config.ts`. On failure `getConfig()` throws `ConfigError`
with an aggregated per-field list:

```
ConfigError: Invalid environment configuration:
  - AUTH0_SECRET: AUTH0_SECRET must be at least 32 characters …
  - DATABASE_URL: DATABASE_URL must not be empty
  - NODE_ENV: must be 'production' when APP_BASE_URL is https:// …

Check .env.local against .env.example and ensure every required variable is set.
```

**Resolution:**

1. Cross-reference each listed field with `.env.example` — every key in
   `.env.example` is required unless explicitly annotated as optional.
2. Common regressions:
   - `AUTH0_SECRET` shorter than 32 chars — regenerate via
     `openssl rand -hex 32`.
   - `APP_BASE_URL` uses `https://` while `NODE_ENV=development` — the
     paired invariant fails because session cookies would ship without
     the `Secure` flag over TLS. Either set `NODE_ENV=production` or
     use `http://` in dev.
   - `DATABASE_URL`, `AUTH0_*`, `AWS_*` unset on a fresh deploy — copy
     them from the matching secrets store (AWS SSM / Vercel env / local
     `.env.local`).
3. Boot is fail-fast by design: the process exits before any request
   handler, Prisma client, or Auth0 middleware can observe the missing
   value. Do not bypass validation by exporting dummy secrets.

**Why aggregated error output:**
`config.ts` `loadConfig()` joins every Zod issue into a single string
so operators fix all gaps in one pass instead of chasing a staircase
of single-field failures at each restart.

---

## Pre-request liveness check

`/api/health` is the only API route excluded from the Auth0 proxy
matcher (see `src/proxy.ts` config block) and is NOT rate-limited.
k8s / ALB liveness probes must target it — targeting any other route
produces 401/429 noise that fails health checks.

---

## CSP violations (browser console)

F11.1 enforces a strict nonce-based CSP. Symptoms:

- "Refused to execute inline script because it violates …" — usually
  a third-party library injecting an inline `<script>` without a
  nonce. Pass the `x-nonce` request header through to it (see
  `src/app/providers.tsx` pattern).
- "Refused to load the stylesheet …" — missing origin in `style-src`
  or `connect-src`. Update `src/lib/security-headers.ts` `buildCsp`.
- "Refused to load image …" — `img-src` permits `https:` already, so
  this typically means `data:` or `blob:` usage — allowed. If blocked,
  check browser extension interference before assuming a CSP bug.

---

## Dependency security scanning (F11.7)

**Continuous layer:** GitHub Dependabot (`.github/dependabot.yml`)
opens weekly PRs for npm + GitHub Actions updates. Minor/patch
bundled, majors individual. Label `security` for triage.

**Gate layer:** `.github/workflows/security-scan.yml` runs
`npm audit --audit-level=high` on every PR, main push, and daily
at 07:00 UTC. Any HIGH or CRITICAL advisory fails CI.

**Manual audit:** `npm audit --json` locally — current baseline is
0 vulnerabilities across all severities.

**Known triage rules:**

1. CRITICAL → fix or justified workaround before merge.
2. HIGH → 7-day SLA; track in Linear / issue tracker if deferred.
3. MODERATE/LOW → monthly sweep during the same drill cadence as
   `docs/AWS-SECURITY-CONFIG.md` §Ownership.

**If CI fails on `npm audit` for a newly disclosed advisory:**

```bash
npm audit
# identify the path
npm audit fix           # safe non-breaking fixes
npm audit fix --force   # breaking upgrades (review changelog first)
```

If no upgrade path exists, add a documented override to
`package.json` `overrides` field and file an issue to track upstream
resolution.

---

## Rate limiting returning 429 in dev

Dev uses `createInMemoryLimiter` (per-process, non-durable). Restart
`npm run dev` to drop the in-memory counters. Production uses Upstash
Redis — `createRateLimiter` hard-throws if `UPSTASH_REDIS_REST_URL` or
`UPSTASH_REDIS_REST_TOKEN` are unset in `NODE_ENV=production`.
