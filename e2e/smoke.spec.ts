import { test, expect, request } from "@playwright/test";

// F12.3 — smoke flows exercisable without an authenticated Auth0
// session. Full login-required journeys are documented in
// docs/E2E-TEST-MATRIX.md with owner + fixture requirements; they
// ship in Module 12 launch-gate once the test-tenant seed is ready.

const BASE = "http://localhost:3000";

test.describe("F12.3 public-edge smoke", () => {
  test("/api/health returns 200 with liveness payload", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status");
    await ctx.dispose();
  });

  test("unauthenticated / redirects to /auth/login", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/`, { maxRedirects: 0 });
    // Auth0 middleware redirects unauthenticated users — status 307
    // and Location points into the auth flow.
    expect([302, 307]).toContain(res.status());
    const loc = res.headers()["location"] ?? "";
    expect(loc).toMatch(/\/auth\/login|\/authorize/);
    await ctx.dispose();
  });

  test("every response carries the static security headers", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/health`);
    const h = res.headers();
    expect(h["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-xss-protection"]).toBe("1; mode=block");
    expect(h["referrer-policy"]).toBeTruthy();
    await ctx.dispose();
  });

  test("protected routes carry a nonce-based CSP", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/dashboard`, { maxRedirects: 0 });
    const csp = res.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src[^;]*'nonce-[^']+'/);
    expect(csp).toMatch(/'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    await ctx.dispose();
  });

  test("/api/s3/buckets requires authentication (401)", async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BASE}/api/s3/buckets`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});
