import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bucketAccessUpdateSchema,
  diffBucketAccess,
  getUserBuckets,
  setUserBuckets,
} from "@/lib/user-bucket-access";

afterEach(() => {
  vi.clearAllMocks();
});

describe("bucketAccessUpdateSchema", () => {
  it("accepts an array of uuids", () => {
    const parsed = bucketAccessUpdateSchema.safeParse({
      bucketIds: [
        "11111111-2222-3333-4444-555555555555",
        "66666666-7777-8888-9999-aaaaaaaaaaaa",
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-uuid values", () => {
    expect(
      bucketAccessUpdateSchema.safeParse({ bucketIds: ["abc"] }).success,
    ).toBe(false);
  });

  it("dedupes identical ids", () => {
    const parsed = bucketAccessUpdateSchema.parse({
      bucketIds: [
        "11111111-2222-3333-4444-555555555555",
        "11111111-2222-3333-4444-555555555555",
      ],
    });
    expect(parsed.bucketIds).toHaveLength(1);
  });
});

describe("diffBucketAccess", () => {
  it("returns the add + remove sets", () => {
    const diff = diffBucketAccess(["a", "b"], ["b", "c"]);
    expect(diff.toAdd).toEqual(["c"]);
    expect(diff.toRemove).toEqual(["a"]);
  });

  it("returns empty arrays when sets are equal", () => {
    const diff = diffBucketAccess(["a", "b"], ["b", "a"]);
    expect(diff.toAdd).toEqual([]);
    expect(diff.toRemove).toEqual([]);
  });
});

describe("getUserBuckets", () => {
  it("maps junction rows to {bucketId,name,grantedAt,grantedByName}", async () => {
    const prisma = {
      userBucketAccess: {
        findMany: vi.fn().mockResolvedValue([
          {
            bucketId: "b-1",
            grantedAt: new Date("2026-04-01T00:00:00Z"),
            bucket: { name: "finance" },
            grantedBy: { name: "Alice", email: "a@b.com" },
          },
          {
            bucketId: "b-2",
            grantedAt: new Date("2026-04-02T00:00:00Z"),
            bucket: { name: "hr" },
            grantedBy: { name: null, email: "op@b.com" },
          },
        ]),
      },
    };
    const rows = await getUserBuckets(
      prisma as unknown as Parameters<typeof getUserBuckets>[0],
      "u-1",
    );
    expect(rows).toEqual([
      {
        bucketId: "b-1",
        name: "finance",
        grantedAt: new Date("2026-04-01T00:00:00Z"),
        grantedByName: "Alice",
      },
      {
        bucketId: "b-2",
        name: "hr",
        grantedAt: new Date("2026-04-02T00:00:00Z"),
        grantedByName: "op@b.com",
      },
    ]);
    const arg = prisma.userBucketAccess.findMany.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ userId: "u-1" });
  });
});

describe("setUserBuckets", () => {
  it("deletes removed rows and creates added rows in a transaction", async () => {
    const existing = [{ bucketId: "b-1" }, { bucketId: "b-2" }];
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue(existing);
    const tx = {
      userBucketAccess: { findMany, deleteMany, createMany },
    };
    const prisma = {
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };

    await setUserBuckets(
      prisma as unknown as Parameters<typeof setUserBuckets>[0],
      {
        userId: "u-1",
        bucketIds: ["b-2", "b-3"],
        grantedById: "actor-1",
      },
    );

    const deleteArg = deleteMany.mock.calls[0]?.[0];
    expect(deleteArg.where).toEqual({
      userId: "u-1",
      bucketId: { in: ["b-1"] },
    });
    const createArg = createMany.mock.calls[0]?.[0];
    expect(createArg.data).toEqual([
      { userId: "u-1", bucketId: "b-3", grantedById: "actor-1" },
    ]);
  });

  it("no-op when requested set equals current set (no delete/create)", async () => {
    const existing = [{ bucketId: "b-1" }, { bucketId: "b-2" }];
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const findMany = vi.fn().mockResolvedValue(existing);
    const tx = { userBucketAccess: { findMany, deleteMany, createMany } };
    const prisma = {
      $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    await setUserBuckets(
      prisma as unknown as Parameters<typeof setUserBuckets>[0],
      {
        userId: "u-1",
        bucketIds: ["b-1", "b-2"],
        grantedById: "actor-1",
      },
    );
    expect(deleteMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });
});
