import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveHasRole: vi.fn(),
  resolvePolicyOrNull: vi.fn(),
  documentFindFirst: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({
  resolveHasRole: mocks.resolveHasRole,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: { findFirst: mocks.documentFindFirst },
    accessPolicy: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/policy-engine", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/policy-engine")>(
      "@/lib/policy-engine",
    );
  return {
    ...actual,
    resolvePolicyOrNull: mocks.resolvePolicyOrNull,
  };
});
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: vi.fn(() => ({ limit: mocks.limit })),
}));

import { GET } from "@/app/api/policies/effective/route";
import { NextRequest } from "next/server";

const ok = { success: true, reset: Date.now() + 30_000 };

const DOC_ID = "11111111-1111-1111-1111-111111111111";

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

function adminSession() {
  return { user: { sub: "auth0|admin" } };
}

function req(url: string): NextRequest {
  return new NextRequest(url);
}

describe("GET /api/policies/effective", () => {
  it("401 when no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(
      req(`http://x/api/policies/effective?documentId=${DOC_ID}`),
    );
    expect(res.status).toBe(401);
  });

  it("403 when not admin+", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await GET(
      req(`http://x/api/policies/effective?documentId=${DOC_ID}`),
    );
    expect(res.status).toBe(403);
  });

  it("400 when documentId missing", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    const res = await GET(req("http://x/api/policies/effective"));
    expect(res.status).toBe(400);
  });

  it("400 when documentId is not uuid", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    const res = await GET(
      req("http://x/api/policies/effective?documentId=not-a-uuid"),
    );
    expect(res.status).toBe(400);
  });

  it("404 when document not found / deleted", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.documentFindFirst.mockResolvedValueOnce(null);
    const res = await GET(
      req(`http://x/api/policies/effective?documentId=${DOC_ID}`),
    );
    expect(res.status).toBe(404);
  });

  it("200 with source=bucket + requireAuth=true when bucket policy matches", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.documentFindFirst.mockResolvedValueOnce({
      s3Key: "documents/car4.jpg",
      bucket: { name: "helpucompli-docs-developer" },
    });
    mocks.resolvePolicyOrNull.mockResolvedValueOnce({
      source: "bucket",
      policyId: "p-bucket",
      linkTtlSeconds: 900,
      maxDownloads: null,
      requireAuth: true,
      allowedDomains: [],
      allowedIpRanges: [],
    });
    const res = await GET(
      req(`http://x/api/policies/effective?documentId=${DOC_ID}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        source: string;
        policyId: string | null;
        requireAuth: boolean;
      };
    };
    expect(body.data.source).toBe("bucket");
    expect(body.data.policyId).toBe("p-bucket");
    expect(body.data.requireAuth).toBe(true);
  });

  it("200 with source=none + requireAuth=false when no policy matches (falls back to linkDefaultPolicy)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.documentFindFirst.mockResolvedValueOnce({
      s3Key: "documents/car2.png",
      bucket: { name: "helpucompli-docs-test" },
    });
    mocks.resolvePolicyOrNull.mockResolvedValueOnce(null);
    const res = await GET(
      req(`http://x/api/policies/effective?documentId=${DOC_ID}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        source: string;
        policyId: string | null;
        requireAuth: boolean;
        linkTtlSeconds: number;
      };
    };
    expect(body.data.source).toBe("none");
    expect(body.data.policyId).toBeNull();
    expect(body.data.requireAuth).toBe(false);
    expect(body.data.linkTtlSeconds).toBe(900);
  });

  it("200 with source=prefix for longest-prefix match", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.documentFindFirst.mockResolvedValueOnce({
      s3Key: "clients/acme/car4.jpg",
      bucket: { name: "helpucompli-docs-developer" },
    });
    mocks.resolvePolicyOrNull.mockResolvedValueOnce({
      source: "prefix",
      policyId: "p-prefix",
      linkTtlSeconds: 3600,
      maxDownloads: 5,
      requireAuth: false,
      allowedDomains: ["*.acme.com"],
      allowedIpRanges: [],
    });
    const res = await GET(
      req(`http://x/api/policies/effective?documentId=${DOC_ID}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { source: string } };
    expect(body.data.source).toBe("prefix");
  });

  it("200 with source=object for exact-key match (highest priority)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.documentFindFirst.mockResolvedValueOnce({
      s3Key: "documents/car4.jpg",
      bucket: { name: "helpucompli-docs-developer" },
    });
    mocks.resolvePolicyOrNull.mockResolvedValueOnce({
      source: "object",
      policyId: "p-object",
      linkTtlSeconds: 900,
      maxDownloads: 1,
      requireAuth: true,
      allowedDomains: [],
      allowedIpRanges: ["10.0.0.0/8"],
    });
    const res = await GET(
      req(`http://x/api/policies/effective?documentId=${DOC_ID}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { source: string } };
    expect(body.data.source).toBe("object");
  });

  it("429 when rate-limited", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce({
      success: false,
      reset: Date.now() + 5000,
    });
    const res = await GET(
      req(`http://x/api/policies/effective?documentId=${DOC_ID}`),
    );
    expect(res.status).toBe(429);
  });

  it("500 on prisma throw — generic message, no DB URL leak", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.documentFindFirst.mockRejectedValueOnce(
      new Error("postgresql://user:pw@host failed"),
    );
    const res = await GET(
      req(`http://x/api/policies/effective?documentId=${DOC_ID}`),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/postgres|@|pw/i);
  });
});
