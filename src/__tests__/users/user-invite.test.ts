import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAuth0User: vi.fn(),
  assignAuth0RoleByName: vi.fn(),
  createPasswordChangeTicket: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/auth0-management", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth0-management")>(
      "@/lib/auth0-management",
    );
  return {
    ...actual,
    createAuth0User: mocks.createAuth0User,
    assignAuth0RoleByName: mocks.assignAuth0RoleByName,
    createPasswordChangeTicket: mocks.createPasswordChangeTicket,
  };
});
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));

import {
  inviteUser,
  inviteUserInputSchema,
  canInviteWithRole,
} from "@/lib/user-invite";
import { Auth0ConflictError } from "@/lib/auth0-management";

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

function stubPrisma() {
  return {
    user: {
      upsert: vi.fn().mockResolvedValue({
        id: "db-1",
        auth0Id: "auth0|new",
        email: "new@x.com",
        name: "New User",
        role: "viewer",
        status: "active",
        lastLoginAt: null,
        createdAt: new Date(),
      }),
    },
  };
}

describe("inviteUserInputSchema", () => {
  it("accepts valid email + role + optional name", () => {
    const parsed = inviteUserInputSchema.safeParse({
      email: "a@b.com",
      name: "Alice",
      role: "viewer",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-email", () => {
    const parsed = inviteUserInputSchema.safeParse({
      email: "not-email",
      role: "viewer",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects disallowed role", () => {
    const parsed = inviteUserInputSchema.safeParse({
      email: "a@b.com",
      role: "owner",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("canInviteWithRole", () => {
  it("superadmin can invite any role", () => {
    expect(canInviteWithRole("superadmin", "superadmin")).toBe(true);
    expect(canInviteWithRole("superadmin", "admin")).toBe(true);
    expect(canInviteWithRole("superadmin", "viewer")).toBe(true);
  });

  it("admin can only invite viewer", () => {
    expect(canInviteWithRole("admin", "viewer")).toBe(true);
    expect(canInviteWithRole("admin", "admin")).toBe(false);
    expect(canInviteWithRole("admin", "superadmin")).toBe(false);
  });

  it("viewer cannot invite anyone", () => {
    expect(canInviteWithRole("viewer", "viewer")).toBe(false);
  });
});

describe("inviteUser", () => {
  it("creates Auth0 user → assigns role → ticket → upserts local DB → logs USER_INVITE audit", async () => {
    mocks.createAuth0User.mockResolvedValueOnce({
      userId: "auth0|new",
      email: "new@x.com",
    });
    mocks.assignAuth0RoleByName.mockResolvedValueOnce(undefined);
    mocks.createPasswordChangeTicket.mockResolvedValueOnce(
      "https://auth.helpucompli.com/lo/reset?ticket=abc",
    );
    mocks.logAudit.mockResolvedValueOnce(undefined);

    const prisma = stubPrisma();
    const result = await inviteUser(
      prisma as unknown as Parameters<typeof inviteUser>[0],
      {
        input: { email: "new@x.com", name: "New User", role: "viewer" },
        actor: { userId: "db-actor", ipAddress: "1.2.3.4", userAgent: "UA" },
      },
    );

    expect(result.auth0Id).toBe("auth0|new");
    expect(mocks.createAuth0User).toHaveBeenCalledWith({
      email: "new@x.com",
      name: "New User",
    });
    expect(mocks.assignAuth0RoleByName).toHaveBeenCalledWith(
      "auth0|new",
      "viewer",
    );
    expect(mocks.createPasswordChangeTicket).toHaveBeenCalledWith("auth0|new");
    const upsertArg = prisma.user.upsert.mock.calls[0]?.[0];
    expect(upsertArg.where).toEqual({ auth0Id: "auth0|new" });
    expect(upsertArg.create).toMatchObject({
      auth0Id: "auth0|new",
      email: "new@x.com",
      name: "New User",
      role: "viewer",
    });
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
    const auditArg = mocks.logAudit.mock.calls[0]?.[1];
    expect(auditArg.action).toBe("USER_INVITE");
    expect(auditArg.targetType).toBe("user");
    expect(auditArg.metadata).toMatchObject({ email: "new@x.com", role: "viewer" });
  });

  it("propagates Auth0ConflictError on duplicate email without touching DB or audit", async () => {
    mocks.createAuth0User.mockRejectedValueOnce(new Auth0ConflictError());
    const prisma = stubPrisma();
    await expect(
      inviteUser(prisma as unknown as Parameters<typeof inviteUser>[0], {
        input: { email: "dup@x.com", name: null, role: "viewer" },
        actor: { userId: "db-actor", ipAddress: "1.2.3.4", userAgent: "UA" },
      }),
    ).rejects.toBeInstanceOf(Auth0ConflictError);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });
});
