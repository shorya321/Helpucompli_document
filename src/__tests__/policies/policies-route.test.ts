import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveHasRole: vi.fn(),
  resolveRole: vi.fn(),
  getPolicyList: vi.fn(),
  createPolicy: vi.fn(),
  ensureUser: vi.fn(),
  limitGet: vi.fn(),
  limitPost: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({
  resolveHasRole: mocks.resolveHasRole,
  resolveRole: mocks.resolveRole,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/policy-list", async () => {
  const actual = await vi.importActual<typeof import("@/lib/policy-list")>(
    "@/lib/policy-list",
  );
  return { ...actual, getPolicyList: mocks.getPolicyList };
});
vi.mock("@/lib/policy-crud", async () => {
  const actual = await vi.importActual<typeof import("@/lib/policy-crud")>(
    "@/lib/policy-crud",
  );
  return { ...actual, createPolicy: mocks.createPolicy };
});
vi.mock("@/lib/ensure-user", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: vi
    .fn()
    .mockImplementationOnce(() => ({ limit: mocks.limitGet }))
    .mockImplementationOnce(() => ({ limit: mocks.limitPost })),
}));

import { GET, POST } from "@/app/api/policies/route";
import { NextRequest } from "next/server";

const ok = { success: true, reset: Date.now() + 30_000 };

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

function adminSession() {
  return { user: { sub: "auth0|admin" } };
}

function jsonReq(body: unknown) {
  return new NextRequest("http://x/api/policies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  name: "Default",
  targetType: "bucket",
  targetValue: "helpucompli-prod",
  allowedDomains: [],
  allowedIpRanges: [],
  linkTtlSeconds: 900,
  maxDownloads: null,
  requireAuth: false,
};

describe("GET /api/policies", () => {
  it("401 when no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(new NextRequest("http://x/api/policies"));
    expect(res.status).toBe(401);
  });

  it("403 when not admin+", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await GET(new NextRequest("http://x/api/policies"));
    expect(res.status).toBe(403);
  });

  it("200 returns list", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitGet.mockResolvedValueOnce(ok);
    mocks.getPolicyList.mockResolvedValueOnce([
      {
        id: "p-1",
        name: "x",
        targetType: "bucket",
        targetValue: "b",
        allowedDomains: [],
        allowedIpRanges: [],
        linkTtlSeconds: 900,
        maxDownloads: null,
        requireAuth: false,
        updatedAt: new Date(),
        createdByName: null,
      },
    ]);
    const res = await GET(new NextRequest("http://x/api/policies"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("500 on prisma throw — generic message, no DB URL leak", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitGet.mockResolvedValueOnce(ok);
    mocks.getPolicyList.mockRejectedValueOnce(
      new Error("postgresql://user:pw@host failed"),
    );
    const res = await GET(new NextRequest("http://x/api/policies"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/postgres|@|pw/i);
  });
});

describe("POST /api/policies", () => {
  it("401 when no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("403 when not admin+", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(403);
  });

  it("415 on non-JSON content type", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitPost.mockResolvedValueOnce(ok);
    const req = new NextRequest("http://x/api/policies", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x",
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it("400 on invalid JSON", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitPost.mockResolvedValueOnce(ok);
    const req = new NextRequest("http://x/api/policies", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("400 on schema violation", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitPost.mockResolvedValueOnce(ok);
    const res = await POST(jsonReq({ ...VALID_BODY, linkTtlSeconds: 1 }));
    expect(res.status).toBe(400);
  });

  it("429 when rate-limited", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limitPost.mockResolvedValueOnce({
      success: false,
      reset: Date.now() + 5000,
    });
    const res = await POST(jsonReq(VALID_BODY));
    expect(res.status).toBe(429);
  });

  it("403 when admin (non-superadmin) sends linkTtlSeconds=null (perpetual policy)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limitPost.mockResolvedValueOnce(ok);
    const res = await POST(jsonReq({ ...VALID_BODY, linkTtlSeconds: null }));
    expect(res.status).toBe(403);
    expect(mocks.createPolicy).not.toHaveBeenCalled();
  });

  it("201 when superadmin sends linkTtlSeconds=null", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.limitPost.mockResolvedValueOnce(ok);
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-s" });
    mocks.createPolicy.mockResolvedValueOnce({ id: "p-never" });
    const res = await POST(jsonReq({ ...VALID_BODY, linkTtlSeconds: null }));
    expect(res.status).toBe(201);
  });

  it("201 on success and passes ipAddress + userId to createPolicy", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limitPost.mockResolvedValueOnce(ok);
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-internal" });
    mocks.createPolicy.mockResolvedValueOnce({ id: "p-new" });
    const req = new NextRequest("http://x/api/policies", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "1.2.3.4",
        "user-agent": "TestBot",
      },
      body: JSON.stringify(VALID_BODY),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe("p-new");
    const ctx = mocks.createPolicy.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(ctx.userId).toBe("u-internal");
    expect(ctx.ipAddress).toBe("1.2.3.4");
    expect(ctx.userAgent).toBe("TestBot");
  });
});
