import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveHasRole: vi.fn(),
  queryAuditLogs: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/auth-guard", () => ({
  resolveHasRole: mocks.resolveHasRole,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { auditLog: { findMany: vi.fn() } },
}));

vi.mock("@/lib/audit-query", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/audit-query")>(
      "@/lib/audit-query",
    );
  return { ...actual, queryAuditLogs: mocks.queryAuditLogs };
});

vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({ limit: mocks.limit }),
}));

import { GET } from "@/app/api/audit/route";
import { NextRequest } from "next/server";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.resolveHasRole.mockReset();
  mocks.queryAuditLogs.mockReset();
  mocks.limit.mockReset();
});

function req(qs = "") {
  return new NextRequest(`http://x/api/audit${qs}`);
}

const okQuota = { success: true, reset: Date.now() + 30_000 };

describe("GET /api/audit", () => {
  it("401 when no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("403 when not admin/superadmin", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { sub: "auth0|v" },
    });
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mocks.queryAuditLogs).not.toHaveBeenCalled();
  });

  it("429 when rate-limited", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce({
      success: false,
      reset: Date.now() + 5000,
    });
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("400 on invalid query (bad action enum)", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(okQuota);
    const res = await GET(req("?actions=NOT_A_REAL_ACTION"));
    expect(res.status).toBe(400);
  });

  it("200 returns rows + nextCursor; passes parsed filters to queryAuditLogs", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(okQuota);
    mocks.queryAuditLogs.mockResolvedValueOnce({
      rows: [
        {
          id: "a-1",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          action: "BUCKET_CREATE",
          targetType: "bucket",
          targetId: "b-1",
          ipAddress: "10.0.0.1",
          userId: "u-1",
          userName: "User 1",
          userEmail: "u1@x.com",
        },
      ],
      nextCursor: "a-1",
    });
    const res = await GET(
      req(
        "?actions=BUCKET_CREATE&actions=DOCUMENT_UPLOAD&userId=u-1&targetType=bucket&limit=25&cursor=a-9",
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { rows: unknown[]; nextCursor: string | null } };
    expect(body.data.rows).toHaveLength(1);
    expect(body.data.nextCursor).toBe("a-1");
    const passed = mocks.queryAuditLogs.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(passed.actions).toEqual(["BUCKET_CREATE", "DOCUMENT_UPLOAD"]);
    expect(passed.userId).toBe("u-1");
    expect(passed.targetType).toBe("bucket");
    expect(passed.limit).toBe(25);
    expect(passed.cursor).toBe("a-9");
  });

  it("500 with generic message on query throw (no DATABASE_URL leak)", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(okQuota);
    mocks.queryAuditLogs.mockRejectedValueOnce(
      new Error("postgresql://user:pw@host/db connection failed"),
    );
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/postgres|password|@/i);
  });

  it("response is no-store, private", async () => {
    mocks.getSession.mockResolvedValueOnce({ user: { sub: "auth0|a" } });
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(okQuota);
    mocks.queryAuditLogs.mockResolvedValueOnce({ rows: [], nextCursor: null });
    const res = await GET(req());
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(res.headers.get("Cache-Control")).toMatch(/private/);
  });
});
