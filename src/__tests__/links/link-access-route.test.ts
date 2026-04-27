import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findLink: vi.fn(),
  resolvePolicy: vi.fn(),
  enforcePolicy: vi.fn(),
  presignGetUrl: vi.fn(),
  incrementCount: vi.fn(),
  updateMany: vi.fn(),
  decrementCount: vi.fn(),
  auditCreate: vi.fn(),
  limit: vi.fn(),
  ensureUser: vi.fn(),
  resolveRole: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ resolveRole: mocks.resolveRole }));
vi.mock("@/lib/ensure-user", () => ({ ensureUser: mocks.ensureUser }));

vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({ limit: mocks.limit }),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    generatedLink: {
      findUnique: mocks.findLink,
      update: mocks.decrementCount,
      updateMany: mocks.updateMany,
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
    resolvePolicyOrNull: mocks.resolvePolicy,
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
    allowPublicEmbed: false,
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
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.presignGetUrl.mockResolvedValueOnce(
      "https://s3.amazonaws.com/alpha-bucket/shared/file.pdf?X-Amz-Signature=abc",
    );
    const res = await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/X-Amz-Signature=abc/);
    // Sec-review M3: atomic conditional increment via updateMany.
    expect(mocks.updateMany).toHaveBeenCalledOnce();
    const args = mocks.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(args.data.downloadCount).toEqual({ increment: 1 });
    expect(args.where.isRevoked).toBe(false);
    expect(mocks.auditCreate.mock.calls[0]?.[0].data.action).toBe(
      "LINK_ACCESS",
    );
  });

  it("403 when atomic increment loses the race (count=0)", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({ downloadCount: 4, maxDownloads: 5 }),
    );
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce(allow);
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    expect(res.status).toBe(403);
    expect(mocks.presignGetUrl).not.toHaveBeenCalled();
    expect(mocks.auditCreate.mock.calls[0]?.[0].data.action).toBe(
      "LINK_DENIED",
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
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    const res = await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    expect(res.status).toBe(302);
    expect(mocks.resolvePolicy).not.toHaveBeenCalled();
  });

  it("redirect URL Cache-Control is private no-store (presigned URL not cacheable)", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow());
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce(allow);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    const res = await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(res.headers.get("Cache-Control")).toMatch(/private/);
  });

  it("403 when remaining < ABORT_FLOOR (30s) — link essentially expired", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({ expiresAt: new Date(Date.now() + 10_000) }), // 10s left
    );
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce({
      ...allow,
      linkTtlSeconds: 900,
    });
    const res = await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    expect(res.status).toBe(403);
    expect(mocks.presignGetUrl).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    const reason = mocks.auditCreate.mock.calls[0]?.[0].data.metadata.reason;
    expect(reason).toBe("remaining-ttl-too-low");
  });

  it("clamps presign TTL UP to MIN_TTL_SECONDS when remaining is short but > 30s — accepted overhang", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({ expiresAt: new Date(Date.now() + 120_000) }), // 120s left
    );
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce({
      ...allow,
      linkTtlSeconds: 900,
    });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    const res = await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    expect(res.status).toBe(302);
    const presignArgs = mocks.presignGetUrl.mock.calls[0]?.[0] as {
      ttlSeconds: number;
    };
    // Math.min(900 desired, 120 remaining, 7d max) = 120, then
    // Math.max(900 floor, 120) = 900.
    expect(presignArgs.ttlSeconds).toBe(900);
  });

  it("302 + presign TTL clamped to MAX_GET_TTL when link has null expiresAt (never expires)", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow({ expiresAt: null }));
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce({
      ...allow,
      linkTtlSeconds: 3600,
    });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=perpetual");
    const res = await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    expect(res.status).toBe(302);
    // updateMany must match null-expiry rows via OR.
    const whereArgs = mocks.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    const or = whereArgs.where.OR as Array<Record<string, unknown>>;
    expect(or).toHaveLength(2);
    expect(or[0]).toEqual({ expiresAt: null });
    const presignArgs = mocks.presignGetUrl.mock.calls[0]?.[0] as {
      ttlSeconds: number;
    };
    // linkTtlSeconds 3600 < MAX_GET_TTL 604800 → chosen.
    expect(presignArgs.ttlSeconds).toBe(3600);
  });

  it("uses min(decision.ttl, remaining, 7d) as presign TTL when remaining > MIN_TTL", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({ expiresAt: new Date(Date.now() + 1200 * 1000) }), // 1200s
    );
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce({
      ...allow,
      linkTtlSeconds: 3600,
    });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    const presignArgs = mocks.presignGetUrl.mock.calls[0]?.[0] as {
      ttlSeconds: number;
    };
    // min(3600, 1200, 7d) = 1200. max(900, 1200) = 1200.
    expect(presignArgs.ttlSeconds).toBe(1200);
  });

  // ---- allowPublicEmbed=true: counter + maxDownloads must be skipped ----
  // Each WordPress page render produces ≥2 viewer hits (server-side
  // oEmbed discovery + browser iframe load). If we counted every hit,
  // a finite `maxDownloads` would exhaust on a handful of legitimate
  // page views. Public-embed links rely on `expiresAt` + admin revoke
  // for lifecycle, not the counter.

  it("public-embed link does NOT call updateMany (counter increment skipped)", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({ allowPublicEmbed: true }),
    );
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce(allow);
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    const res = await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    expect(res.status).toBe(302);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.auditCreate.mock.calls[0]?.[0].data.action).toBe(
      "LINK_ACCESS",
    );
  });

  it("public-embed link with downloadCount === maxDownloads still serves (counter is meaningless on public-embed path)", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({
        allowPublicEmbed: true,
        downloadCount: 5,
        maxDownloads: 5,
      }),
    );
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce(allow);
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    const res = await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    expect(res.status).toBe(302);
  });

  it("private link (allowPublicEmbed=false / undefined) STILL increments counter — regression guard", async () => {
    // Identical to the existing "302 redirect" happy-path; explicit
    // re-statement so a future "skip increment for ALL links" mistake
    // fails this test loudly.
    mocks.findLink.mockResolvedValueOnce(linkRow());
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce(allow);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    expect(mocks.updateMany).toHaveBeenCalledOnce();
    const args = mocks.updateMany.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.downloadCount).toEqual({ increment: 1 });
  });

  it("public-embed link passes publicEmbedBypass=true to enforcePolicy (engine skips Referer + IP checks)", async () => {
    mocks.findLink.mockResolvedValueOnce(
      linkRow({ allowPublicEmbed: true }),
    );
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce(allow);
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    const ctx = mocks.enforcePolicy.mock.calls[0]?.[1] as {
      publicEmbedBypass?: boolean;
    };
    expect(ctx.publicEmbedBypass).toBe(true);
  });

  it("private link does NOT set publicEmbedBypass (legacy enforcement path) — regression guard", async () => {
    mocks.findLink.mockResolvedValueOnce(linkRow({ allowPublicEmbed: false }));
    mocks.resolvePolicy.mockResolvedValueOnce(defaultEffective);
    mocks.enforcePolicy.mockReturnValueOnce(allow);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.presignGetUrl.mockResolvedValueOnce("https://s3/x?sig=1");
    await GET(req(), {
      params: params("tok_abc_with_long_enough_token_value_xyz"),
    });
    const ctx = mocks.enforcePolicy.mock.calls[0]?.[1] as {
      publicEmbedBypass?: boolean;
    };
    expect(ctx.publicEmbedBypass).toBe(false);
  });
});
