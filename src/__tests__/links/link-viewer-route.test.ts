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

// Pin the raw-fetch token to a deterministic value so URL assertions
// stay stable across test runs. The mock intentionally returns the
// SAME literal for both kinds so existing URL assertions keep working;
// kind-discrimination tests use `issueRawFetchTokenSpy` below.
const issueRawFetchTokenSpy =
  vi.fn<
    (hash: string, ttl: number, kind: "sub-fetch" | "external-embed") => string
  >();
issueRawFetchTokenSpy.mockReturnValue("FIXED.TOKEN");
vi.mock("@/lib/raw-fetch-token", () => ({
  issueRawFetchToken: (
    hash: string,
    ttl: number,
    kind: "sub-fetch" | "external-embed",
  ) => issueRawFetchTokenSpy(hash, ttl, kind),
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    APP_BASE_URL: "http://localhost:3000",
    NODE_ENV: "test",
    AWS_REGION: "us-east-1",
    AUTH0_DOMAIN: "auth.helpucompli.com",
  }),
}));

const TOK_QUERY = "t=FIXED.TOKEN";

import { GET } from "@/app/l/[hash]/route";
import { NextRequest } from "next/server";

const TOKEN = "tok_abc_with_long_enough_token_value_xyz";

afterEach(() => {
  mocks.resolveAndAuthorizeLink.mockReset();
  issueRawFetchTokenSpy.mockClear();
});

beforeEach(() => {
  mocks.resolveAndAuthorizeLink.mockReset();
  issueRawFetchTokenSpy.mockClear();
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

  it("non-embeddable PDF link does NOT emit og:image (head byte-identical to prior behavior)", async () => {
    // Regression guard: og:image must be additive and gated on
    // image MIME + allowPublicEmbed=true. Non-image docs and non-
    // embeddable links must emit the same <head> as before.
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).not.toContain("og:image");
    expect(body).not.toContain("twitter:image");
  });

  it("non-embeddable image link does NOT emit og:image (allowPublicEmbed=false wins)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        link: {
          id: "link-1",
          documentId: "d-2",
          policyId: "p-1",
          allowPublicEmbed: false,
        },
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
    expect(body).not.toContain("og:image");
    expect(body).not.toContain("twitter:image");
  });

  it("embeddable image link emits og:image + og:image:type + twitter:image pointing at /raw with HMAC token", async () => {
    // Iframely-backed surfaces (Circle.so, Notion image-embed) read
    // og:image first for unknown domains; without it they reject the
    // URL with "embed a different image" even when oEmbed type:photo
    // is correct. The URL must serve raw image bytes, which /l/<hash>
    // /raw does (Content-Type from document MIME). The HMAC token
    // lets the policy engine accept server-side crawler fetches.
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        link: {
          id: "link-1",
          documentId: "d-2",
          policyId: "p-1",
          allowPublicEmbed: true,
        },
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
    const expectedOgImage = `http://localhost:3000/l/${TOKEN}/raw?t=FIXED.TOKEN`;
    expect(body).toContain(
      `<meta property="og:image" content="${expectedOgImage}">`,
    );
    expect(body).toContain(
      '<meta property="og:image:type" content="image/png">',
    );
    expect(body).toContain(
      `<meta name="twitter:image" content="${expectedOgImage}">`,
    );
  });

  it("embeddable image link emits og:image:type=image/jpeg for JPEG documents", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        link: {
          id: "link-1",
          documentId: "d-3",
          policyId: "p-1",
          allowPublicEmbed: true,
        },
        document: {
          id: "d-3",
          filename: "scan.jpg",
          contentType: "image/jpeg",
          bucketName: "alpha-bucket",
          s3Key: "shared/scan.jpg",
        },
      }),
    );
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).toContain(
      '<meta property="og:image:type" content="image/jpeg">',
    );
  });

  it("embeddable PDF link does NOT emit og:image (image-only gate)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        link: {
          id: "link-1",
          documentId: "d-1",
          policyId: "p-1",
          allowPublicEmbed: true,
        },
      }),
    );
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).not.toContain("og:image");
    expect(body).not.toContain("twitter:image");
  });

  it("PDF content-type → <iframe> pointing at same-origin /pdfjs/viewer.html with file=/l/<hash>/raw", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).toContain("<iframe");
    expect(body).not.toContain("<img");
    // PDFs use the canvas-rendering PDF.js viewer to bypass Chrome's
    // built-in PDF-in-cross-origin-iframe block.
    // `&` is HTML-escaped to `&amp;` in the attribute value.
    const expectedSrc = `/pdfjs/viewer.html?file=${encodeURIComponent(`/l/${TOKEN}/raw`)}&amp;${TOK_QUERY}`;
    expect(body).toContain(`src="${expectedSrc}"`);
    // Negative guard: PDF must NOT iframe /raw directly anymore — that
    // hits Chrome's nested-iframe PDF block.
    expect(body).not.toContain(`<iframe src="/l/${TOKEN}/raw"`);
  });

  it("HTML content-type → <iframe> pointing at /l/<hash>/raw directly (no PDF.js detour)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        document: {
          id: "d-h",
          filename: "page.html",
          contentType: "text/html",
          bucketName: "alpha-bucket",
          s3Key: "shared/page.html",
        },
      }),
    );
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).toContain(`<iframe src="/l/${TOKEN}/raw?${TOK_QUERY}"`);
    expect(body).not.toContain("/pdfjs/");
  });

  it("text/plain content-type → <iframe> pointing at /l/<hash>/raw directly", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        document: {
          id: "d-t",
          filename: "notes.txt",
          contentType: "text/plain",
          bucketName: "alpha-bucket",
          s3Key: "shared/notes.txt",
        },
      }),
    );
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).toContain(`<iframe src="/l/${TOKEN}/raw?${TOK_QUERY}"`);
    expect(body).not.toContain("/pdfjs/");
  });

  it("image/* content-type → <img> embed element pointing at same-origin /l/<hash>/raw", async () => {
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
    expect(body).toContain(`src="/l/${TOKEN}/raw?${TOK_QUERY}"`);
  });

  it("video/* content-type → <video> embed pointing at same-origin /l/<hash>/raw", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        document: {
          id: "d-v",
          filename: "clip.mp4",
          contentType: "video/mp4",
          bucketName: "alpha-bucket",
          s3Key: "shared/clip.mp4",
        },
      }),
    );
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).toContain("<video");
    expect(body).toContain(`src="/l/${TOKEN}/raw?${TOK_QUERY}"`);
  });

  it("audio/* content-type → <audio> embed pointing at same-origin /l/<hash>/raw", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        document: {
          id: "d-a",
          filename: "song.mp3",
          contentType: "audio/mpeg",
          bucketName: "alpha-bucket",
          s3Key: "shared/song.mp3",
        },
      }),
    );
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).toContain("<audio");
    expect(body).toContain(`src="/l/${TOKEN}/raw?${TOK_QUERY}"`);
  });

  it("never leaks the presigned S3 URL into the rendered HTML body (proxy keeps it server-side)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).not.toContain("s3.us-east-1.amazonaws.com");
    expect(body).not.toContain("X-Amz-Signature");
    expect(body).not.toContain("X-Amz-Expires");
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

  it("CSP fetch directives are tightened to 'self' (no S3 origin needed — proxy is same-origin)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    const res = await GET(req(), { params: params(TOKEN) });
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("media-src 'self'");
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("object-src 'self'");
    // Defense in depth: no S3 origin should appear in the CSP at all.
    expect(csp).not.toContain("amazonaws.com");
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

  it("allowPublicEmbed=true with policy.allowedDomains → emits ONLY those hosts (admin's narrowing intent honored, no `https:` widening)", async () => {
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
    expect(csp).toContain("frame-ancestors https://partner.example.com");
    // Critical regression guard: previous shipped behavior appended
    // `https:` which silently widened the admin's allowlist to any
    // HTTPS site. The narrowing intent must stay narrow.
    expect(csp).not.toContain("https://partner.example.com https:");
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

  it("allowPublicEmbed=false AND empty allowedDomains → does NOT emit oEmbed discovery tag (regression guard)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    const body = await (await GET(req(), { params: params(TOKEN) })).text();
    expect(body).not.toContain('type="application/json+oembed"');
  });

  // ---- raw-fetch token kind plumbing ----
  //
  // Inline sub-resource URLs (img/video/audio/iframe/pdfjs) MUST mint
  // sub-fetch tokens — the outer page already passed publicEmbed
  // refinement, so /raw can safely skip refinement on the sub-fetch.
  // og:image URLs MUST mint external-embed tokens — they leave the
  // origin via Iframely / Notion / Slack, where browser referer was
  // never validated, so /raw must keep refinement on.

  it("inline sub-resource URLs use a sub-fetch kind raw-fetch token", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        document: {
          id: "d-i",
          filename: "photo.png",
          contentType: "image/png",
          bucketName: "alpha-bucket",
          s3Key: "shared/photo.png",
        },
      }),
    );
    await GET(req(), { params: params(TOKEN) });
    // Non-image, non-embeddable cases mint exactly one token (sub-fetch).
    expect(issueRawFetchTokenSpy).toHaveBeenCalledWith(
      TOKEN,
      expect.any(Number),
      "sub-fetch",
    );
    // No og:image emitted on a non-embeddable image link, so no
    // external-embed token should be minted.
    const kinds = issueRawFetchTokenSpy.mock.calls.map(([, , kind]) => kind);
    expect(kinds).not.toContain("external-embed");
  });

  it("embeddable image link mints both kinds: sub-fetch (inline) + external-embed (og:image)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        link: {
          id: "link-1",
          documentId: "d-2",
          policyId: "p-1",
          allowPublicEmbed: true,
        },
        document: {
          id: "d-2",
          filename: "photo.png",
          contentType: "image/png",
          bucketName: "alpha-bucket",
          s3Key: "shared/photo.png",
        },
      }),
    );
    await GET(req(), { params: params(TOKEN) });
    const kinds = issueRawFetchTokenSpy.mock.calls.map(([, , kind]) => kind);
    expect(kinds).toContain("sub-fetch");
    expect(kinds).toContain("external-embed");
  });

  it("allowPublicEmbed=false + policy.allowedDomains non-empty → does NOT emit oEmbed discovery tag (F9.3 regression — domain restriction gates access, embedding requires the explicit toggle)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        link: {
          id: "link-5",
          documentId: "d-1",
          policyId: "p-1",
          allowPublicEmbed: false,
        },
        effective: {
          source: "object",
          policyId: "p-1",
          linkTtlSeconds: 900,
          maxDownloads: null,
          requireAuth: false,
          allowedDomains: ["embed.test.com"],
          allowedIpRanges: [],
        },
      }),
    );
    const res = await GET(req(), { params: params(TOKEN) });
    const body = await res.text();
    expect(body).not.toContain('type="application/json+oembed"');
    // Frame-ancestors still narrows to the listed host so the browser
    // refuses any iframe attempt — defense in depth even with no
    // discovery tag.
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors https://embed.test.com");
  });
});
