import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getBucketDetails: vi.fn(),
  findUniqueUser: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUniqueUser },
  },
}));

vi.mock("@/lib/bucket-details", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bucket-details")>(
      "@/lib/bucket-details",
    );
  return {
    ...actual,
    getBucketDetails: mocks.getBucketDetails,
  };
});

import { GET } from "@/app/api/s3/buckets/[id]/route";
import { NextRequest } from "next/server";
import {
  BucketAccessDeniedError,
  BucketNotFoundError,
} from "@/lib/bucket-details";

function req(id = "b-1") {
  return new NextRequest(`http://x/api/s3/buckets/${id}`);
}

function ctx(id = "b-1") {
  return { params: Promise.resolve({ id }) };
}

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.getBucketDetails.mockReset();
  mocks.findUniqueUser.mockReset();
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

const payload = {
  id: "b-1",
  name: "helpucompli-docs-acme",
  region: "us-east-1",
  description: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  isActive: true,
  documentCount: 3,
  storageBytes: BigInt(8192),
  recentDocuments: [],
  accessPolicies: [],
  hipaaCompliance: {
    sseKms: true,
    versioning: true,
    publicAccessBlock: true,
    httpsOnlyPolicy: true,
  },
};

describe("GET /api/s3/buckets/[id]", () => {
  it("401 when unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(401);
    expect(mocks.getBucketDetails).not.toHaveBeenCalled();
  });

  it("403 when no valid role", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { sub: "auth0|x", email: "x@x.com" },
    });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
  });

  it("400 when id is missing/empty", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin", "auth0|a"));
    const res = await GET(req(""), ctx(""));
    expect(res.status).toBe(400);
    expect(mocks.getBucketDetails).not.toHaveBeenCalled();
  });

  it("400 when id exceeds 64 chars (guard against payload abuse)", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin", "auth0|long"));
    const long = "a".repeat(200);
    const res = await GET(req(long), ctx(long));
    expect(res.status).toBe(400);
  });

  it("200 + BigInt storage serialized for admin", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin", "auth0|a"));
    mocks.getBucketDetails.mockResolvedValueOnce(payload);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; storageBytes: number | string };
      error: null;
    };
    expect(body.data.id).toBe("b-1");
    expect(body.data.storageBytes).toBe(8192);
  });

  it("superadmin scope passed to lib has no userId", async () => {
    mocks.getSession.mockResolvedValueOnce(session("superadmin", "auth0|su"));
    mocks.getBucketDetails.mockResolvedValueOnce(payload);
    await GET(req(), ctx());
    const scope = mocks.getBucketDetails.mock.calls[0]?.[1];
    expect(scope).toEqual({ role: "superadmin" });
    expect(mocks.findUniqueUser).not.toHaveBeenCalled();
  });

  it("viewer scope resolves auth0 sub → User.id before calling the lib", async () => {
    mocks.getSession.mockResolvedValueOnce(session("viewer", "auth0|v"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-7" });
    mocks.getBucketDetails.mockResolvedValueOnce(payload);
    await GET(req(), ctx());
    expect(mocks.findUniqueUser).toHaveBeenCalledWith({
      where: { auth0Id: "auth0|v" },
      select: { id: true },
    });
    const scope = mocks.getBucketDetails.mock.calls[0]?.[1];
    expect(scope).toEqual({ role: "viewer", userId: "u-7" });
  });

  it("viewer without DB row: 403 (no leak via 404 vs 403 distinction)", async () => {
    mocks.getSession.mockResolvedValueOnce(session("viewer", "auth0|new"));
    mocks.findUniqueUser.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
    expect(mocks.getBucketDetails).not.toHaveBeenCalled();
  });

  it("404 when lib throws BucketNotFoundError (admin)", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin", "auth0|a"));
    mocks.getBucketDetails.mockRejectedValueOnce(
      new BucketNotFoundError("b-missing"),
    );
    const res = await GET(req("b-missing"), ctx("b-missing"));
    expect(res.status).toBe(404);
  });

  it("403 when lib throws BucketAccessDeniedError (viewer)", async () => {
    mocks.getSession.mockResolvedValueOnce(session("viewer", "auth0|v"));
    mocks.findUniqueUser.mockResolvedValueOnce({ id: "u-7" });
    mocks.getBucketDetails.mockRejectedValueOnce(
      new BucketAccessDeniedError("b-1"),
    );
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
  });

  it("429 after 30 requests in 30s for the same user", async () => {
    const sub = "auth0|rate-det";
    for (let i = 0; i < 30; i++) {
      mocks.getSession.mockResolvedValueOnce(session("admin", sub));
      mocks.getBucketDetails.mockResolvedValueOnce(payload);
      const ok = await GET(req(), ctx());
      expect(ok.status).toBe(200);
    }
    mocks.getSession.mockResolvedValueOnce(session("admin", sub));
    const res = await GET(req(), ctx());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("Cache-Control: no-store, private on 200", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin", "auth0|cache"));
    mocks.getBucketDetails.mockResolvedValueOnce(payload);
    const res = await GET(req(), ctx());
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("500 + generic error; never leaks DATABASE_URL", async () => {
    mocks.getSession.mockResolvedValueOnce(session("admin", "auth0|err"));
    mocks.getBucketDetails.mockRejectedValueOnce(
      new Error("postgres://user:secret@host/db oh no"),
    );
    const res = await GET(req(), ctx());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("secret");
    expect(body.error).not.toContain("postgres://");
  });
});
