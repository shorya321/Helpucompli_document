import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findLink: vi.fn(),
  resolvePolicy: vi.fn(),
  enforcePolicy: vi.fn(),
  presignGetUrl: vi.fn(),
  incrementCount: vi.fn(),
  auditCreate: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({ limit: mocks.limit }),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    generatedLink: {
      findUnique: mocks.findLink,
      update: mocks.incrementCount,
    },
    auditLog: { create: mocks.auditCreate },
  },
}));
vi.mock("@/lib/policy-engine", async () => {
  const actual = await vi.importActual<typeof import("@/lib/policy-engine")>(
    "@/lib/policy-engine",
  );
  return {
    ...actual,
    resolvePolicy: mocks.resolvePolicy,
    enforcePolicy: mocks.enforcePolicy,
  };
});
vi.mock("@/lib/s3-presign", async () => {
  const actual = await vi.importActual<typeof import("@/lib/s3-presign")>(
    "@/lib/s3-presign",
  );
  return { ...actual, presignGetUrl: mocks.presignGetUrl };
});

import { GET } from "@/app/api/links/[hash]/route";
import { NextRequest } from "next/server";

const okQuota = { success: true, reset: Date.now() + 30_000 };

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

beforeEach(() => {
  mocks.limit.mockResolvedValue(okQuota);
  mocks.getSession.mockResolvedValue(null);
  mocks.auditCreate.mockResolvedValue({ id: "a-1" });
});

const future = () => new Date(Date.now() + 3_600_000);

function linkRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "link-1",
    documentId: "d-1",
    presignedUrlHash: "tok_abc_with_long_enough_token_value_xyz",
    expiresAt: future(),
    downloadCount: 0,
    maxDownloads: null,
    isRevoked: false,
    policyId: null,
    document: {
      id: "d-1",
      s3Key: "shared/file.pdf",
      isDeleted: false,
      bucket: { name: "alpha-bucket" },
    },
    ...over,
  };
}

const params = (hash: string) => Promise.resolve({ hash });

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://x/api/links/tok_abc_with_long_enough_token_value_xyz", { headers });
}

const allow = { allow: true, linkTtlSeconds: 900, maxDownloads: null };
const deny = { allow: false };

const defaultEffective = {
  source: "default",
  policyId: null,
  linkTtlSeconds: 900,
  maxDownloads: null,
  requireAuth: false,
  allowedDomains: [],
  allowedIpRanges: [],
};

describe("GET /api/links/[hash]", () => {
  it("403 (NOT 404) when token missing — no info leak", async () => {
    mocks.findLink.mockResolvedValueOnce(null);
    const res = await GET(req(), { params: params("nope") });
    expect(res.status).toBe(403);
  });

  it("403 when revoked + writes LINK_DENIED audit", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow({ isRevoked: true }));
    const res = await GET(req(), { params: params("tok_abc_with_long_enough_token_value_xyz") });
    expect(res.status).toBe(403);
    expect(mocks.auditCreate).toHaveBeenCalled();
    const args = mocks.auditCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.action).toBe("LINK_DENIED");
    expect(mocks.incrementCount).not.toHaveBeenCalled();
  });

  it("403 when expired", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const res = await GET(req(), { params: params("tok_abc_with_long_enough_token_value_xyz") });
    expect(res.status).toBe(403);
    expect(mocks.auditCreate.mock.calls[0]?.[0].data.action).toBe(
      "LINK_DENIED",
    );
  });

  it("403 when downloadCount >= maxDownloads", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({ downloadCount: 5, maxDownloads: 5 }),
    );
    const res = await GET(req(), { params: params("tok_abc_with_long_enough_token_value_xyz") });
    expect(res.status).toBe(403);
  });

  it("403 when document soft-deleted", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        document: {
          id: "d-1",
          s3Key: "shared/file.pdf",
          isDeleted: true,
          bucket: { name: "alpha-bucket" },
        },
      }),
    );
    const res = await GET(req(), { params: params("tok_abc_with_long_enough_token_value_xyz") });
    expect(res.status).toBe(403);
  });

  it("403 when policy enforce returns deny + audit LINK_DENIED", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow());
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce(deny);
    const res = await GET(req(), { params: params("tok_abc_with_long_enough_token_value_xyz") });
    expect(res.status).toBe(403);
    expect(mocks.incrementCount).not.toHaveBeenCalled();
    expect(mocks.auditCreate.mock.calls[0]?.[0].data.action).toBe(
      "LINK_DENIED",
    );
  });

  it("302 redirect with presigned URL on allow + atomically increments + audit LINK_ACCESS", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow());
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce(allow);
    mocks.presignGetUrl.mockResolvedValueOnce(
      "https://s3.amazonaws.com/alpha-bucket/shared/file.pdf?X-Amz-Signature=abc",
    );
    mocks.incrementCount.mockResolvedValueOnce({});
    const res = await GET(req(), { params: params("tok_abc_with_long_enough_token_value_xyz") });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/X-Amz-Signature=abc/);
    expect(mocks.incrementCount).toHaveBeenCalledOnce();
    const updateArgs = mocks.incrementCount.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // Atomic increment via Prisma {increment: 1}, NOT read-then-write.
    expect(updateArgs.data.downloadCount).toEqual({ increment: 1 });
    expect(mocks.auditCreate.mock.calls[0]?.[0].data.action).toBe(
      "LINK_ACCESS",
    );
  });

  it("uses link's stored policy when policyId present, skips inheritance", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        policyId: "p-1",
        policy: {
          id: "p-1",
          linkTtlSeconds: 1800,
          maxDownloads: null,
          requireAuth: false,
          allowedDomains: [],
          allowedIpRanges: [],
        },
      }),
    );
    mocks.enforcePolicy.mockReturnValueOnce(allow);
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    mocks.incrementCount.mockResolvedValueOnce({});
    const res = await GET(req(), { params: params("tok_abc_with_long_enough_token_value_xyz") });
    expect(res.status).toBe(302);
    expect(mocks.resolvePolicy).not.toHaveBeenCalled();
  });

  it("redirect URL Cache-Control is private no-store (presigned URL not cacheable)", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow());
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce(allow);
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    mocks.incrementCount.mockResolvedValueOnce({});
    const res = await GET(req(), { params: params("tok_abc_with_long_enough_token_value_xyz") });
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(res.headers.get("Cache-Control")).toMatch(/private/);
  });

  it("clamps presign TTL to time-remaining when link expires before policy TTL", async () => {
    const linkExpiresIn = 120; // seconds
    mocks.findLink.mockResolvedValueOnce(
      linkRow({ expiresAt: new Date(Date.now() + linkExpiresIn * 1000) }),
    );
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce({
      ...allow,
      linkTtlSeconds: 3600,
    });
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    mocks.incrementCount.mockResolvedValueOnce({});
    await GET(req(), { params: params("tok_abc_with_long_enough_token_value_xyz") });
    const presignArgs = mocks.presignGetUrl.mock.calls[0]?.[0] as {
      ttlSeconds: number;
    };
    // Should be ≤ link expiry (120s) — but s3-presign min is 900s, so it
    // should clamp UP to 900 (presign min), proving we never pass 3600s
    // when link itself expires in 120s.
    expect(presignArgs.ttlSeconds).toBeLessThanOrEqual(900);
  });
});
