import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveHasRole: vi.fn(),
  resolveRole: vi.fn(),
  ensureUser: vi.fn(),
  findLink: vi.fn(),
  auditCreate: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({
  resolveHasRole: mocks.resolveHasRole,
  resolveRole: mocks.resolveRole,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    generatedLink: { findUnique: mocks.findLink },
    auditLog: { create: mocks.auditCreate },
  },
}));
vi.mock("@/lib/ensure-user", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({ limit: mocks.limit }),
}));

import { GET } from "@/app/api/links/admin/[id]/share-info/route";
import { NextRequest } from "next/server";

const ok = { success: true, reset: Date.now() + 30_000 };
const adminSession = () => ({ user: { sub: "auth0|a" } });
const params = (id: string) => Promise.resolve({ id });
const ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "abc123TokenValueDefghiJklmnoPqrsTuvwxyz0-_";
const ORIGIN = "https://docs.example.com";
// shareableUrl derives from APP_BASE_URL (stubbed in vitest.setup.ts),
// not from the request origin — that was the 0.0.0.0:3000 prod bug.
const APP_BASE = "http://localhost:3000";

function req(origin = ORIGIN) {
  return new NextRequest(`${origin}/api/links/admin/${ID}/share-info`, {
    method: "GET",
  });
}

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

beforeEach(() => {
  mocks.limit.mockResolvedValue(ok);
  mocks.auditCreate.mockResolvedValue({ id: "a-1" });
});

describe("GET /api/links/admin/[id]/share-info", () => {
  it("401 unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(req(), { params: params(ID) });
    expect(res.status).toBe(401);
  });

  it("403 non-admin", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await GET(req(), { params: params(ID) });
    expect(res.status).toBe(403);
    expect(mocks.findLink).not.toHaveBeenCalled();
  });

  it("400 malformed id", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    const res = await GET(req(), { params: params("not-uuid") });
    expect(res.status).toBe(400);
  });

  it("429 rate-limited", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce({
      success: false,
      reset: Date.now() + 10_000,
    });
    const res = await GET(req(), { params: params(ID) });
    expect(res.status).toBe(429);
  });

  it("404 when link missing", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce(null);
    const res = await GET(req(), { params: params(ID) });
    expect(res.status).toBe(404);
  });

  it("410 when link revoked", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: new Date(Date.now() + 60_000),
      isRevoked: true,
      downloadCount: 0,
      maxDownloads: null,
    });
    const res = await GET(req(), { params: params(ID) });
    expect(res.status).toBe(410);
  });

  it("410 when link expired", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: new Date(Date.now() - 60_000),
      isRevoked: false,
      downloadCount: 0,
      maxDownloads: null,
    });
    const res = await GET(req(), { params: params(ID) });
    expect(res.status).toBe(410);
  });

  it("410 when download cap hit", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: new Date(Date.now() + 60_000),
      isRevoked: false,
      downloadCount: 5,
      maxDownloads: 5,
    });
    const res = await GET(req(), { params: params(ID) });
    expect(res.status).toBe(410);
  });

  it("200 returns token, shareableUrl, embedCode, expiresAt", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    const future = new Date(Date.now() + 3_600_000);
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: future,
      isRevoked: false,
      downloadCount: 0,
      maxDownloads: null,
    });
    const res = await GET(req(), { params: params(ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        token: string;
        shareableUrl: string;
        embedCode: string;
        expiresAt: string | null;
      } | null;
    };
    expect(body.data?.token).toBe(TOKEN);
    expect(body.data?.shareableUrl).toBe(`${APP_BASE}/l/${TOKEN}`);
    expect(body.data?.embedCode).toContain("<iframe");
    expect(body.data?.embedCode).toContain(TOKEN);
    expect(body.data?.expiresAt).toBe(future.toISOString());
  });

  it("200 and expiresAt=null for never-expires link", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: null,
      isRevoked: false,
      downloadCount: 0,
      maxDownloads: null,
    });
    const res = await GET(req(), { params: params(ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { expiresAt: string | null } | null;
    };
    expect(body.data?.expiresAt).toBeNull();
  });

  it("embedImageUrl is null for non-image documents (PDF/text/etc)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: new Date(Date.now() + 60_000),
      isRevoked: false,
      downloadCount: 0,
      maxDownloads: null,
      allowPublicEmbed: true,
      document: { contentType: "application/pdf" },
    });
    const res = await GET(req(), { params: params(ID) });
    const body = (await res.json()) as {
      data: { embedImageUrl: string | null } | null;
    };
    expect(body.data?.embedImageUrl).toBeNull();
  });

  it("embedImageUrl is null for image docs WITHOUT allowPublicEmbed (gate must hold)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: new Date(Date.now() + 60_000),
      isRevoked: false,
      downloadCount: 0,
      maxDownloads: null,
      allowPublicEmbed: false,
      document: { contentType: "image/png" },
    });
    const res = await GET(req(), { params: params(ID) });
    const body = (await res.json()) as {
      data: { embedImageUrl: string | null } | null;
    };
    expect(body.data?.embedImageUrl).toBeNull();
  });

  it("embedImageUrl is populated for image docs WITH allowPublicEmbed (Circle.so / Notion image-embed compatible)", async () => {
    // Direct image-bytes URL — bypasses the og:image meta path that
    // Circle.so's image-embed slot does NOT consume. The token is
    // verifiable + bound to the link hash.
    const { verifyRawFetchToken } = await import("@/lib/raw-fetch-token");
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: new Date(Date.now() + 3_600_000),
      isRevoked: false,
      downloadCount: 0,
      maxDownloads: null,
      allowPublicEmbed: true,
      document: { contentType: "image/jpeg" },
    });
    const res = await GET(req(), { params: params(ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { embedImageUrl: string | null } | null;
    };
    const u = body.data?.embedImageUrl;
    expect(u).toMatch(
      new RegExp(
        `^${APP_BASE.replace(/\//g, "\\/").replace(/:/g, "\\:")}/l/${TOKEN}/raw\\?t=[A-Za-z0-9_%.-]+$`,
      ),
    );
    const t = new URL(u as string).searchParams.get("t");
    // External-embed kind — refinement still enforced on /raw so the
    // copied URL only renders inside iframes on policy.allowedDomains.
    expect(verifyRawFetchToken(t!, TOKEN)).toEqual({ kind: "external-embed" });
  });

  it("embedImageUrl token TTL is clamped to link's remaining lifetime (cannot outlive the link)", async () => {
    // Sec-review defense-in-depth: a leaked image URL must die when
    // the link expires. /raw revalidates expiry server-side too, but
    // the token TTL is the first gate.
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    const linkExpiresIn = 5 * 60; // 5 min
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: new Date(Date.now() + linkExpiresIn * 1000),
      isRevoked: false,
      downloadCount: 0,
      maxDownloads: null,
      allowPublicEmbed: true,
      document: { contentType: "image/png" },
    });
    const res = await GET(req(), { params: params(ID) });
    const body = (await res.json()) as {
      data: { embedImageUrl: string | null } | null;
    };
    const u = body.data?.embedImageUrl as string;
    const t = new URL(u).searchParams.get("t")!;
    // Decode payload to inspect exp claim. Token format:
    // base64url(json).base64url(hmac).
    const [payloadB64] = t.split(".");
    const pad = 4 - (payloadB64!.length % 4 || 4);
    const padded = payloadB64! + "=".repeat(pad === 4 ? 0 : pad);
    const json = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const claims = JSON.parse(json) as { exp: number; hash: string };
    const nowSec = Math.floor(Date.now() / 1000);
    expect(claims.exp).toBeGreaterThanOrEqual(nowSec);
    // exp must NOT exceed link expiry (allow tiny clock-skew slack).
    expect(claims.exp).toBeLessThanOrEqual(nowSec + linkExpiresIn + 2);
    expect(claims.hash).toBe(TOKEN);
  });

  it("embedVideoUrl is null for non-video documents (image/PDF/etc)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: new Date(Date.now() + 60_000),
      isRevoked: false,
      downloadCount: 0,
      maxDownloads: null,
      allowPublicEmbed: true,
      document: { contentType: "image/png" },
    });
    const res = await GET(req(), { params: params(ID) });
    const body = (await res.json()) as {
      data: { embedVideoUrl: string | null } | null;
    };
    expect(body.data?.embedVideoUrl).toBeNull();
  });

  it("embedVideoUrl is null for video docs WITHOUT allowPublicEmbed (gate must hold)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: new Date(Date.now() + 60_000),
      isRevoked: false,
      downloadCount: 0,
      maxDownloads: null,
      allowPublicEmbed: false,
      document: { contentType: "video/mp4" },
    });
    const res = await GET(req(), { params: params(ID) });
    const body = (await res.json()) as {
      data: { embedVideoUrl: string | null } | null;
    };
    expect(body.data?.embedVideoUrl).toBeNull();
  });

  it("embedVideoUrl is populated for video docs WITH allowPublicEmbed (Circle.so / Compass video-embed compatible)", async () => {
    // Direct video-bytes URL — Iframely renders this as HTML5 <video>
    // because /raw responds with Content-Type: video/mp4 (rel:"file").
    const { verifyRawFetchToken } = await import("@/lib/raw-fetch-token");
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: null,
      presignedUrlHash: TOKEN,
      expiresAt: new Date(Date.now() + 3_600_000),
      isRevoked: false,
      downloadCount: 0,
      maxDownloads: null,
      allowPublicEmbed: true,
      document: { contentType: "video/mp4" },
    });
    const res = await GET(req(), { params: params(ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { embedVideoUrl: string | null; embedImageUrl: string | null } | null;
    };
    const u = body.data?.embedVideoUrl;
    expect(u).toMatch(
      new RegExp(
        `^${APP_BASE.replace(/\//g, "\\/").replace(/:/g, "\\:")}/l/${TOKEN}/raw\\?t=[A-Za-z0-9_%.-]+$`,
      ),
    );
    // Image URL stays null for a video doc (mutually exclusive MIME gate).
    expect(body.data?.embedImageUrl).toBeNull();
    const t = new URL(u as string).searchParams.get("t");
    expect(verifyRawFetchToken(t!, TOKEN)).toEqual({ kind: "external-embed" });
  });

  it("writes LINK_SHARE_INFO_VIEW audit on success", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-9" });
    mocks.findLink.mockResolvedValueOnce({
      id: ID,
      documentId: "d-1",
      policyId: "p-1",
      presignedUrlHash: TOKEN,
      expiresAt: new Date(Date.now() + 60_000),
      isRevoked: false,
      downloadCount: 0,
      maxDownloads: null,
    });
    await GET(req(), { params: params(ID) });
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    const call = mocks.auditCreate.mock.calls[0]![0] as {
      data: { action: string; targetId: string; userId: string };
    };
    expect(call.data.action).toBe("LINK_SHARE_INFO_VIEW");
    expect(call.data.targetId).toBe(ID);
    expect(call.data.userId).toBe("u-9");
  });
});
