import { describe, expect, it, vi } from "vitest";
import {
  AWS_REGIONS,
  bucketCreateInputSchema,
  createBucketForTenant,
  DuplicateBucketNameError,
  HIPAA_BUCKET_NAME_PREFIX,
  type BucketCreatePrisma,
  type BucketCreateTxHandle,
  type BucketS3Runner,
} from "@/lib/bucket-create";

type CreateArgs = { data: Record<string, unknown> };

interface StubOpts {
  readonly createdBucketId?: string;
  readonly throwOnBucketCreate?: unknown;
  readonly throwOnAuditCreate?: unknown;
}

function makePrisma(opts: StubOpts = {}) {
  const bucketCreateCalls: CreateArgs[] = [];
  const auditCreateCalls: CreateArgs[] = [];
  const txHandle: BucketCreateTxHandle = {
    bucket: {
      create: vi.fn(async (args: CreateArgs) => {
        bucketCreateCalls.push(args);
        if (opts.throwOnBucketCreate) throw opts.throwOnBucketCreate;
        return {
          id: opts.createdBucketId ?? "new-bucket-id",
          name: args.data.name as string,
          awsRegion: args.data.awsRegion as string,
        };
      }),
    },
    auditLog: {
      create: vi.fn(async (args: CreateArgs) => {
        auditCreateCalls.push(args);
        if (opts.throwOnAuditCreate) throw opts.throwOnAuditCreate;
        return { id: "audit-1" };
      }),
    },
  };
  const client: BucketCreatePrisma = {
    // Simulate rollback semantics: if the callback throws, the prior
    // tx mutations do NOT persist. The stub only records calls, so
    // rollback = calls stay recorded for test inspection but the
    // parent context sees the error. Direct generic function (not
    // vi.fn wrapped) to avoid vitest's Mock<...> generic erasure.
    $transaction: <T,>(fn: (tx: BucketCreateTxHandle) => Promise<T>) =>
      fn(txHandle),
  };
  return { client, bucketCreateCalls, auditCreateCalls };
}

function makeS3Runner(opts?: { throwOnCreate?: Error }) {
  const createCalls: Array<{ name: string; region: string }> = [];
  const deleteCalls: string[] = [];
  const runner: BucketS3Runner = {
    create: vi.fn(async (input) => {
      createCalls.push({ name: input.name, region: input.region });
      if (opts?.throwOnCreate) throw opts.throwOnCreate;
      return {
        name: input.name,
        region: input.region,
        cloudTrailConfigured: false,
      };
    }),
    deleteEmpty: vi.fn(async (name: string) => {
      deleteCalls.push(name);
    }),
  };
  return { runner, createCalls, deleteCalls };
}

const VALID_NAME = `${HIPAA_BUCKET_NAME_PREFIX}acme-prod`;

const baseCtx = {
  createdById: "user-42",
  ipAddress: "10.0.0.1",
  userAgent: "vitest/1.0",
};

describe("bucketCreateInputSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = bucketCreateInputSchema.safeParse({
      name: VALID_NAME,
      awsRegion: "us-east-1",
      description: "primary",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects names without the HIPAA prefix", () => {
    expect(
      bucketCreateInputSchema.safeParse({
        name: "random-bucket-x",
        awsRegion: "us-east-1",
      }).success,
    ).toBe(false);
  });

  it("rejects names with uppercase / underscores / dots", () => {
    for (const n of [
      `${HIPAA_BUCKET_NAME_PREFIX}ACME`,
      `${HIPAA_BUCKET_NAME_PREFIX}acme_prod`,
      `${HIPAA_BUCKET_NAME_PREFIX}acme.prod`,
    ]) {
      expect(
        bucketCreateInputSchema.safeParse({ name: n, awsRegion: "us-east-1" })
          .success,
      ).toBe(false);
    }
  });

  it("rejects names shorter than 3 chars or longer than 63", () => {
    expect(
      bucketCreateInputSchema.safeParse({ name: "a", awsRegion: "us-east-1" })
        .success,
    ).toBe(false);
    expect(
      bucketCreateInputSchema.safeParse({
        name: `${HIPAA_BUCKET_NAME_PREFIX}${"x".repeat(100)}`,
        awsRegion: "us-east-1",
      }).success,
    ).toBe(false);
  });

  it("rejects an unsupported AWS region", () => {
    expect(
      bucketCreateInputSchema.safeParse({
        name: VALID_NAME,
        awsRegion: "mars-north-1",
      }).success,
    ).toBe(false);
  });

  it("accepts every region in AWS_REGIONS", () => {
    for (const r of AWS_REGIONS) {
      expect(
        bucketCreateInputSchema.safeParse({
          name: VALID_NAME,
          awsRegion: r,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects oversized description", () => {
    expect(
      bucketCreateInputSchema.safeParse({
        name: VALID_NAME,
        awsRegion: "us-east-1",
        description: "x".repeat(5000),
      }).success,
    ).toBe(false);
  });
});

describe("createBucketForTenant", () => {
  it("creates on S3, inserts the DB row, writes the audit log in one tx, returns the bucket", async () => {
    const prisma = makePrisma({ createdBucketId: "b-new" });
    const s3 = makeS3Runner();
    const result = await createBucketForTenant(
      prisma.client,
      s3.runner,
      { name: VALID_NAME, awsRegion: "us-east-1", description: "primary" },
      baseCtx,
    );
    expect(result).toEqual({
      id: "b-new",
      name: VALID_NAME,
      region: "us-east-1",
    });
    expect(s3.createCalls).toEqual([
      { name: VALID_NAME, region: "us-east-1" },
    ]);
    const row = prisma.bucketCreateCalls[0]?.data;
    expect(row).toMatchObject({
      name: VALID_NAME,
      awsRegion: "us-east-1",
      description: "primary",
      createdById: "user-42",
      isActive: true,
    });
    expect(prisma.auditCreateCalls).toHaveLength(1);
    const audit = prisma.auditCreateCalls[0]?.data;
    expect(audit).toMatchObject({
      userId: "user-42",
      action: "BUCKET_CREATE",
      targetType: "bucket",
      targetId: "b-new",
      ipAddress: "10.0.0.1",
      userAgent: "vitest/1.0",
    });
    expect(audit?.metadata).toEqual({
      name: VALID_NAME,
      awsRegion: "us-east-1",
    });
  });

  it("rolls back the S3 bucket and re-throws as DuplicateBucketNameError on P2002", async () => {
    const p2002 = Object.assign(new Error("P2002 unique constraint"), {
      code: "P2002",
    });
    const prisma = makePrisma({ throwOnBucketCreate: p2002 });
    const s3 = makeS3Runner();
    await expect(
      createBucketForTenant(
        prisma.client,
        s3.runner,
        { name: VALID_NAME, awsRegion: "us-east-1" },
        baseCtx,
      ),
    ).rejects.toBeInstanceOf(DuplicateBucketNameError);
    expect(s3.createCalls).toHaveLength(1);
    expect(s3.deleteCalls).toEqual([VALID_NAME]);
  });

  it("rolls back S3 + re-throws original on any non-P2002 DB error", async () => {
    const other = new Error("transient DB failure");
    const prisma = makePrisma({ throwOnBucketCreate: other });
    const s3 = makeS3Runner();
    await expect(
      createBucketForTenant(
        prisma.client,
        s3.runner,
        { name: VALID_NAME, awsRegion: "us-east-1" },
        baseCtx,
      ),
    ).rejects.toThrow(/transient DB failure/);
    expect(s3.deleteCalls).toEqual([VALID_NAME]);
  });

  it("rolls back S3 + bucket row when auditLog insert fails (tx rollback)", async () => {
    const prisma = makePrisma({
      throwOnAuditCreate: new Error("audit writer dead"),
    });
    const s3 = makeS3Runner();
    await expect(
      createBucketForTenant(
        prisma.client,
        s3.runner,
        { name: VALID_NAME, awsRegion: "us-east-1" },
        baseCtx,
      ),
    ).rejects.toThrow(/audit writer dead/);
    // bucket.create was called inside the tx; transaction rollback
    // is simulated by the stub not persisting state, but we verify
    // that S3 rollback ran so AWS is left clean.
    expect(s3.deleteCalls).toEqual([VALID_NAME]);
  });

  it("does NOT rollback on S3 failure (createHipaaBucket handles its own internal rollback)", async () => {
    const prisma = makePrisma();
    const s3 = makeS3Runner({ throwOnCreate: new Error("AWS blew up") });
    await expect(
      createBucketForTenant(
        prisma.client,
        s3.runner,
        { name: VALID_NAME, awsRegion: "us-east-1" },
        baseCtx,
      ),
    ).rejects.toThrow(/AWS blew up/);
    expect(s3.deleteCalls).toHaveLength(0);
    expect(prisma.bucketCreateCalls).toHaveLength(0);
    expect(prisma.auditCreateCalls).toHaveLength(0);
  });

  it("rejects invalid input at the schema boundary (defense-in-depth vs the route's own parse)", async () => {
    const prisma = makePrisma();
    const s3 = makeS3Runner();
    await expect(
      createBucketForTenant(
        prisma.client,
        s3.runner,
        { name: "no-prefix", awsRegion: "us-east-1" },
        baseCtx,
      ),
    ).rejects.toThrow();
    expect(s3.createCalls).toHaveLength(0);
    expect(prisma.bucketCreateCalls).toHaveLength(0);
  });
});
