import { z } from "zod";
import type { Role } from "@/types";

export type BucketSortField = "name" | "createdAt" | "documentCount";
export type BucketSortDir = "asc" | "desc";
export type BucketStatusFilter = "active" | "inactive" | "all";

export interface BucketSummary {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly description: string | null;
  readonly createdAt: Date;
  readonly isActive: boolean;
  readonly documentCount: number;
  readonly storageBytes: bigint;
}

export interface BucketListFilters {
  readonly region?: string;
  readonly status?: BucketStatusFilter;
}

export interface BucketListSort {
  readonly field: BucketSortField;
  readonly dir: BucketSortDir;
}

// Scope: superadmin/admin see every bucket, viewer only sees buckets
// granted via UserBucketAccess. Encoded as a discriminated union so the
// caller cannot pass a viewer role without a userId.
export type BucketListScope =
  | { readonly role: Extract<Role, "superadmin" | "admin"> }
  | { readonly role: Extract<Role, "viewer">; readonly userId: string };

export interface BucketListOptions {
  readonly filters?: BucketListFilters;
  readonly sort?: BucketListSort;
}

// Narrow Prisma surface — lets tests inject plain stubs without
// reaching for @prisma/client's generated types. Method syntax gives
// bivariant args so the real PrismaClient's generic signatures remain
// assignable.
export interface BucketListPrisma {
  readonly bucket: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        name: string;
        awsRegion: string;
        description: string | null;
        createdAt: Date;
        isActive: boolean;
        _count: { documents: number };
      }>
    >;
  };
  readonly document: {
    groupBy(args: unknown): Promise<
      Array<{ bucketId: string; _sum: { sizeBytes: bigint | null } }>
    >;
  };
}

interface BucketListLike {
  readonly bucket: { findMany(args?: unknown): Promise<unknown[]> };
  readonly document: { groupBy(args?: unknown): Promise<unknown[]> };
}

export function asBucketListPrisma(client: BucketListLike): BucketListPrisma {
  return client as unknown as BucketListPrisma;
}

// Shared query schema for /api/s3/buckets AND /buckets page. Single
// source of truth — the route cannot drift from the UI dropdowns.
// 32-char region cap leaves headroom over the longest current AWS
// region (~20 chars) while blocking query-string abuse.
export const bucketListQuerySchema = z.object({
  sort: z.enum(["name", "createdAt", "documentCount"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  region: z.string().min(1).max(32).optional(),
  status: z.enum(["active", "inactive", "all"]).optional(),
});

export type BucketListQuery = z.infer<typeof bucketListQuerySchema>;

// Pure helper: take a normalised query bag, return the typed
// sort/filters the lib expects. Returns `null` on validation failure
// so callers can choose their own response code (400 in the route,
// fallback-to-defaults on the page).
export function parseBucketListQuery(
  params: Record<string, string | string[] | undefined>,
): BucketListOptions | null {
  // Collapse array-valued params to the first string — URLSearchParams
  // tolerates duplicates but the schema wants single values.
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") flat[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") flat[k] = v[0];
  }
  const parsed = bucketListQuerySchema.safeParse(flat);
  if (!parsed.success) return null;

  const { sort, dir, region, status } = parsed.data;
  // `dir` without `sort` is ambiguous (asc/desc by which field?) and a
  // silent default-to-name creates surprising UX where the filter bar
  // submits dir alone. Reject it explicitly.
  if (dir && !sort) return null;
  const options: { sort?: BucketListSort; filters?: BucketListFilters } = {};
  if (sort) options.sort = { field: sort, dir: dir ?? "asc" };
  const filters: BucketListFilters = {
    ...(region ? { region } : {}),
    ...(status ? { status } : {}),
  };
  if (Object.keys(filters).length) options.filters = filters;
  return options;
}

function buildWhere(
  scope: BucketListScope,
  filters: BucketListFilters,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  const status: BucketStatusFilter = filters.status ?? "active";
  if (status === "active") where.isActive = true;
  else if (status === "inactive") where.isActive = false;

  if (filters.region) where.awsRegion = filters.region;

  if (scope.role === "viewer") {
    where.userAccess = { some: { userId: scope.userId } };
  }
  return where;
}

function buildOrderBy(
  sort: BucketListSort,
): Record<string, BucketSortDir> | undefined {
  // documentCount ordering is applied in-memory after the relation
  // count merge — Prisma cannot orderBy a filtered-relation _count.
  if (sort.field === "documentCount") return undefined;
  if (sort.field === "name") return { name: sort.dir };
  return { createdAt: sort.dir };
}

export async function getBucketList(
  prisma: BucketListPrisma,
  scope: BucketListScope,
  options: BucketListOptions = {},
): Promise<readonly BucketSummary[]> {
  const filters = options.filters ?? {};
  const sort: BucketListSort = options.sort ?? { field: "name", dir: "asc" };
  const where = buildWhere(scope, filters);
  const orderBy = buildOrderBy(sort);

  const findManyArgs: Record<string, unknown> = {
    where,
    select: {
      id: true,
      name: true,
      awsRegion: true,
      description: true,
      createdAt: true,
      isActive: true,
      // Filtered-relation _count — HIPAA isDeleted=false so soft-deleted
      // docs do not inflate the visible count.
      _count: { select: { documents: { where: { isDeleted: false } } } },
    },
  };
  if (orderBy) findManyArgs.orderBy = orderBy;

  // findMany first, then groupBy scoped to the IDs it returned. This
  // avoids loading aggregate storage for buckets outside the caller's
  // scope (defense-in-depth under HIPAA 164.312 — a viewer's request
  // never touches document sums for buckets they can't see, even in
  // server memory). Sequencing is intentional; Promise.all would race
  // the groupBy before we know the scope.
  const rows = await prisma.bucket.findMany(findManyArgs);
  const bucketIds = rows.map((r) => r.id);
  const groups =
    bucketIds.length === 0
      ? []
      : await prisma.document.groupBy({
          by: ["bucketId"],
          where: { isDeleted: false, bucketId: { in: bucketIds } },
          _sum: { sizeBytes: true },
        });

  const ZERO = BigInt(0);
  const storageById = new Map<string, bigint>();
  for (const g of groups) {
    storageById.set(g.bucketId, g._sum.sizeBytes ?? ZERO);
  }

  const merged: BucketSummary[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    region: r.awsRegion,
    description: r.description,
    createdAt: r.createdAt,
    isActive: r.isActive,
    documentCount: r._count.documents,
    storageBytes: storageById.get(r.id) ?? ZERO,
  }));

  if (sort.field === "documentCount") {
    const mul = sort.dir === "asc" ? 1 : -1;
    merged.sort((a, b) => mul * (a.documentCount - b.documentCount));
  }

  return merged;
}
