import { describe, expect, it, vi } from "vitest";
import {
  parseUserListQuery,
  listUsers,
  asUserListPrisma,
} from "@/lib/user-list";

describe("parseUserListQuery", () => {
  it("applies defaults", () => {
    const parsed = parseUserListQuery({});
    expect(parsed).toMatchObject({
      page: 1,
      pageSize: 10,
      sort: "createdAt",
      dir: "desc",
    });
  });

  it("accepts role + status filters and q search", () => {
    const parsed = parseUserListQuery({
      role: "admin",
      status: "active",
      q: "alice",
    });
    expect(parsed).toMatchObject({ role: "admin", status: "active", q: "alice" });
  });

  it("rejects invalid role", () => {
    expect(parseUserListQuery({ role: "owner" })).toBeNull();
  });

  it("rejects invalid sort field", () => {
    expect(parseUserListQuery({ sort: "password" })).toBeNull();
  });

  it("caps pageSize and rejects oversize q", () => {
    expect(parseUserListQuery({ pageSize: "500" })).toBeNull();
    expect(parseUserListQuery({ q: "x".repeat(129) })).toBeNull();
  });

  it("treats empty role/status as undefined (form 'All' option)", () => {
    const parsed = parseUserListQuery({ q: "john", role: "", status: "" });
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      q: "john",
      role: undefined,
      status: undefined,
    });
  });

  it("treats empty page/pageSize as defaults", () => {
    const parsed = parseUserListQuery({ page: "", pageSize: "" });
    expect(parsed).toMatchObject({ page: 1, pageSize: 10 });
  });

  it("treats empty sort/dir as defaults", () => {
    const parsed = parseUserListQuery({ sort: "", dir: "" });
    expect(parsed).toMatchObject({ sort: "createdAt", dir: "desc" });
  });
});

describe("listUsers", () => {
  function makePrisma(rows: unknown[], total: number) {
    return {
      user: {
        findMany: vi.fn().mockResolvedValue(rows),
        count: vi.fn().mockResolvedValue(total),
      },
    };
  }

  it("passes through pagination skip/take + orderBy", async () => {
    const prisma = makePrisma([], 0);
    await listUsers(asUserListPrisma(prisma), {
      page: 2,
      pageSize: 10,
      sort: "name",
      dir: "asc",
    });
    const arg = prisma.user.findMany.mock.calls[0]?.[0];
    expect(arg.skip).toBe(10);
    expect(arg.take).toBe(10);
    expect(arg.orderBy).toEqual({ name: "asc" });
  });

  it("builds ILIKE OR across name + email for q", async () => {
    const prisma = makePrisma([], 0);
    await listUsers(asUserListPrisma(prisma), { q: "ali" });
    const where = prisma.user.findMany.mock.calls[0]?.[0].where;
    expect(where.OR).toEqual([
      { name: { contains: "ali", mode: "insensitive" } },
      { email: { contains: "ali", mode: "insensitive" } },
    ]);
  });

  it("filters by role + status when provided", async () => {
    const prisma = makePrisma([], 0);
    await listUsers(asUserListPrisma(prisma), {
      role: "viewer",
      status: "disabled",
    });
    const where = prisma.user.findMany.mock.calls[0]?.[0].where;
    expect(where.role).toBe("viewer");
    expect(where.status).toBe("disabled");
  });

  it("returns paginated result shape", async () => {
    const rows = [
      {
        id: "u-1",
        auth0Id: "auth0|1",
        email: "a@b.com",
        name: "Alice",
        role: "admin",
        status: "active",
        lastLoginAt: new Date("2026-04-01T00:00:00Z"),
        createdAt: new Date("2026-03-01T00:00:00Z"),
      },
    ];
    const prisma = makePrisma(rows, 1);
    const result = await listUsers(asUserListPrisma(prisma), { page: 1 });
    expect(result.total).toBe(1);
    expect(result.users[0]?.email).toBe("a@b.com");
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
  });
});
