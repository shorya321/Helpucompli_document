import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setAuth0UserBlocked: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/auth0-management", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth0-management")>(
      "@/lib/auth0-management",
    );
  return { ...actual, setAuth0UserBlocked: mocks.setAuth0UserBlocked };
});
vi.mock("@/lib/audit", () => ({ logAudit: mocks.logAudit }));

import {
  canChangeStatus,
  changeUserStatus,
  userStatusUpdateSchema,
} from "@/lib/user-status";

afterEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe("userStatusUpdateSchema", () => {
  it("accepts active|disabled", () => {
    expect(
      userStatusUpdateSchema.safeParse({ status: "active" }).success,
    ).toBe(true);
    expect(
      userStatusUpdateSchema.safeParse({ status: "disabled" }).success,
    ).toBe(true);
  });
  it("rejects unknown status", () => {
    expect(
      userStatusUpdateSchema.safeParse({ status: "pending" }).success,
    ).toBe(false);
  });
});

describe("canChangeStatus", () => {
  it("blocks self-disable (cannot lock yourself out)", () => {
    expect(
      canChangeStatus({
        actorRole: "superadmin",
        targetCurrentRole: "admin",
        newStatus: "disabled",
        isSelf: true,
      }),
    ).toBe(false);
  });

  it("admin cannot disable a superadmin", () => {
    expect(
      canChangeStatus({
        actorRole: "admin",
        targetCurrentRole: "superadmin",
        newStatus: "disabled",
        isSelf: false,
      }),
    ).toBe(false);
  });

  it("superadmin can change any other user's status", () => {
    expect(
      canChangeStatus({
        actorRole: "superadmin",
        targetCurrentRole: "superadmin",
        newStatus: "disabled",
        isSelf: false,
      }),
    ).toBe(true);
  });

  it("admin can toggle viewer/admin target status", () => {
    expect(
      canChangeStatus({
        actorRole: "admin",
        targetCurrentRole: "viewer",
        newStatus: "disabled",
        isSelf: false,
      }),
    ).toBe(true);
  });

  it("viewer cannot change status", () => {
    expect(
      canChangeStatus({
        actorRole: "viewer",
        targetCurrentRole: "viewer",
        newStatus: "disabled",
        isSelf: false,
      }),
    ).toBe(false);
  });
});

describe("changeUserStatus", () => {
  function stubPrisma(target: Record<string, unknown> | null) {
    return {
      user: {
        findUnique: vi.fn().mockResolvedValue(target),
        update: vi.fn().mockImplementation(async (args: { data: { status: string } }) => ({
          id: "t-1",
          auth0Id: "auth0|t1",
          status: args.data.status,
        })),
      },
    };
  }

  it("returns null on missing target", async () => {
    const prisma = stubPrisma(null);
    const result = await changeUserStatus(
      prisma as unknown as Parameters<typeof changeUserStatus>[0],
      {
        targetUserId: "missing",
        newStatus: "disabled",
        actor: {
          userId: "a",
          role: "superadmin",
          ipAddress: "1.1.1.1",
          userAgent: "UA",
        },
      },
    );
    expect(result).toBeNull();
  });

  it("throws Forbidden on hierarchy violation", async () => {
    const prisma = stubPrisma({
      id: "t-1",
      auth0Id: "auth0|t1",
      role: "superadmin",
      status: "active",
    });
    await expect(
      changeUserStatus(
        prisma as unknown as Parameters<typeof changeUserStatus>[0],
        {
          targetUserId: "t-1",
          newStatus: "disabled",
          actor: {
            userId: "a",
            role: "admin",
            ipAddress: "1.1.1.1",
            userAgent: "UA",
          },
        },
      ),
    ).rejects.toThrow(/forbidden/i);
    expect(mocks.setAuth0UserBlocked).not.toHaveBeenCalled();
  });

  it("no-op when status already equals newStatus", async () => {
    const prisma = stubPrisma({
      id: "t-1",
      auth0Id: "auth0|t1",
      role: "viewer",
      status: "active",
    });
    const result = await changeUserStatus(
      prisma as unknown as Parameters<typeof changeUserStatus>[0],
      {
        targetUserId: "t-1",
        newStatus: "active",
        actor: {
          userId: "a",
          role: "superadmin",
          ipAddress: "1.1.1.1",
          userAgent: "UA",
        },
      },
    );
    expect(result).toMatchObject({ id: "t-1", status: "active" });
    expect(mocks.setAuth0UserBlocked).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("disables user: PATCHes Auth0 blocked=true + updates DB + logs USER_DISABLE", async () => {
    const prisma = stubPrisma({
      id: "t-1",
      auth0Id: "auth0|t1",
      role: "viewer",
      status: "active",
    });
    mocks.setAuth0UserBlocked.mockResolvedValueOnce(undefined);
    const result = await changeUserStatus(
      prisma as unknown as Parameters<typeof changeUserStatus>[0],
      {
        targetUserId: "t-1",
        newStatus: "disabled",
        actor: {
          userId: "a",
          role: "superadmin",
          ipAddress: "1.2.3.4",
          userAgent: "UA",
        },
      },
    );
    expect(result?.status).toBe("disabled");
    expect(mocks.setAuth0UserBlocked).toHaveBeenCalledWith("auth0|t1", true);
    expect(prisma.user.update.mock.calls[0]?.[0].data).toEqual({
      status: "disabled",
    });
    const auditArg = mocks.logAudit.mock.calls[0]?.[1];
    expect(auditArg.action).toBe("USER_DISABLE");
  });

  it("enables user: PATCHes Auth0 blocked=false + logs USER_ENABLE", async () => {
    const prisma = stubPrisma({
      id: "t-1",
      auth0Id: "auth0|t1",
      role: "viewer",
      status: "disabled",
    });
    mocks.setAuth0UserBlocked.mockResolvedValueOnce(undefined);
    const result = await changeUserStatus(
      prisma as unknown as Parameters<typeof changeUserStatus>[0],
      {
        targetUserId: "t-1",
        newStatus: "active",
        actor: {
          userId: "a",
          role: "superadmin",
          ipAddress: "1.2.3.4",
          userAgent: "UA",
        },
      },
    );
    expect(result?.status).toBe("active");
    expect(mocks.setAuth0UserBlocked).toHaveBeenCalledWith("auth0|t1", false);
    const auditArg = mocks.logAudit.mock.calls[0]?.[1];
    expect(auditArg.action).toBe("USER_ENABLE");
  });
});
