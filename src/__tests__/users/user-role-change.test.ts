import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replaceAuth0RoleByName: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/auth0-management", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth0-management")>(
      "@/lib/auth0-management",
    );
  return { ...actual, replaceAuth0RoleByName: mocks.replaceAuth0RoleByName };
});
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));

import {
  canChangeRole,
  changeUserRole,
  userRoleUpdateSchema,
} from "@/lib/user-role-change";

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("userRoleUpdateSchema", () => {
  it("accepts valid role", () => {
    expect(
      userRoleUpdateSchema.safeParse({ role: "viewer" }).success,
    ).toBe(true);
  });
  it("rejects unknown role", () => {
    expect(
      userRoleUpdateSchema.safeParse({ role: "owner" }).success,
    ).toBe(false);
  });
});

describe("canChangeRole hierarchy", () => {
  it("blocks self-modification", () => {
    expect(
      canChangeRole({
        actorRole: "superadmin",
        targetCurrentRole: "admin",
        newRole: "viewer",
        isSelf: true,
      }),
    ).toBe(false);
  });

  it("superadmin can change any non-self target to any role", () => {
    for (const current of ["superadmin", "admin", "viewer"] as const) {
      for (const next of ["superadmin", "admin", "viewer"] as const) {
        expect(
          canChangeRole({
            actorRole: "superadmin",
            targetCurrentRole: current,
            newRole: next,
            isSelf: false,
          }),
        ).toBe(true);
      }
    }
  });

  it("admin cannot modify a superadmin target", () => {
    expect(
      canChangeRole({
        actorRole: "admin",
        targetCurrentRole: "superadmin",
        newRole: "viewer",
        isSelf: false,
      }),
    ).toBe(false);
  });

  it("admin can only set newRole=viewer", () => {
    expect(
      canChangeRole({
        actorRole: "admin",
        targetCurrentRole: "admin",
        newRole: "viewer",
        isSelf: false,
      }),
    ).toBe(true);
    expect(
      canChangeRole({
        actorRole: "admin",
        targetCurrentRole: "viewer",
        newRole: "admin",
        isSelf: false,
      }),
    ).toBe(false);
    expect(
      canChangeRole({
        actorRole: "admin",
        targetCurrentRole: "viewer",
        newRole: "superadmin",
        isSelf: false,
      }),
    ).toBe(false);
  });

  it("viewer cannot change any role", () => {
    expect(
      canChangeRole({
        actorRole: "viewer",
        targetCurrentRole: "viewer",
        newRole: "viewer",
        isSelf: false,
      }),
    ).toBe(false);
  });
});

describe("changeUserRole", () => {
  function stubPrisma(targetRow: Record<string, unknown> | null) {
    return {
      user: {
        findUnique: vi.fn().mockResolvedValue(targetRow),
        update: vi.fn().mockResolvedValue({
          id: "t-1",
          auth0Id: "auth0|t1",
          role: "viewer",
        }),
      },
    };
  }

  it("returns null when target user not found", async () => {
    const prisma = stubPrisma(null);
    const result = await changeUserRole(
      prisma as unknown as Parameters<typeof changeUserRole>[0],
      {
        targetUserId: "missing",
        newRole: "viewer",
        actor: {
          userId: "a-1",
          auth0Id: "auth0|a",
          role: "superadmin",
          ipAddress: "1.1.1.1",
          userAgent: "UA",
        },
      },
    );
    expect(result).toBeNull();
    expect(mocks.replaceAuth0RoleByName).not.toHaveBeenCalled();
  });

  it("throws when hierarchy blocks the change (admin → admin target)", async () => {
    const prisma = stubPrisma({
      id: "t-1",
      auth0Id: "auth0|t1",
      role: "superadmin",
    });
    await expect(
      changeUserRole(
        prisma as unknown as Parameters<typeof changeUserRole>[0],
        {
          targetUserId: "t-1",
          newRole: "viewer",
          actor: {
            userId: "a-1",
            auth0Id: "auth0|a",
            role: "admin",
            ipAddress: "1.1.1.1",
            userAgent: "UA",
          },
        },
      ),
    ).rejects.toThrow(/forbidden/i);
    expect(mocks.replaceAuth0RoleByName).not.toHaveBeenCalled();
  });

  it("throws on self-demotion", async () => {
    const prisma = stubPrisma({
      id: "a-1",
      auth0Id: "auth0|a",
      role: "superadmin",
    });
    await expect(
      changeUserRole(
        prisma as unknown as Parameters<typeof changeUserRole>[0],
        {
          targetUserId: "a-1",
          newRole: "admin",
          actor: {
            userId: "a-1",
            auth0Id: "auth0|a",
            role: "superadmin",
            ipAddress: "1.1.1.1",
            userAgent: "UA",
          },
        },
      ),
    ).rejects.toThrow(/forbidden|self/i);
  });

  it("updates Auth0 + local DB + audit on allowed change", async () => {
    const prisma = stubPrisma({
      id: "t-1",
      auth0Id: "auth0|t1",
      role: "admin",
    });
    mocks.replaceAuth0RoleByName.mockResolvedValueOnce(undefined);
    mocks.logAudit.mockResolvedValueOnce(undefined);
    const result = await changeUserRole(
      prisma as unknown as Parameters<typeof changeUserRole>[0],
      {
        targetUserId: "t-1",
        newRole: "viewer",
        actor: {
          userId: "a-1",
          auth0Id: "auth0|a",
          role: "superadmin",
          ipAddress: "1.2.3.4",
          userAgent: "UA",
        },
      },
    );

    expect(result).toMatchObject({ id: "t-1", role: "viewer" });
    expect(mocks.replaceAuth0RoleByName).toHaveBeenCalledWith(
      "auth0|t1",
      "viewer",
    );
    const updateArg = prisma.user.update.mock.calls[0]?.[0];
    expect(updateArg.where).toEqual({ id: "t-1" });
    expect(updateArg.data).toEqual({ role: "viewer" });
    const auditArg = mocks.logAudit.mock.calls[0]?.[1];
    expect(auditArg.action).toBe("USER_ROLE_CHANGE");
    expect(auditArg.metadata).toMatchObject({
      fromRole: "admin",
      toRole: "viewer",
    });
  });

  it("no-op early return when newRole equals current role (no Auth0 or audit)", async () => {
    const prisma = stubPrisma({
      id: "t-1",
      auth0Id: "auth0|t1",
      role: "viewer",
    });
    const result = await changeUserRole(
      prisma as unknown as Parameters<typeof changeUserRole>[0],
      {
        targetUserId: "t-1",
        newRole: "viewer",
        actor: {
          userId: "a-1",
          auth0Id: "auth0|a",
          role: "superadmin",
          ipAddress: "1.1.1.1",
          userAgent: "UA",
        },
      },
    );
    expect(result).toMatchObject({ id: "t-1", role: "viewer" });
    expect(mocks.replaceAuth0RoleByName).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
