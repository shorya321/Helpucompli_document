// Sliding-window rate limiter used by dashboard API routes (F4 HIGH-1).
// Production MUST use the Upstash Redis backend — durable across
// server instances, required for HIPAA audit of access controls.
// In-memory fallback exists only for dev + tests (per-process state is
// worthless on multi-instance deploys — hence the production guard).

export interface RateLimitResult {
  readonly success: boolean;
  readonly remaining: number;
  readonly reset: number;
}

export interface RateLimiter {
  limit(identifier: string): Promise<RateLimitResult>;
}

export interface RateLimiterOptions {
  readonly max: number;
  readonly windowMs: number;
  readonly prefix?: string;
}

interface InMemoryOptions extends RateLimiterOptions {
  readonly now?: () => number;
}

export function createInMemoryLimiter(opts: InMemoryOptions): RateLimiter {
  const { max, windowMs, now = () => Date.now() } = opts;
  const hits = new Map<string, number[]>();

  return {
    async limit(identifier: string): Promise<RateLimitResult> {
      const current = now();
      const cutoff = current - windowMs;
      const prior = hits.get(identifier) ?? [];
      const live = prior.filter((t) => t > cutoff);

      if (live.length >= max) {
        hits.set(identifier, live);
        const oldest = live[0] ?? current;
        return {
          success: false,
          remaining: 0,
          reset: oldest + windowMs,
        };
      }

      live.push(current);
      hits.set(identifier, live);
      return {
        success: true,
        remaining: max - live.length,
        reset: current + windowMs,
      };
    },
  };
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const nodeEnv = process.env.NODE_ENV;

  if (!url || !token) {
    // `next build` evaluates route modules during page-data-collection
    // with NODE_ENV=production but no runtime secrets. Skip the hard-fail
    // during build — the in-memory limiter is created but never serves
    // traffic (build output is discarded after collection). Runtime phase
    // (`phase-production-server` or unset) still enforces the HIPAA guard.
    const isBuildPhase =
      process.env.NEXT_PHASE === "phase-production-build";
    if (nodeEnv === "production" && !isBuildPhase) {
      throw new Error(
        "Rate limiter requires UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN " +
          "in production. In-memory fallback is not durable across server instances " +
          "and cannot satisfy HIPAA access-control audit requirements.",
      );
    }
    // Dev + test + build phase: in-memory is fine.
    return createInMemoryLimiter(opts);
  }

  // Upstash-backed limiter. Import is dynamic so test env never touches
  // the network client — vi.mock can still intercept module load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Ratelimit } = require("@upstash/ratelimit") as {
    Ratelimit: new (config: unknown) => {
      limit(id: string): Promise<{
        success: boolean;
        remaining: number;
        reset: number;
      }>;
    };
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Redis } = require("@upstash/redis") as {
    Redis: new (config: { url: string; token: string }) => unknown;
  };

  const redis = new Redis({ url, token });
  const windowSec = Math.max(1, Math.round(opts.windowMs / 1000));
  const ratelimit = new Ratelimit({
    redis,
    limiter: slidingWindowConfig(opts.max, windowSec),
    analytics: false,
    prefix: opts.prefix ?? "@helpucompli/ratelimit",
  });

  return {
    async limit(identifier: string): Promise<RateLimitResult> {
      const r = await ratelimit.limit(identifier);
      return {
        success: r.success,
        remaining: r.remaining,
        reset: r.reset,
      };
    },
  };
}

// Separated for override in tests without dragging in the full Upstash
// module surface.
function slidingWindowConfig(max: number, windowSec: number): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Ratelimit } = require("@upstash/ratelimit") as {
    Ratelimit: {
      slidingWindow: (max: number, window: string) => unknown;
    };
  };
  return Ratelimit.slidingWindow(max, `${windowSec} s`);
}
