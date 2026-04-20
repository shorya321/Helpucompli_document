import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveHasRole: vi.fn(),
  resolveRole: vi.fn(),
  ensureUser: vi.fn(),
  getUserBuckets: vi.fn(),
  setUserBuckets: vi.fn(),
  userFindUnique: vi.fn(),
  limitGet: vi.fn(),
  limitPut: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({
  resolveHasRole: mocks.resolveHasRole,
  resolveRole: mocks.resolveRole,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.userFindUnique } },
}));
vi.mock("@/lib/ensure-user", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/user-bucket-access", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/user-bucket-access")>(
      "@/lib/user-bucket-access",
    );
  return {
    ...actual,
    getUserBuckets: mocks.getUserBuckets,
    setUserBuckets: mocks.setUserBuckets,
  };
});
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: vi
    .fn()
    .mockImplementationOnce(() => ({ limit: mocks.limitGet }))
    .mockImplementationOnce(() => ({ limit: mocks.limitPut })),
}));

import { GET, PUT } from "@/app/api/users/[id]/buckets/route";
import { NextRequest } from "next/server";

const ok = { success: true, reset: Date.now() + 30_000 };
const UUID = "11111111-2222-3333-4444-555555555555";
const BUCKET = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const params = Promise.resolve({ id: UUID });

function adminSession() {
  return { user: { sub: "auth0|admin" } };
}

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("GET /api/users/[id]/buckets", () => {
  it("401 no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(
      new NextRequest(`http://x/api/users/${UUID}/buckets`),
      { params },
    );
    expect(res.status).toBe(401);
  });

  it("403 when not admin+", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await GET(
      new NextRequest(`http://x/api/users/${UUID}/buckets`),
      { params },
    );
    expect(res.status).toBe(403);
  });

  it("400 on invalid id", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitGet.mockResolvedValueOnce(ok);
    const res = await GET(
      new NextRequest(`http://x/api/users/bad/buckets`),
      { params: Promise.resolve({ id: "bad" }) },
    );
    expect(res.status).toBe(400);
  });

  it("404 when target user not found", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitGet.mockResolvedValueOnce(ok);
    mocks.userFindUnique.mockResolvedValueOnce(null);
    const res = await GET(
      new NextRequest(`http://x/api/users/${UUID}/buckets`),
      { params },
    );
    expect(res.status).toBe(404);
  });

  it("200 returns bucket list", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitGet.mockResolvedValueOnce(ok);
    mocks.userFindUnique.mockResolvedValueOnce({ id: UUID });
    mocks.getUserBuckets.mockResolvedValueOnce([
      {
        bucketId: BUCKET,
        name: "finance",
        grantedAt: new Date(),
        grantedByName: "Alice",
      },
    ]);
    const res = await GET(
      new NextRequest(`http://x/api/users/${UUID}/buckets`),
      { params },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});

describe("PUT /api/users/[id]/buckets", () => {
  function jsonReq(body: unknown) {
    return new NextRequest(`http://x/api/users/${UUID}/buckets`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("401 no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await PUT(jsonReq({ bucketIds: [BUCKET] }), { params });
    expect(res.status).toBe(401);
  });

  it("403 when not admin+", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await PUT(jsonReq({ bucketIds: [BUCKET] }), { params });
    expect(res.status).toBe(403);
  });

  it("400 on invalid body", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitPut.mockResolvedValueOnce(ok);
    const res = await PUT(jsonReq({ bucketIds: ["not-uuid"] }), { params });
    expect(res.status).toBe(400);
  });

  it("404 when target user not found", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitPut.mockResolvedValueOnce(ok);
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.userFindUnique.mockResolvedValueOnce(null);
    const res = await PUT(jsonReq({ bucketIds: [BUCKET] }), { params });
    expect(res.status).toBe(404);
  });

  it("200 on successful update", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitPut.mockResolvedValueOnce(ok);
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.userFindUnique.mockResolvedValueOnce({ id: UUID });
    mocks.setUserBuckets.mockResolvedValueOnce({
      toAdd: [BUCKET],
      toRemove: [],
    });
    const res = await PUT(jsonReq({ bucketIds: [BUCKET] }), { params });
    expect(res.status).toBe(200);
    expect(mocks.setUserBuckets).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: UUID,
        bucketIds: [BUCKET],
        grantedById: "actor-1",
      }),
    );
  });
});
