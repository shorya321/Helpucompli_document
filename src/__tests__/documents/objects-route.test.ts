import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueBucket: vi.fn(),
  upsertUser: vi.fn(),
  findFirstBucketAccess: vi.fn(),
  listObjects: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bucket: { findUnique: mocks.findUniqueBucket },
    user: { upsert: mocks.upsertUser },
    userBucketAccess: { findFirst: mocks.findFirstBucketAccess },
  },
}));

vi.mock("@/lib/s3-objects", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/s3-objects")>("@/lib/s3-objects");
  return {
    ...actual,
    listObjects: mocks.listObjects,
  };
});

import { GET } from "@/app/api/s3/objects/route";
import { NextRequest } from "next/server";

afterEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

const BUCKET_ID = "11111111-1111-1111-1111-111111111111";

function superadmin() {
  return {
    user: {
      sub: `auth0|su-${Math.random().toString(36).slice(2)}`,
      email: "s@x.com",
      "https://docs.helpucompli.com/role": "superadmin",
    },
  };
}
function admin() {
  return {
    user: {
      sub: `auth0|a-${Math.random().toString(36).slice(2)}`,
      email: "a@x.com",
      "https://docs.helpucompli.com/role": "admin",
    },
  };
}
function viewer() {
  return {
    user: {
      sub: `auth0|v-${Math.random().toString(36).slice(2)}`,
      email: "v@x.com",
      "https://docs.helpucompli.com/role": "viewer",
    },
  };
}

function req(qs: Record<string, string>) {
  const u = new URL("http://x/api/s3/objects");
  for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v);
  return new NextRequest(u, {
    method: "GET",
    headers: {
      "x-forwarded-for": "10.0.0.1",
      "user-agent": "vitest-ua/1.0",
    },
  });
}

function okListing() {
  return {
    contents: [
      {
        Key: "folder/report.pdf",
        Size: 4096,
        LastModified: new Date("2026-01-01T00:00:00Z"),
        ETag: '"abc123"',
      },
    ],
    commonPrefixes: ["folder/sub/"],
    isTruncated: false,
  };
}

describe("GET /api/s3/objects", () => {
  it("401 when no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(req({ bucketId: BUCKET_ID }));
    expect(res.status).toBe(401);
  });

  it("400 when bucketId missing", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    const res = await GET(req({}));
    expect(res.status).toBe(400);
  });

  it("400 when prefix has traversal", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    const res = await GET(req({ bucketId: BUCKET_ID, prefix: "../leak" }));
    expect(res.status).toBe(400);
  });

  it("404 when bucket missing", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    mocks.findUniqueBucket.mockResolvedValueOnce(null);
    const res = await GET(req({ bucketId: BUCKET_ID }));
    expect(res.status).toBe(404);
  });

  it("404 when bucket inactive", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    mocks.findUniqueBucket.mockResolvedValueOnce({
      id: BUCKET_ID,
      name: "inactive-bucket",
      isActive: false,
    });
    const res = await GET(req({ bucketId: BUCKET_ID }));
    expect(res.status).toBe(404);
  });

  it("403 when viewer lacks UserBucketAccess", async () => {
    mocks.getSession.mockResolvedValueOnce(viewer());
    mocks.findUniqueBucket.mockResolvedValueOnce({
      id: BUCKET_ID,
      name: "secure-bucket",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValueOnce({ id: "u1" });
    mocks.findFirstBucketAccess.mockResolvedValueOnce(null);
    const res = await GET(req({ bucketId: BUCKET_ID }));
    expect(res.status).toBe(403);
  });

  it("200 + contents for superadmin (bypasses UserBucketAccess)", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    mocks.findUniqueBucket.mockResolvedValueOnce({
      id: BUCKET_ID,
      name: "secure-bucket",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValueOnce({ id: "u0" });
    mocks.listObjects.mockResolvedValueOnce(okListing());
    const res = await GET(req({ bucketId: BUCKET_ID, prefix: "folder/" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        contents: Array<{ key: string; size: number }>;
        commonPrefixes: string[];
      };
    };
    expect(body.data.contents[0]?.key).toBe("folder/report.pdf");
    expect(body.data.contents[0]?.size).toBe(4096);
    expect(body.data.commonPrefixes).toEqual(["folder/sub/"]);
    expect(mocks.findFirstBucketAccess).not.toHaveBeenCalled();
  });

  it("200 for admin with UserBucketAccess", async () => {
    mocks.getSession.mockResolvedValueOnce(admin());
    mocks.findUniqueBucket.mockResolvedValueOnce({
      id: BUCKET_ID,
      name: "secure-bucket",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValueOnce({ id: "a1" });
    mocks.findFirstBucketAccess.mockResolvedValueOnce({ userId: "a1" });
    mocks.listObjects.mockResolvedValueOnce(okListing());
    const res = await GET(req({ bucketId: BUCKET_ID }));
    expect(res.status).toBe(200);
  });

  it("500 when listObjects throws (error message does not leak)", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    mocks.findUniqueBucket.mockResolvedValueOnce({
      id: BUCKET_ID,
      name: "secure-bucket",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValueOnce({ id: "u0" });
    mocks.listObjects.mockRejectedValueOnce(
      new Error("arn:aws:s3:::secret-bucket NoSuchBucket"),
    );
    const res = await GET(req({ bucketId: BUCKET_ID }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Failed to list objects");
    expect(body.error).not.toContain("arn:aws");
  });
});
