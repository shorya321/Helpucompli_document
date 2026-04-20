import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveRole: vi.fn(),
  ensureUser: vi.fn(),
  findUnique: vi.fn(),
  getUserBuckets: vi.fn(),
  getBucketList: vi.fn(),
  queryAuditLogs: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));
vi.mock("@/lib/auth0", () => ({ auth0: { getSession: mocks.getSession } }));
vi.mock("@/lib/auth-guard", () => ({ resolveRole: mocks.resolveRole }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/ensure-user", () => ({ ensureUser: mocks.ensureUser }));
vi.mock("@/lib/user-bucket-access", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/user-bucket-access")>(
      "@/lib/user-bucket-access",
    );
  return { ...actual, getUserBuckets: mocks.getUserBuckets };
});
vi.mock("@/lib/bucket-list", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bucket-list")>(
    "@/lib/bucket-list",
  );
  return { ...actual, getBucketList: mocks.getBucketList };
});
vi.mock("@/lib/audit-query", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit-query")>(
    "@/lib/audit-query",
  );
  return { ...actual, queryAuditLogs: mocks.queryAuditLogs };
});

import UserDetailsPage from "@/app/(dashboard)/users/[id]/page";

const UUID = "11111111-2222-3333-4444-555555555555";

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

function adminSession() {
  return { user: { sub: "auth0|admin" } };
}

describe("UserDetailsPage", () => {
  it("redirects to /auth/login when no session", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    await expect(
      UserDetailsPage({ params: Promise.resolve({ id: UUID }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/auth/login");
  });

  it("redirects to / when actor is not admin+", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveRole.mockResolvedValueOnce("viewer");
    await expect(
      UserDetailsPage({ params: Promise.resolve({ id: UUID }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/");
  });

  it("notFound on invalid UUID", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveRole.mockResolvedValueOnce("admin");
    await expect(
      UserDetailsPage({ params: Promise.resolve({ id: "not-a-uuid" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("notFound when target user missing", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.findUnique.mockResolvedValueOnce(null);
    await expect(
      UserDetailsPage({ params: Promise.resolve({ id: UUID }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders viewer target with BucketAccess", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.findUnique.mockResolvedValueOnce({
      id: UUID,
      auth0Id: "auth0|v",
      email: "viewer@x.com",
      name: "Viewer",
      role: "viewer",
      status: "active",
      createdAt: new Date("2026-04-01"),
      lastLoginAt: new Date("2026-04-15"),
    });
    mocks.getUserBuckets.mockResolvedValueOnce([]);
    mocks.getBucketList.mockResolvedValueOnce([
      { id: "b-1", name: "finance" },
    ]);
    mocks.queryAuditLogs.mockResolvedValueOnce({ rows: [], nextCursor: null });
    const el = await UserDetailsPage({
      params: Promise.resolve({ id: UUID }),
    });
    expect(el).toBeTruthy();
    // Viewer targets trigger the bucket fetches.
    expect(mocks.getUserBuckets).toHaveBeenCalledWith(
      expect.anything(),
      UUID,
    );
    expect(mocks.getBucketList).toHaveBeenCalled();
  });

  it("skips bucket fetches for non-viewer targets", async () => {
    mocks.getSession.mockResolvedValueOnce(adminSession());
    mocks.resolveRole.mockResolvedValueOnce("superadmin");
    mocks.ensureUser.mockResolvedValueOnce({ id: "actor-1" });
    mocks.findUnique.mockResolvedValueOnce({
      id: UUID,
      auth0Id: "auth0|a",
      email: "admin@x.com",
      name: "Admin",
      role: "admin",
      status: "active",
      createdAt: new Date(),
      lastLoginAt: null,
    });
    mocks.queryAuditLogs.mockResolvedValueOnce({ rows: [], nextCursor: null });
    await UserDetailsPage({ params: Promise.resolve({ id: UUID }) });
    expect(mocks.getUserBuckets).not.toHaveBeenCalled();
    expect(mocks.getBucketList).not.toHaveBeenCalled();
  });
});
