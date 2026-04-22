import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getRecentActivity: vi.fn(),
  getRecentActivityPage: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/activity-feed", async () => {
  const actual = await vi.importActual<typeof import("@/lib/activity-feed")>(
    "@/lib/activity-feed",
  );
  return {
    ...actual,
    getRecentActivity: mocks.getRecentActivity,
    getRecentActivityPage: mocks.getRecentActivityPage,
  };
});

import { GET } from "@/app/api/dashboard/activity/route";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.getRecentActivity.mockReset();
  mocks.getRecentActivityPage.mockReset();
});

function adminSession(sub = "auth0|page-a") {
  return {
    user: {
      sub,
      email: "a@x.com",
      "https://docs.helpucompli.com/role": "admin",
    },
  };
}

function makeReq(query = "") {
  const url = `https://localhost/api/dashboard/activity${query}`;
  return new Request(url) as unknown as Parameters<typeof GET>[0];
}

describe("GET /api/dashboard/activity — pagination", () => {
  it("with ?limit returns paged shape (entries + nextCursor)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|p1"));
    mocks.getRecentActivityPage.mockResolvedValueOnce({
      entries: [
        {
          id: "a1",
          createdAt: new Date("2026-04-22T12:00:00Z"),
          action: "LOGIN",
          userName: "Alice",
          targetType: "user",
          targetId: "u1",
        },
      ],
      nextCursor: "a1",
    });
    const res = await GET(makeReq("?limit=20"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { entries: unknown[]; nextCursor: string | null };
      error: null;
    };
    expect(body.data.entries).toHaveLength(1);
    expect(body.data.nextCursor).toBe("a1");
    expect(mocks.getRecentActivityPage).toHaveBeenCalledOnce();
    expect(mocks.getRecentActivity).not.toHaveBeenCalled();
  });

  it("with ?cursor returns paged shape", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|p2"));
    mocks.getRecentActivityPage.mockResolvedValueOnce({
      entries: [],
      nextCursor: null,
    });
    const res = await GET(makeReq("?cursor=abc&limit=20"));
    expect(res.status).toBe(200);
    expect(mocks.getRecentActivityPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cursor: "abc", limit: 20 }),
    );
  });

  it("400 for invalid limit (out of range)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|p3"));
    const res = await GET(makeReq("?limit=9999"));
    expect(res.status).toBe(400);
    expect(mocks.getRecentActivityPage).not.toHaveBeenCalled();
  });

  it("400 for invalid limit (zero)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|p4"));
    const res = await GET(makeReq("?limit=0"));
    expect(res.status).toBe(400);
  });

  it("400 for malformed cursor (oversize)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|p5"));
    const oversized = "a".repeat(200);
    const res = await GET(makeReq(`?cursor=${oversized}`));
    expect(res.status).toBe(400);
  });

  it("preserves array shape (no params) — back-compat with F4.3 contract", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|p6"));
    mocks.getRecentActivity.mockResolvedValueOnce([]);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(Array.isArray(body.data)).toBe(true);
    expect(mocks.getRecentActivity).toHaveBeenCalledOnce();
    expect(mocks.getRecentActivityPage).not.toHaveBeenCalled();
  });

  it("returns 400 with generic error — never echoes Zod issue text", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|p7"));
    const res = await GET(makeReq("?limit=abc"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { data: null; error: string };
    expect(body.data).toBeNull();
    expect(body.error).toBe("Invalid query");
  });
});
