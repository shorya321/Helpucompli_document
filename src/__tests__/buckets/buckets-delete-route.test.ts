import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  deleteBucketForTenant: vi.fn(),
  findUniqueUser: vi.fn(),
  findUniqueBucket: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUniqueUser },
    bucket: { findUnique: mocks.findUniqueBucket },
  },
}));

vi.mock("@/lib/bucket-delete", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bucket-delete")>(
      "@/lib/bucket-delete",
    );
  return {
    ...actual,
    deleteBucketForTenant: mocks.deleteBucketForTenant,
  };
});

import { DELETE } from "@/app/api/s3/buckets/[id]/route";
import { NextRequest } from "next/server";
import {
  BucketAlreadyDeletedError,
  BucketHasActiveDocumentsError,
  BucketNotFoundForDeleteError,
} from "@/lib/bucket-delete";

function req(
  id: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  return new NextRequest(`http://x/api/s3/buckets/${id}`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "10.0.0.9",
      "user-agent": "vitest-ua/1.0",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.deleteBucketForTenant.mockReset();
  mocks.findUniqueUser.mockReset();
  mocks.findUniqueBucket.mockReset();
});

function session(role: string, sub = "auth0|x") {
  return {
    user: {
      sub,
      email: "x@x.com",
      "https://docs.helpucompli.com/role": role,
    },
  };
}

const NAME = "helpucompli-docs-acme";
const BODY = { confirmName: NAME };

describe("DELETE /api/s3/buckets/[id]", () => {
  it("401 when unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await DELETE(req("b-1", BODY), ctx("b-1"));
    expect(res.status).toBe(401);
    expect(mocks.deleteBucketForTenant).not.toHaveBeenCalled();
  });

  it("403 for admin — superadmin only", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin"));
    const res = await DELETE(req("b-1", BODY), ctx("b-1"));
    expect(res.status).toBe(403);
  });

  it("403 for viewer", async () => {
    mocks.getSession.mockResolvedValueOnce(session("viewer"));
    const res = await DELETE(req("b-1", BODY), ctx("b-1"));
    expect(res.status).toBe(403);
  });

  it("415 when Content-Type is not application/json", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-1" });
    const r = new NextRequest("http://x/api/s3/buckets/b-1", {
      method: "DELETE",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(BODY),
    });
    const res = await DELETE(r, ctx("b-1"));
    expect(res.status).toBe(415);
  });

  it("400 when body is not valid JSON", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-1" });
    const r = new NextRequest("http://x/api/s3/buckets/b-1", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: "{{not-json",
    });
    const res = await DELETE(r, ctx("b-1"));
    expect(res.status).toBe(400);
  });

  it("400 when confirmName is missing or empty", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-1" });
    const res = await DELETE(req("b-1", {}), ctx("b-1"));
    expect(res.status).toBe(400);
  });

  it("400 when id exceeds 64 chars", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-1" });
    const long = "a".repeat(100);
    const res = await DELETE(req(long, BODY), ctx(long));
    expect(res.status).toBe(400);
  });

  it("404 when bucket not found (before deleteBucketForTenant runs)", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin", "auth0|s404"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findUniqueBucket.mockResolvedValueOnce(null);
    const res = await DELETE(req("b-missing", BODY), ctx("b-missing"));
    expect(res.status).toBe(404);
    expect(mocks.deleteBucketForTenant).not.toHaveBeenCalled();
  });

  it("accepts confirmName with different case (normalized to lowercase)", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin", "auth0|case"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findUniqueBucket.mockResolvedValueOnce({ name: NAME });
    mocks.deleteBucketForTenant.mockResolvedValueOnce({
      id: "b-1",
      name: NAME,
      isActive: false,
    });
    const res = await DELETE(
      req("b-1", { confirmName: NAME.toUpperCase() }),
      ctx("b-1"),
    );
    expect(res.status).toBe(200);
  });

  it("H1: 409 body does not echo the bucket id (fixed error strings only)", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin", "auth0|leak"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findUniqueBucket.mockResolvedValueOnce({ name: NAME });
    mocks.deleteBucketForTenant.mockRejectedValueOnce(
      new BucketHasActiveDocumentsError("b-secret-id-42"),
    );
    const res = await DELETE(req("b-secret-id-42", BODY), ctx("b-secret-id-42"));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("b-secret-id-42");
  });

  it("400 when confirmName does not match the bucket's actual name", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin", "auth0|s"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.findUniqueBucket.mockResolvedValueOnce({ name: NAME });
    const res = await DELETE(
      req("b-1", { confirmName: "helpucompli-docs-typo" }),
      ctx("b-1"),
    );
    expect(res.status).toBe(400);
    expect(mocks.deleteBucketForTenant).not.toHaveBeenCalled();
  });

  it("401 when superadmin has no DB row — cannot attribute audit row", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin", "auth0|new"));
    mocks.findUniqueBucket.mockResolvedValueOnce({ name: NAME });
    mocks.findUniqueUser.mockResolvedValueOnce(null);
    const res = await DELETE(req("b-1", BODY), ctx("b-1"));
    expect(res.status).toBe(401);
  });

  it("200 on successful deactivation", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin", "auth0|ok"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-ok" });
    mocks.findUniqueBucket.mockResolvedValueOnce({ name: NAME });
    mocks.deleteBucketForTenant.mockResolvedValueOnce({
      id: "b-1",
      name: NAME,
      isActive: false,
    });
    const res = await DELETE(req("b-1", BODY), ctx("b-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; isActive: boolean };
    };
    expect(body.data).toEqual({ id: "b-1", name: NAME, isActive: false });
  });

  it("409 when lib throws BucketHasActiveDocumentsError", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin", "auth0|busy"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-busy" });
    mocks.findUniqueBucket.mockResolvedValueOnce({ name: NAME });
    mocks.deleteBucketForTenant.mockRejectedValueOnce(
      new BucketHasActiveDocumentsError("b-1"),
    );
    const res = await DELETE(req("b-1", BODY), ctx("b-1"));
    expect(res.status).toBe(409);
  });

  it("409 when lib throws BucketAlreadyDeletedError", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin", "auth0|dup"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-dup" });
    mocks.findUniqueBucket.mockResolvedValueOnce({ name: NAME });
    mocks.deleteBucketForTenant.mockRejectedValueOnce(
      new BucketAlreadyDeletedError("b-1"),
    );
    const res = await DELETE(req("b-1", BODY), ctx("b-1"));
    expect(res.status).toBe(409);
  });

  it("404 when lib throws BucketNotFoundForDeleteError (TOCTOU after pre-check)", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin", "auth0|t"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-toctou" });
    mocks.findUniqueBucket.mockResolvedValueOnce({ name: NAME });
    mocks.deleteBucketForTenant.mockRejectedValueOnce(
      new BucketNotFoundForDeleteError("b-1"),
    );
    const res = await DELETE(req("b-1", BODY), ctx("b-1"));
    expect(res.status).toBe(404);
  });

  it("429 after 5 deletes in 60s for the same user", async () => {
    const sub = "auth0|rate-del";
    for (let i = 0; i < 5; i++) {
      mocks.getSession.mockResolvedValueOnce(session("superadmin", sub));
      mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-rate" });
      mocks.findUniqueBucket.mockResolvedValueOnce({ name: NAME });
      mocks.deleteBucketForTenant.mockResolvedValueOnce({
        id: `b-${i}`,
        name: NAME,
        isActive: false,
      });
      const ok = await DELETE(req(`b-${i}`, BODY), ctx(`b-${i}`));
      expect(ok.status).toBe(200);
    }
    // 6th call still needs the findUniqueUser mock — rate-limit runs
    // AFTER the DB user resolve (sec-review M3 reorder).
    mocks.getSession.mockResolvedValueOnce(session("superadmin", sub));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-rate" });
    const res = await DELETE(req("b-x", BODY), ctx("b-x"));
    expect(res.status).toBe(429);
  });

  it("500 + generic error; never leaks DATABASE_URL", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin", "auth0|err"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-err" });
    mocks.findUniqueBucket.mockResolvedValueOnce({ name: NAME });
    mocks.deleteBucketForTenant.mockRejectedValueOnce(
      new Error("postgres://user:secret@host/db connection refused"),
    );
    const res = await DELETE(req("b-1", BODY), ctx("b-1"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("secret");
    expect(body.error).not.toContain("postgres://");
  });
});
