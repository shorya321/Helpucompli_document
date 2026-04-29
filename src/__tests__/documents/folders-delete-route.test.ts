import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueBucket: vi.fn(),
  upsertUser: vi.fn(),
  findFirstBucketAccess: vi.fn(),
  softDeleteFolder: vi.fn(),
  hardDeleteFolder: vi.fn(),
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

vi.mock("@/lib/folder-delete", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/folder-delete")>(
      "@/lib/folder-delete",
    );
  return {
    ...actual,
    softDeleteFolder: mocks.softDeleteFolder,
    hardDeleteFolder: mocks.hardDeleteFolder,
  };
});

// Stub out console.error so the new structured logging in the route's
// catch block does not pollute test output.
vi.spyOn(console, "error").mockImplementation(() => {});

import { POST } from "@/app/api/s3/folders/delete/route";
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
  return new NextRequest("http://x/api/s3/folders/delete", {
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

describe("POST /api/s3/folders/delete", () => {
  it("401 when unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await POST(
      req({ mode: "soft", bucketId: BUCKET_ID, prefix: "x/" }),
    );
    expect(res.status).toBe(401);
  });

  it("403 when viewer", async () => {
    mocks.getSession.mockResolvedValueOnce(viewer());
    const res = await POST(
      req({ mode: "soft", bucketId: BUCKET_ID, prefix: "x/" }),
    );
    expect(res.status).toBe(403);
  });

  it("415 on non-JSON content-type", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    const res = await POST(
      req(
        { mode: "soft", bucketId: BUCKET_ID, prefix: "x/" },
        { "content-type": "text/plain" },
      ),
    );
    expect(res.status).toBe(415);
  });

  it("400 on prefix without trailing slash", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    const res = await POST(
      req({ mode: "soft", bucketId: BUCKET_ID, prefix: "no-slash" }),
    );
    expect(res.status).toBe(400);
  });

  it("404 when bucket not found", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    mocks.findUniqueBucket.mockResolvedValueOnce(null);
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-1" });
    const res = await POST(
      req({ mode: "soft", bucketId: BUCKET_ID, prefix: "x/" }),
    );
    expect(res.status).toBe(404);
  });

  it("200 happy path soft delete delegates to softDeleteFolder", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    mocks.findUniqueBucket.mockResolvedValueOnce({
      id: BUCKET_ID,
      name: "helpucompli-docs-test",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.softDeleteFolder.mockResolvedValueOnce({
      filesDeleted: 3,
      folderMarkersDeleted: 1,
    });
    const res = await POST(
      req({ mode: "soft", bucketId: BUCKET_ID, prefix: "x/" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { filesDeleted: number } };
    expect(body.data.filesDeleted).toBe(3);
    expect(mocks.softDeleteFolder).toHaveBeenCalledOnce();
  });

  it("409 maps Prisma P2003 FK violation to clearer message", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    mocks.findUniqueBucket.mockResolvedValueOnce({
      id: BUCKET_ID,
      name: "helpucompli-docs-test",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-1" });
    const { Prisma } = await import("@prisma/client");
    const fkErr = new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed",
      { code: "P2003", clientVersion: "test" },
    );
    mocks.hardDeleteFolder.mockRejectedValueOnce(fkErr);
    const res = await POST(
      req({
        mode: "hard",
        bucketId: BUCKET_ID,
        prefix: "invoices/",
        confirmName: "invoices",
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/active records/i);
  });

  it("500 generic on unexpected error without engine leak", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    mocks.findUniqueBucket.mockResolvedValueOnce({
      id: BUCKET_ID,
      name: "helpucompli-docs-test",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.hardDeleteFolder.mockRejectedValueOnce(
      new Error("arn:aws:kms DATABASE_URL=secret"),
    );
    const res = await POST(
      req({
        mode: "hard",
        bucketId: BUCKET_ID,
        prefix: "invoices/",
        confirmName: "invoices",
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(body)).not.toContain("arn:aws:kms");
  });

  it("400 hard delete with mismatched confirmName", async () => {
    mocks.getSession.mockResolvedValueOnce(superadmin());
    mocks.findUniqueBucket.mockResolvedValueOnce({
      id: BUCKET_ID,
      name: "helpucompli-docs-test",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValueOnce({ id: "u-1" });
    const res = await POST(
      req({
        mode: "hard",
        bucketId: BUCKET_ID,
        prefix: "invoices/",
        confirmName: "wrong",
      }),
    );
    expect(res.status).toBe(400);
  });
});
