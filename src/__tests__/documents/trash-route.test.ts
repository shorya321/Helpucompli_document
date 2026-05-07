import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  ensureUser: vi.fn(),
  bucketFindMany: vi.fn(),
  documentFindMany: vi.fn(),
  documentCount: vi.fn(),
  userBucketAccessFindMany: vi.fn(),
  listDeletedFolderMarkers: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bucket: {
      findMany: mocks.bucketFindMany,
    },
    document: {
      findMany: mocks.documentFindMany,
      count: mocks.documentCount,
    },
    userBucketAccess: { findMany: mocks.userBucketAccessFindMany },
  },
}));

vi.mock("@/lib/ensure-user", () => ({
  ensureUser: mocks.ensureUser,
}));

vi.mock("@/lib/folder-restore", () => ({
  listDeletedFolderMarkers: mocks.listDeletedFolderMarkers,
}));

import { GET } from "@/app/api/s3/trash/route";
import { NextRequest } from "next/server";

afterEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

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

function reqUrl(qs = "") {
  return new NextRequest(`http://x/api/s3/trash${qs}`);
}

describe("GET /api/s3/trash", () => {
  it("401 without session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await GET(reqUrl());
    expect(res.status).toBe(401);
  });

  it("403 for viewer", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    const res = await GET(reqUrl());
    expect(res.status).toBe(403);
  });

  it("200 superadmin: lists every soft-deleted doc across all buckets", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.ensureUser.mockResolvedValue({ id: "user-su" });
    mocks.documentFindMany.mockResolvedValue([
      {
        id: "d1",
        bucketId: "b1",
        s3Key: "a.pdf",
        filename: "a.pdf",
        sizeBytes: BigInt(100),
        deletedAt: new Date("2026-04-01"),
        bucket: { name: "bucket-a" },
        deletedBy: { email: "a@x.com" },
      },
    ]);
    mocks.documentCount.mockResolvedValue(1);
    mocks.bucketFindMany.mockResolvedValue([
      { id: "b1", name: "bucket-a" },
    ]);
    mocks.listDeletedFolderMarkers.mockResolvedValue([]);

    const res = await GET(reqUrl());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { documents: Array<{ id: string }>; total: number };
    };
    expect(body.data.total).toBe(1);
    expect(body.data.documents).toHaveLength(1);
    expect(body.data.documents[0]!.id).toBe("d1");

    const where = mocks.documentFindMany.mock.calls[0]![0] as { where: { isDeleted: boolean } };
    expect(where.where.isDeleted).toBe(true);
    // No bucket scoping for superadmin
    expect((where.where as { bucketId?: unknown }).bucketId).toBeUndefined();
  });

  it("200 admin: scoped to userBucketAccess buckets only", async () => {
    const B1 = "11111111-1111-1111-1111-111111111111";
    const B2 = "22222222-2222-2222-2222-222222222222";
    mocks.getSession.mockResolvedValue(admin());
    mocks.ensureUser.mockResolvedValue({ id: "user-a" });
    mocks.userBucketAccessFindMany.mockResolvedValue([
      { bucketId: B1 },
      { bucketId: B2 },
    ]);
    mocks.documentFindMany.mockResolvedValue([]);
    mocks.documentCount.mockResolvedValue(0);
    mocks.bucketFindMany.mockResolvedValue([]);
    mocks.listDeletedFolderMarkers.mockResolvedValue([]);

    const res = await GET(reqUrl());
    expect(res.status).toBe(200);
    const where = mocks.documentFindMany.mock.calls[0]![0] as {
      where: { isDeleted: boolean; bucketId: { in: string[] } };
    };
    expect(where.where.isDeleted).toBe(true);
    expect(where.where.bucketId.in.sort()).toEqual([B1, B2]);
  });

  it("200 admin with no bucket access: empty list", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.ensureUser.mockResolvedValue({ id: "user-a" });
    mocks.userBucketAccessFindMany.mockResolvedValue([]);

    const res = await GET(reqUrl());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { total: number; documents: unknown[] } };
    expect(body.data.total).toBe(0);
    expect(body.data.documents).toHaveLength(0);
    expect(mocks.documentFindMany).not.toHaveBeenCalled();
  });

  it("respects ?bucketId filter (admin scoped within own access)", async () => {
    const B1 = "11111111-1111-1111-1111-111111111111";
    const B2 = "22222222-2222-2222-2222-222222222222";
    mocks.getSession.mockResolvedValue(admin());
    mocks.ensureUser.mockResolvedValue({ id: "user-a" });
    mocks.userBucketAccessFindMany.mockResolvedValue([
      { bucketId: B1 },
      { bucketId: B2 },
    ]);
    mocks.documentFindMany.mockResolvedValue([]);
    mocks.documentCount.mockResolvedValue(0);
    mocks.bucketFindMany.mockResolvedValue([]);
    mocks.listDeletedFolderMarkers.mockResolvedValue([]);

    const res = await GET(reqUrl(`?bucketId=${B1}`));
    expect(res.status).toBe(200);
    const where = mocks.documentFindMany.mock.calls[0]![0] as {
      where: { bucketId: { in: string[] } };
    };
    expect(where.where.bucketId.in).toEqual([B1]);
  });

  it("403 admin asking for a bucket they don't have access to", async () => {
    const B1 = "11111111-1111-1111-1111-111111111111";
    const B2 = "22222222-2222-2222-2222-222222222222";
    mocks.getSession.mockResolvedValue(admin());
    mocks.ensureUser.mockResolvedValue({ id: "user-a" });
    mocks.userBucketAccessFindMany.mockResolvedValue([{ bucketId: B1 }]);

    const res = await GET(reqUrl(`?bucketId=${B2}`));
    expect(res.status).toBe(403);
  });

  it("includes deleted folder markers scoped to visible buckets", async () => {
    const B1 = "11111111-1111-1111-1111-111111111111";
    mocks.getSession.mockResolvedValue(admin());
    mocks.ensureUser.mockResolvedValue({ id: "user-a" });
    mocks.userBucketAccessFindMany.mockResolvedValue([{ bucketId: B1 }]);
    mocks.documentFindMany.mockResolvedValue([]);
    mocks.documentCount.mockResolvedValue(0);
    mocks.bucketFindMany.mockResolvedValue([
      { id: B1, name: "helpucompli-docs-acme" },
    ]);
    mocks.listDeletedFolderMarkers.mockResolvedValue([
      {
        key: "docs/",
        versionId: "dm-docs",
        deletedAt: new Date("2026-05-02T10:00:00.000Z"),
      },
    ]);

    const res = await GET(reqUrl());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        folders: Array<{
          bucketId: string;
          bucketName: string;
          prefix: string;
          deletedAt: string;
        }>;
      };
    };
    expect(body.data.folders).toEqual([
      {
        bucketId: B1,
        bucketName: "helpucompli-docs-acme",
        prefix: "docs/",
        deletedAt: "2026-05-02T10:00:00.000Z",
      },
    ]);
    expect(mocks.listDeletedFolderMarkers).toHaveBeenCalledWith({
      bucket: "helpucompli-docs-acme",
    });
  });
});
