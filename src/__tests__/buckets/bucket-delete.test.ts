import { describe, expect, it, vi } from "vitest";
import {
  BucketAlreadyDeletedError,
  BucketHasActiveDocumentsError,
  BucketNotFoundForDeleteError,
  deleteBucketForTenant,
  type BucketDeletePrisma,
  type BucketDeleteTxHandle,
  type BucketS3DeleteRunner,
} from "@/lib/bucket-delete";
import { BucketNotEmptyError } from "@/lib/s3-buckets";

type Args = { data?: Record<string, unknown>; where?: Record<string, unknown> };

interface StubOpts {
  readonly bucket?:
    | {
        id: string;
        name: string;
        isActive: boolean;
        _count: { documents: number };
      }
    | null;
  readonly throwOnUpdate?: unknown;
  readonly throwOnAudit?: unknown;
}

function makePrisma(opts: StubOpts = {}) {
  const findCalls: Args[] = [];
  const updateCalls: Args[] = [];
  const auditCalls: Args[] = [];
  const txHandle: BucketDeleteTxHandle = {
    bucket: {
      update: vi.fn(async (args: Args) => {
        updateCalls.push(args);
        if (opts.throwOnUpdate) throw opts.throwOnUpdate;
        return { id: "b-1", name: "helpucompli-docs-x", isActive: false };
      }),
    },
    auditLog: {
      create: vi.fn(async (args: Args) => {
        auditCalls.push(args);
        if (opts.throwOnAudit) throw opts.throwOnAudit;
        return { id: "audit-1" };
      }),
    },
  };
  const client: BucketDeletePrisma = {
    bucket: {
      findUnique: vi.fn(async (args: Args) => {
        findCalls.push(args);
        return opts.bucket === undefined
          ? {
              id: "b-1",
              name: "helpucompli-docs-x",
              isActive: true,
              _count: { documents: 0 },
            }
          : opts.bucket;
      }),
    },
    $transaction: <T,>(fn: (tx: BucketDeleteTxHandle) => Promise<T>) =>
      fn(txHandle),
  };
  return { client, findCalls, updateCalls, auditCalls };
}

function makeS3Runner(opts?: { throwOnDelete?: unknown }) {
  const deleteCalls: string[] = [];
  const runner: BucketS3DeleteRunner = {
    deleteEmpty: vi.fn(async (name: string) => {
      deleteCalls.push(name);
      if (opts?.throwOnDelete) throw opts.throwOnDelete;
    }),
  };
  return { runner, deleteCalls };
}

const baseCtx = {
  userId: "u-42",
  ipAddress: "10.0.0.1",
  userAgent: "vitest/1.0",
};

describe("deleteBucketForTenant — preconditions", () => {
  it("404 when bucket not found", async () => {
    const prisma = makePrisma({ bucket: null });
    const s3 = makeS3Runner();
    await expect(
      deleteBucketForTenant(prisma.client, s3.runner, "b-missing", baseCtx),
    ).rejects.toBeInstanceOf(BucketNotFoundForDeleteError);
    expect(s3.deleteCalls).toHaveLength(0);
  });

  it("409 when bucket already inactive (idempotency guard — no double audit)", async () => {
    const prisma = makePrisma({
      bucket: {
        id: "b-1",
        name: "helpucompli-docs-x",
        isActive: false,
        _count: { documents: 0 },
      },
    });
    const s3 = makeS3Runner();
    await expect(
      deleteBucketForTenant(prisma.client, s3.runner, "b-1", baseCtx),
    ).rejects.toBeInstanceOf(BucketAlreadyDeletedError);
    expect(s3.deleteCalls).toHaveLength(0);
    expect(prisma.auditCalls).toHaveLength(0);
  });

  it("409 when bucket has active (non-soft-deleted) documents — no S3 touch", async () => {
    const prisma = makePrisma({
      bucket: {
        id: "b-1",
        name: "helpucompli-docs-x",
        isActive: true,
        _count: { documents: 3 },
      },
    });
    const s3 = makeS3Runner();
    await expect(
      deleteBucketForTenant(prisma.client, s3.runner, "b-1", baseCtx),
    ).rejects.toBeInstanceOf(BucketHasActiveDocumentsError);
    expect(s3.deleteCalls).toHaveLength(0);
    expect(prisma.updateCalls).toHaveLength(0);
  });
});

describe("deleteBucketForTenant — happy path", () => {
  it("deletes S3 then deactivates DB row + writes audit in one tx", async () => {
    const prisma = makePrisma();
    const s3 = makeS3Runner();
    const r = await deleteBucketForTenant(
      prisma.client,
      s3.runner,
      "b-1",
      baseCtx,
    );
    expect(r).toEqual({
      id: "b-1",
      name: "helpucompli-docs-x",
      isActive: false,
    });
    expect(s3.deleteCalls).toEqual(["helpucompli-docs-x"]);
    expect(prisma.updateCalls).toHaveLength(1);
    expect(prisma.updateCalls[0]?.where).toEqual({ id: "b-1" });
    expect(prisma.updateCalls[0]?.data).toEqual({ isActive: false });
    expect(prisma.auditCalls).toHaveLength(1);
    const audit = prisma.auditCalls[0]?.data;
    expect(audit).toMatchObject({
      userId: "u-42",
      action: "BUCKET_DELETE",
      targetType: "bucket",
      targetId: "b-1",
      ipAddress: "10.0.0.1",
      userAgent: "vitest/1.0",
    });
    expect(audit?.metadata).toEqual({ name: "helpucompli-docs-x" });
  });
});

describe("deleteBucketForTenant — error propagation", () => {
  it("re-wraps S3 BucketNotEmpty race as BucketHasActiveDocumentsError (TOCTOU)", async () => {
    const prisma = makePrisma();
    const s3 = makeS3Runner({
      throwOnDelete: new BucketNotEmptyError("helpucompli-docs-x"),
    });
    await expect(
      deleteBucketForTenant(prisma.client, s3.runner, "b-1", baseCtx),
    ).rejects.toBeInstanceOf(BucketHasActiveDocumentsError);
    expect(prisma.updateCalls).toHaveLength(0);
    expect(prisma.auditCalls).toHaveLength(0);
  });

  it("rethrows non-BucketNotEmpty S3 errors verbatim (no DB mutation)", async () => {
    const prisma = makePrisma();
    const s3 = makeS3Runner({
      throwOnDelete: new Error("AWS connectivity lost"),
    });
    await expect(
      deleteBucketForTenant(prisma.client, s3.runner, "b-1", baseCtx),
    ).rejects.toThrow(/AWS connectivity/);
    expect(prisma.updateCalls).toHaveLength(0);
  });

  it("bubbles tx error when audit insert fails — S3 delete already happened (documented inconsistency window)", async () => {
    const prisma = makePrisma({
      throwOnAudit: new Error("audit writer dead"),
    });
    const s3 = makeS3Runner();
    await expect(
      deleteBucketForTenant(prisma.client, s3.runner, "b-1", baseCtx),
    ).rejects.toThrow(/audit writer dead/);
    // S3 WAS called — by design. On retry, the lib returns 404 since
    // the row is still active but S3 bucket is gone. Ops reconciliation
    // job must sweep active-in-DB but missing-from-S3 pairs.
    expect(s3.deleteCalls).toEqual(["helpucompli-docs-x"]);
  });
});
