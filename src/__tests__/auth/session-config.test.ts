import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.AUTH0_DOMAIN = "test.auth0.com";
  process.env.AUTH0_CLIENT_ID = "test_client_id";
  process.env.AUTH0_CLIENT_SECRET = "test_client_secret";
  process.env.AUTH0_SECRET = "test_secret_thirty_two_chars_long___";
  process.env.APP_BASE_URL = "http://localhost:3000";
});

describe("SESSION_CONFIG (HIPAA 30-min inactivity + cookie flags)", () => {
  it("enforces 30-minute inactivityDuration (HIPAA)", async () => {
    const { SESSION_CONFIG } = await import("@/lib/auth0");
    expect(SESSION_CONFIG.inactivityDuration).toBe(30 * 60);
  });

  it("caps session with absoluteDuration (<= 8 hours)", async () => {
    const { SESSION_CONFIG } = await import("@/lib/auth0");
    expect(SESSION_CONFIG.absoluteDuration).toBeGreaterThan(0);
    expect(SESSION_CONFIG.absoluteDuration).toBeLessThanOrEqual(8 * 60 * 60);
  });

  it("enables rolling sessions so activity extends the window", async () => {
    const { SESSION_CONFIG } = await import("@/lib/auth0");
    expect(SESSION_CONFIG.rolling).toBe(true);
  });

  it("sets cookie sameSite='lax' (CSRF defense with login-redirect support)", async () => {
    const { SESSION_CONFIG } = await import("@/lib/auth0");
    expect(SESSION_CONFIG.cookie?.sameSite).toBe("lax");
  });

  it("sets cookie secure flag based on NODE_ENV (true in production)", async () => {
    const { SESSION_CONFIG } = await import("@/lib/auth0");
    const expected = process.env.NODE_ENV === "production";
    expect(SESSION_CONFIG.cookie?.secure).toBe(expected);
  });
});

describe("TRANSACTION_COOKIE_CONFIG (OAuth state cookie)", () => {
  it("sets sameSite='lax' on the transaction cookie", async () => {
    const { TRANSACTION_COOKIE_CONFIG } = await import("@/lib/auth0");
    expect(TRANSACTION_COOKIE_CONFIG.sameSite).toBe("lax");
  });

  it("mirrors secure flag based on NODE_ENV", async () => {
    const { TRANSACTION_COOKIE_CONFIG } = await import("@/lib/auth0");
    const expected = process.env.NODE_ENV === "production";
    expect(TRANSACTION_COOKIE_CONFIG.secure).toBe(expected);
  });
});
