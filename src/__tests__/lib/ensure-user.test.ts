import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureUser } from "@/lib/ensure-user";
import type { SessionData } from "@/lib/auth-guard";

type PrismaStub = {
  user: { upsert: ReturnType<typeof vi.fn> };
};

function makePrisma(returning: { id: string } = { id: "u-new" }): PrismaStub {
  return {
    user: { upsert: vi.fn().mockResolvedValue(returning) },
  };
}

function sessionOf(overrides: Record<string, unknown> = {}): SessionData {
  return {
    user: {
      sub: "auth0|abc",
      email: "me@example.com",
      name: "Example User",
      ...overrides,
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("ensureUser", () => {
  it("calls prisma.user.upsert keyed by auth0Id with role + email + name from session", async () => {
    const prisma = makePrisma({ id: "u-1" });
    const session = sessionOf({ sub: "auth0|s1", email: "a@b.com", name: "Alice" });

    const result = await ensureUser(
      prisma as unknown as Parameters<typeof ensureUser>[0],
      { session, role: "superadmin" },
    );

    expect(result).toEqual({ id: "u-1" });
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.user.upsert.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ auth0Id: "auth0|s1" });
    expect(arg.create).toMatchObject({
      auth0Id: "auth0|s1",
      email: "a@b.com",
      name: "Alice",
      role: "superadmin",
    });
    expect(arg.select).toEqual({ id: true });
  });

  it("update branch syncs email + name + lastLoginAt from Auth0 but NOT role (F10.1)", async () => {
    const prisma = makePrisma({ id: "u-2" });
    const session = sessionOf({ email: "new@b.com", name: "New Name" });

    await ensureUser(
      prisma as unknown as Parameters<typeof ensureUser>[0],
      { session, role: "admin" },
    );

    const arg = prisma.user.upsert.mock.calls[0]?.[0];
    expect(arg.update.email).toBe("new@b.com");
    expect(arg.update.name).toBe("New Name");
    expect(arg.update.lastLoginAt).toBeInstanceOf(Date);
    // Role change is governed by F10.4 role-management flow, not passive login sync.
    expect(arg.update.role).toBeUndefined();
  });

  it("update branch coerces missing name to null on Auth0 profile change", async () => {
    const prisma = makePrisma({ id: "u-3" });
    const session = sessionOf({ name: undefined });

    await ensureUser(
      prisma as unknown as Parameters<typeof ensureUser>[0],
      { session, role: "viewer" },
    );

    const arg = prisma.user.upsert.mock.calls[0]?.[0];
    expect(arg.update.name).toBeNull();
  });

  it("coerces non-string name to null (Auth0 may omit or return non-string)", async () => {
    const prisma = makePrisma();
    const session = sessionOf({ name: undefined });

    await ensureUser(
      prisma as unknown as Parameters<typeof ensureUser>[0],
      { session, role: "viewer" },
    );

    const arg = prisma.user.upsert.mock.calls[0]?.[0];
    expect(arg.create.name).toBeNull();
  });

  it("throws when session is missing email claim — UNIQUE NOT NULL guard", async () => {
    const prisma = makePrisma();
    const session = sessionOf({ email: undefined });

    await expect(
      ensureUser(
        prisma as unknown as Parameters<typeof ensureUser>[0],
        { session, role: "superadmin" },
      ),
    ).rejects.toThrow(/email/i);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("throws when session email is a non-string value", async () => {
    const prisma = makePrisma();
    const session = sessionOf({ email: 42 });

    await expect(
      ensureUser(
        prisma as unknown as Parameters<typeof ensureUser>[0],
        { session, role: "superadmin" },
      ),
    ).rejects.toThrow(/email/i);
  });
});
