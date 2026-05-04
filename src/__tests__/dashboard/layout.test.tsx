import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  ensureUser: vi.fn(async () => ({ id: "u-test" })),
  logLoginOnce: vi.fn(async () => undefined),
  headers: vi.fn(async () => new Headers()),
  redirect: vi.fn((path: string) => {
    throw new Error(`__redirect:${path}`);
  }),
}));

vi.mock("@/lib/auth0", () => ({
  auth0: { getSession: mocks.getSession },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/ensure-user", () => ({
  ensureUser: mocks.ensureUser,
}));

vi.mock("@/lib/log-login-once", () => ({
  logLoginOnce: mocks.logLoginOnce,
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import DashboardLayout from "@/app/(dashboard)/layout";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.redirect.mockClear();
  mocks.logLoginOnce.mockClear();
});

describe("DashboardLayout (server component)", () => {
  it("redirects to /auth/login when there is no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      /__redirect:\/auth\/login/,
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/auth/login");
  });

  it("redirects to /access-denied when session has no valid role claim", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: { sub: "auth0|x", email: "x@x.com" },
    });
    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      /__redirect:\/access-denied/,
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/access-denied");
  });

  it("renders the child tree when session has a valid role", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        sub: "auth0|sa",
        email: "sa@x.com",
        name: "Super Admin",
        "https://docs.helpucompli.com/role": "superadmin",
      },
    });
    const element = await DashboardLayout({ children: null });
    expect(element).toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("invokes logLoginOnce with the resolved DB user id and the request headers", async () => {
    mocks.getSession.mockResolvedValueOnce({
      user: {
        sub: "auth0|sa",
        email: "sa@x.com",
        name: "Super Admin",
        "https://docs.helpucompli.com/role": "superadmin",
      },
      internal: { sid: "sid-1", createdAt: 1 },
    });
    await DashboardLayout({ children: null });
    expect(mocks.logLoginOnce).toHaveBeenCalledTimes(1);
    const args = mocks.logLoginOnce.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { userDbId: string; headers: Headers },
    ];
    expect(args[2]).toMatchObject({ userDbId: "u-test" });
    expect(args[2].headers).toBeInstanceOf(Headers);
  });
});
