import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveRole: vi.fn(),
  verifyReceipt: vi.fn(),
  abort: vi.fn(),
  limit: vi.fn(),
  findBucket: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({ resolveRole: mocks.resolveRole }));
vi.mock("@/lib/s3-multipart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/s3-multipart")>();
  return { ...actual, abortMultipartUpload: mocks.abort };
});
vi.mock("@/lib/upload-receipt", async () => {
  const actual = await vi.importActual<typeof import("@/lib/upload-receipt")>(
    "@/lib/upload-receipt",
  );
  return { ...actual, verifyUploadReceipt: mocks.verifyReceipt };
});
vi.mock("@/lib/prisma", () => ({
  prisma: { bucket: { findUnique: mocks.findBucket } },
}));
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({ limit: mocks.limit }),
}));

import { POST } from "@/app/api/s3/upload-abort/route";
import { NextRequest } from "next/server";

const VALID = {
  bucketId: "11111111-1111-4111-8111-111111111111",
  s3Key: "path/file.pdf",
  uploadId: "upload-abc",
  receipt: "r.e.c",
};

function req(body: unknown = VALID, headers: Record<string, string> = {}) {
  return new NextRequest("http://x/api/s3/upload-abort", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("POST /api/s3/upload-abort", () => {
  it("401 unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it("403 viewer", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|v" } });
    mocks.resolveRole.mockResolvedValueOnce("viewer");
    const res = await POST(req());
    expect(res.status).toBe(403);
  });

  it("415 non-JSON", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveRole.mockResolvedValueOnce("admin");
    const res = await POST(req(VALID, { "content-type": "text/plain" }));
    expect(res.status).toBe(415);
  });

  it("429 rate limited", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce({
      success: false,
      reset: Date.now() + 30_000,
      remaining: 0,
    });
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("400 bad JSON", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce({ success: true, reset: 0 });
    const res = await POST(req("not-json"));
    expect(res.status).toBe(400);
  });

  it("400 schema rejection", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce({ success: true, reset: 0 });
    const res = await POST(req({ nope: true }));
    expect(res.status).toBe(400);
  });

  it("401 bad receipt", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce({ success: true, reset: 0 });
    mocks.verifyReceipt.mockImplementationOnce(() => {
      const err = new Error("bad");
      err.name = "InvalidUploadReceiptError";
      throw err;
    });
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it("404 missing bucket", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce({ success: true, reset: 0 });
    mocks.verifyReceipt.mockReturnValueOnce(undefined);
    mocks.findBucket.mockResolvedValueOnce(null);
    const res = await POST(req());
    expect(res.status).toBe(404);
  });

  it("200 happy path", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce({ success: true, reset: 0 });
    mocks.verifyReceipt.mockReturnValueOnce(undefined);
    mocks.findBucket.mockResolvedValueOnce({
      id: VALID.bucketId,
      name: "helpucompli-docs-main",
      isActive: true,
    });
    mocks.abort.mockResolvedValueOnce(undefined);
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ aborted: true });
  });

  it("500 when S3 abort throws", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce({ success: true, reset: 0 });
    mocks.verifyReceipt.mockReturnValueOnce(undefined);
    mocks.findBucket.mockResolvedValueOnce({
      id: VALID.bucketId,
      name: "helpucompli-docs-main",
      isActive: true,
    });
    mocks.abort.mockRejectedValueOnce(new Error("AWS down"));
    const res = await POST(req());
    expect(res.status).toBe(500);
  });
});
