import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  ensureUser: vi.fn(async () => ({ id: "u-test" })),
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

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

import DashboardLayout from "@/app/(dashboard)/layout";

afterEach(() => {
  mocks.getSession.mockReset();
  mocks.redirect.mockClear();
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
});
