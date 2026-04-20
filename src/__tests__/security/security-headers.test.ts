import { describe, expect, it, vi } from "vitest";

const configMock = vi.hoisted(() => ({
  AUTH0_DOMAIN: "auth.helpucompli.com",
  AWS_REGION: "us-east-1",
  NODE_ENV: "production",
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => configMock,
}));

import {
  STATIC_SECURITY_HEADERS,
  buildCsp,
  generateNonce,
} from "@/lib/security-headers";

describe("generateNonce", () => {
  it("returns a base64-encoded string", () => {
    const nonce = generateNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
    // Base64 charset
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("returns a different value on each call (unpredictable)", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateNonce());
    expect(set.size).toBe(100);
  });
});

describe("buildCsp", () => {
  const nonce = "AAAA1111";

  it("includes the nonce in script-src with strict-dynamic", () => {
    const csp = buildCsp(nonce, { isDev: false });
    expect(csp).toMatch(/script-src[^;]*'nonce-AAAA1111'/);
    expect(csp).toMatch(/script-src[^;]*'strict-dynamic'/);
  });

  it("does NOT allow 'unsafe-inline' in script-src in production", () => {
    const csp = buildCsp(nonce, { isDev: false });
    const scriptSrc = /script-src ([^;]+);/.exec(csp)?.[1] ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("does NOT allow 'unsafe-eval' in script-src in production", () => {
    const csp = buildCsp(nonce, { isDev: false });
    const scriptSrc = /script-src ([^;]+);/.exec(csp)?.[1] ?? "";
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("allows 'unsafe-eval' only in development", () => {
    const csp = buildCsp(nonce, { isDev: true });
    expect(csp).toMatch(/script-src[^;]*'unsafe-eval'/);
  });

  it("uses 'unsafe-inline' for style-src without a nonce (CSP3 nonce would block inline style attrs)", () => {
    const csp = buildCsp(nonce, { isDev: false });
    const styleSrc = /style-src ([^;]+);/.exec(csp)?.[1] ?? "";
    expect(styleSrc).toContain("'unsafe-inline'");
    expect(styleSrc).not.toContain("'nonce-");
  });

  it("includes default-src 'self'", () => {
    expect(buildCsp(nonce, { isDev: false })).toMatch(/default-src 'self'/);
  });

  it("sets frame-ancestors 'none' (clickjacking)", () => {
    expect(buildCsp(nonce, { isDev: false })).toMatch(/frame-ancestors 'none'/);
  });

  it("sets object-src 'none'", () => {
    expect(buildCsp(nonce, { isDev: false })).toMatch(/object-src 'none'/);
  });

  it("includes upgrade-insecure-requests", () => {
    expect(buildCsp(nonce, { isDev: false })).toContain(
      "upgrade-insecure-requests",
    );
  });

  it("allows S3 upload origin for presigned PUT (F6.2)", () => {
    const csp = buildCsp(nonce, { isDev: false, awsRegion: "us-west-2" });
    expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.s3\.us-west-2\.amazonaws\.com/);
  });

  it("allows S3 read origin in frame-src for PDF preview (F6.6)", () => {
    const csp = buildCsp(nonce, { isDev: false, awsRegion: "us-west-2" });
    expect(csp).toMatch(/frame-src[^;]*https:\/\/\*\.s3\.us-west-2\.amazonaws\.com/);
  });

  it("includes Auth0 origin in connect-src and form-action", () => {
    const csp = buildCsp(nonce, {
      isDev: false,
      auth0Domain: "auth.helpucompli.com",
    });
    expect(csp).toMatch(/connect-src[^;]*https:\/\/auth\.helpucompli\.com/);
    expect(csp).toMatch(/form-action[^;]*https:\/\/auth\.helpucompli\.com/);
  });

  it("omits Auth0 origin when domain not provided", () => {
    const csp = buildCsp(nonce, { isDev: false, auth0Domain: undefined });
    expect(csp).not.toContain("https://undefined");
  });

  it("does not contain newlines (single-line header value)", () => {
    expect(buildCsp(nonce, { isDev: false })).not.toContain("\n");
  });
});

describe("STATIC_SECURITY_HEADERS", () => {
  it("includes HSTS with 2-year max-age + preload", () => {
    expect(STATIC_SECURITY_HEADERS["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("includes X-Content-Type-Options: nosniff", () => {
    expect(STATIC_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("includes X-Frame-Options: DENY (defense-in-depth with frame-ancestors)", () => {
    expect(STATIC_SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
  });

  it("includes X-XSS-Protection: 1; mode=block", () => {
    expect(STATIC_SECURITY_HEADERS["X-XSS-Protection"]).toBe("1; mode=block");
  });

  it("includes a strict Referrer-Policy", () => {
    expect(STATIC_SECURITY_HEADERS["Referrer-Policy"]).toMatch(
      /^(no-referrer|strict-origin-when-cross-origin)$/,
    );
  });
});
