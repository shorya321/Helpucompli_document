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

  it("sets an explicit cookie name to avoid collision across *.helpucompli.com apps", async () => {
    const { SESSION_CONFIG } = await import("@/lib/auth0");
    expect(SESSION_CONFIG.cookie?.name).toBe("helpucompli_doc_session");
  });
});

describe("SESSION_CONFIG — secure cookie gated on https origin", () => {
  const env = process.env as Record<string, string | undefined>;

  it("forces secure=true when APP_BASE_URL is https, even without NODE_ENV=production", async () => {
    const original = { NODE_ENV: env.NODE_ENV, APP_BASE_URL: env.APP_BASE_URL };
    env.NODE_ENV = "development";
    env.APP_BASE_URL = "https://docs.helpucompli.com";
    try {
      const { isSecureCookieOrigin } = await import("@/lib/auth0");
      expect(isSecureCookieOrigin()).toBe(true);
    } finally {
      env.NODE_ENV = original.NODE_ENV;
      env.APP_BASE_URL = original.APP_BASE_URL;
    }
  });

  it("allows secure=false when APP_BASE_URL is http and NODE_ENV!=production", async () => {
    const original = { NODE_ENV: env.NODE_ENV, APP_BASE_URL: env.APP_BASE_URL };
    env.NODE_ENV = "development";
    env.APP_BASE_URL = "http://localhost:3000";
    try {
      const { isSecureCookieOrigin } = await import("@/lib/auth0");
      expect(isSecureCookieOrigin()).toBe(false);
    } finally {
      env.NODE_ENV = original.NODE_ENV;
      env.APP_BASE_URL = original.APP_BASE_URL;
    }
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
