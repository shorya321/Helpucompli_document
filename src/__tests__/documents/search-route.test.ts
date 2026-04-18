import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUniqueUser: vi.fn(),
  searchDocuments: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUniqueUser },
    document: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock("@/lib/document-search", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/document-search")>(
      "@/lib/document-search",
    );
  return { ...actual, searchDocuments: mocks.searchDocuments };
});

import { GET } from "@/app/api/documents/search/route";
import { NextRequest } from "next/server";

afterEach(() => {
  Object.values(mocks).forEach((m) =>
    typeof m === "function" && "mockReset" in m ? m.mockReset() : undefined,
  );
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
function viewer() {
  return {
    user: {
      sub: `auth0|v-${Math.random().toString(36).slice(2)}`,
      email: "v@x.com",
      "https://docs.helpucompli.com/role": "viewer",
    },
  };
}

function req(url = "http://x/api/documents/search") {
  return new NextRequest(url);
}

describe("GET /api/documents/search", () => {
  it("401 without session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("400 on invalid query", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    const res = await GET(req("http://x/api/documents/search?sort=hacked"));
    expect(res.status).toBe(400);
  });

  it("viewer with no User row returns empty list (not 403)", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    mocks.findUniqueUser.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.documents).toEqual([]);
  });

  it("viewer scope passes userId to searchDocuments", async () => {
    mocks.getSession.mockResolvedValue(viewer());
    mocks.findUniqueUser.mockResolvedValue({ id: "user-v" });
    mocks.searchDocuments.mockResolvedValue({
      documents: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const call = mocks.searchDocuments.mock.calls[0]![1] as {
      role: string;
      userId?: string;
    };
    expect(call.role).toBe("viewer");
    expect(call.userId).toBe("user-v");
  });

  it("superadmin bypasses user lookup", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.searchDocuments.mockResolvedValue({
      documents: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mocks.findUniqueUser).not.toHaveBeenCalled();
  });

  it("serialises BigInt sizeBytes to JSON-safe number/string", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.searchDocuments.mockResolvedValue({
      documents: [
        {
          id: "d1",
          bucketId: "b1",
          s3Key: "k",
          filename: "a",
          contentType: "application/pdf",
          sizeBytes: BigInt(2048),
          uploadedAt: new Date("2026-04-10T00:00:00Z"),
          uploadedBy: { id: "u", name: "A", email: "a@x" },
          isDeleted: false,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('"sizeBytes":{}');
    expect(body).toContain('"sizeBytes":');
  });

  it("500 generic when searchDocuments throws (no engine leak)", async () => {
    mocks.getSession.mockResolvedValue(superadmin());
    mocks.searchDocuments.mockRejectedValue(
      new Error("engine://DATABASE_URL=x"),
    );
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
  });
});
