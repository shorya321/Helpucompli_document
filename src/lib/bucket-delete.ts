import {
  BucketNotEmptyError,
  deleteEmptyHipaaBucket,
} from "@/lib/s3-buckets";

export class BucketNotFoundForDeleteError extends Error {
  public readonly status = 404;
  constructor(id: string) {
    super(`Bucket '${id}' not found`);
    this.name = "BucketNotFoundForDeleteError";
  }
}

export class BucketAlreadyDeletedError extends Error {
  public readonly status = 409;
  constructor(id: string) {
    super(`Bucket '${id}' has already been deactivated`);
    this.name = "BucketAlreadyDeletedError";
  }
}

export class BucketHasActiveDocumentsError extends Error {
  public readonly status = 409;
  constructor(id: string) {
    super(`Bucket '${id}' still has active documents — empty it first`);
    this.name = "BucketHasActiveDocumentsError";
  }
}

export interface BucketDeleteContext {
  readonly userId: string;
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface BucketDeleteResult {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

// Transaction handle — bucket.update + auditLog.create share one tx
// so a failed audit write rolls back the deactivation (HIPAA
// 164.312(b) audit completeness). The S3 delete happens BEFORE the
// transaction because S3 cannot participate in Prisma $transaction.
export interface BucketDeleteTxHandle {
  readonly bucket: {
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<{ id: string; name: string; isActive: boolean }>;
  };
  readonly auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

export interface BucketDeletePrisma {
  readonly bucket: {
    findUnique(args: {
      where: { id: string };
      select: unknown;
    }): Promise<
      | {
          id: string;
          name: string;
          isActive: boolean;
          _count: { documents: number };
        }
      | null
    >;
  };
  $transaction<T>(fn: (tx: BucketDeleteTxHandle) => Promise<T>): Promise<T>;
}

interface BucketDeletePrismaLike {
  readonly bucket: { findUnique(args?: unknown): Promise<unknown> };
  $transaction(fn: (tx: unknown) => Promise<unknown>): Promise<unknown>;
}

export function asBucketDeletePrisma(
  client: BucketDeletePrismaLike,
): BucketDeletePrisma {
  return client as unknown as BucketDeletePrisma;
}

export interface BucketS3DeleteRunner {
  deleteEmpty(name: string): Promise<void>;
}

export const defaultS3DeleteRunner: BucketS3DeleteRunner = {
  deleteEmpty: (name) => deleteEmptyHipaaBucket(name),
};

export async function deleteBucketForTenant(
  prisma: BucketDeletePrisma,
  s3: BucketS3DeleteRunner,
  bucketId: string,
  ctx: BucketDeleteContext,
): Promise<BucketDeleteResult> {
  const row = await prisma.bucket.findUnique({
    where: { id: bucketId },
    select: {
      id: true,
      name: true,
      isActive: true,
      _count: { select: { documents: { where: { isDeleted: false } } } },
    },
  });
  if (!row) throw new BucketNotFoundForDeleteError(bucketId);
  // Idempotency guard — prevents a second DELETE from re-entering
  // the S3 path (which would 404) and re-issuing an audit row.
  if (!row.isActive) throw new BucketAlreadyDeletedError(bucketId);
  if (row._count.documents > 0) {
    throw new BucketHasActiveDocumentsError(bucketId);
  }

  // S3 delete happens OUTSIDE the tx. If the S3 bucket has been
  // populated since the DB pre-check (a concurrent upload raced),
  // deleteEmptyHipaaBucket throws BucketNotEmptyError — rewrap as
  // the DB-level error class so the route returns a consistent 409.
  try {
    await s3.deleteEmpty(row.name);
  } catch (err) {
    if (err instanceof BucketNotEmptyError) {
      throw new BucketHasActiveDocumentsError(bucketId);
    }
    throw err;
  }

  // Deactivate + audit in one tx. If the audit write fails the
  // deactivation rolls back — at that point the S3 bucket is gone
  // but the DB row is still active. This is a documented
  // reconciliation point (see test "bubbles tx error when audit
  // insert fails"). A periodic sweep reconciles active-in-DB but
  // missing-from-S3 buckets post-hoc.
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.bucket.update({
      where: { id: bucketId },
      data: { isActive: false },
    });
    await tx.auditLog.create({
      data: {
        userId: ctx.userId,
        action: "BUCKET_DELETE",
        targetType: "bucket",
        targetId: bucketId,
        metadata: { name: row.name },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return u;
  });

  return {
    id: updated.id,
    name: updated.name,
    isActive: updated.isActive,
  };
}
