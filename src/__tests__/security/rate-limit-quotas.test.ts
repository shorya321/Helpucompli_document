import { describe, expect, it, vi } from "vitest";

// F11.2 quota audit. Per module spec:
//   - 100 req/min per authenticated user on general endpoints (we run stricter)
//   - 10 req/min for link generation (POST /api/links)
// This test captures createRateLimiter() opts at module load time for
// security-sensitive routes and asserts the configured quota. Tightening
// is safe; loosening must be a conscious decision that updates this test.

interface CapturedOpts {
  max: number;
  windowMs: number;
  prefix?: string;
}

const captured: CapturedOpts[] = [];

vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: (opts: CapturedOpts) => {
    captured.push(opts);
    return { limit: vi.fn().mockResolvedValue({ success: true, reset: 0 }) };
  },
}));

// Secondary dependencies — keep module import lean so quota capture
// fires without exercising DB/session code.
vi.mock("@/lib/auth0", () => ({ auth0: { getSession: vi.fn() } }));
vi.mock("@/lib/auth-guard", () => ({
  resolveHasRole: vi.fn(),
  resolveRole: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ensure-user", () => ({ ensureUser: vi.fn() }));

describe("POST /api/links rate-limit (F11.2 link generation quota)", () => {
  it("configures the create limiter at 10 requests / 60s", async () => {
    captured.length = 0;
    await import("@/app/api/links/route");
    const linksCreate = captured.find(
      (c) => c.prefix === "@helpucompli/links-create",
    );
    expect(linksCreate).toBeDefined();
    expect(linksCreate?.max).toBe(10);
    expect(linksCreate?.windowMs).toBe(60_000);
  });
});
