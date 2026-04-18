import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueBucket: vi.fn(),
  upsertUser: vi.fn(),
  transaction: vi.fn(),
  completeMultipartUpload: vi.fn(),
  headObject: vi.fn(),
  documentCreate: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bucket: { findUnique: mocks.findUniqueBucket },
    user: { upsert: mocks.upsertUser },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/s3-multipart", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/s3-multipart")>("@/lib/s3-multipart");
  return {
    ...actual,
    completeMultipartUpload: mocks.completeMultipartUpload,
  };
});

vi.mock("@/lib/s3-objects", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/s3-objects")>("@/lib/s3-objects");
  return {
    ...actual,
    headObject: mocks.headObject,
  };
});

import { POST } from "@/app/api/s3/upload-complete/route";
import { NextRequest } from "next/server";

afterEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

function admin() {
  return {
    user: {
      sub: `auth0|a-${Math.random().toString(36).slice(2)}`,
      email: "a@x.com",
      name: "Admin A",
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

const BUCKET_ID = "22222222-2222-2222-2222-222222222222";
const validBody = {
  bucketId: BUCKET_ID,
  s3Key: "abc-report.pdf",
  filename: "report.pdf",
  contentType: "application/pdf",
  sizeBytes: 2048,
};

function req(payload: unknown, headers?: Record<string, string>) {
  return new NextRequest("http://x/api/s3/upload-complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.5",
      "user-agent": "vitest-ua/1.0",
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

function txStub() {
  // Fake $transaction runs the callback immediately with a tx stub.
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    return fn({
      document: { create: mocks.documentCreate },
      auditLog: { create: mocks.auditLogCreate },
    });
  });
}

describe("POST /api/s3/upload-complete", () => {
  it("401 when no session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
  });

  it("403 for viewer", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
  });

  it("415 on non-JSON", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(req(validBody, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
  });

  it("400 on schema failure", async () => {
    mocks.getSession.mockResolvedValue(admin());
    const res = await POST(req({ ...validBody, s3Key: "/abs" }));
    expect(res.status).toBe(400);
  });

  it("404 when bucket not found", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(404);
  });

  it("409 when bucket inactive", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: false,
    });
    const res = await POST(req(validBody));
    expect(res.status).toBe(409);
  });

  it("422 when S3 has no object at key (upload failed/aborted)", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-1" });
    // headObject throws (S3 returns NotFound)
    mocks.headObject.mockRejectedValue(
      Object.assign(new Error("NotFound"), { name: "NotFound" }),
    );
    const res = await POST(req(validBody));
    expect(res.status).toBe(422);
  });

  it("201 writes Document + audit in a transaction (simple upload)", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-1" });
    mocks.headObject.mockResolvedValue({ contentLength: 2048 });
    mocks.documentCreate.mockResolvedValue({ id: "doc-1" });
    mocks.auditLogCreate.mockResolvedValue({});
    txStub();

    const res = await POST(req(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe("doc-1");
    expect(mocks.documentCreate).toHaveBeenCalledTimes(1);
    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);
    const auditCall = mocks.auditLogCreate.mock.calls[0]![0] as {
      data: { action: string };
    };
    expect(auditCall.data.action).toBe("DOCUMENT_UPLOAD");
  });

  it("400 when sizeBytes mismatches S3 headObject contentLength", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-1" });
    mocks.headObject.mockResolvedValue({ contentLength: 999999 });
    const res = await POST(req(validBody));
    expect(res.status).toBe(400);
  });

  it("calls completeMultipartUpload first when multipart payload given", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-1" });
    mocks.completeMultipartUpload.mockResolvedValue({ etag: '"abc"' });
    mocks.headObject.mockResolvedValue({ contentLength: 2048 });
    mocks.documentCreate.mockResolvedValue({ id: "doc-mp" });
    mocks.auditLogCreate.mockResolvedValue({});
    txStub();

    const res = await POST(
      req({
        ...validBody,
        multipart: {
          uploadId: "uid",
          parts: [
            {
              partNumber: 1,
              etag: '"abcdefabcdefabcdefabcdefabcdef12"',
            },
          ],
        },
      }),
    );
    expect(res.status).toBe(201);
    expect(mocks.completeMultipartUpload).toHaveBeenCalledTimes(1);
  });

  it("500 generic when DB throws", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-1" });
    mocks.headObject.mockResolvedValue({ contentLength: 2048 });
    mocks.transaction.mockRejectedValue(
      new Error("engine leak DATABASE_URL=postgres://..."),
    );
    const res = await POST(req(validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  });
});
