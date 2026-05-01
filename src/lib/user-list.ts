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
  pageSize: z.number().int().positive().max(100).default(10),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;

function firstValue(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}

export function parseUserListQuery(
  params: Record<string, unknown>,
): UserListQuery | null {
  const emptyToUndef = (v: string | undefined): string | undefined =>
    v === "" ? undefined : v;

  const pageRaw = firstValue(params.page);
  const pageSizeRaw = firstValue(params.pageSize);

  const raw = {
    q: emptyToUndef(firstValue(params.q)),
    role: emptyToUndef(firstValue(params.role)),
    status: emptyToUndef(firstValue(params.status)),
    sort: emptyToUndef(firstValue(params.sort)) ?? "createdAt",
    dir: emptyToUndef(firstValue(params.dir)) ?? "desc",
    page: pageRaw && pageRaw !== "" ? Number(pageRaw) : 1,
    pageSize: pageSizeRaw && pageSizeRaw !== "" ? Number(pageSizeRaw) : 10,
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
  const pageSize = input.pageSize ?? 10;
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
