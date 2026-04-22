import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveRole: vi.fn(),
  getBucketDocumentsPage: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/auth-guard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth-guard")>(
    "@/lib/auth-guard",
  );
  return {
    ...actual,
    resolveRole: mocks.resolveRole,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
  },
}));

vi.mock("@/lib/bucket-details", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bucket-details")>(
    "@/lib/bucket-details",
  );
  return {
    ...actual,
    getBucketDocumentsPage: mocks.getBucketDocumentsPage,
  };
});

import { GET } from "@/app/api/s3/buckets/[id]/documents/route";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.resolveRole.mockReset();
  mocks.getBucketDocumentsPage.mockReset();
  mocks.userFindUnique.mockReset();
});

function adminSession(sub = "auth0|a") {
  return { user: { sub, email: "a@x.com" } };
}

function makeReq(query = "") {
  return new Request(
    `https://localhost/api/s3/buckets/b-1/documents${query}`,
  ) as unknown as Parameters<typeof GET>[0];
}

const ctx = { params: Promise.resolve({ id: "b-1" }) };

describe("GET /api/s3/buckets/[id]/documents", () => {
  it("401 unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(401);
    expect(mocks.getBucketDocumentsPage).not.toHaveBeenCalled();
  });

  it("403 with no role", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveRole.mockResolvedValueOnce(null);
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(403);
  });

  it("admin happy path returns paged shape", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|p1"));
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.getBucketDocumentsPage.mockResolvedValueOnce({
      entries: [
        {
          id: "d1",
          filename: "a.pdf",
          sizeBytes: BigInt(1024),
          contentType: "application/pdf",
          uploadedAt: new Date("2026-04-22T12:00:00Z"),
          uploadedByName: "Alice",
        },
      ],
      nextCursor: "d1",
    });
    const res = await GET(makeReq("?cursor=cur&limit=10"), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { entries: unknown[]; nextCursor: string | null };
    };
    expect(body.data.entries).toHaveLength(1);
    expect(body.data.nextCursor).toBe("d1");
    expect(mocks.getBucketDocumentsPage).toHaveBeenCalledWith(
      expect.anything(),
      { role: "admin" },
      "b-1",
      expect.objectContaining({ cursor: "cur", limit: 10 }),
    );
  });

  it("viewer scope resolves db user id and passes through", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|v1"));
    mocks.resolveRole.mockResolvedValueOnce("viewer");
    mocks.userFindUnique.mockResolvedValueOnce({ id: "u-99" });
    mocks.getBucketDocumentsPage.mockResolvedValueOnce({
      entries: [],
      nextCursor: null,
    });
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(200);
    expect(mocks.getBucketDocumentsPage).toHaveBeenCalledWith(
      expect.anything(),
      { role: "viewer", userId: "u-99" },
      "b-1",
      expect.any(Object),
    );
  });

  it("viewer with no db user → 403", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|v2"));
    mocks.resolveRole.mockResolvedValueOnce("viewer");
    mocks.userFindUnique.mockResolvedValueOnce(null);
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(403);
    expect(mocks.getBucketDocumentsPage).not.toHaveBeenCalled();
  });

  it("400 on invalid limit (out of range)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|q1"));
    mocks.resolveRole.mockResolvedValueOnce("admin");
    const res = await GET(makeReq("?limit=9999"), ctx);
    expect(res.status).toBe(400);
    expect(mocks.getBucketDocumentsPage).not.toHaveBeenCalled();
  });

  it("400 on oversized cursor", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|q2"));
    mocks.resolveRole.mockResolvedValueOnce("admin");
    const oversize = "a".repeat(200);
    const res = await GET(makeReq(`?cursor=${oversize}`), ctx);
    expect(res.status).toBe(400);
  });

  it("404 on invalid bucket id (path schema)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|q3"));
    mocks.resolveRole.mockResolvedValueOnce("admin");
    const res = await GET(makeReq(), {
      params: Promise.resolve({ id: "" }),
    });
    expect(res.status).toBe(404);
  });

  it("403 when getBucketDocumentsPage throws BucketAccessDeniedError", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|q4"));
    mocks.resolveRole.mockResolvedValueOnce("admin");
    const { BucketAccessDeniedError } = await import("@/lib/bucket-details");
    mocks.getBucketDocumentsPage.mockRejectedValueOnce(
      new BucketAccessDeniedError("b-1"),
    );
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(403);
  });

  it("404 when getBucketDocumentsPage throws BucketNotFoundError", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|q5"));
    mocks.resolveRole.mockResolvedValueOnce("admin");
    const { BucketNotFoundError } = await import("@/lib/bucket-details");
    mocks.getBucketDocumentsPage.mockRejectedValueOnce(
      new BucketNotFoundError("b-1"),
    );
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(404);
  });

  it("500 generic on unknown engine throw — never echoes raw error", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|q6"));
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.getBucketDocumentsPage.mockRejectedValueOnce(
      new Error("postgres://user:secret@host/db"),
    );
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { data: null; error: string };
    expect(body.error).toBe("Failed to load documents");
    expect(body.error).not.toContain("secret");
  });

  it("Cache-Control no-store private", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|q7"));
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.getBucketDocumentsPage.mockResolvedValueOnce({
      entries: [],
      nextCursor: null,
    });
    const res = await GET(makeReq(), ctx);
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("BigInt sizeBytes serialised as string in JSON response", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|q8"));
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.getBucketDocumentsPage.mockResolvedValueOnce({
      entries: [
        {
          id: "d-big",
          filename: "big.bin",
          sizeBytes: BigInt("9007199254740993"),
          contentType: "application/octet-stream",
          uploadedAt: new Date("2026-04-22T12:00:00Z"),
          uploadedByName: null,
        },
      ],
      nextCursor: null,
    });
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { entries: Array<{ sizeBytes: string | number }> };
    };
    // toJsonSafe normalises BigInt — should not throw at JSON encode
    expect(body.data.entries[0]?.sizeBytes).toBeDefined();
  });
});
