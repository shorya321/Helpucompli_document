import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.AUTH0_DOMAIN = "test.auth0.com";
  process.env.AUTH0_CLIENT_ID = "test_client_id";
  process.env.AUTH0_CLIENT_SECRET = "test_client_secret";
  process.env.AUTH0_SECRET = "test_secret_thirty_two_chars_long___";
  process.env.APP_BASE_URL = "http://localhost:3000";
});

describe("auth0 client singleton", () => {
  it("exports an Auth0Client instance with expected methods", async () => {
    const { auth0 } = await import("@/lib/auth0");

    expect(auth0).toBeTruthy();
    expect(typeof auth0.middleware).toBe("function");
    expect(typeof auth0.getSession).toBe("function");
    expect(typeof auth0.getAccessToken).toBe("function");
  });

  it("returns the same instance on repeated imports (singleton)", async () => {
    const first = (await import("@/lib/auth0")).auth0;
    const second = (await import("@/lib/auth0")).auth0;

    expect(first).toBe(second);
  });
});
