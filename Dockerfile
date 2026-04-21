# syntax=docker/dockerfile:1.7
#
# Production image for docs.helpucompli.com (Next.js 16 + Prisma).
# Multi-stage build → final image is ~150MB (node:20-alpine + standalone
# Next output + Prisma engine). Deploy path: Coolify → GitHub webhook →
# docker build → container boots with `prisma migrate deploy && node
# server.js`, so schema is always in sync with the committed migration
# dir before the first request lands.

# ----- base -----
FROM node:20-alpine AS base
# openssl is required by the Prisma engine on Alpine (libssl linkage).
# libc6-compat smooths native bindings (e.g. pino transport workers).
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ----- deps: install npm deps against the lockfile -----
FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
# `npm ci` is reproducible vs `npm install`. Prisma postinstall runs
# `prisma generate` using the schema copied above.
RUN npm ci

# ----- builder: compile Next.js + regenerate Prisma for the target OS -----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Pin NODE_ENV=production so any Coolify-injected build-time NODE_ENV
# cannot leak in and trip the HIPAA guard in src/lib/config.ts (https://
# APP_BASE_URL requires NODE_ENV=production for Secure cookie flag).
ENV NODE_ENV=production
# Skip ESLint errors during prod build (Next respects eslint.ignoreDuringBuilds
# only if set in config — safer to run lint separately in CI). Keep tsc hard-
# fail on type errors by not disabling typescript check.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# ----- runner: minimal runtime -----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Run as non-root. Next.js standalone output expects UID 1001 by default.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Static assets + standalone server bundle.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Schema + migrations so `prisma migrate deploy` can run at boot.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# Full node_modules from the builder stage. Prisma CLI pulls in transitive
# deps (@prisma/config → effect, c12, deepmerge-ts, empathic) that are
# hoisted to top-level node_modules and NOT traced by Next.js standalone.
# A narrow @prisma/prisma/.prisma subset left `effect` missing and the
# container crashed at boot. One full copy removes the whack-a-mole risk
# as Prisma's dep graph evolves. Standalone's traced node_modules files
# under .next/standalone/node_modules are preserved where they exist.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Healthcheck hits the `/api/health` route that returns 200 + liveness.
# Coolify also probes this path (set in the UI).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3000/api/health || exit 1

# Apply pending migrations, then start the Next server. Migration failure
# aborts boot so we never serve a request against a drifted schema.
# Invoke prisma CLI directly via `node` — the standalone runner image does
# not include the `node_modules/.bin/` symlinks (only the `prisma` package
# dir is copied), so calling `node_modules/.bin/prisma` fails at boot.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
