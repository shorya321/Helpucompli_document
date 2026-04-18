import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueBucket: vi.fn(),
  upsertUser: vi.fn(),
  findFirstBucketAccess: vi.fn(),
  presignPutUrl: vi.fn(),
  initiateMultipartUpload: vi.fn(),
  presignUploadPart: vi.fn(),
  abortMultipartUpload: vi.fn(),
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

vi.mock("@/lib/s3-presign", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/s3-presign")>("@/lib/s3-presign");
  return {
    ...actual,
    presignPutUrl: mocks.presignPutUrl,
  };
});

vi.mock("@/lib/s3-multipart", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/s3-multipart")>("@/lib/s3-multipart");
  return {
    ...actual,
    initiateMultipartUpload: mocks.initiateMultipartUpload,
    presignUploadPart: mocks.presignUploadPart,
    abortMultipartUpload: mocks.abortMultipartUpload,
  };
});

vi.mock("@/lib/upload-receipt", () => ({
  issueUploadReceipt: vi.fn(() => "stub-payload.stub-sig"),
  verifyUploadReceipt: vi.fn(() => true),
  InvalidUploadReceiptError: class extends Error {},
}));

import { POST } from "@/app/api/s3/upload-url/route";
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

const BUCKET_ID = "11111111-1111-1111-1111-111111111111";

function req(payload: unknown, headers?: Record<string, string>) {
  return new NextRequest("http://x/api/s3/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

const validBody = {
  bucketId: BUCKET_ID,
  filename: "report.pdf",
  contentType: "application/pdf",
  sizeBytes: 2048,
  folderPrefix: "",
};

describe("POST /api/s3/upload-url", () => {
  it("401 when session missing", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
  });

  it("403 for viewer", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
  });

  it("415 on non-JSON content-type", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    const res = await POST(req(validBody, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
  });

  it("400 on invalid JSON body", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    const res = await POST(req("{not json"));
    expect(res.status).toBe(400);
  });

  it("400 on schema fail", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    const res = await POST(req({ ...validBody, sizeBytes: -1 }));
    expect(res.status).toBe(400);
  });

  it("404 when bucket not found", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(404);
  });

  it("409 when bucket inactive", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: false,
    });
    const res = await POST(req(validBody));
    expect(res.status).toBe(409);
  });

  it("returns simple presigned URL for small files", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.presignPutUrl.mockResolvedValue("https://s3/signed-put");
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.mode).toBe("simple");
    expect(body.data.url).toBe("https://s3/signed-put");
    expect(body.data.s3Key).toMatch(/-report\.pdf$/);
    expect(body.data.receipt).toMatch(/\./);
  });

  it("403 when admin lacks UserBucketAccess for the target bucket", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-foreign",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-admin" });
    mocks.findFirstBucketAccess.mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
    expect(mocks.presignPutUrl).not.toHaveBeenCalled();
  });

  it("200 when admin HAS UserBucketAccess for the target bucket", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-admin" });
    mocks.findFirstBucketAccess.mockResolvedValue({ userId: "user-admin" });
    mocks.presignPutUrl.mockResolvedValue("https://s3/signed");
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
  });

  it("returns multipart plan for files > 100 MB", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.initiateMultipartUpload.mockResolvedValue({ uploadId: "uid-1" });
    mocks.presignUploadPart.mockImplementation((args: { partNumber: number }) =>
      Promise.resolve(`https://s3/part-${args.partNumber}`),
    );
    const bigBody = {
      ...validBody,
      filename: "big.bin",
      contentType: "application/octet-stream",
      sizeBytes: 200 * 1024 * 1024,
    };
    const res = await POST(req(bigBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.mode).toBe("multipart");
    expect(body.data.uploadId).toBe("uid-1");
    expect(Array.isArray(body.data.parts)).toBe(true);
    expect(body.data.parts.length).toBeGreaterThan(1);
    expect(body.data.parts[0]).toEqual({ partNumber: 1, url: "https://s3/part-1" });
  });

  it("admin with bucket access is allowed", async () => {
    mocks.getSession.mockResolvedValue(admin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-admin" });
    mocks.findFirstBucketAccess.mockResolvedValue({ userId: "user-admin" });
    mocks.presignPutUrl.mockResolvedValue("https://s3/signed");
    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
  });

  it("500 generic when presign throws", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.presignPutUrl.mockRejectedValue(
      new Error("engine://secret/DATABASE_URL leak"),
    );
    const res = await POST(req(validBody));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to issue upload URL");
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  });

  it("generates unique s3Key per request (uuid-prefixed)", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.findUniqueBucket.mockResolvedValue({
      id: BUCKET_ID,
      name: "helpucompli-docs-acme",
      isActive: true,
    });
    mocks.upsertUser.mockResolvedValue({ id: "user-su" });
    mocks.presignPutUrl.mockResolvedValue("https://s3/signed");
    const r1 = await POST(req(validBody));
    const r2 = await POST(req(validBody));
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b1.data.s3Key).not.toBe(b2.data.s3Key);
  });
});
