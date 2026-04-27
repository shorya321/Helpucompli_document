import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the prisma + rate limiter + audit boundary so the test exercises
// only the oEmbed handler's response shaping. Refusal paths and the
// successful JSON shape are verified independently of the DB / Redis.

const mocks = vi.hoisted(() => ({
  findLink: vi.fn(),
  auditCreate: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({ limit: mocks.limit }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    generatedLink: { findUnique: mocks.findLink },
    auditLog: { create: mocks.auditCreate },
  },
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => ({
    APP_BASE_URL: "https://docs.helpucompli.com",
    NODE_ENV: "production",
    AWS_REGION: "us-east-1",
    AUTH0_DOMAIN: "auth.helpucompli.com",
  }),
}));

import { GET } from "@/app/api/oembed/route";
import { NextRequest } from "next/server";

const TOKEN = "tok_abc_with_long_enough_token_value_xyz";
const SHARE_URL = `https://docs.helpucompli.com/l/${TOKEN}`;

const okQuota = { success: true, reset: Date.now() + 30_000 };

function future(): Date {
  return new Date(Date.now() + 3_600_000);
}

function linkRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "link-1",
    documentId: "d-1",
    presignedUrlHash: TOKEN,
    expiresAt: future(),
    downloadCount: 0,
    maxDownloads: null,
    isRevoked: false,
    policyId: null,
    allowPublicEmbed: true,
    document: {
      id: "d-1",
      filename: "Spec.pdf",
      contentType: "application/pdf",
      isDeleted: false,
    },
    policy: null,
    ...over,
  };
}

function req(url: string): NextRequest {
  return new NextRequest(url, {
    headers: { "user-agent": "WordPress/6.4 oEmbed proxy" },
  });
}

function oembedUrl(target: string, format = "json"): string {
  return `https://docs.helpucompli.com/api/oembed?url=${encodeURIComponent(target)}&format=${format}`;
}

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

beforeEach(() => {
  mocks.limit.mockResolvedValue(okQuota);
  mocks.auditCreate.mockResolvedValue({ id: "a-1" });
});

describe("GET /api/oembed", () => {
  it("400 when url query param missing", async () => {
    const res = await GET(req("https://docs.helpucompli.com/api/oembed"));
    expect(res.status).toBe(400);
  });

  it("400 when url is not on the configured APP_BASE_URL origin", async () => {
    const res = await GET(req(oembedUrl("https://evil.example.com/l/abc123")));
    expect(res.status).toBe(400);
  });

  it("400 when url path is not /l/<token>", async () => {
    const res = await GET(req(oembedUrl("https://docs.helpucompli.com/dashboard")));
    expect(res.status).toBe(400);
  });

  it("400 when format is XML (only JSON supported)", async () => {
    const res = await GET(req(oembedUrl(SHARE_URL, "xml")));
    // Per oEmbed spec, providers MAY 501 for unsupported formats.
    expect([400, 501]).toContain(res.status);
  });

  it("404 when token not found", async () => {
    mocks.findLink.mockResolvedValueOnce(null);
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(404);
  });

  it("404 when allowPublicEmbed=false AND no policy (no embed signal at all)", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow({ allowPublicEmbed: false }));
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(404);
  });

  it("404 when allowPublicEmbed=false AND policy.allowedDomains is empty", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        allowPublicEmbed: false,
        policy: { requireAuth: false, allowedDomains: [] },
      }),
    );
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(404);
  });

  it("200 when allowPublicEmbed=false BUT policy.allowedDomains is non-empty (domain-restricted embed)", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        allowPublicEmbed: false,
        policy: { requireAuth: false, allowedDomains: ["embed.test.com"] },
      }),
    );
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.html).toMatch(/<iframe /);
    expect(body.html).toContain(`src="${SHARE_URL}"`);
  });

  it("404 when allowPublicEmbed=false + allowedDomains non-empty BUT requireAuth=true (auth wins)", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        allowPublicEmbed: false,
        policy: { requireAuth: true, allowedDomains: ["embed.test.com"] },
      }),
    );
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(404);
  });

  it("404 when link is revoked", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow({ isRevoked: true }));
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(404);
  });

  it("404 when link is expired", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({ expiresAt: new Date(Date.now() - 60_000) }),
    );
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(404);
  });

  it("404 when document is soft-deleted", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        document: {
          id: "d-1",
          filename: "Spec.pdf",
          contentType: "application/pdf",
          isDeleted: true,
        },
      }),
    );
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(404);
  });

  it("404 when policy.requireAuth is true (auth wins over public embed flag)", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        allowPublicEmbed: true,
        policy: { requireAuth: true },
      }),
    );
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(404);
  });

  it("429 with Retry-After when rate-limited", async () => {
    mocks.limit.mockResolvedValueOnce({
      success: false,
      reset: Date.now() + 5_000,
    });
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("200 rich response for application/pdf", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow());
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe("rich");
    expect(body.version).toBe("1.0");
    expect(body.provider_name).toBe("HelpUcompli Documents");
    expect(body.title).toBe("Spec.pdf");
    expect(body.html).toMatch(/<iframe /);
    expect(body.html).toContain(`src="${SHARE_URL}"`);
    expect(body.cache_age).toBe(300);
  });

  it("200 rich response (iframe) for image/png — viewer keeps the presigned URL fresh", async () => {
    // oEmbed photo.url MUST be raw image bytes per spec; our viewer
    // returns text/html, so WP rendered a broken-image icon when this
    // returned `photo`. Iframe path delegates rendering to the viewer
    // page, which emits <img src=presigned> with rotation handled per
    // request. Regression guard against future "type: photo" changes.
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        document: {
          id: "d-1",
          filename: "photo.png",
          contentType: "image/png",
          isDeleted: false,
        },
      }),
    );
    const res = await GET(req(oembedUrl(SHARE_URL)));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe("rich");
    expect(body.html).toMatch(/<iframe /);
    expect(body.html).toContain(`src="${SHARE_URL}"`);
  });

  it("200 video response for video/mp4 returns iframe HTML", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        document: {
          id: "d-1",
          filename: "demo.mp4",
          contentType: "video/mp4",
          isDeleted: false,
        },
      }),
    );
    const res = await GET(req(oembedUrl(SHARE_URL)));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe("video");
    expect(body.html).toMatch(/<iframe /);
  });

  it("200 rich response (iframe) for audio/mpeg — audio embeds inline instead of degrading to a card", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        document: {
          id: "d-1",
          filename: "song.mp3",
          contentType: "audio/mpeg",
          isDeleted: false,
        },
      }),
    );
    const res = await GET(req(oembedUrl(SHARE_URL)));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe("rich");
    expect(body.html).toMatch(/<iframe /);
    expect(body.html).toContain(`src="${SHARE_URL}"`);
  });

  it("200 rich response (iframe) for empty/unknown contentType — never silently degrades to a link card", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        document: {
          id: "d-1",
          filename: "binary.dat",
          contentType: null,
          isDeleted: false,
        },
      }),
    );
    const res = await GET(req(oembedUrl(SHARE_URL)));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe("rich");
    expect(body.html).toMatch(/<iframe /);
  });

  it("clamps maxwidth/maxheight to safe bounds", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow());
    const url = `${oembedUrl(SHARE_URL)}&maxwidth=99999&maxheight=10`;
    const body = (await (await GET(req(url))).json()) as Record<string, unknown>;
    expect(body.width).toBe(4096);
    expect(body.height).toBe(200);
  });

  it("HTML-escapes the title in iframe attribute (XSS guard)", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        document: {
          id: "d-1",
          filename: '"><script>alert(1)</script>.pdf',
          contentType: "application/pdf",
          isDeleted: false,
        },
      }),
    );
    const body = (await (await GET(req(oembedUrl(SHARE_URL)))).json()) as Record<
      string,
      unknown
    >;
    const html = body.html as string;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toMatch(/title="[^"]*&lt;script&gt;/);
  });

  it("emits Cache-Control public + s-maxage so platform proxies can cache", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow());
    const res = await GET(req(oembedUrl(SHARE_URL)));
    const cc = res.headers.get("cache-control") ?? "";
    expect(cc).toContain("public");
    expect(cc).toContain("s-maxage=300");
  });

  it("audits LINK_OEMBED_FETCHED on success (best-effort, never blocks)", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow());
    await GET(req(oembedUrl(SHARE_URL)));
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    const data = mocks.auditCreate.mock.calls[0]?.[0]?.data as Record<
      string,
      unknown
    >;
    expect(data.action).toBe("LINK_OEMBED_FETCHED");
    expect(data.targetType).toBe("link");
  });

  it("does NOT 5xx when audit write fails (best-effort)", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow());
    mocks.auditCreate.mockRejectedValueOnce(new Error("DB down"));
    const res = await GET(req(oembedUrl(SHARE_URL)));
    expect(res.status).toBe(200);
  });
});
