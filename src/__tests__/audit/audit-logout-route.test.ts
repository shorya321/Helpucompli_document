import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveRole: vi.fn(),
  ensureUser: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/auth-guard", () => ({
  resolveRole: mocks.resolveRole,
}));

vi.mock("@/lib/ensure-user", () => ({
  ensureUser: mocks.ensureUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      create: mocks.auditCreate,
    },
  },
}));

import { GET } from "@/app/api/auth/audit-logout/route";
import { NextRequest } from "next/server";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.AUDIT_LOGIN_LOGOUT_ENABLED;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  mocks.getSession.mockReset();
  mocks.resolveRole.mockReset();
  mocks.ensureUser.mockReset();
  mocks.auditCreate.mockReset();
});

function makeReq() {
  return new NextRequest("http://localhost/api/auth/audit-logout", {
    method: "GET",
    headers: {
      "x-forwarded-for": "10.5.5.5",
      "user-agent": "vitest-ua/2.0",
    },
  });
}

function makeSession(sid = "sid-logout-1") {
  return {
    user: {
      sub: "auth0|user-1",
      email: "u@example.com",
      "https://docs.helpucompli.com/role": "viewer",
    },
    internal: { sid, createdAt: 1234567890 },
  };
}

describe("GET /api/auth/audit-logout", () => {
  it("writes a LOGOUT audit row then 302-redirects to /auth/logout", async () => {
    mocks.getSession.mockResolvedValue(makeSession("sid-bye"));
    mocks.resolveRole.mockResolvedValue("viewer");
    mocks.ensureUser.mockResolvedValue({ id: "u-db-1" });
    mocks.auditCreate.mockResolvedValue({ id: "audit-out" });

    const res = await GET(makeReq());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/auth\/logout$/);
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1);
    const args = mocks.auditCreate.mock.calls[0]?.[0];
    expect(args?.data).toMatchObject({
      userId: "u-db-1",
      action: "LOGOUT",
      targetType: "session",
      targetId: "sid-bye",
      ipAddress: "10.5.5.5",
      userAgent: "vitest-ua/2.0",
    });
    expect(args?.data?.metadata).toMatchObject({ sessionId: "sid-bye" });
  });

  it("kill-switch AUDIT_LOGIN_LOGOUT_ENABLED=false skips audit but still redirects", async () => {
    process.env.AUDIT_LOGIN_LOGOUT_ENABLED = "false";
    mocks.getSession.mockResolvedValue(makeSession());
    mocks.resolveRole.mockResolvedValue("viewer");
    mocks.ensureUser.mockResolvedValue({ id: "u-db-1" });

    const res = await GET(makeReq());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/auth\/logout$/);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("redirects to /auth/logout even when there is no session", async () => {
    mocks.getSession.mockResolvedValue(null);

    const res = await GET(makeReq());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/auth\/logout$/);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.ensureUser).not.toHaveBeenCalled();
  });

  it("audit DB failure must NOT block the logout redirect", async () => {
    mocks.getSession.mockResolvedValue(makeSession());
    mocks.resolveRole.mockResolvedValue("viewer");
    mocks.ensureUser.mockResolvedValue({ id: "u-db-1" });
    mocks.auditCreate.mockRejectedValue(new Error("db down"));

    const res = await GET(makeReq());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/auth\/logout$/);
  });

  it("redirects when role cannot be resolved (no DB user yet) — still log out cleanly", async () => {
    mocks.getSession.mockResolvedValue(makeSession());
    mocks.resolveRole.mockResolvedValue(null);

    const res = await GET(makeReq());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/\/auth\/logout$/);
    expect(mocks.ensureUser).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
