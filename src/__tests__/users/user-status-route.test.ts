import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveHasRole: vi.fn(),
  resolveRole: vi.fn(),
  ensureUser: vi.fn(),
  changeUserStatus: vi.fn(),
  limit: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({
  resolveHasRole: mocks.resolveHasRole,
  resolveRole: mocks.resolveRole,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/ensure-user", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/user-status", async () => {
  const actual = await vi.importActual<typeof import("@/lib/user-status")>(
    "@/lib/user-status",
  );
  return { ...actual, changeUserStatus: mocks.changeUserStatus };
});
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: vi.fn().mockImplementation(() => ({ limit: mocks.limit })),
}));

import { PATCH } from "@/app/api/users/[id]/status/route";
import { NextRequest } from "next/server";
import { ForbiddenStatusChangeError } from "@/lib/user-status";

const ok = { success: true, reset: Date.now() + 30_000 };
const UUID = "11111111-2222-3333-4444-555555555555";
const params = Promise.resolve({ id: UUID });

function adminSession() {
  return { user: { sub: "auth0|admin" } };
}

function jsonReq(body: unknown, ctype = "application/json") {
  return new NextRequest(`http://x/api/users/${UUID}/status`, {
    method: "PATCH",
    headers: { "content-type": ctype },
    body: ctype === "application/json" ? JSON.stringify(body) : String(body),
  });
}

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("PATCH /api/users/[id]/status", () => {
  it("401 no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await PATCH(jsonReq({ status: "disabled" }), { params });
    expect(res.status).toBe(401);
  });

  it("403 when not admin+", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(false);
    const res = await PATCH(jsonReq({ status: "disabled" }), { params });
    expect(res.status).toBe(403);
  });

  it("400 invalid id", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    const res = await PATCH(jsonReq({ status: "disabled" }), {
      params: Promise.resolve({ id: "bad" }),
    });
    expect(res.status).toBe(400);
  });

  it("400 schema violation", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    const res = await PATCH(jsonReq({ status: "pending" }), { params });
    expect(res.status).toBe(400);
  });

  it("404 when target missing", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.changeUserStatus.mockResolvedValueOnce(null);
    const res = await PATCH(jsonReq({ status: "disabled" }), { params });
    expect(res.status).toBe(404);
  });

  it("403 on ForbiddenStatusChangeError", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.resolveRole.mockResolvedValueOnce("admin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.changeUserStatus.mockRejectedValueOnce(
      new ForbiddenStatusChangeError("Forbidden: role hierarchy"),
    );
    const res = await PATCH(jsonReq({ status: "disabled" }), { params });
    expect(res.status).toBe(403);
  });

  it("200 on success", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.changeUserStatus.mockResolvedValueOnce({
      id: UUID,
      auth0Id: "auth0|t1",
      status: "disabled",
    });
    const res = await PATCH(jsonReq({ status: "disabled" }), { params });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("disabled");
  });

  it("500 on unexpected error", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveHasRole.mockResolvedValueOnce(true);
    mocks.limit.mockResolvedValueOnce(ok);
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.changeUserStatus.mockRejectedValueOnce(new Error("boom pw=leak"));
    const res = await PATCH(jsonReq({ status: "disabled" }), { params });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toMatch(/pw|leak/i);
  });
});
