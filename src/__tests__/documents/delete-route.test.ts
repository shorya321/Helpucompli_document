import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueBucket: vi.fn(),
  findFirstDocument: vi.fn(),
  countGeneratedLinks: vi.fn(),
  upsertUser: vi.fn(),
  findFirstBucketAccess: vi.fn(),
  softDeleteObject: vi.fn(),
  listObjectVersions: vi.fn(),
  hardDeleteObjectVersion: vi.fn(),
  transaction: vi.fn(),
  documentUpdate: vi.fn(),
  documentDelete: vi.fn(),
  generatedLinkDeleteMany: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bucket: { findUnique: mocks.findUniqueBucket },
    document: { findFirst: mocks.findFirstDocument },
    generatedLink: { count: mocks.countGeneratedLinks },
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
    softDeleteObject: mocks.softDeleteObject,
    listObjectVersions: mocks.listObjectVersions,
    hardDeleteObjectVersion: mocks.hardDeleteObjectVersion,
  };
});

import { POST } from "@/app/api/s3/delete/route";
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
  return new NextRequest("http://x/api/s3/delete", {
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

const softBody = {
  mode: "soft" as const,
  bucketId: BUCKET_ID,
  s3Key: "abc-report.pdf",
};
const hardBody = {
  mode: "hard" as const,
  bucketId: BUCKET_ID,
  s3Key: "abc-report.pdf",
  confirmName: "report.pdf",
};
const docRow = {
  id: DOC_ID,
  bucketId: BUCKET_ID,
  s3Key: "abc-report.pdf",
  filename: "report.pdf",
  contentType: "application/pdf",
  isDeleted: false,
};

function txStub() {
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    return fn({
      document: {
        update: mocks.documentUpdate,
        delete: mocks.documentDelete,
      },
      generatedLink: { deleteMany: mocks.generatedLinkDeleteMany },
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

describe("POST /api/s3/delete — soft", () => {
  it("401 without session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await POST(req(softBody));
    expect(res.status).toBe(401);
  });

  it("403 for viewer", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    const res = await POST(req(softBody));
    expect(res.status).toBe(403);
  });

  it("400 on schema fail", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(req({ ...softBody, bucketId: "nope" }));
    expect(res.status).toBe(400);
  });

  it("404 when bucket missing", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue(null);
    const res = await POST(req(softBody));
    expect(res.status).toBe(404);
  });

  it("404 when document missing", async () => {
    mocks.getSession.mockResolvedValue(admin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(null);
    const res = await POST(req(softBody));
    expect(res.status).toBe(404);
  });

  it("410 when already deleted (idempotency guard)", async () => {
    mocks.getSession.mockResolvedValue(admin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue({ ...docRow, isDeleted: true });
    mocks.upsertUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockResolvedValue({ userId: "user-a" });
    const res = await POST(req(softBody));
    expect(res.status).toBe(410);
  });

  it("403 when admin lacks UserBucketAccess", async () => {
    mocks.getSession.mockResolvedValue(admin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.upsertUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockResolvedValue(null);
    const res = await POST(req(softBody));
    expect(res.status).toBe(403);
  });

  it("200 soft-deletes + DOCUMENT_SOFT_DELETE audit", async () => {
    mocks.getSession.mockResolvedValue(admin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.upsertUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockResolvedValue({ userId: "user-a" });
    mocks.softDeleteObject.mockResolvedValue({ deleteMarker: true });
    mocks.documentUpdate.mockResolvedValue({ id: DOC_ID });
    mocks.auditLogCreate.mockResolvedValue({});
    txStub();

    const res = await POST(req(softBody));
    expect(res.status).toBe(200);
    expect(mocks.softDeleteObject).toHaveBeenCalledTimes(1);
    expect(mocks.documentUpdate).toHaveBeenCalledTimes(1);
    const updateCall = mocks.documentUpdate.mock.calls[0]![0] as {
      data: { isDeleted: boolean };
    };
    expect(updateCall.data.isDeleted).toBe(true);
    const audit = mocks.auditLogCreate.mock.calls[0]![0] as {
      data: { action: string };
    };
    expect(audit.data.action).toBe("DOCUMENT_SOFT_DELETE");
  });
});

describe("POST /api/s3/delete — hard", () => {
  it("403 for admin (superadmin-only)", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(req(hardBody));
    expect(res.status).toBe(403);
  });

  it("400 when confirmName mismatches filename", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    const res = await POST(req({ ...hardBody, confirmName: "wrong.pdf" }));
    expect(res.status).toBe(400);
  });

  it("200 even when active links exist — links cascaded inside tx", async () => {
    // Hard-delete is superadmin-only + typed-name confirmed; redundant
    // "revoke first" gate has been removed. Guard regression test:
    // route MUST drop links inside the same transaction (FK is
    // RESTRICT, so order matters) and MUST NOT consult any link count.
    mocks.getSession.mockResolvedValue(superadmin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.listObjectVersions.mockResolvedValue({ versions: [], isTruncated: false });
    mocks.generatedLinkDeleteMany.mockResolvedValue({ count: 4 });
    mocks.documentDelete.mockResolvedValue({ id: DOC_ID });
    mocks.auditLogCreate.mockResolvedValue({});
    txStub();

    const res = await POST(req(hardBody));
    expect(res.status).toBe(200);
    expect(mocks.countGeneratedLinks).not.toHaveBeenCalled();
    expect(mocks.generatedLinkDeleteMany).toHaveBeenCalledTimes(1);
    const dmArg = mocks.generatedLinkDeleteMany.mock.calls[0]![0] as {
      where: { documentId: string };
    };
    expect(dmArg.where.documentId).toBe(DOC_ID);
    expect(mocks.documentDelete).toHaveBeenCalledTimes(1);
  });

  it("200 hard-deletes every version + DOCUMENT_HARD_DELETE audit", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.countGeneratedLinks.mockResolvedValue(0);
    mocks.listObjectVersions.mockResolvedValue({
      versions: [
        { key: "abc-report.pdf", versionId: "v1", isLatest: false, isDeleteMarker: false },
        { key: "abc-report.pdf", versionId: "v2", isLatest: true, isDeleteMarker: false },
      ],
      isTruncated: false,
    });
    mocks.hardDeleteObjectVersion.mockResolvedValue({ deleteMarker: false });
    mocks.documentDelete.mockResolvedValue({ id: DOC_ID });
    mocks.auditLogCreate.mockResolvedValue({});
    txStub();

    const res = await POST(req(hardBody));
    expect(res.status).toBe(200);
    expect(mocks.hardDeleteObjectVersion).toHaveBeenCalledTimes(2);
    expect(mocks.documentDelete).toHaveBeenCalledTimes(1);
    const audit = mocks.auditLogCreate.mock.calls[0]![0] as {
      data: { action: string };
    };
    expect(audit.data.action).toBe("DOCUMENT_HARD_DELETE");
  });

  it("case-insensitive confirmName accepted", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.countGeneratedLinks.mockResolvedValue(0);
    mocks.listObjectVersions.mockResolvedValue({ versions: [], isTruncated: false });
    mocks.documentDelete.mockResolvedValue({ id: DOC_ID });
    mocks.auditLogCreate.mockResolvedValue({});
    txStub();

    const res = await POST(req({ ...hardBody, confirmName: "REPORT.PDF" }));
    expect(res.status).toBe(200);
  });

  it("500 generic on S3 err (no engine leak)", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    okBucket();
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.countGeneratedLinks.mockResolvedValue(0);
    mocks.listObjectVersions.mockRejectedValue(
      new Error("arn:aws:kms DATABASE_URL=x"),
    );
    const res = await POST(req(hardBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  });
});
