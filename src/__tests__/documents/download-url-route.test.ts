import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueBucket: vi.fn(),
  findFirstDocument: vi.fn(),
  upsertUser: vi.fn(),
  findFirstBucketAccess: vi.fn(),
  presignGetUrl: vi.fn(),
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
    auditLog: { create: mocks.auditLogCreate },
  },
}));

vi.mock("@/lib/s3-presign", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/s3-presign")>("@/lib/s3-presign");
  return {
    ...actual,
    presignGetUrl: mocks.presignGetUrl,
  };
});

import { POST } from "@/app/api/s3/download-url/route";
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
  return new NextRequest("http://x/api/s3/download-url", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.4",
      "user-agent": "vitest-ua/1.0",
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const validBody = { bucketId: BUCKET_ID, s3Key: "abc-report.pdf" };
const docRow = {
  id: DOC_ID,
  bucketId: BUCKET_ID,
  s3Key: "abc-report.pdf",
  filename: "report.pdf",
  contentType: "application/pdf",
  isDeleted: false,
};

describe("POST /api/s3/download-url", () => {
  it("401 when no session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
  });

  it("400 on schema fail", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(req({ bucketId: "nope", s3Key: "/abs" }));
    expect(res.status).toBe(400);
  });

  it("404 when bucket missing", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(404);
  });

  it("404 when document missing", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.findFirstDocument.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(404);
  });

  it("410 when document soft-deleted", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.findFirstDocument.mockResolvedValue({ ...docRow, isDeleted: true });
    const res = await POST(req(validBody));
    expect(res.status).toBe(410);
  });

  it("403 when viewer lacks UserBucketAccess", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.upsertUser.mockResolvedValue({ id: "user-v" });
    mocks.findFirstBucketAccess.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
  });

  it("403 when admin lacks UserBucketAccess", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.upsertUser.mockResolvedValue({ id: "user-a" });
    mocks.findFirstBucketAccess.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
  });

  it("200 with presigned URL for superadmin + audit DOCUMENT_DOWNLOAD", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.presignGetUrl.mockResolvedValue("https://s3/signed-get");
    mocks.auditLogCreate.mockResolvedValue({});
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.url).toBe("https://s3/signed-get");
    expect(body.data.expiresIn).toBeGreaterThan(0);
    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);
    const audit = mocks.auditLogCreate.mock.calls[0]![0] as {
      data: { action: string; targetId: string };
    };
    expect(audit.data.action).toBe("DOCUMENT_DOWNLOAD");
    expect(audit.data.targetId).toBe(DOC_ID);
  });

  it("200 for viewer with UserBucketAccess row", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.upsertUser.mockResolvedValue({ id: "user-v" });
    mocks.findFirstBucketAccess.mockResolvedValue({ userId: "user-v" });
    mocks.presignGetUrl.mockResolvedValue("https://s3/signed-get");
    mocks.auditLogCreate.mockResolvedValue({});
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
  });

  it("sanitizes filename for Content-Disposition", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.findFirstDocument.mockResolvedValue({
      ...docRow,
      filename: 'weird"name.pdf',
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.presignGetUrl.mockResolvedValue("https://s3/signed-get");
    mocks.auditLogCreate.mockResolvedValue({});
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    const callArg = mocks.presignGetUrl.mock.calls[0]![0] as {
      responseContentDisposition?: string;
    };
    expect(callArg.responseContentDisposition).not.toContain('"weird"');
  });

  it("500 generic on presign error (no engine leak)", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.findFirstDocument.mockResolvedValue(docRow);
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.presignGetUrl.mockRejectedValue(
      new Error("arn:aws:kms:leak DATABASE_URL=x"),
    );
    const res = await POST(req(validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  });
});
