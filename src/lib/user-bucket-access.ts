import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

// Request body for PUT /api/users/[id]/buckets — a complete replacement
// of the assigned-bucket set. Deduplication is enforced at parse time
// so the diff never double-counts a repeated id.
export const bucketAccessUpdateSchema = z.object({
  bucketIds: z
    .array(z.string().uuid())
    .max(200)
    .transform((ids) => Array.from(new Set(ids))),
});

export type BucketAccessUpdateInput = z.infer<typeof bucketAccessUpdateSchema>;

export interface UserBucketAccessRow {
  readonly bucketId: string;
  readonly name: string;
  readonly grantedAt: Date;
  readonly grantedByName: string | null;
}

export interface UserBucketAccessPrisma {
  readonly userBucketAccess: {
    findMany(args: unknown): Promise<unknown[]>;
  };
}

export async function getUserBuckets(
  prisma: UserBucketAccessPrisma,
  userId: string,
): Promise<UserBucketAccessRow[]> {
  const rows = (await prisma.userBucketAccess.findMany({
    where: { userId },
    orderBy: { grantedAt: "asc" },
    select: {
      bucketId: true,
      grantedAt: true,
      bucket: { select: { name: true } },
      grantedBy: { select: { name: true, email: true } },
    },
  })) as Array<{
    bucketId: string;
    grantedAt: Date;
    bucket: { name: string } | null;
    grantedBy: { name: string | null; email: string } | null;
  }>;

  return rows.map((r) => ({
    bucketId: r.bucketId,
    name: r.bucket?.name ?? "",
    grantedAt: r.grantedAt,
    grantedByName:
      r.grantedBy?.name && r.grantedBy.name.length > 0
        ? r.grantedBy.name
        : (r.grantedBy?.email ?? null),
  }));
}

export interface BucketAccessDiff {
  readonly toAdd: readonly string[];
  readonly toRemove: readonly string[];
}

export function diffBucketAccess(
  current: readonly string[],
  next: readonly string[],
): BucketAccessDiff {
  const nextSet = new Set(next);
  const currentSet = new Set(current);
  const toAdd = next.filter((b) => !currentSet.has(b));
  const toRemove = current.filter((b) => !nextSet.has(b));
  return { toAdd, toRemove };
}

type BucketAccessWritePrisma = Pick<PrismaClient, "$transaction">;

export interface SetBucketAccessArgs {
  readonly userId: string;
  readonly bucketIds: readonly string[];
  readonly grantedById: string;
}

// Replaces the user's assigned-bucket set to exactly bucketIds. Uses a
// single transaction: read current → compute diff → delete removed →
// create added. Skips both writes when the diff is empty so the hot
// path for "open the access editor and close again" is one SELECT.
export async function setUserBuckets(
  prisma: BucketAccessWritePrisma,
  args: SetBucketAccessArgs,
): Promise<BucketAccessDiff> {
  return prisma.$transaction(async (tx) => {
    const txClient = tx as unknown as {
      userBucketAccess: {
        findMany(args: unknown): Promise<Array<{ bucketId: string }>>;
        deleteMany(args: unknown): Promise<unknown>;
        createMany(args: unknown): Promise<unknown>;
      };
    };

    const existing = await txClient.userBucketAccess.findMany({
      where: { userId: args.userId },
      select: { bucketId: true },
    });
    const current = existing.map((e) => e.bucketId);
    const diff = diffBucketAccess(current, args.bucketIds);

    if (diff.toRemove.length > 0) {
      await txClient.userBucketAccess.deleteMany({
        where: {
          userId: args.userId,
          bucketId: { in: diff.toRemove as string[] },
        },
      });
    }
    if (diff.toAdd.length > 0) {
      await txClient.userBucketAccess.createMany({
        data: diff.toAdd.map((bucketId) => ({
          userId: args.userId,
          bucketId,
          grantedById: args.grantedById,
        })),
      });
    }

    return diff;
  });
}
