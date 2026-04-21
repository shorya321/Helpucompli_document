import { describe, expect, it, vi } from "vitest";
import {
  BucketNotFoundError,
  BucketAccessDeniedError,
  getBucketDetails,
  type BucketDetails,
  type BucketDetailsPrisma,
  type BucketDetailsScope,
} from "@/lib/bucket-details";

type BucketRow = {
  id: string;
  name: string;
  awsRegion: string;
  description: string | null;
  createdAt: Date;
  isActive: boolean;
  _count: { documents: number };
  userAccess?: Array<{ userId: string }>;
};

interface StubOpts {
  readonly bucket?: BucketRow | null;
  readonly storageBytes?: bigint | null;
  readonly recentDocuments?: Array<Record<string, unknown>>;
  readonly accessPolicies?: Array<Record<string, unknown>>;
}

function makeStub(opts: StubOpts = {}) {
  const bucketCalls: unknown[] = [];
  const aggregateCalls: unknown[] = [];
  const docFindManyCalls: unknown[] = [];
  const policyFindManyCalls: unknown[] = [];
  const client: BucketDetailsPrisma = {
    bucket: {
      findUnique: vi.fn(async (args: unknown) => {
        bucketCalls.push(args);
        return opts.bucket ?? null;
      }),
    },
    document: {
      aggregate: vi.fn(async (args: unknown) => {
        aggregateCalls.push(args);
        return {
          _sum: {
            sizeBytes:
              opts.storageBytes === undefined ? BigInt(0) : opts.storageBytes,
          },
        };
      }),
      findMany: vi.fn(async (args: unknown) => {
        docFindManyCalls.push(args);
        return opts.recentDocuments ?? [];
      }),
    },
    accessPolicy: {
      findMany: vi.fn(async (args: unknown) => {
        policyFindManyCalls.push(args);
        return opts.accessPolicies ?? [];
      }),
    },
  };
  return {
    client,
    bucketCalls,
    aggregateCalls,
    docFindManyCalls,
    policyFindManyCalls,
  };
}

const baseBucket = (overrides: Partial<BucketRow> = {}): BucketRow => ({
  id: "b-1",
  name: "helpucompli-docs-acme",
  awsRegion: "us-east-1",
  description: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  isActive: true,
  _count: { documents: 0 },
  ...overrides,
});

describe("getBucketDetails — scope", () => {
  it("404s when bucket does not exist (admin)", async () => {
    const stub = makeStub({ bucket: null });
    await expect(
      getBucketDetails(stub.client, { role: "admin" }, "missing-id"),
    ).rejects.toBeInstanceOf(BucketNotFoundError);
  });

  it("superadmin bypasses UserBucketAccess — always returns the bucket if it exists", async () => {
    const stub = makeStub({ bucket: baseBucket() });
    const d = await getBucketDetails(
      stub.client,
      { role: "superadmin" },
      "b-1",
    );
    expect(d.id).toBe("b-1");
  });

  it("viewer with matching userAccess row: returns the bucket", async () => {
    const stub = makeStub({
      bucket: baseBucket({ userAccess: [{ userId: "u-42" }] }),
    });
    const scope: BucketDetailsScope = { role: "viewer", userId: "u-42" };
    const d = await getBucketDetails(stub.client, scope, "b-1");
    expect(d.id).toBe("b-1");
  });

  it("viewer: bucket exists but userAccess relation is empty → 403 (primary enforcement branch)", async () => {
    const stub = makeStub({
      bucket: baseBucket({ userAccess: [] }),
    });
    const scope: BucketDetailsScope = { role: "viewer", userId: "u-99" };
    await expect(
      getBucketDetails(stub.client, scope, "b-1"),
    ).rejects.toBeInstanceOf(BucketAccessDeniedError);
  });

  it("viewer without matching userAccess (findUnique returned null): 403 AccessDenied", async () => {
    // The Prisma findUnique was issued with a userAccess.some.userId
    // relation filter, so the DB would return null, but we test the
    // error-shape contract: viewer without access → BucketAccessDeniedError.
    // Implementation may treat this identically to not-found; assert
    // that a 403-shaped error surfaces, NOT a 404.
    const stub = makeStub({ bucket: null });
    const scope: BucketDetailsScope = { role: "viewer", userId: "u-99" };
    await expect(
      getBucketDetails(stub.client, scope, "b-1"),
    ).rejects.toBeInstanceOf(BucketAccessDeniedError);
  });
});

describe("getBucketDetails — metrics", () => {
  it("documentCount comes from _count.documents (filtered isDeleted=false)", async () => {
    const stub = makeStub({
      bucket: baseBucket({ _count: { documents: 42 } }),
    });
    const d = await getBucketDetails(stub.client, { role: "admin" }, "b-1");
    expect(d.documentCount).toBe(42);
  });

  it("_count passes isDeleted=false via filtered relation count", async () => {
    const stub = makeStub({ bucket: baseBucket() });
    await getBucketDetails(stub.client, { role: "admin" }, "b-1");
    const args = stub.bucketCalls[0] as {
      select: { _count: { select: { documents: unknown } } };
    };
    expect(args.select._count.select.documents).toEqual({
      where: { isDeleted: false },
    });
  });

  it("storageBytes comes from document.aggregate _sum scoped to this bucket + isDeleted=false", async () => {
    const stub = makeStub({
      bucket: baseBucket(),
      storageBytes: BigInt(8_192),
    });
    const d = await getBucketDetails(stub.client, { role: "admin" }, "b-1");
    expect(d.storageBytes).toBe(BigInt(8_192));
    const args = stub.aggregateCalls[0] as {
      where: { bucketId: string; isDeleted: boolean };
      _sum: { sizeBytes: true };
    };
    expect(args.where).toEqual({ bucketId: "b-1", isDeleted: false });
    expect(args._sum).toEqual({ sizeBytes: true });
  });

  it("storageBytes falls back to 0 when _sum.sizeBytes is null (no docs)", async () => {
    const stub = makeStub({
      bucket: baseBucket(),
      storageBytes: null,
    });
    const d = await getBucketDetails(stub.client, { role: "admin" }, "b-1");
    expect(d.storageBytes).toBe(BigInt(0));
  });
});

describe("getBucketDetails — recent documents", () => {
  it("returns up to 10 most-recent non-deleted documents ordered by uploadedAt desc", async () => {
    const stub = makeStub({
      bucket: baseBucket(),
      recentDocuments: [
        {
          id: "d-1",
          filename: "x.pdf",
          sizeBytes: BigInt(1024),
          contentType: "application/pdf",
          uploadedAt: new Date("2026-04-15T00:00:00Z"),
          uploadedBy: { name: "Alice" },
        },
      ],
    });
    const d = await getBucketDetails(stub.client, { role: "admin" }, "b-1");
    expect(d.recentDocuments).toHaveLength(1);
    expect(d.recentDocuments[0]).toMatchObject({
      id: "d-1",
      filename: "x.pdf",
      sizeBytes: BigInt(1024),
      contentType: "application/pdf",
      uploadedByName: "Alice",
    });
    const args = stub.docFindManyCalls[0] as {
      where: Record<string, unknown>;
      orderBy: unknown;
      take: number;
    };
    expect(args.where).toEqual({ bucketId: "b-1", isDeleted: false });
    expect(args.orderBy).toEqual({ uploadedAt: "desc" });
    expect(args.take).toBe(10);
  });

  it("uploadedByName falls back to null when the relation has no name", async () => {
    const stub = makeStub({
      bucket: baseBucket(),
      recentDocuments: [
        {
          id: "d-2",
          filename: "y.pdf",
          sizeBytes: BigInt(0),
          contentType: null,
          uploadedAt: new Date(),
          uploadedBy: { name: null },
        },
      ],
    });
    const d = await getBucketDetails(stub.client, { role: "admin" }, "b-1");
    expect(d.recentDocuments[0]?.uploadedByName).toBeNull();
  });
});

describe("getBucketDetails — access policies", () => {
  it("returns policies scoped to targetType='bucket' AND targetValue=bucketName", async () => {
    const stub = makeStub({ bucket: baseBucket() });
    await getBucketDetails(stub.client, { role: "admin" }, "b-1");
    const args = stub.policyFindManyCalls[0] as {
      where: { targetType: string; targetValue: string };
    };
    expect(args.where).toEqual({
      targetType: "bucket",
      targetValue: "helpucompli-docs-acme",
    });
  });

  it("maps policy row fields into the BucketDetails payload shape", async () => {
    const stub = makeStub({
      bucket: baseBucket(),
      accessPolicies: [
        {
          id: "p-1",
          name: "default-clients",
          linkTtlSeconds: 900,
          maxDownloads: 5,
          requireAuth: true,
          allowedDomains: ["clientcorp.com"],
          allowedIpRanges: ["203.0.113.0/24"],
          createdAt: new Date("2026-04-01T00:00:00Z"),
        },
      ],
    });
    const d = await getBucketDetails(stub.client, { role: "admin" }, "b-1");
    const expected: BucketDetails["accessPolicies"][number] = {
      id: "p-1",
      name: "default-clients",
      linkTtlSeconds: 900,
      maxDownloads: 5,
      requireAuth: true,
      allowedDomains: ["clientcorp.com"],
      allowedIpRanges: ["203.0.113.0/24"],
      createdAt: new Date("2026-04-01T00:00:00Z"),
    };
    expect(d.accessPolicies[0]).toEqual(expected);
  });
});

describe("getBucketDetails — compliance posture", () => {
  it("HIPAA compliance flags reflect the design-level guarantee (all managed buckets are SSE-KMS + versioning + BPA)", async () => {
    const stub = makeStub({ bucket: baseBucket() });
    const d = await getBucketDetails(stub.client, { role: "admin" }, "b-1");
    // These are known-good by module-3 design (createHipaaBucket
    // applies them unconditionally). Surface the truth to the UI
    // rather than running a live S3 HeadBucket on every details load.
    expect(d.hipaaCompliance).toEqual({
      sseKms: true,
      versioning: true,
      publicAccessBlock: true,
      httpsOnlyPolicy: true,
    });
  });
});
