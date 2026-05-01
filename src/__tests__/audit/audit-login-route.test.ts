import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.AUTH0_DOMAIN = "test.auth0.com";
  process.env.AUTH0_CLIENT_ID = "test_client_id";
  process.env.AUTH0_CLIENT_SECRET = "test_client_secret";
  process.env.AUTH0_SECRET = "test_secret_thirty_two_chars_long___";
  process.env.APP_BASE_URL = "http://localhost:3000";
});

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  logAudit: vi.fn(),
  consoleError: vi.fn(),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { auditLog: { create: vi.fn() } },
}));

vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>(
    "@/lib/audit",
  );
  return { ...actual, logAudit: mocks.logAudit };
});

import { GET } from "@/app/api/auth/audit-login/route";
import { NextRequest } from "next/server";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.logAudit.mockReset();
  delete process.env.AUDIT_LOGIN_LOGOUT_ENABLED;
});

function req(qs = ""): NextRequest {
  return new NextRequest(`http://localhost:3000/api/auth/audit-login${qs}`, {
    headers: {
      "x-forwarded-for": "10.0.0.1",
      "user-agent": "Vitest/1.0",
    },
  });
}

describe("GET /api/auth/audit-login", () => {
  it("logs LOGIN action and 302s to ?to= relative path", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { sub: "auth0|abc", email: "u@example.com" },
    });
    mocks.logAudit.mockResolvedValueOnce({ id: "audit-1" });

    const res = await GET(req("?to=/dashboard"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
    const entry = mocks.logAudit.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(entry.action).toBe("LOGIN");
    expect(entry.userId).toBe("auth0|abc");
    expect(entry.targetType).toBe("session");
    expect(entry.ipAddress).toBe("10.0.0.1");
    expect(entry.userAgent).toBe("Vitest/1.0");
    expect((entry.metadata as Record<string, unknown>).email).toBe(
      "u@example.com",
    );
  });

  it("redirects to / when ?to is missing", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { sub: "auth0|abc", email: null },
    });
    mocks.logAudit.mockResolvedValueOnce({ id: "audit-2" });
    const res = await GET(req());
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("redirects to / and refuses absolute ?to= URL (open-redirect guard)", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { sub: "auth0|abc", email: null },
    });
    mocks.logAudit.mockResolvedValueOnce({ id: "audit-3" });
    const res = await GET(req("?to=https://evil.com/steal"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("rejects protocol-relative ?to=//evil.com", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { sub: "auth0|abc", email: null },
    });
    mocks.logAudit.mockResolvedValueOnce({ id: "audit-4" });
    const res = await GET(req("?to=//evil.com"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("does not call logAudit when no session, but still redirects", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const res = await GET(req("?to=/x"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/x");
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("swallows logAudit rejection — auth flow MUST not break", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { sub: "auth0|abc", email: null },
    });
    mocks.logAudit.mockRejectedValueOnce(new Error("DB down"));
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const res = await GET(req("?to=/dashboard"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
    errSpy.mockRestore();
  });

  it("kill-switch: AUDIT_LOGIN_LOGOUT_ENABLED=false skips audit but still redirects", async () => {
    process.env.AUDIT_LOGIN_LOGOUT_ENABLED = "false";
    const res = await GET(req("?to=/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/dashboard");
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });
});
