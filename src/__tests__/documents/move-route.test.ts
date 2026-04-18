import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueBucket: vi.fn(),
  findFirstDocument: vi.fn(),
  upsertUser: vi.fn(),
  findFirstBucketAccess: vi.fn(),
  copyObject: vi.fn(),
  moveObject: vi.fn(),
  transaction: vi.fn(),
  documentCreate: vi.fn(),
  documentUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bucket: { findUnique: mocks.findUniqueBucket },
    document: { findFirst: mocks.findFirstDocument },
    user: { upsert: mocks.upsertUser },
    userBucketAccess: { findFirst: mocks.findFirstBucketAccess },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/s3-objects", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/s3-objects")>("@/lib/s3-objects");
  return {
    ...actual,
    copyObject: mocks.copyObject,
    moveObject: mocks.moveObject,
  };
});

import { POST } from "@/app/api/s3/move/route";
import { NextRequest } from "next/server";

afterEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

const SOURCE_BUCKET = "11111111-1111-1111-1111-111111111111";
const DEST_BUCKET = "22222222-2222-2222-2222-222222222222";
const DOC_ID = "33333333-3333-3333-3333-333333333333";

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
function superadmin() {
  return {
    user: {
      sub: `auth0|su-${Math.random().toString(36).slice(2)}`,
      email: "s@x.com",
      "https://docs.helpucompli.com/role": "superadmin",
    },
  };
}

function req(payload: unknown, headers?: Record<string, string>) {
  return new NextRequest("http://x/api/s3/move", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.3",
      "user-agent": "vitest-ua/1.0",
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const validBody = {
  mode: "move" as const,
  sourceBucketId: SOURCE_BUCKET,
  sourceS3Key: "abc-report.pdf",
  destBucketId: DEST_BUCKET,
  destFolderPrefix: "",
};

const srcDoc = {
  id: DOC_ID,
  bucketId: SOURCE_BUCKET,
  s3Key: "abc-report.pdf",
  filename: "report.pdf",
  contentType: "application/pdf",
  sizeBytes: BigInt(2048),
  isDeleted: false,
};

function txStub() {
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    return fn({
      document: {
        create: mocks.documentCreate,
        update: mocks.documentUpdate,
      },
      auditLog: { create: mocks.auditLogCreate },
    });
  });
}

function twoBuckets(args?: Partial<{ sourceActive: boolean; destActive: boolean }>) {
  const active = { sourceActive: true, destActive: true, ...args };
  mocks.findUniqueBucket.mockImplementation((q: { where: { id: string } }) => {
    if (q.where.id === SOURCE_BUCKET)
      return Promise.resolve({
        id: SOURCE_BUCKET,
        name: "helpucompli-docs-src",
        isActive: active.sourceActive,
      });
    if (q.where.id === DEST_BUCKET)
      return Promise.resolve({
        id: DEST_BUCKET,
        name: "helpucompli-docs-dst",
        isActive: active.destActive,
      });
    return Promise.resolve(null);
  });
}

describe("POST /api/s3/move", () => {
  it("401 without session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
  });

  it("403 for viewer", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
  });

  it("400 on schema fail (unknown mode)", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(req({ ...validBody, mode: "wipe" }));
    expect(res.status).toBe(400);
  });

  it("400 when source and dest identical", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(
      req({ ...validBody, destBucketId: SOURCE_BUCKET, destFolderPrefix: "" }),
    );
    expect(res.status).toBe(400);
  });

  it("404 when source bucket missing", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(404);
  });

  it("409 when destination inactive", async () => {
    mocks.getSession.mockResolvedValue(admin());
    twoBuckets({ destActive: false });
    const res = await POST(req(validBody));
    expect(res.status).toBe(409);
  });

  it("404 when source document missing", async () => {
    mocks.getSession.mockResolvedValue(admin());
    twoBuckets();
    mocks.findFirstDocument.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(404);
  });

  it("410 when source document soft-deleted", async () => {
    mocks.getSession.mockResolvedValue(admin());
    twoBuckets();
    mocks.findFirstDocument.mockResolvedValue({ ...srcDoc, isDeleted: true });
    const res = await POST(req(validBody));
    expect(res.status).toBe(410);
  });

  it("403 when admin lacks access to source bucket", async () => {
    mocks.getSession.mockResolvedValue(admin());
    twoBuckets();
    mocks.findFirstDocument.mockResolvedValue(srcDoc);
    mocks.upsertUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockImplementation(
      (q: { where: { bucketId: string } }) =>
        q.where.bucketId === SOURCE_BUCKET
          ? Promise.resolve(null)
          : Promise.resolve({ userId: "user-a" }),
    );
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
  });

  it("403 when admin lacks access to destination bucket", async () => {
    mocks.getSession.mockResolvedValue(admin());
    twoBuckets();
    mocks.findFirstDocument.mockResolvedValue(srcDoc);
    mocks.upsertUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockImplementation(
      (q: { where: { bucketId: string } }) =>
        q.where.bucketId === DEST_BUCKET
          ? Promise.resolve(null)
          : Promise.resolve({ userId: "user-a" }),
    );
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
  });

  it("201 moves via moveObject + updates Document row + DOCUMENT_MOVE audit", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    twoBuckets();
    mocks.findFirstDocument.mockResolvedValue(srcDoc);
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.moveObject.mockResolvedValue(undefined);
    mocks.documentUpdate.mockResolvedValue({ id: DOC_ID });
    mocks.auditLogCreate.mockResolvedValue({});
    txStub();

    const res = await POST(req(validBody));
    expect(res.status).toBe(201);
    expect(mocks.moveObject).toHaveBeenCalledTimes(1);
    expect(mocks.documentUpdate).toHaveBeenCalledTimes(1);
    const audit = mocks.auditLogCreate.mock.calls[0]![0] as {
      data: { action: string };
    };
    expect(audit.data.action).toBe("DOCUMENT_MOVE");
  });

  it("201 copies via copyObject + creates new Document + DOCUMENT_COPY audit", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    twoBuckets();
    mocks.findFirstDocument.mockResolvedValue(srcDoc);
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.copyObject.mockResolvedValue(undefined);
    mocks.documentCreate.mockResolvedValue({ id: "new-doc-1" });
    mocks.auditLogCreate.mockResolvedValue({});
    txStub();

    const res = await POST(req({ ...validBody, mode: "copy" }));
    expect(res.status).toBe(201);
    expect(mocks.copyObject).toHaveBeenCalledTimes(1);
    expect(mocks.moveObject).not.toHaveBeenCalled();
    expect(mocks.documentCreate).toHaveBeenCalledTimes(1);
    const audit = mocks.auditLogCreate.mock.calls[0]![0] as {
      data: { action: string };
    };
    expect(audit.data.action).toBe("DOCUMENT_COPY");
  });

  it("500 generic when S3 op throws (no engine leak)", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    twoBuckets();
    mocks.findFirstDocument.mockResolvedValue(srcDoc);
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.moveObject.mockRejectedValue(
      new Error("arn:aws:kms:leak DATABASE_URL=x"),
    );
    const res = await POST(req(validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  });
});
