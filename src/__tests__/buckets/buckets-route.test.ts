import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getBucketList: vi.fn(),
  findUniqueUser: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUniqueUser },
  },
}));

vi.mock("@/lib/bucket-list", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bucket-list")>(
      "@/lib/bucket-list",
    );
  return {
    ...actual,
    getBucketList: mocks.getBucketList,
  };
});

import { GET } from "@/app/api/s3/buckets/route";
import { NextRequest } from "next/server";

function req(url = "http://x/api/s3/buckets") {
  return new NextRequest(url);
}

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.getBucketList.mockReset();
  mocks.findUniqueUser.mockReset();
});

function adminSession(sub = "auth0|a") {
  return {
    user: {
      sub,
      email: "a@x.com",
      "https://docs.helpucompli.com/role": "admin",
    },
  };
}

function viewerSession(sub = "auth0|v") {
  return {
    user: {
      sub,
      email: "v@x.com",
      "https://docs.helpucompli.com/role": "viewer",
    },
  };
}

describe("GET /api/s3/buckets", () => {
  it("401 when unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mocks.getBucketList).not.toHaveBeenCalled();
  });

  it("403 when no valid role", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { sub: "auth0|x", email: "x@x.com" },
    });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mocks.getBucketList).not.toHaveBeenCalled();
  });

  it("200 for admin — passes superadmin/admin scope (no userId)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.getBucketList.mockResolvedValueOnce([]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const scope = mocks.getBucketList.mock.calls[0]?.[1];
    expect(scope).toEqual({ role: "admin" });
  });

  it("viewer: resolves auth0 sub → DB user.id and scopes by userId", async () => {
    mocks.getSession.mockResolvedValueOnce(viewerSession("auth0|v1"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-42" });
    mocks.getBucketList.mockResolvedValueOnce([]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mocks.findUniqueUser).toHaveBeenCalledWith({
      where: { auth0Id: "auth0|v1" },
      select: { id: true },
    });
    const scope = mocks.getBucketList.mock.calls[0]?.[1];
    expect(scope).toEqual({ role: "viewer", userId: "u-42" });
  });

  it("viewer with no provisioned DB row: 200 + empty list (never leaks structural error)", async () => {
    mocks.getSession.mockResolvedValueOnce(viewerSession("auth0|v-new"));
    mocks.findUniqueUser.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; error: null };
    expect(body.data).toEqual([]);
    expect(mocks.getBucketList).not.toHaveBeenCalled();
  });

  it("parses sort+dir+region+status query params", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|q"));
    mocks.getBucketList.mockResolvedValueOnce([]);
    await GET(
      req(
        "http://x/api/s3/buckets?sort=documentCount&dir=desc&region=us-west-2&status=inactive",
      ),
    );
    const opts = mocks.getBucketList.mock.calls[0]?.[2];
    expect(opts).toEqual({
      sort: { field: "documentCount", dir: "desc" },
      filters: { region: "us-west-2", status: "inactive" },
    });
  });

  it("rejects invalid sort field with 400", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|bad-sort"));
    const res = await GET(req("http://x/api/s3/buckets?sort=totallyBogus"));
    expect(res.status).toBe(400);
    expect(mocks.getBucketList).not.toHaveBeenCalled();
  });

  it("rejects oversized region string with 400", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|bad-region"));
    const res = await GET(
      req(`http://x/api/s3/buckets?region=${"a".repeat(100)}`),
    );
    expect(res.status).toBe(400);
    expect(mocks.getBucketList).not.toHaveBeenCalled();
  });

  it("401 when session has a role but an empty/missing sub (no shared rate-limit bucket)", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        // sub missing entirely
        email: "x@x.com",
        "https://docs.helpucompli.com/role": "admin",
      },
    });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mocks.getBucketList).not.toHaveBeenCalled();
  });

  it("serialises storageBytes (BigInt) without throwing", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|bn"));
    mocks.getBucketList.mockResolvedValueOnce([
      {
        id: "b-1",
        name: "helpucompli-docs-one",
        region: "us-east-1",
        description: null,
        createdAt: new Date("2026-04-01T00:00:00Z"),
        isActive: true,
        documentCount: 3,
        storageBytes: BigInt(123456),
      },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ storageBytes: number | string }>;
      error: null;
    };
    expect(body.data[0]?.storageBytes).toBe(123456);
  });

  it("serialises storageBytes above 2^53 as a string (precision preserved)", async () => {
    // Past Number.MAX_SAFE_INTEGER toJsonSafe falls back to a string
    // so the integer survives the JSON round-trip. HIPAA document stores
    // at PB scale can cross this boundary.
    const huge = BigInt("10000000000000000"); // 10^16 > 2^53 ≈ 9.0e15
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|big"));
    mocks.getBucketList.mockResolvedValueOnce([
      {
        id: "b-1",
        name: "helpucompli-docs-huge",
        region: "us-east-1",
        description: null,
        createdAt: new Date("2026-04-01T00:00:00Z"),
        isActive: true,
        documentCount: 0,
        storageBytes: huge,
      },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ storageBytes: number | string }>;
      error: null;
    };
    expect(body.data[0]?.storageBytes).toBe("10000000000000000");
  });

  it("429 after 30 requests in 30s for the same user (rate limit)", async () => {
    const sub = "auth0|rate-buckets";
    for (let i = 0; i < 30; i++) {
      mocks.getSession.mockResolvedValueOnce(adminSession(sub));
      mocks.getBucketList.mockResolvedValueOnce([]);
      const ok = await GET(req());
      expect(ok.status).toBe(200);
    }
    mocks.getSession.mockResolvedValueOnce(adminSession(sub));
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("Cache-Control: no-store, private on 200", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|cache-b"));
    mocks.getBucketList.mockResolvedValueOnce([]);
    const res = await GET(req());
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("500 + generic error; never leaks DATABASE_URL on throw", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|err"));
    mocks.getBucketList.mockRejectedValueOnce(
      new Error("postgres://user:secret@host/db connection refused"),
    );
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { data: null; error: string };
    expect(body.data).toBeNull();
    expect(body.error).not.toContain("secret");
    expect(body.error).not.toContain("postgres://");
  });
});
