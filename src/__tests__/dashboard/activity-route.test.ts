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

  it("429 after 10 requests in 30s for the same user (rate limit)", async () => {
    for (let i = 0; i < 10; i++) {
      mocks.getSession.mockResolvedValueOnce({
        user: {
          sub: "auth0|rate-act",
          email: "r@x.com",
          "https://docs.helpucompli.com/role": "admin",
        },
      });
      mocks.getRecentActivity.mockResolvedValueOnce([]);
      const ok = await GET();
      expect(ok.status).toBe(200);
    }
    mocks.getSession.mockResolvedValueOnce({
      user: {
        sub: "auth0|rate-act",
        email: "r@x.com",
        "https://docs.helpucompli.com/role": "admin",
      },
    });
    const res = await GET();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(mocks.getRecentActivity).toHaveBeenCalledTimes(10);
  });

  it("sets Cache-Control no-store, private on 200 responses", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        sub: "auth0|cache-act",
        email: "c@x.com",
        "https://docs.helpucompli.com/role": "admin",
      },
    });
    mocks.getRecentActivity.mockResolvedValueOnce([]);
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("500 when payload fails Zod validation (oversize targetId from buggy writer)", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        sub: "auth0|a",
        email: "a@x.com",
        "https://docs.helpucompli.com/role": "admin",
      },
    });
    // targetId above 1024 chars — must be rejected at the boundary.
    mocks.getRecentActivity.mockResolvedValueOnce([
      {
        id: "x",
        createdAt: new Date("2026-04-17T10:00:00Z"),
        action: "DOCUMENT_UPLOAD",
        userName: "Alice",
        targetType: "document",
        targetId: "a".repeat(2000),
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { data: null; error: string };
    expect(body.data).toBeNull();
    // Generic error — never surfaces zod issue details.
    expect(body.error).toBe("Failed to load activity feed");
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
