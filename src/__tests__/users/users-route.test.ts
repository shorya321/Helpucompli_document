import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveHasRole: vi.fn(),
  listUsers: vi.fn(),
  limitGet: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({ resolveHasRole: mocks.resolveHasRole }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/user-list", async () => {
  const actual = await vi.importActual<typeof import("@/lib/user-list")>(
    "@/lib/user-list",
  );
  return { ...actual, listUsers: mocks.listUsers };
});
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: vi.fn().mockImplementation(() => ({ limit: mocks.limitGet })),
}));

import { GET } from "@/app/api/users/route";
import { NextRequest } from "next/server";

const ok = { success: true, reset: Date.now() + 30_000 };

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

function adminSession() {
  return { user: { sub: "auth0|admin" } };
}

describe("GET /api/users", () => {
  it("401 no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(new NextRequest("http://x/api/users"));
    expect(res.status).toBe(401);
  });

  it("403 when not admin+", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await GET(new NextRequest("http://x/api/users"));
    expect(res.status).toBe(403);
  });

  it("429 when rate-limited", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitGet.mockResolvedValueOnce({
      success: false,
      reset: Date.now() + 5000,
    });
    const res = await GET(new NextRequest("http://x/api/users"));
    expect(res.status).toBe(429);
  });

  it("400 on invalid query", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitGet.mockResolvedValueOnce(ok);
    const res = await GET(new NextRequest("http://x/api/users?role=owner"));
    expect(res.status).toBe(400);
  });

  it("200 returns paginated list with role/status/q passed to listUsers", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitGet.mockResolvedValueOnce(ok);
    mocks.listUsers.mockResolvedValueOnce({
      users: [
        {
          id: "u-1",
          auth0Id: "auth0|1",
          email: "a@b.com",
          name: "Alice",
          role: "admin",
          status: "active",
          lastLoginAt: new Date("2026-04-01T00:00:00Z"),
          createdAt: new Date("2026-03-01T00:00:00Z"),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    const res = await GET(
      new NextRequest("http://x/api/users?role=admin&status=active&q=ali"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { users: unknown[] };
      total: number;
    };
    expect(body.data.users).toHaveLength(1);
    expect(body.total).toBe(1);
    const call = mocks.listUsers.mock.calls[0]?.[1];
    expect(call).toMatchObject({ role: "admin", status: "active", q: "ali" });
  });

  it("500 on listUsers throw — no DB URL leak", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitGet.mockResolvedValueOnce(ok);
    mocks.listUsers.mockRejectedValueOnce(
      new Error("postgresql://u:pw@host failed"),
    );
    const res = await GET(new NextRequest("http://x/api/users"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/postgres|@|pw/i);
  });
});
