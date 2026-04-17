import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getDashboardStats: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/dashboard-stats", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/dashboard-stats")>(
      "@/lib/dashboard-stats",
    );
  return {
    ...actual,
    getDashboardStats: mocks.getDashboardStats,
  };
});

import { GET } from "@/app/api/dashboard/stats/route";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.getDashboardStats.mockReset();
});

describe("GET /api/dashboard/stats", () => {
  it("returns 401 when there is no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mocks.getDashboardStats).not.toHaveBeenCalled();
  });

  it("returns 403 when session has no valid role claim", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { sub: "auth0|x", email: "x@x.com" },
    });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mocks.getDashboardStats).not.toHaveBeenCalled();
  });

  it("returns 200 + stats payload for an authed+roled user", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        sub: "auth0|a",
        email: "a@x.com",
        "https://docs.helpucompli.com/role": "admin",
      },
    });
    mocks.getDashboardStats.mockResolvedValueOnce({
      totalDocuments: 10,
      totalBuckets: 2,
      recentUploads: 4,
      recentLinks: 1,
      activeUsers: 5,
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { totalDocuments: number };
      error: null;
    };
    expect(body.data.totalDocuments).toBe(10);
    expect(body.error).toBeNull();
  });

  it("returns 500 + generic error when the stats fetch throws (no leak of db internals)", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        sub: "auth0|a",
        email: "a@x.com",
        "https://docs.helpucompli.com/role": "admin",
      },
    });
    mocks.getDashboardStats.mockRejectedValueOnce(
      new Error("connection string: postgres://user:password@host/db"),
    );
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { data: null; error: string };
    expect(body.data).toBeNull();
    expect(body.error).not.toContain("password");
    expect(body.error).not.toContain("postgres://");
  });
});
