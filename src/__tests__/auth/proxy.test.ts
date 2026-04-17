import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.AUTH0_DOMAIN = "test.auth0.com";
  process.env.AUTH0_CLIENT_ID = "test_client_id";
  process.env.AUTH0_CLIENT_SECRET = "test_client_secret";
  process.env.AUTH0_SECRET = "test_secret_thirty_two_chars_long___";
  process.env.APP_BASE_URL = "http://localhost:3000";
});

describe("proxy.ts (Next.js 16 proxy entry)", () => {
  it("exports proxy as a function", async () => {
    const mod = await import("@/proxy");
    expect(typeof mod.proxy).toBe("function");
  });

  it("exports a matcher config that excludes Next static, health, and SEO assets", async () => {
    const mod = await import("@/proxy");
    expect(mod.config).toBeDefined();
    expect(Array.isArray(mod.config.matcher)).toBe(true);
    expect(mod.config.matcher.length).toBeGreaterThan(0);

    const pattern = mod.config.matcher[0];
    expect(pattern).toMatch(/_next\/static/);
    expect(pattern).toMatch(/favicon\.ico/);
    expect(pattern).toMatch(/api\/health/);
    expect(pattern).toMatch(/robots\.txt/);
    expect(pattern).toMatch(/sitemap\.xml/);
  });
});
