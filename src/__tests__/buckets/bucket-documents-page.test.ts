import { describe, expect, it, vi } from "vitest";
import {
  BUCKET_DOCUMENTS_PAGE_LIMIT,
  BUCKET_DOCUMENTS_PAGE_LIMIT_MAX,
  BucketAccessDeniedError,
  BucketNotFoundError,
  getBucketDocumentsPage,
  type BucketDetailsPrisma,
} from "@/lib/bucket-details";

function row(
  id: string,
  uploadedAt: Date,
  bucketId = "b-1",
): Record<string, unknown> {
  return {
    id,
    filename: `${id}.pdf`,
    sizeBytes: BigInt(1024),
    contentType: "application/pdf",
    uploadedAt,
    uploadedBy: { name: "Alice" },
    bucketId,
    isDeleted: false,
  };
}

interface StubOpts {
  readonly bucketAccessOk?: boolean;
  readonly bucketMissing?: boolean;
  readonly findManyRows?: Array<Record<string, unknown>>;
  readonly findUniqueRow?: { uploadedAt: Date; bucketId: string; isDeleted: boolean } | null;
}

function makeStub(opts: StubOpts) {
  const findManyCalls: Array<Record<string, unknown>> = [];
  const findUniqueDocCalls: Array<{ id: string }> = [];
  const client: BucketDetailsPrisma = {
    bucket: {
      findUnique: vi.fn(async () => {
        if (opts.bucketMissing) return null;
        return {
          id: "b-1",
          name: "n",
          awsRegion: "us-east-1",
          description: null,
          createdAt: new Date(),
          isActive: true,
          _count: { documents: 100 },
          userAccess: opts.bucketAccessOk ? [{ userId: "u-1" }] : [],
        };
      }),
    },
    document: {
      aggregate: vi.fn(async () => ({ _sum: { sizeBytes: BigInt(0) } })),
      findMany: vi.fn(async (args?: Record<string, unknown>) => {
        findManyCalls.push(args ?? {});
        return opts.findManyRows ?? [];
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        findUniqueDocCalls.push(where);
        return opts.findUniqueRow ?? null;
      }),
    },
    accessPolicy: {
      findMany: vi.fn(async () => []),
    },
  };
  return { client, findManyCalls, findUniqueDocCalls };
}

describe("getBucketDocumentsPage — access control", () => {
  it("throws BucketAccessDeniedError for viewer without grant", async () => {
    const stub = makeStub({ bucketAccessOk: false });
    await expect(
      getBucketDocumentsPage(
        stub.client,
        { role: "viewer", userId: "u-1" },
        "b-1",
      ),
    ).rejects.toBeInstanceOf(BucketAccessDeniedError);
  });

  it("throws BucketNotFoundError for admin when bucket missing", async () => {
    const stub = makeStub({ bucketMissing: true });
    await expect(
      getBucketDocumentsPage(stub.client, { role: "admin" }, "b-1"),
    ).rejects.toBeInstanceOf(BucketNotFoundError);
  });

  it("admin scope skips userAccess gate", async () => {
    const stub = makeStub({
      bucketAccessOk: false,
      findManyRows: [row("d-1", new Date("2026-04-22T12:00:00Z"))],
    });
    const page = await getBucketDocumentsPage(stub.client, { role: "admin" }, "b-1");
    expect(page.entries).toHaveLength(1);
  });
});

describe("getBucketDocumentsPage — pagination", () => {
  it("first page (no cursor) returns up to limit + nextCursor when more rows exist", async () => {
    const ts = new Date("2026-04-22T12:00:00Z");
    const rows = Array.from({ length: BUCKET_DOCUMENTS_PAGE_LIMIT + 1 }, (_, i) =>
      row(`d${i}`, new Date(ts.getTime() - i * 1000)),
    );
    const stub = makeStub({ bucketAccessOk: true, findManyRows: rows });
    const page = await getBucketDocumentsPage(
      stub.client,
      { role: "admin" },
      "b-1",
      { limit: BUCKET_DOCUMENTS_PAGE_LIMIT },
    );
    expect(page.entries).toHaveLength(BUCKET_DOCUMENTS_PAGE_LIMIT);
    expect(page.nextCursor).toBe(`d${BUCKET_DOCUMENTS_PAGE_LIMIT - 1}`);
    expect(stub.findManyCalls[0]?.take).toBe(BUCKET_DOCUMENTS_PAGE_LIMIT + 1);
  });

  it("first page returns nextCursor=null when fewer rows than limit", async () => {
    const stub = makeStub({
      bucketAccessOk: true,
      findManyRows: [row("d0", new Date())],
    });
    const page = await getBucketDocumentsPage(stub.client, { role: "admin" }, "b-1");
    expect(page.entries).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("uses tie-stable orderBy [uploadedAt desc, id desc]", async () => {
    const stub = makeStub({ bucketAccessOk: true });
    await getBucketDocumentsPage(stub.client, { role: "admin" }, "b-1");
    expect(stub.findManyCalls[0]?.orderBy).toEqual([
      { uploadedAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("scopes findMany to {bucketId, isDeleted: false}", async () => {
    const stub = makeStub({ bucketAccessOk: true });
    await getBucketDocumentsPage(stub.client, { role: "admin" }, "b-1");
    const where = stub.findManyCalls[0]?.where as Record<string, unknown>;
    expect(where.bucketId).toBe("b-1");
    expect(where.isDeleted).toBe(false);
  });

  it("with cursor: applies OR-where for tie-stable pagination", async () => {
    const cursorTs = new Date("2026-04-22T12:00:00Z");
    const stub = makeStub({
      bucketAccessOk: true,
      findUniqueRow: {
        uploadedAt: cursorTs,
        bucketId: "b-1",
        isDeleted: false,
      },
      findManyRows: [row("d-next", new Date(cursorTs.getTime() - 1000))],
    });
    const page = await getBucketDocumentsPage(
      stub.client,
      { role: "admin" },
      "b-1",
      { cursor: "d-cursor", limit: 10 },
    );
    expect(stub.findUniqueDocCalls).toEqual([{ id: "d-cursor" }]);
    const where = stub.findManyCalls[0]?.where as Record<string, unknown>;
    expect(where.OR).toEqual([
      { uploadedAt: { lt: cursorTs } },
      { uploadedAt: cursorTs, id: { lt: "d-cursor" } },
    ]);
    expect(page.entries).toHaveLength(1);
  });

  it("missing cursor row → empty page + null nextCursor (no crash)", async () => {
    const stub = makeStub({
      bucketAccessOk: true,
      findUniqueRow: null,
    });
    const page = await getBucketDocumentsPage(
      stub.client,
      { role: "admin" },
      "b-1",
      { cursor: "no-such-id" },
    );
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("cross-bucket cursor → empty page (security: prevents bucket-id probing)", async () => {
    const stub = makeStub({
      bucketAccessOk: true,
      findUniqueRow: {
        uploadedAt: new Date(),
        bucketId: "DIFFERENT-BUCKET",
        isDeleted: false,
      },
    });
    const page = await getBucketDocumentsPage(
      stub.client,
      { role: "admin" },
      "b-1",
      { cursor: "stolen-from-other-bucket" },
    );
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("soft-deleted cursor row → empty page", async () => {
    const stub = makeStub({
      bucketAccessOk: true,
      findUniqueRow: {
        uploadedAt: new Date(),
        bucketId: "b-1",
        isDeleted: true,
      },
    });
    const page = await getBucketDocumentsPage(
      stub.client,
      { role: "admin" },
      "b-1",
      { cursor: "soft-deleted" },
    );
    expect(page.entries).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("clamps limit > max", async () => {
    const stub = makeStub({ bucketAccessOk: true });
    await getBucketDocumentsPage(stub.client, { role: "admin" }, "b-1", {
      limit: 9999,
    });
    expect(stub.findManyCalls[0]?.take).toBe(BUCKET_DOCUMENTS_PAGE_LIMIT_MAX + 1);
  });

  it("falls back to default when limit is 0 (treated as missing)", async () => {
    const stub = makeStub({ bucketAccessOk: true });
    await getBucketDocumentsPage(stub.client, { role: "admin" }, "b-1", {
      limit: 0,
    });
    expect(stub.findManyCalls[0]?.take).toBe(BUCKET_DOCUMENTS_PAGE_LIMIT + 1);
  });

  it("clamps negative limit to 1", async () => {
    const stub = makeStub({ bucketAccessOk: true });
    await getBucketDocumentsPage(stub.client, { role: "admin" }, "b-1", {
      limit: -5,
    });
    expect(stub.findManyCalls[0]?.take).toBe(2);
  });
});
