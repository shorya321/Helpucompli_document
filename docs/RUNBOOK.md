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

## Rate limiting returning 429 in dev

Dev uses `createInMemoryLimiter` (per-process, non-durable). Restart
`npm run dev` to drop the in-memory counters. Production uses Upstash
Redis — `createRateLimiter` hard-throws if `UPSTASH_REDIS_REST_URL` or
`UPSTASH_REDIS_REST_TOKEN` are unset in `NODE_ENV=production`.
