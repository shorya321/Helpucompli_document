import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getActivityTrend: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/activity-trend", async () => {
  const actual = await vi.importActual<typeof import("@/lib/activity-trend")>(
    "@/lib/activity-trend",
  );
  return {
    ...actual,
    getActivityTrend: mocks.getActivityTrend,
  };
});

import { GET } from "@/app/api/dashboard/activity-trend/route";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.getActivityTrend.mockReset();
});

function makeReq(url = "https://localhost/api/dashboard/activity-trend") {
  return new Request(url) as unknown as Parameters<typeof GET>[0];
}

function adminSession(sub = "auth0|trend-a") {
  return {
    user: {
      sub,
      email: "a@x.com",
      "https://docs.helpucompli.com/role": "admin",
    },
  };
}

describe("GET /api/dashboard/activity-trend", () => {
  it("401 when unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(mocks.getActivityTrend).not.toHaveBeenCalled();
  });

  it("403 for viewer — admin+ only", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        sub: "auth0|v",
        email: "v@x.com",
        "https://docs.helpucompli.com/role": "viewer",
      },
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    expect(mocks.getActivityTrend).not.toHaveBeenCalled();
  });

  it("200 + trend data for an admin", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.getActivityTrend.mockResolvedValueOnce({
      days: 14,
      points: Array.from({ length: 14 }, (_, i) => ({
        date: `2026-04-${String(9 + i).padStart(2, "0")}`,
        auth: 0,
        document: 0,
        policy: 0,
        link: 0,
        user: 0,
      })),
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { days: number; points: unknown[] };
    };
    expect(body.data.days).toBe(14);
    expect(body.data.points).toHaveLength(14);
  });

  it("400 for invalid days param (not a number)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|invalid-days"));
    const res = await GET(
      makeReq("https://localhost/api/dashboard/activity-trend?days=abc"),
    );
    expect(res.status).toBe(400);
    expect(mocks.getActivityTrend).not.toHaveBeenCalled();
  });

  it("400 for days out of range", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|range-days"));
    const res = await GET(
      makeReq("https://localhost/api/dashboard/activity-trend?days=999"),
    );
    expect(res.status).toBe(400);
  });

  it("429 after 10 requests in 30s for the same user", async () => {
    for (let i = 0; i < 10; i++) {
      mocks.getSession.mockResolvedValueOnce(adminSession("auth0|rate-trend"));
      mocks.getActivityTrend.mockResolvedValueOnce({
        days: 14,
        points: [],
      });
      const ok = await GET(makeReq());
      // First 10 are fine — but with empty points the schema validation
      // returns 500 (points must be ≥ days when days=14). That's not the
      // contract we're testing here, so accept either.
      expect([200, 500]).toContain(ok.status);
    }
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|rate-trend"));
    const res = await GET(makeReq());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("sets Cache-Control no-store, private", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|cache-trend"));
    mocks.getActivityTrend.mockResolvedValueOnce({
      days: 14,
      points: Array.from({ length: 14 }, (_, i) => ({
        date: `2026-04-${String(9 + i).padStart(2, "0")}`,
        auth: 0,
        document: 0,
        policy: 0,
        link: 0,
        user: 0,
      })),
    });
    const res = await GET(makeReq());
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("500 + generic error; never leaks DATABASE_URL on engine throw", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession("auth0|err-trend"));
    mocks.getActivityTrend.mockRejectedValueOnce(
      new Error("postgres://user:secret@host/db connection refused"),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { data: null; error: string };
    expect(body.data).toBeNull();
    expect(body.error).not.toContain("secret");
    expect(body.error).not.toContain("postgres://");
  });
});
