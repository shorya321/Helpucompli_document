import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared authorize helper so these tests exercise only the
// response-shaping layer of /l/[hash]/route.ts. Helper unit tests live
// in link-access-route.test.ts + link-access.test.ts.
const mocks = vi.hoisted(() => ({
  resolveAndAuthorizeLink: vi.fn(),
}));

vi.mock("@/lib/link-access", () => ({
  resolveAndAuthorizeLink: mocks.resolveAndAuthorizeLink,
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    APP_BASE_URL: "http://localhost:3000",
    NODE_ENV: "test",
    AWS_REGION: "us-east-1",
    AUTH0_DOMAIN: "auth.helpucompli.com",
  }),
}));

import { GET } from "@/app/l/[hash]/route";
import { NextRequest } from "next/server";

const TOKEN = "tok_abc_with_long_enough_token_value_xyz";

afterEach(() => {
  mocks.resolveAndAuthorizeLink.mockReset();
});

beforeEach(() => {
  mocks.resolveAndAuthorizeLink.mockReset();
});

function req() {
  return new NextRequest(`http://x/l/${TOKEN}`);
}

function params(hash: string) {
  return Promise.resolve({ hash });
}

function okResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    kind: "ok",
    link: {
      id: "link-1",
      documentId: "d-1",
      policyId: "p-1",
      allowPublicEmbed: false,
    },
    document: {
      id: "d-1",
      filename: "Spec.pdf",
      contentType: "application/pdf",
      bucketName: "alpha-bucket",
      s3Key: "shared/file.pdf",
    },
    effective: {
      source: "object",
      policyId: "p-1",
      linkTtlSeconds: 900,
      maxDownloads: null,
      requireAuth: false,
      allowedDomains: [],
      allowedIpRanges: [],
    },
    presignedUrl:
      "https://alpha-bucket.s3.us-east-1.amazonaws.com/shared/file.pdf?X-Amz-Signature=abc&X-Amz-Expires=900",
    ...over,
  };
}

describe("GET /l/[hash] — embeddable link viewer", () => {
  it("403 html when helper returns forbidden", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce({ kind: "forbidden" });
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("content-security-policy")).toMatch(
      /frame-ancestors 'none'/,
    );
    expect(res.headers.get("x-frame-options")).toBeNull();
  });

  it("429 html + Retry-After when rate-limited", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce({
      kind: "rateLimited",
      retryAfterSec: 42,
    });
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("200 html with frame-ancestors 'none' when policy has no allowedDomains", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(res.headers.get("x-frame-options")).toBeNull();
  });

  it("200 html with dynamic frame-ancestors when policy lists allowedDomains", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        effective: {
          source: "object",
          policyId: "p-1",
          linkTtlSeconds: 900,
          maxDownloads: null,
          requireAuth: false,
          allowedDomains: ["partner.example.com", "*.other.io"],
          allowedIpRanges: [],
        },
      }),
    );
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(
      "frame-ancestors https://partner.example.com https://*.other.io",
    );
    expect(res.headers.get("x-frame-options")).toBeNull();
  });

  it("HTML body contains OpenGraph meta tags", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    const res = await GET(req(), { params: params(TOKEN) });
    const body = await res.text();
    expect(body).toContain('<meta property="og:title" content="Spec.pdf">');
    expect(body).toContain('<meta property="og:type" content="article">');
    expect(body).toContain(
      `<meta property="og:url" content="http://localhost:3000/l/${TOKEN}">`,
    );
    expect(body).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("PDF content-type → <iframe> embed element", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).toContain("<iframe");
    expect(body).not.toContain("<img");
  });

  it("image/* content-type → <img> embed element", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        document: {
          id: "d-2",
          filename: "photo.png",
          contentType: "image/png",
          bucketName: "alpha-bucket",
          s3Key: "shared/photo.png",
        },
      }),
    );
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).toContain("<img");
    expect(body).not.toContain("<iframe");
  });

  it("HTML-escapes the filename in OG tags and title (XSS guard)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        document: {
          id: "d-3",
          filename: '"><script>alert(1)</script>.pdf',
          contentType: "application/pdf",
          bucketName: "alpha-bucket",
          s3Key: "shared/evil.pdf",
        },
      }),
    );
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("HTML-escapes the presigned URL so & does not break the iframe src", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    // Unescaped `&X-Amz-Expires` would let the browser interpret `&X`
    // as an entity start. The attribute must contain `&amp;`.
    expect(body).toContain("&amp;X-Amz-Expires=900");
    expect(body).not.toContain("?X-Amz-Signature=abc&X-Amz-Expires=900");
  });

  it("CSP frame-src + object-src restricted to the S3 origin of the presigned URL", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    const res = await GET(req(), { params: params(TOKEN) });
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(
      "frame-src 'self' https://alpha-bucket.s3.us-east-1.amazonaws.com",
    );
    expect(csp).toContain(
      "object-src https://alpha-bucket.s3.us-east-1.amazonaws.com",
    );
  });

  // ---- allowPublicEmbed=true: oEmbed discovery + CSP merge ----

  it("allowPublicEmbed=true → CSP frame-ancestors appends `https:` (any HTTPS parent permitted)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        link: {
          id: "link-2",
          documentId: "d-1",
          policyId: null,
          allowPublicEmbed: true,
        },
        effective: {
          source: "default",
          policyId: null,
          linkTtlSeconds: 900,
          maxDownloads: null,
          requireAuth: false,
          allowedDomains: [],
          allowedIpRanges: [],
        },
      }),
    );
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/frame-ancestors https:/);
    expect(csp).not.toMatch(/frame-ancestors 'none'/);
  });

  it("allowPublicEmbed=true with policy.allowedDomains → unions both sources", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        link: {
          id: "link-3",
          documentId: "d-1",
          policyId: "p-1",
          allowPublicEmbed: true,
        },
        effective: {
          source: "object",
          policyId: "p-1",
          linkTtlSeconds: 900,
          maxDownloads: null,
          requireAuth: false,
          allowedDomains: ["partner.example.com"],
          allowedIpRanges: [],
        },
      }),
    );
    const res = await GET(req(), { params: params(TOKEN) });
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(
      "frame-ancestors https://partner.example.com https:",
    );
  });

  it("allowPublicEmbed=true → emits oEmbed discovery <link rel=\"alternate\">", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        link: {
          id: "link-4",
          documentId: "d-1",
          policyId: null,
          allowPublicEmbed: true,
        },
      }),
    );
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).toContain('rel="alternate"');
    expect(body).toContain('type="application/json+oembed"');
    expect(body).toContain(`/api/oembed?url=`);
    expect(body).toContain(encodeURIComponent(`http://localhost:3000/l/${TOKEN}`));
  });

  it("allowPublicEmbed=false (default) → does NOT emit oEmbed discovery tag (regression guard)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).not.toContain('type="application/json+oembed"');
  });
});
