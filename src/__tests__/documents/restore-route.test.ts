import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueBucket: vi.fn(),
  findFirstDocument: vi.fn(),
  ensureUser: vi.fn(),
  findFirstBucketAccess: vi.fn(),
  restoreObject: vi.fn(),
  transaction: vi.fn(),
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
    userBucketAccess: { findFirst: mocks.findFirstBucketAccess },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/ensure-user", () => ({
  ensureUser: mocks.ensureUser,
}));

vi.mock("@/lib/s3-objects", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/s3-objects")>("@/lib/s3-objects");
  return {
    ...actual,
    restoreObject: mocks.restoreObject,
  };
});

import { POST } from "@/app/api/s3/restore/route";
import { NotDeletedError } from "@/lib/s3-objects";
import { NextRequest } from "next/server";

afterEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

const BUCKET_ID = "11111111-1111-1111-1111-111111111111";
const DOC_ID = "22222222-2222-2222-2222-222222222222";

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
  return new NextRequest("http://x/api/s3/restore", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.8",
      "user-agent": "vitest-ua/1.0",
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const body = {
  bucketId: BUCKET_ID,
  s3Key: "abc-report.pdf",
};

const docRow = {
  id: DOC_ID,
  bucketId: BUCKET_ID,
  s3Key: "abc-report.pdf",
  filename: "report.pdf",
  contentType: "application/pdf",
  isDeleted: true,
};

function txStub() {
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    return fn({
      document: { update: mocks.documentUpdate },
      auditLog: { create: mocks.auditLogCreate },
    });
  });
}

function okBucket(active = true) {
  mocks.findUniqueBucket.mockResolvedValue({
    id: BUCKET_ID,
    name: "helpucompli-docs-acme",
    isActive: active,
  });
}

describe("POST /api/s3/restore", () => {
  it("401 without session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await POST(req(body));
    expect(res.status).toBe(401);
  });

  it("403 for viewer", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    const res = await POST(req(body));
    expect(res.status).toBe(403);
  });

  it("415 on non-JSON content-type", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(
      req(body, { "content-type": "text/plain" }),
    );
    expect(res.status).toBe(415);
  });

  it("400 on schema fail", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(req({ ...body, bucketId: "nope" }));
    expect(res.status).toBe(400);
  });

  it("400 on s3Key with traversal", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(req({ ...body, s3Key: "../etc/passwd" }));
    expect(res.status).toBe(400);
  });

  it("404 when bucket missing", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue(null);
    const res = await POST(req(body));
    expect(res.status).toBe(404);
  });

  it("409 when bucket inactive", async () => {
    mocks.getSession.mockResolvedValue(admin());
    okBucket(false);
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.ensureUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockResolvedValue({ userId: "user-a" });
    const res = await POST(req(body));
    expect(res.status).toBe(409);
  });

  it("404 when document missing", async () => {
    mocks.getSession.mockResolvedValue(admin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(null);
    const res = await POST(req(body));
    expect(res.status).toBe(404);
  });

  it("409 when document is not soft-deleted", async () => {
    mocks.getSession.mockResolvedValue(admin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue({ ...docRow, isDeleted: false });
    mocks.ensureUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockResolvedValue({ userId: "user-a" });
    const res = await POST(req(body));
    expect(res.status).toBe(409);
  });

  it("403 when admin lacks UserBucketAccess", async () => {
    mocks.getSession.mockResolvedValue(admin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.ensureUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockResolvedValue(null);
    const res = await POST(req(body));
    expect(res.status).toBe(403);
  });

  it("409 when no delete-marker on S3 (NotDeletedError)", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.ensureUser.mockResolvedValue({ id: "user-su" });
    mocks.restoreObject.mockRejectedValue(new NotDeletedError("no marker"));
    const res = await POST(req(body));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/not.*delete/i);
  });

  it("500 on unexpected S3 error", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.ensureUser.mockResolvedValue({ id: "user-su" });
    mocks.restoreObject.mockRejectedValue(new Error("boom"));
    const res = await POST(req(body));
    expect(res.status).toBe(500);
  });

  it("200 restores: clears flags + DOCUMENT_RESTORE audit", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.ensureUser.mockResolvedValue({ id: "user-su" });
    mocks.restoreObject.mockResolvedValue({ restoredFromVersionId: "dm-1" });
    mocks.documentUpdate.mockResolvedValue({ id: DOC_ID });
    mocks.auditLogCreate.mockResolvedValue({});
    txStub();

    const res = await POST(req(body));
    expect(res.status).toBe(200);
    expect(mocks.restoreObject).toHaveBeenCalledTimes(1);

    const updateCall = mocks.documentUpdate.mock.calls[0]![0] as {
      data: { isDeleted: boolean; deletedAt: Date | null; deletedById: string | null };
    };
    expect(updateCall.data.isDeleted).toBe(false);
    expect(updateCall.data.deletedAt).toBeNull();
    expect(updateCall.data.deletedById).toBeNull();

    const audit = mocks.auditLogCreate.mock.calls[0]![0] as {
      data: { action: string; metadata: { restoredFromVersionId: string } };
    };
    expect(audit.data.action).toBe("DOCUMENT_RESTORE");
    expect(audit.data.metadata.restoredFromVersionId).toBe("dm-1");
  });

  it("admin with userBucketAccess can restore", async () => {
    mocks.getSession.mockResolvedValue(admin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.ensureUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockResolvedValue({ userId: "user-a" });
    mocks.restoreObject.mockResolvedValue({ restoredFromVersionId: "dm-1" });
    mocks.documentUpdate.mockResolvedValue({ id: DOC_ID });
    mocks.auditLogCreate.mockResolvedValue({});
    txStub();

    const res = await POST(req(body));
    expect(res.status).toBe(200);
  });
});
