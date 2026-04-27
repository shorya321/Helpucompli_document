import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const configMock = vi.hoisted(() => ({
  AUTH0_DOMAIN: "auth.helpucompli.com",
  AWS_REGION: "us-east-1",
  NODE_ENV: "production" as const,
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => configMock,
}));

const auth0Mock = vi.hoisted(() => ({
  middleware: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: auth0Mock,
}));

import { proxy } from "@/proxy";

function makeAuthResponse(
  headers: Record<string, string> = { "x-middleware-next": "1" },
): NextResponse {
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

beforeEach(() => {
  auth0Mock.middleware.mockReset();
});

describe("proxy (CSP nonce injection)", () => {
  it("sets a Content-Security-Policy header on the response", async () => {
    auth0Mock.middleware.mockResolvedValue(makeAuthResponse());
    const request = new Request("https://docs.helpucompli.com/dashboard");

    const response = await proxy(request);

    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toMatch(/script-src[^;]*'nonce-[^']+'/);
    expect(csp).toMatch(/script-src[^;]*'strict-dynamic'/);
  });

  it("does not allow 'unsafe-inline' in script-src in production", async () => {
    auth0Mock.middleware.mockResolvedValue(makeAuthResponse());
    const request = new Request("https://docs.helpucompli.com/dashboard");

    const response = await proxy(request);

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    const scriptSrc = /script-src ([^;]+);/.exec(csp)?.[1] ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("generates a unique nonce per request", async () => {
    auth0Mock.middleware.mockResolvedValue(makeAuthResponse());

    const first = await proxy(
      new Request("https://docs.helpucompli.com/dashboard"),
    );
    auth0Mock.middleware.mockResolvedValue(makeAuthResponse());
    const second = await proxy(
      new Request("https://docs.helpucompli.com/dashboard"),
    );

    const cspFirst = first.headers.get("Content-Security-Policy") ?? "";
    const cspSecond = second.headers.get("Content-Security-Policy") ?? "";
    const nonceFirst = /'nonce-([^']+)'/.exec(cspFirst)?.[1];
    const nonceSecond = /'nonce-([^']+)'/.exec(cspSecond)?.[1];
    expect(nonceFirst).toBeTruthy();
    expect(nonceSecond).toBeTruthy();
    expect(nonceFirst).not.toBe(nonceSecond);
  });

  it("sets all static security headers on the response", async () => {
    auth0Mock.middleware.mockResolvedValue(makeAuthResponse());
    const request = new Request("https://docs.helpucompli.com/dashboard");

    const response = await proxy(request);

    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-XSS-Protection")).toBe("1; mode=block");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("preserves Auth0 set-cookie headers on app routes", async () => {
    const auth = makeAuthResponse({
      "x-middleware-next": "1",
      "set-cookie": "appSession=abc; HttpOnly; Path=/",
    });
    auth0Mock.middleware.mockResolvedValue(auth);
    const request = new Request("https://docs.helpucompli.com/dashboard");

    const response = await proxy(request);

    expect(response.headers.get("set-cookie")).toContain("appSession=abc");
  });

  it("passes through /auth/* response unchanged aside from CSP", async () => {
    const redirectRes = NextResponse.redirect(
      "https://auth.helpucompli.com/authorize",
    );
    redirectRes.headers.set("set-cookie", "state=xyz; HttpOnly");
    auth0Mock.middleware.mockResolvedValue(redirectRes);
    const request = new Request("https://docs.helpucompli.com/auth/login");

    const response = await proxy(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).toContain("state=xyz");
    expect(response.headers.get("Content-Security-Policy")).toMatch(
      /script-src/,
    );
    expect(response.headers.get("Strict-Transport-Security")).toBeTruthy();
  });

  it("does not forward x-middleware-next from Auth0 on app-route wrap", async () => {
    // Both NextResponse.next() and authRes carry x-middleware-next: '1'.
    // Merging logic must not overwrite the fresh one from NextResponse.next
    // — just ensure the value is '1' (not doubled/appended).
    auth0Mock.middleware.mockResolvedValue(
      makeAuthResponse({ "x-middleware-next": "1" }),
    );
    const request = new Request("https://docs.helpucompli.com/dashboard");

    const response = await proxy(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  // ---- Embeddable link viewer + same-origin asset proxy frame controls ----
  //
  // /l/<token> owns its own policy-driven `frame-ancestors`. /l/<token>/raw
  // is its same-origin asset proxy and must also be embeddable as a sub-
  // resource of the viewer (otherwise iframe-loaded files like PDFs are
  // blocked by the static `X-Frame-Options: DENY` even when the request is
  // same-origin). Both paths skip the static X-Frame-Options and omit the
  // middleware CSP's `frame-ancestors 'none'`. Every other path keeps the
  // strict default — the third test guards against regex over-broadening.
  const VIEWER_TOKEN =
    "tok_abc_with_long_enough_token_value_xyz";

  it("/l/<token> viewer skips X-Frame-Options and omits middleware frame-ancestors", async () => {
    auth0Mock.middleware.mockResolvedValue(makeAuthResponse());
    const request = new Request(
      `https://docs.helpucompli.com/l/${VIEWER_TOKEN}`,
    );

    const response = await proxy(request);

    expect(response.headers.get("X-Frame-Options")).toBeNull();
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    // Middleware CSP must NOT carry frame-ancestors here — the viewer
    // route owns that directive in its own response headers.
    expect(csp).not.toContain("frame-ancestors");
  });

  it("/l/<token>/raw same-origin proxy skips X-Frame-Options and omits middleware frame-ancestors", async () => {
    auth0Mock.middleware.mockResolvedValue(makeAuthResponse());
    const request = new Request(
      `https://docs.helpucompli.com/l/${VIEWER_TOKEN}/raw`,
    );

    const response = await proxy(request);

    expect(response.headers.get("X-Frame-Options")).toBeNull();
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).not.toContain("frame-ancestors");
  });

  it("/l/<token>/<other> (anything other than /raw) keeps the strict X-Frame-Options DENY + frame-ancestors 'none' default", async () => {
    // Regression guard: do NOT broaden the regex by accident. Only the
    // viewer page itself and its `/raw` asset proxy are exempt; any
    // future siblings under /l/<token>/… must explicitly opt in.
    auth0Mock.middleware.mockResolvedValue(makeAuthResponse());
    const request = new Request(
      `https://docs.helpucompli.com/l/${VIEWER_TOKEN}/something-else`,
    );

    const response = await proxy(request);

    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
