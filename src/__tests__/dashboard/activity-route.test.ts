import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getRecentActivity: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/activity-feed", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/activity-feed")>(
      "@/lib/activity-feed",
    );
  return {
    ...actual,
    getRecentActivity: mocks.getRecentActivity,
  };
});

import { GET } from "@/app/api/dashboard/activity/route";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.getRecentActivity.mockReset();
});

describe("GET /api/dashboard/activity", () => {
  it("401 when unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mocks.getRecentActivity).not.toHaveBeenCalled();
  });

  it("403 when no valid role claim", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { sub: "auth0|x", email: "x@x.com" },
    });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mocks.getRecentActivity).not.toHaveBeenCalled();
  });

  it("403 for viewer — tenant-wide audit activity is admin+ only", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        sub: "auth0|v",
        email: "v@x.com",
        "https://docs.helpucompli.com/role": "viewer",
      },
    });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mocks.getRecentActivity).not.toHaveBeenCalled();
  });

  it("200 + entries for an admin", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        sub: "auth0|a",
        email: "a@x.com",
        "https://docs.helpucompli.com/role": "admin",
      },
    });
    const ts = new Date("2026-04-17T10:00:00Z");
    mocks.getRecentActivity.mockResolvedValueOnce([
      {
        id: "x",
        createdAt: ts,
        action: "LOGIN",
        userName: "Alice",
        targetType: "user",
        targetId: "u1",
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; action: string }>;
      error: null;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.action).toBe("LOGIN");
    expect(body.error).toBeNull();
  });

  it("500 + generic error; never leaks DATABASE_URL from raw err.message", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        sub: "auth0|a",
        email: "a@x.com",
        "https://docs.helpucompli.com/role": "admin",
      },
    });
    mocks.getRecentActivity.mockRejectedValueOnce(
      new Error("postgres://user:secret@host/db connection refused"),
    );
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { data: null; error: string };
    expect(body.data).toBeNull();
    expect(body.error).not.toContain("secret");
    expect(body.error).not.toContain("postgres://");
  });
});
