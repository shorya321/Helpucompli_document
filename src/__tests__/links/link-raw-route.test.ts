import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the shared authorize helper so these tests exercise only the
// proxy/streaming layer of /l/[hash]/raw/route.ts. Helper unit tests
// live in link-access-route.test.ts + link-access.test.ts.
const mocks = vi.hoisted(() => ({
  resolveAndAuthorizeLink: vi.fn(),
  verifyRawFetchToken: vi.fn(),
}));

vi.mock("@/lib/link-access", () => ({
  resolveAndAuthorizeLink: mocks.resolveAndAuthorizeLink,
}));

vi.mock("@/lib/raw-fetch-token", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/raw-fetch-token")>(
      "@/lib/raw-fetch-token",
    );
  return {
    ...actual,
    verifyRawFetchToken: mocks.verifyRawFetchToken,
  };
});

import { GET } from "@/app/l/[hash]/raw/route";
import { InvalidRawFetchTokenError } from "@/lib/raw-fetch-token";
import { NextRequest } from "next/server";

const TOKEN = "tok_abc_with_long_enough_token_value_xyz";
const PRESIGNED =
  "https://alpha-bucket.s3.us-east-1.amazonaws.com/shared/file.pdf?X-Amz-Signature=abc&X-Amz-Expires=900";

let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

afterEach(() => {
  mocks.resolveAndAuthorizeLink.mockReset();
  mocks.verifyRawFetchToken.mockReset();
  if (fetchSpy) {
    fetchSpy.mockRestore();
    fetchSpy = null;
  }
});

beforeEach(() => {
  mocks.resolveAndAuthorizeLink.mockReset();
  mocks.verifyRawFetchToken.mockReset();
});

function req(init?: {
  headers?: Record<string, string>;
  query?: string;
}): NextRequest {
  const headers = new Headers(init?.headers);
  const url = `http://x/l/${TOKEN}/raw${init?.query ? `?${init.query}` : ""}`;
  return new NextRequest(url, { headers });
}

function params(hash: string): Promise<{ hash: string }> {
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
    presignedUrl: PRESIGNED,
    ...over,
  };
}

function fakeS3Response(opts: {
  status?: number;
  body?: BodyInit | null;
  headers?: Record<string, string>;
}): Response {
  return new Response(opts.body ?? "fake bytes", {
    status: opts.status ?? 200,
    headers: opts.headers ?? {},
  });
}

describe("GET /l/[hash]/raw — same-origin streaming proxy", () => {
  it("403 when authorize helper returns forbidden, and upstream S3 is never called", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce({ kind: "forbidden" });
    fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.headers.get("cache-control")).toBe(
      "private, no-store, no-cache, max-age=0, must-revalidate",
    );
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.headers.get("expires")).toBe("0");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("429 + Retry-After when authorize helper returns rateLimited", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce({
      kind: "rateLimited",
      retryAfterSec: 17,
    });
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("200 streams S3 body with Content-Type from the document and inline Content-Disposition", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        fakeS3Response({
          status: 200,
          body: "PDFBYTES",
          headers: { "content-length": "8" },
        }),
      );
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="Spec.pdf"',
    );
    expect(res.headers.get("cache-control")).toBe(
      "private, no-store, no-cache, max-age=0, must-revalidate",
    );
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.headers.get("expires")).toBe("0");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("content-length")).toBe("8");
    const text = await res.text();
    expect(text).toBe("PDFBYTES");
  });

  it("does NOT forward etag or last-modified from S3 (prevents external CDN conditional revalidation past expiry)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      fakeS3Response({
        status: 200,
        body: "x",
        headers: {
          etag: '"deadbeef"',
          "last-modified": "Wed, 01 Jan 2025 00:00:00 GMT",
          "content-length": "1",
        },
      }),
    );
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("last-modified")).toBeNull();
    // Content-Length still passes through (needed for inline rendering).
    expect(res.headers.get("content-length")).toBe("1");
  });

  it("forwards the Range header upstream and proxies a 206 + Content-Range response", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        fakeS3Response({
          status: 206,
          body: "chunk",
          headers: {
            "content-range": "bytes 0-1023/4096",
            "content-length": "1024",
            "accept-ranges": "bytes",
          },
        }),
      );
    const res = await GET(req({ headers: { range: "bytes=0-1023" } }), {
      params: params(TOKEN),
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-1023/4096");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    // Verify the Range header was forwarded to S3.
    expect(fetchSpy).toHaveBeenCalledWith(
      PRESIGNED,
      expect.objectContaining({
        headers: expect.objectContaining({ Range: "bytes=0-1023" }),
      }),
    );
  });

  it("falls back to application/octet-stream when document has no contentType", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        document: {
          id: "d-x",
          filename: "blob.bin",
          contentType: null,
          bucketName: "alpha-bucket",
          s3Key: "shared/blob.bin",
        },
      }),
    );
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 200, body: "x" }));
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("encodes unicode filenames via RFC 5987 (ascii fallback + filename*=UTF-8'')", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        document: {
          id: "d-u",
          filename: "日本語ファイル.pdf",
          contentType: "application/pdf",
          bucketName: "alpha-bucket",
          s3Key: "shared/jp.pdf",
        },
      }),
    );
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 200, body: "x" }));
    const res = await GET(req(), { params: params(TOKEN) });
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toMatch(/^inline;/);
    // ASCII fallback: every non-printable-ASCII glyph collapsed to _.
    expect(cd).toContain('filename="_______.pdf"');
    // RFC 5987 encoded form preserves the unicode bytes.
    expect(cd).toContain(
      `filename*=UTF-8''${encodeURIComponent("日本語ファイル.pdf")}`,
    );
  });

  it("strips quote and backslash from the ASCII fallback filename", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(
      okResult({
        document: {
          id: "d-q",
          filename: 'a"b\\c.pdf',
          contentType: "application/pdf",
          bucketName: "alpha-bucket",
          s3Key: "shared/q.pdf",
        },
      }),
    );
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 200, body: "x" }));
    const res = await GET(req(), { params: params(TOKEN) });
    const cd = res.headers.get("content-disposition") ?? "";
    expect(cd).toContain('filename="a_b_c.pdf"');
  });

  it("does not call fetch with credentials and never leaks the presigned URL into response headers", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 200, body: "x" }));
    const res = await GET(req(), { params: params(TOKEN) });
    for (const [, value] of res.headers.entries()) {
      expect(value).not.toContain("X-Amz-Signature");
      expect(value).not.toContain("amazonaws.com");
    }
  });

  it("translates upstream S3 4xx (presign expired/object missing) into a 403", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 403, body: "AccessDenied" }));
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.status).toBe(403);
  });

  it("returns 502 when fetch to S3 throws (network blip)", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network down"));
    const res = await GET(req(), { params: params(TOKEN) });
    expect(res.status).toBe(502);
  });

  it("does not forward Range when the request omits it", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 200, body: "x" }));
    await GET(req(), { params: params(TOKEN) });
    const callArgs = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (callArgs?.headers ?? {}) as Record<string, string>;
    expect(headers["Range"]).toBeUndefined();
  });

  // ---- raw-fetch-token: kind discriminator (raw-fetch-token.ts) ----
  //
  // sub-fetch  → bypassRefererRefinement=true  (inline 120s token from /l/<hash> outer page)
  // external-embed → bypassRefererRefinement=false (long-lived og:image / oEmbed photo / share-info image URL)
  //                  external embed tokens MUST run normal refinement so a copied image URL
  //                  from an `allowedDomains`-pinned link is denied on unlisted browser hosts.

  it("forwards bypassRefererRefinement=true to authorize helper when ?t= is a sub-fetch kind", async () => {
    mocks.verifyRawFetchToken.mockReturnValueOnce({ kind: "sub-fetch" });
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 200, body: "x" }));
    const res = await GET(req({ query: "t=valid.token" }), {
      params: params(TOKEN),
    });
    expect(res.status).toBe(200);
    expect(mocks.verifyRawFetchToken).toHaveBeenCalledWith("valid.token", TOKEN);
    expect(mocks.resolveAndAuthorizeLink).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      {
        bypassRefererRefinement: true,
        tokenKind: "sub-fetch",
        isSubResource: true,
      },
    );
  });

  it("forwards bypassRefererRefinement=FALSE when ?t= is an external-embed kind (refinement still enforced)", async () => {
    // Bug fix: og:image / oEmbed photo / share-info image URL tokens
    // are 7-day externally-pasted URLs whose browser referer was never
    // validated. They must NOT downgrade refinement.
    mocks.verifyRawFetchToken.mockReturnValueOnce({ kind: "external-embed" });
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 200, body: "x" }));
    const res = await GET(req({ query: "t=valid.embed.token" }), {
      params: params(TOKEN),
    });
    expect(res.status).toBe(200);
    expect(mocks.resolveAndAuthorizeLink).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      {
        bypassRefererRefinement: false,
        tokenKind: "external-embed",
        isSubResource: true,
      },
    );
  });

  it("returns 403 when authorize denies an external-embed token (e.g. browser on unlisted referer)", async () => {
    // Drives home the user-visible bug-fix outcome: same image URL,
    // pasted on `circle.so` page (NOT in policy.allowedDomains), gets
    // 403 because refinement is still enforced for external-embed kind.
    mocks.verifyRawFetchToken.mockReturnValueOnce({ kind: "external-embed" });
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce({ kind: "forbidden" });
    const res = await GET(
      req({
        query: "t=valid.embed.token",
        headers: {
          referer: "https://circle.so/some/page",
          "sec-fetch-dest": "image",
        },
      }),
      { params: params(TOKEN) },
    );
    expect(res.status).toBe(403);
    expect(mocks.resolveAndAuthorizeLink).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      {
        bypassRefererRefinement: false,
        tokenKind: "external-embed",
        isSubResource: true,
      },
    );
  });

  // ---- raw-fetch-token: external-embed media-sub-resource carve-out ----
  //
  // Cross-platform embed proxies (Iframely / Embedly / Compass video
  // player) inline a bare <video> / <audio> at our og:video / og:audio
  // URL. The browser fetches /raw with `Sec-Fetch-Dest=video|audio` and
  // a Referer that points at the proxy host (cdn.iframe.ly), not the
  // user-facing parent admins listed in policy.allowedDomains — so the
  // policy engine refinement gate would deny the play. The HMAC token
  // is hash-bound + 7-day TTL + revocable via link revoke / expiresAt
  // so we treat it as the authoritative gate for these media sub-
  // resources and skip refinement just like a sub-fetch token would.
  // Sec-Fetch-Dest=image keeps strict refinement (F9.10 / 7e84fb7) —
  // bare <img> embeds preserve Referer, so the F9.10 strict check is
  // reliable.

  it("forwards bypassRefererRefinement=true when external-embed + Sec-Fetch-Dest=video (Compass/Iframely video carve-out)", async () => {
    mocks.verifyRawFetchToken.mockReturnValueOnce({ kind: "external-embed" });
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 200, body: "x" }));
    const res = await GET(
      req({
        query: "t=valid.embed.token",
        headers: {
          referer: "https://cdn.iframe.ly/api/iframe?u=...",
          "sec-fetch-dest": "video",
          "sec-fetch-site": "cross-site",
        },
      }),
      { params: params(TOKEN) },
    );
    expect(res.status).toBe(200);
    expect(mocks.resolveAndAuthorizeLink).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      {
        bypassRefererRefinement: true,
        tokenKind: "external-embed",
        isSubResource: true,
      },
    );
  });

  it("forwards bypassRefererRefinement=true when external-embed + Sec-Fetch-Dest=audio", async () => {
    mocks.verifyRawFetchToken.mockReturnValueOnce({ kind: "external-embed" });
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 200, body: "x" }));
    const res = await GET(
      req({
        query: "t=valid.embed.token",
        headers: {
          referer: "https://cdn.iframe.ly/api/iframe?u=...",
          "sec-fetch-dest": "audio",
          "sec-fetch-site": "cross-site",
        },
      }),
      { params: params(TOKEN) },
    );
    expect(res.status).toBe(200);
    expect(mocks.resolveAndAuthorizeLink).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      {
        bypassRefererRefinement: true,
        tokenKind: "external-embed",
        isSubResource: true,
      },
    );
  });

  it("keeps bypassRefererRefinement=FALSE when external-embed + Sec-Fetch-Dest=image (image refinement preserved per F9.10 / 7e84fb7)", async () => {
    // Bare <img> embeds (oEmbed type:photo URL inlined on the platform
    // page) preserve Referer end-to-end, so strict refinement remains
    // the right gate for images. Regression guard.
    mocks.verifyRawFetchToken.mockReturnValueOnce({ kind: "external-embed" });
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 200, body: "x" }));
    await GET(
      req({
        query: "t=valid.embed.token",
        headers: {
          referer: "https://app.circle.so/post",
          "sec-fetch-dest": "image",
          "sec-fetch-site": "cross-site",
        },
      }),
      { params: params(TOKEN) },
    );
    expect(mocks.resolveAndAuthorizeLink).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      {
        bypassRefererRefinement: false,
        tokenKind: "external-embed",
        isSubResource: true,
      },
    );
  });

  it("forwards bypassRefererRefinement=false + tokenKind=null when ?t= is malformed/expired/wrong-hash (silent fall-through)", async () => {
    mocks.verifyRawFetchToken.mockImplementationOnce(() => {
      throw new InvalidRawFetchTokenError("expired");
    });
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce({ kind: "forbidden" });
    const res = await GET(req({ query: "t=tampered.bad" }), {
      params: params(TOKEN),
    });
    expect(res.status).toBe(403);
    expect(mocks.resolveAndAuthorizeLink).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      {
        bypassRefererRefinement: false,
        tokenKind: null,
        isSubResource: true,
      },
    );
  });

  it("forwards bypassRefererRefinement=false + tokenKind=null when ?t= is omitted entirely", async () => {
    mocks.resolveAndAuthorizeLink.mockResolvedValueOnce(okResult());
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeS3Response({ status: 200, body: "x" }));
    await GET(req(), { params: params(TOKEN) });
    expect(mocks.verifyRawFetchToken).not.toHaveBeenCalled();
    expect(mocks.resolveAndAuthorizeLink).toHaveBeenCalledWith(
      expect.anything(),
      TOKEN,
      {
        bypassRefererRefinement: false,
        tokenKind: null,
        isSubResource: true,
      },
    );
  });
});
