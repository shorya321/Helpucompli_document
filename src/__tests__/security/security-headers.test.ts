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
  buildFrameAncestorsDirective,
  buildPublicEmbedFrameAncestors,
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

  it("omits frame-ancestors when omitFrameAncestors=true (link viewer owns its own directive)", () => {
    const csp = buildCsp(nonce, { isDev: false, omitFrameAncestors: true });
    expect(csp).not.toContain("frame-ancestors");
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

  it("allows S3 read origin in media-src for video/audio preview", () => {
    const csp = buildCsp(nonce, { isDev: false, awsRegion: "us-west-2" });
    expect(csp).toMatch(/media-src[^;]*'self'/);
    expect(csp).toMatch(/media-src[^;]*blob:/);
    expect(csp).toMatch(
      /media-src[^;]*https:\/\/\*\.s3\.us-west-2\.amazonaws\.com/,
    );
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

describe("buildFrameAncestorsDirective", () => {
  it("returns frame-ancestors 'none' for empty list (HIPAA-safe default)", () => {
    expect(buildFrameAncestorsDirective([])).toBe("frame-ancestors 'none'");
  });

  it("emits https:// prefix for each valid hostname", () => {
    expect(
      buildFrameAncestorsDirective(["partner.example.com", "sub.other.io"]),
    ).toBe(
      "frame-ancestors https://partner.example.com https://sub.other.io",
    );
  });

  it("accepts wildcard labels (*.example.com)", () => {
    expect(buildFrameAncestorsDirective(["*.example.com"])).toBe(
      "frame-ancestors https://*.example.com",
    );
  });

  it("silently drops scheme-like or path-like entries (no injection)", () => {
    expect(
      buildFrameAncestorsDirective([
        "https://evil.com/../bypass",
        "javascript:alert(1)",
        " space in host ",
      ]),
    ).toBe("frame-ancestors 'none'");
  });

  it("skips empty / non-string entries", () => {
    expect(
      buildFrameAncestorsDirective([
        "",
        "good.example.com",
        // @ts-expect-error — deliberate runtime sanity check
        null,
        "another.example.com",
      ]),
    ).toBe(
      "frame-ancestors https://good.example.com https://another.example.com",
    );
  });

  it("lowercases hostnames (CSP source expressions are case-insensitive in host, keep canonical form)", () => {
    expect(buildFrameAncestorsDirective(["Partner.EXAMPLE.com"])).toBe(
      "frame-ancestors https://partner.example.com",
    );
  });
});

describe("buildPublicEmbedFrameAncestors (allowPublicEmbed=true on a link)", () => {
  it("empty allowedDomains → frame-ancestors https: (any HTTPS parent permitted)", () => {
    expect(buildPublicEmbedFrameAncestors([])).toBe("frame-ancestors https:");
  });

  it("non-empty allowedDomains → only those hosts (no `https:` append — admin's narrowing intent stays narrow)", () => {
    expect(
      buildPublicEmbedFrameAncestors(["partner.example.com"]),
    ).toBe("frame-ancestors https://partner.example.com");
  });

  it("multiple allowedDomains preserved in order (no scheme source mixed in)", () => {
    expect(
      buildPublicEmbedFrameAncestors(["a.example.com", "*.b.io"]),
    ).toBe("frame-ancestors https://a.example.com https://*.b.io");
  });

  it("falls back to https: when every entry is malformed (consistent with empty input)", () => {
    expect(
      buildPublicEmbedFrameAncestors(["javascript:alert(1)", " bad host "]),
    ).toBe("frame-ancestors https:");
  });

  it("regression: buildFrameAncestorsDirective([]) still returns 'none' so off-by-default (toggle-off) behavior is preserved", () => {
    expect(buildFrameAncestorsDirective([])).toBe("frame-ancestors 'none'");
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
