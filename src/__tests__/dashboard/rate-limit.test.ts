import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sliding-window in-memory limiter tests. Upstash-backed path is not
// exercised here — it's a pass-through to @upstash/ratelimit, covered
// by the library's own tests. We assert:
//  - identifier isolation (one user's quota doesn't count against another)
//  - window sliding (old requests age out)
//  - limit enforcement (N allowed, N+1 blocked)
//  - production-only hard-fail when UPSTASH vars are unset

import {
  createInMemoryLimiter,
  createRateLimiter,
  type RateLimiter,
} from "@/lib/rate-limit";

describe("in-memory limiter", () => {
  let limiter: RateLimiter;
  let now: number;
  beforeEach(() => {
    now = 1_700_000_000_000;
    limiter = createInMemoryLimiter({
      max: 3,
      windowMs: 10_000,
      now: () => now,
    });
  });

  it("allows up to `max` requests within the window", async () => {
    expect((await limiter.limit("user-a")).success).toBe(true);
    expect((await limiter.limit("user-a")).success).toBe(true);
    expect((await limiter.limit("user-a")).success).toBe(true);
  });

  it("rejects the request that exceeds `max`", async () => {
    for (let i = 0; i < 3; i++) await limiter.limit("user-a");
    const result = await limiter.limit("user-a");
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("isolates identifiers — user-a quota does not affect user-b", async () => {
    for (let i = 0; i < 3; i++) await limiter.limit("user-a");
    const userB = await limiter.limit("user-b");
    expect(userB.success).toBe(true);
  });

  it("ages out old hits past the window boundary", async () => {
    for (let i = 0; i < 3; i++) await limiter.limit("user-a");
    expect((await limiter.limit("user-a")).success).toBe(false);
    now += 10_001;
    expect((await limiter.limit("user-a")).success).toBe(true);
  });

  it("reports accurate remaining count", async () => {
    const r1 = await limiter.limit("user-a");
    expect(r1.remaining).toBe(2);
    const r2 = await limiter.limit("user-a");
    expect(r2.remaining).toBe(1);
    const r3 = await limiter.limit("user-a");
    expect(r3.remaining).toBe(0);
  });
});

describe("createRateLimiter factory", () => {
  const origEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...origEnv };
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns an in-memory limiter when UPSTASH vars are unset and NODE_ENV=test", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.stubEnv("NODE_ENV", "test");
    const l = createRateLimiter({ max: 5, windowMs: 1000 });
    expect(typeof l.limit).toBe("function");
  });

  it("throws in production when UPSTASH vars are unset — HIPAA requires durable quota state", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.NEXT_PHASE;
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createRateLimiter({ max: 5, windowMs: 1000 })).toThrow(
      /UPSTASH/,
    );
  });

  it("does NOT throw during `next build` (NEXT_PHASE=phase-production-build) even without UPSTASH vars — build-time Coolify deploys have no runtime secrets", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const l = createRateLimiter({ max: 5, windowMs: 1000 });
    expect(typeof l.limit).toBe("function");
  });

  it("still throws at runtime phase (phase-production-server) when UPSTASH vars are unset", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    expect(() => createRateLimiter({ max: 5, windowMs: 1000 })).toThrow(
      /UPSTASH/,
    );
  });
});
