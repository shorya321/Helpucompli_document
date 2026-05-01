import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
});

describe("buildLoginCallbackResponse (Auth0 onCallback delegate)", () => {
  it("redirects to /access-denied when error present", async () => {
    const { buildLoginCallbackResponse } = await import(
      "@/lib/login-callback-redirect"
    );
    const res = buildLoginCallbackResponse(
      new Error("auth0 error"),
      { returnTo: "/dashboard", appBaseUrl: "http://localhost:3000" },
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/access-denied",
    );
  });

  it("redirects through /api/auth/audit-login with returnTo on success", async () => {
    const { buildLoginCallbackResponse } = await import(
      "@/lib/login-callback-redirect"
    );
    const res = buildLoginCallbackResponse(null, {
      returnTo: "/dashboard",
      appBaseUrl: "http://localhost:3000",
    });
    expect(res.status).toBe(307);
    const loc = res.headers.get("location");
    expect(loc).toBe(
      "http://localhost:3000/api/auth/audit-login?to=%2Fdashboard",
    );
  });

  it("defaults to=/ when ctx.returnTo missing", async () => {
    const { buildLoginCallbackResponse } = await import(
      "@/lib/login-callback-redirect"
    );
    const res = buildLoginCallbackResponse(null, {
      appBaseUrl: "http://localhost:3000",
    });
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/api/auth/audit-login?to=%2F",
    );
  });

  it("falls back to APP_BASE_URL env when ctx.appBaseUrl missing", async () => {
    const { buildLoginCallbackResponse } = await import(
      "@/lib/login-callback-redirect"
    );
    const res = buildLoginCallbackResponse(null, { returnTo: "/x" });
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/api/auth/audit-login?to=%2Fx",
    );
  });

  it("ignores absolute URL returnTo (open-redirect guard upstream)", async () => {
    const { buildLoginCallbackResponse } = await import(
      "@/lib/login-callback-redirect"
    );
    // ctx.returnTo from Auth0 SDK is typically a relative path; if an
    // absolute URL slips in we strip it to /.
    const res = buildLoginCallbackResponse(null, {
      returnTo: "https://evil.com/x",
      appBaseUrl: "http://localhost:3000",
    });
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/api/auth/audit-login?to=%2F",
    );
  });
});
