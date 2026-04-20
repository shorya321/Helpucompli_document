import { z } from "zod";
import type { Role } from "@/types";

export type UserListSortField = "name" | "email" | "createdAt" | "lastLoginAt" | "role";
export type UserListSortDir = "asc" | "desc";
export type UserStatus = "active" | "disabled";

export const userListQuerySchema = z.object({
  q: z.string().max(128).optional(),
  role: z.enum(["superadmin", "admin", "viewer"]).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  sort: z
    .enum(["name", "email", "createdAt", "lastLoginAt", "role"])
    .default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(25),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;

function firstValue(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}

export function parseUserListQuery(
  params: Record<string, unknown>,
): UserListQuery | null {
  const raw = {
    q: firstValue(params.q),
    role: firstValue(params.role),
    status: firstValue(params.status),
    sort: firstValue(params.sort) ?? "createdAt",
    dir: firstValue(params.dir) ?? "desc",
    page: params.page !== undefined ? Number(firstValue(params.page)) : 1,
    pageSize:
      params.pageSize !== undefined ? Number(firstValue(params.pageSize)) : 25,
  };
  const parsed = userListQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface UserListRow {
  readonly id: string;
  readonly auth0Id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: Role;
  readonly status: UserStatus;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
}

export interface UserListResult {
  readonly users: ReadonlyArray<UserListRow>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface UserListPrisma {
  readonly user: {
    findMany(args: unknown): Promise<UserListRow[]>;
    count(args: unknown): Promise<number>;
  };
}

export function asUserListPrisma(client: { readonly user: unknown }): UserListPrisma {
  return client as unknown as UserListPrisma;
}

export async function listUsers(
  prisma: UserListPrisma,
  input: Partial<UserListQuery>,
): Promise<UserListResult> {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const sort = input.sort ?? "createdAt";
  const dir = input.dir ?? "desc";

  const where: Record<string, unknown> = {};
  if (input.role) where.role = input.role;
  if (input.status) where.status = input.status;
  if (input.q && input.q.length > 0) {
    where.OR = [
      { name: { contains: input.q, mode: "insensitive" } },
      { email: { contains: input.q, mode: "insensitive" } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { [sort]: dir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        auth0Id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total, page, pageSize };
}
