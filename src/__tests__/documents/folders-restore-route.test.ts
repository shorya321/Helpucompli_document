import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueBucket: vi.fn(),
  upsertUser: vi.fn(),
  findFirstBucketAccess: vi.fn(),
  restoreFolder: vi.fn(),
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

vi.mock("@/lib/folder-restore", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/folder-restore")>(
      "@/lib/folder-restore",
    );
  return {
    ...actual,
    restoreFolder: mocks.restoreFolder,
  };
});

import { POST } from "@/app/api/s3/folders/restore/route";
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

function req(payload: unknown, headers?: Record<string, string>) {
  return new NextRequest("http://x/api/s3/folders/restore", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.2",
      "user-agent": "vitest-ua/1.0",
      ...(headers ?? {}),
    },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/s3/folders/restore", () => {
  it("401 when unauthenticated", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await POST(req({ bucketId: BUCKET_ID, prefix: "docs/" }));
    expect(res.status).toBe(401);
  });

  it("403 when viewer", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    const res = await POST(req({ bucketId: BUCKET_ID, prefix: "docs/" }));
    expect(res.status).toBe(403);
  });

  it("400 on invalid prefix", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    const res = await POST(req({ bucketId: BUCKET_ID, prefix: "../docs/" }));
    expect(res.status).toBe(400);
  });

  it("409 when bucket inactive", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: false,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    const res = await POST(req({ bucketId: BUCKET_ID, prefix: "docs/" }));
    expect(res.status).toBe(409);
  });

  it("403 when admin lacks UserBucketAccess", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockResolvedValue(null);
    const res = await POST(req({ bucketId: BUCKET_ID, prefix: "docs/" }));
    expect(res.status).toBe(403);
  });

  it("200 restores folder via shared restore helper", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.restoreFolder.mockResolvedValue({
      filesRestored: 2,
      folderMarkersRestored: 1,
    });

    const res = await POST(req({ bucketId: BUCKET_ID, prefix: "docs/" }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { filesRestored: number; folderMarkersRestored: number };
    };
    expect(body.data.filesRestored).toBe(2);
    expect(body.data.folderMarkersRestored).toBe(1);
    expect(mocks.restoreFolder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bucketId: BUCKET_ID,
        bucketName: "helpucompli-docs-acme",
        prefix: "docs/",
        userId: "user-su",
      }),
    );
  });
});
