import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveHasRole: vi.fn(),
  resolveRole: vi.fn(),
  ensureUser: vi.fn(),
  changeUserRole: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({
  resolveHasRole: mocks.resolveHasRole,
  resolveRole: mocks.resolveRole,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ensure-user", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/user-role-change", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/user-role-change")>(
      "@/lib/user-role-change",
    );
  return { ...actual, changeUserRole: mocks.changeUserRole };
});
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: vi.fn().mockImplementation(() => ({ limit: mocks.limit })),
}));

import { PUT } from "@/app/api/users/[id]/route";
import { NextRequest } from "next/server";
import { ForbiddenRoleChangeError } from "@/lib/user-role-change";

const ok = { success: true, reset: Date.now() + 30_000 };
const UUID = "11111111-2222-3333-4444-555555555555";

function jsonReq(body: unknown, ctype = "application/json") {
  return new NextRequest(`http://x/api/users/${UUID}`, {
    method: "PUT",
    headers: { "content-type": ctype },
    body: ctype === "application/json" ? JSON.stringify(body) : String(body),
  });
}

function adminSession() {
  return { user: { sub: "auth0|admin" } };
}

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

const params = Promise.resolve({ id: UUID });

describe("PUT /api/users/[id]", () => {
  it("401 no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await PUT(jsonReq({ role: "viewer" }), { params });
    expect(res.status).toBe(401);
  });

  it("403 when not admin+", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await PUT(jsonReq({ role: "viewer" }), { params });
    expect(res.status).toBe(403);
  });

  it("400 on invalid id path param", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    const res = await PUT(jsonReq({ role: "viewer" }), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });

  it("415 on non-JSON content type", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    const res = await PUT(jsonReq("oops", "text/plain"), { params });
    expect(res.status).toBe(415);
  });

  it("400 on invalid JSON body", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    const req = new NextRequest(`http://x/api/users/${UUID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    const res = await PUT(req, { params });
    expect(res.status).toBe(400);
  });

  it("400 on schema violation (unknown role)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    const res = await PUT(jsonReq({ role: "owner" }), { params });
    expect(res.status).toBe(400);
  });

  it("404 when changeUserRole returns null (missing target)", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.changeUserRole.mockResolvedValueOnce(null);
    const res = await PUT(jsonReq({ role: "viewer" }), { params });
    expect(res.status).toBe(404);
  });

  it("403 on ForbiddenRoleChangeError from hierarchy", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.changeUserRole.mockRejectedValueOnce(
      new ForbiddenRoleChangeError("Forbidden: role hierarchy"),
    );
    const res = await PUT(jsonReq({ role: "admin" }), { params });
    expect(res.status).toBe(403);
  });

  it("200 on successful role change", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.changeUserRole.mockResolvedValueOnce({
      id: UUID,
      auth0Id: "auth0|target",
      role: "viewer",
    });
    const res = await PUT(jsonReq({ role: "viewer" }), { params });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { role: string };
    };
    expect(body.data.role).toBe("viewer");
  });

  it("500 on unexpected error — no PII leak", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.changeUserRole.mockRejectedValueOnce(new Error("db pw=leak"));
    const res = await PUT(jsonReq({ role: "viewer" }), { params });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/pw|leak/i);
  });
});
