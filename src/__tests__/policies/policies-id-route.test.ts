import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveHasRole: vi.fn(),
  resolveRole: vi.fn(),
  getPolicy: vi.fn(),
  updatePolicy: vi.fn(),
  deletePolicy: vi.fn(),
  ensureUser: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({
  resolveHasRole: mocks.resolveHasRole,
  resolveRole: mocks.resolveRole,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/policy-crud", async () => {
  const actual = await vi.importActual<typeof import("@/lib/policy-crud")>(
    "@/lib/policy-crud",
  );
  return {
    ...actual,
    getPolicy: mocks.getPolicy,
    updatePolicy: mocks.updatePolicy,
    deletePolicy: mocks.deletePolicy,
  };
});
vi.mock("@/lib/ensure-user", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({ limit: mocks.limit }),
}));

import { GET, PUT, DELETE } from "@/app/api/policies/[id]/route";
import { NextRequest } from "next/server";
import { PolicyNotFoundError } from "@/lib/policy-crud";

const ok = { success: true, reset: Date.now() + 30_000 };

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

function adminSession() {
  return { user: { sub: "auth0|admin" } };
}

const params = (id: string) => Promise.resolve({ id });

function jsonReq(method: string, body?: unknown) {
  return new NextRequest("http://x/api/policies/p-1", {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/policies/[id]", () => {
  it("401 unauthenticated", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(jsonReq("GET"), { params: params("11111111-1111-4111-8111-111111111111") });
    expect(res!.status).toBe(401);
  });

  it("403 non-admin", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await GET(jsonReq("GET"), { params: params("11111111-1111-4111-8111-111111111111") });
    expect(res!.status).toBe(403);
  });

  it("404 missing", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.getPolicy.mockResolvedValueOnce(null);
    const res = await GET(jsonReq("GET"), {
      params: params("22222222-2222-4222-8222-222222222222"),
    });
    expect(res!.status).toBe(404);
  });

  it("200 returns policy", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.getPolicy.mockResolvedValueOnce({ id: "11111111-1111-4111-8111-111111111111", name: "X" });
    const res = await GET(jsonReq("GET"), { params: params("11111111-1111-4111-8111-111111111111") });
    expect(res!.status).toBe(200);
  });
});

describe("PUT /api/policies/[id]", () => {
  it("400 on invalid patch", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce(ok);
    const res = await PUT(jsonReq("PUT", { linkTtlSeconds: 1 }), {
      params: params("11111111-1111-4111-8111-111111111111"),
    });
    expect(res!.status).toBe(400);
  });

  it("400 on empty patch", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce(ok);
    const res = await PUT(jsonReq("PUT", {}), { params: params("11111111-1111-4111-8111-111111111111") });
    expect(res!.status).toBe(400);
  });

  it("404 when not found", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.updatePolicy.mockRejectedValueOnce(new PolicyNotFoundError("11111111-1111-4111-8111-111111111111"));
    const res = await PUT(jsonReq("PUT", { name: "Z" }), {
      params: params("11111111-1111-4111-8111-111111111111"),
    });
    expect(res!.status).toBe(404);
  });

  it("200 on success", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.updatePolicy.mockResolvedValueOnce({ id: "11111111-1111-4111-8111-111111111111", name: "Z" });
    const res = await PUT(jsonReq("PUT", { name: "Z" }), {
      params: params("11111111-1111-4111-8111-111111111111"),
    });
    expect(res!.status).toBe(200);
  });
});

describe("DELETE /api/policies/[id]", () => {
  it("404 when missing", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.deletePolicy.mockRejectedValueOnce(new PolicyNotFoundError("11111111-1111-4111-8111-111111111111"));
    const res = await DELETE(jsonReq("DELETE"), { params: params("11111111-1111-4111-8111-111111111111") });
    expect(res!.status).toBe(404);
  });

  it("204 on success", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.ensureUser.mockResolvedValueOnce({ id: "u-1" });
    mocks.deletePolicy.mockResolvedValueOnce(undefined);
    const res = await DELETE(jsonReq("DELETE"), { params: params("11111111-1111-4111-8111-111111111111") });
    expect(res!.status).toBe(204);
  });
});
