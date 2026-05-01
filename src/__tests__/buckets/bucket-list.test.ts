import { describe, expect, it, vi } from "vitest";
import {
  getBucketList,
  parseBucketListQuery,
  type BucketListPrisma,
  type BucketSummary,
} from "@/lib/bucket-list";

type BucketRow = {
  id: string;
  name: string;
  awsRegion: string;
  description: string | null;
  createdAt: Date;
  isActive: boolean;
  _count: { documents: number };
};

type GroupRow = { bucketId: string; _sum: { sizeBytes: bigint | null } };

function makePrismaStub(rows: BucketRow[], groups: GroupRow[]) {
  const findManyCalls: unknown[] = [];
  const groupByCalls: unknown[] = [];
  const client: BucketListPrisma = {
    bucket: {
      findMany: vi.fn(async (args: unknown) => {
        findManyCalls.push(args);
        return rows;
      }),
    },
    document: {
      groupBy: vi.fn(async (args: unknown) => {
        groupByCalls.push(args);
        return groups;
      }),
    },
  };
  return { client, findManyCalls, groupByCalls };
}

const baseRow = (overrides: Partial<BucketRow> = {}): BucketRow => ({
  id: "b-1",
  name: "helpucompli-docs-acme",
  awsRegion: "us-east-1",
  description: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  isActive: true,
  _count: { documents: 0 },
  ...overrides,
});

describe("getBucketList — scope", () => {
  it("superadmin: no userAccess filter, defaults to active buckets", async () => {
    const stub = makePrismaStub([baseRow()], []);
    await getBucketList(stub.client, { role: "superadmin" });
    const args = stub.findManyCalls[0] as { where?: Record<string, unknown> };
    expect(args.where).toEqual({ isActive: true });
  });

  it("admin: same scope as superadmin, active-only default", async () => {
    const stub = makePrismaStub([baseRow()], []);
    await getBucketList(stub.client, { role: "admin" });
    const args = stub.findManyCalls[0] as { where?: Record<string, unknown> };
    expect(args.where).toEqual({ isActive: true });
  });

  it("viewer: scoped by userAccess.some.userId", async () => {
    const stub = makePrismaStub([baseRow()], []);
    await getBucketList(stub.client, {
      role: "viewer",
      userId: "user-42",
    });
    const args = stub.findManyCalls[0] as { where?: Record<string, unknown> };
    expect(args.where).toEqual({
      isActive: true,
      userAccess: { some: { userId: "user-42" } },
    });
  });
});

describe("getBucketList — filters", () => {
  it("status=all drops the isActive predicate", async () => {
    const stub = makePrismaStub([baseRow()], []);
    await getBucketList(
      stub.client,
      { role: "admin" },
      { filters: { status: "all" } },
    );
    const args = stub.findManyCalls[0] as { where?: Record<string, unknown> };
    expect(args.where).toEqual({});
  });

  it("status=inactive narrows to isActive=false", async () => {
    const stub = makePrismaStub([], []);
    await getBucketList(
      stub.client,
      { role: "admin" },
      { filters: { status: "inactive" } },
    );
    const args = stub.findManyCalls[0] as { where?: Record<string, unknown> };
    expect(args.where).toEqual({ isActive: false });
  });

  it("region filter narrows awsRegion", async () => {
    const stub = makePrismaStub([], []);
    await getBucketList(
      stub.client,
      { role: "admin" },
      { filters: { region: "us-west-2" } },
    );
    const args = stub.findManyCalls[0] as { where?: Record<string, unknown> };
    expect(args.where).toEqual({ isActive: true, awsRegion: "us-west-2" });
  });
});

describe("getBucketList — aggregates", () => {
  it("documentCount comes from _count.documents (filtered-relation count)", async () => {
    const rows: BucketRow[] = [baseRow({ _count: { documents: 7 } })];
    const stub = makePrismaStub(rows, []);
    const list = await getBucketList(stub.client, { role: "admin" });
    expect(list[0]?.documentCount).toBe(7);
  });

  it("passes isDeleted=false to the filtered relation count", async () => {
    const stub = makePrismaStub([], []);
    await getBucketList(stub.client, { role: "admin" });
    const args = stub.findManyCalls[0] as {
      select?: { _count?: { select?: { documents?: unknown } } };
    };
    expect(args.select?._count?.select?.documents).toEqual({
      where: { isDeleted: false },
    });
  });

  it("groupBy runs over documents with isDeleted=false, scoped to returned bucketIds, and _sum.sizeBytes", async () => {
    const stub = makePrismaStub(
      [baseRow({ id: "b-1" }), baseRow({ id: "b-2", name: "h-x" })],
      [],
    );
    await getBucketList(stub.client, { role: "admin" });
    const args = stub.groupByCalls[0] as {
      by?: unknown;
      where?: { isDeleted?: boolean; bucketId?: { in?: string[] } };
      _sum?: unknown;
    };
    expect(args.by).toEqual(["bucketId"]);
    expect(args.where?.isDeleted).toBe(false);
    expect(args.where?.bucketId?.in).toEqual(["b-1", "b-2"]);
    expect(args._sum).toEqual({ sizeBytes: true });
  });

  it("skips the groupBy round-trip entirely when findMany returns no buckets", async () => {
    const stub = makePrismaStub([], []);
    await getBucketList(stub.client, { role: "admin" });
    expect(stub.groupByCalls).toHaveLength(0);
  });

  it("merges storageBytes from the matching groupBy row", async () => {
    const rows: BucketRow[] = [
      baseRow({ id: "b-1" }),
      baseRow({ id: "b-2", name: "helpucompli-docs-zulu" }),
    ];
    const groups: GroupRow[] = [
      { bucketId: "b-1", _sum: { sizeBytes: BigInt(1024) } },
      { bucketId: "b-2", _sum: { sizeBytes: BigInt(2_000_000) } },
    ];
    const stub = makePrismaStub(rows, groups);
    const list = await getBucketList(stub.client, { role: "admin" });
    const byId = new Map(list.map((b) => [b.id, b.storageBytes]));
    expect(byId.get("b-1")).toBe(BigInt(1024));
    expect(byId.get("b-2")).toBe(BigInt(2_000_000));
  });

  it("storageBytes is 0n when groupBy returns _sum=null or no row", async () => {
    const rows: BucketRow[] = [
      baseRow({ id: "b-1" }),
      baseRow({ id: "b-2", name: "helpucompli-docs-z" }),
    ];
    const groups: GroupRow[] = [
      { bucketId: "b-1", _sum: { sizeBytes: null } }, // null from DB when only null sizes
      // b-2 missing entirely — zero docs
    ];
    const stub = makePrismaStub(rows, groups);
    const list = await getBucketList(stub.client, { role: "admin" });
    const byId = new Map(list.map((b) => [b.id, b.storageBytes]));
    expect(byId.get("b-1")).toBe(BigInt(0));
    expect(byId.get("b-2")).toBe(BigInt(0));
  });
});

describe("getBucketList — sort", () => {
  const rows = (): BucketRow[] => [
    baseRow({
      id: "b-a",
      name: "helpucompli-docs-alpha",
      createdAt: new Date("2026-03-01T00:00:00Z"),
      _count: { documents: 1 },
    }),
    baseRow({
      id: "b-b",
      name: "helpucompli-docs-bravo",
      createdAt: new Date("2026-02-01T00:00:00Z"),
      _count: { documents: 5 },
    }),
    baseRow({
      id: "b-c",
      name: "helpucompli-docs-charlie",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      _count: { documents: 3 },
    }),
  ];

  it("default sort: name asc via orderBy", async () => {
    const stub = makePrismaStub(rows(), []);
    await getBucketList(stub.client, { role: "admin" });
    const args = stub.findManyCalls[0] as { orderBy?: unknown };
    expect(args.orderBy).toEqual({ name: "asc" });
  });

  it("sort createdAt desc passes through to orderBy", async () => {
    const stub = makePrismaStub(rows(), []);
    await getBucketList(
      stub.client,
      { role: "admin" },
      { sort: { field: "createdAt", dir: "desc" } },
    );
    const args = stub.findManyCalls[0] as { orderBy?: unknown };
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("sort documentCount desc is applied in-memory (not orderBy)", async () => {
    // Prisma cannot orderBy a filtered-relation _count, so the lib
    // must sort post-merge. Verify by result ordering, not args.
    const stub = makePrismaStub(rows(), []);
    const list = await getBucketList(
      stub.client,
      { role: "admin" },
      { sort: { field: "documentCount", dir: "desc" } },
    );
    expect(list.map((b) => b.id)).toEqual(["b-b", "b-c", "b-a"]);
  });

  it("sort documentCount asc orders ascending", async () => {
    const stub = makePrismaStub(rows(), []);
    const list = await getBucketList(
      stub.client,
      { role: "admin" },
      { sort: { field: "documentCount", dir: "asc" } },
    );
    expect(list.map((b) => b.id)).toEqual(["b-a", "b-c", "b-b"]);
  });
});

describe("parseBucketListQuery", () => {
  it("returns empty options for an empty query bag", () => {
    expect(parseBucketListQuery({})).toEqual({});
  });

  it("parses sort + dir into a sort clause", () => {
    expect(parseBucketListQuery({ sort: "createdAt", dir: "desc" })).toEqual({
      sort: { field: "createdAt", dir: "desc" },
    });
  });

  it("defaults dir to asc when only sort is provided", () => {
    expect(parseBucketListQuery({ sort: "name" })).toEqual({
      sort: { field: "name", dir: "asc" },
    });
  });

  it("parses region + status into filters", () => {
    expect(parseBucketListQuery({ region: "us-east-1", status: "all" })).toEqual({
      filters: { region: "us-east-1", status: "all" },
    });
  });

  it("returns null on invalid enum values", () => {
    expect(parseBucketListQuery({ sort: "totallyBogus" })).toBeNull();
    expect(parseBucketListQuery({ status: "huh" })).toBeNull();
  });

  it("returns null on oversized region", () => {
    expect(parseBucketListQuery({ region: "a".repeat(100) })).toBeNull();
  });

  it("rejects `dir` without `sort` (ambiguous — refuses silent default)", () => {
    expect(parseBucketListQuery({ dir: "desc" })).toBeNull();
  });

  it("flattens array-valued duplicate params to the first value", () => {
    expect(
      parseBucketListQuery({ sort: ["name", "createdAt"] }),
    ).toEqual({ sort: { field: "name", dir: "asc" } });
  });

  // Regression: the buckets filter form ships every field on submit,
  // including blanks (e.g. `?sort=name&dir=asc&region=&status=inactive`
  // when the user leaves Region empty). Treating "" as a real value
  // makes Zod reject the whole bag (`.min(1)` on region, enums on the
  // others) and the page silently drops every filter the user picked.
  it("treats empty-string region as absent and keeps the rest of the filters", () => {
    expect(
      parseBucketListQuery({
        sort: "name",
        dir: "asc",
        region: "",
        status: "inactive",
      }),
    ).toEqual({
      sort: { field: "name", dir: "asc" },
      filters: { status: "inactive" },
    });
  });

  it("treats an all-empty form submission as no filters", () => {
    expect(
      parseBucketListQuery({ sort: "", dir: "", region: "", status: "" }),
    ).toEqual({});
  });

  it("treats empty-string status as absent", () => {
    expect(
      parseBucketListQuery({ region: "us-east-1", status: "" }),
    ).toEqual({ filters: { region: "us-east-1" } });
  });
});

describe("getBucketList — shape", () => {
  it("returns BucketSummary rows with all metric fields", async () => {
    const stub = makePrismaStub(
      [
        baseRow({
          id: "b-1",
          name: "helpucompli-docs-one",
          awsRegion: "us-east-1",
          description: "primary",
          isActive: true,
          _count: { documents: 2 },
        }),
      ],
      [{ bucketId: "b-1", _sum: { sizeBytes: BigInt(4096) } }],
    );
    const [bucket] = await getBucketList(stub.client, { role: "admin" });
    const expected: BucketSummary = {
      id: "b-1",
      name: "helpucompli-docs-one",
      region: "us-east-1",
      description: "primary",
      createdAt: new Date("2026-04-01T00:00:00Z"),
      isActive: true,
      documentCount: 2,
      storageBytes: BigInt(4096),
    };
    expect(bucket).toEqual(expected);
  });
});
