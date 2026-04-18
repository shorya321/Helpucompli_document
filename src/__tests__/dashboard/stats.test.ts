import { describe, expect, it, vi } from "vitest";
import {
  getDashboardStats,
  RECENT_WINDOW_DAYS,
  type DashboardStats,
  type DashboardStatsPrisma,
} from "@/lib/dashboard-stats";

type CountArg = { where?: Record<string, unknown> } | undefined;

// Keyed stub — each count returns based on the where shape, not call
// order. Promise.all ordering cannot silently flip results.
function makePrismaStub(counts: {
  totalDocuments: number;
  recentUploads: number;
  totalBuckets: number;
  recentLinks: number;
  activeUsers: number;
}) {
  const calls: {
    document: CountArg[];
    bucket: CountArg[];
    generatedLink: CountArg[];
    user: CountArg[];
  } = { document: [], bucket: [], generatedLink: [], user: [] };

  const client: DashboardStatsPrisma = {
    document: {
      count: vi.fn(async (args?: CountArg) => {
        calls.document.push(args);
        const where = (args?.where ?? {}) as {
          isDeleted?: boolean;
          uploadedAt?: { gte: Date };
        };
        return where.uploadedAt
          ? counts.recentUploads
          : counts.totalDocuments;
      }),
    },
    bucket: {
      count: vi.fn(async (args?: CountArg) => {
        calls.bucket.push(args);
        return counts.totalBuckets;
      }),
    },
    generatedLink: {
      count: vi.fn(async (args?: CountArg) => {
        calls.generatedLink.push(args);
        return counts.recentLinks;
      }),
    },
    user: {
      count: vi.fn(async (args?: CountArg) => {
        calls.user.push(args);
        return counts.activeUsers;
      }),
    },
  };
  return { client, calls };
}

describe("RECENT_WINDOW_DAYS", () => {
  it("is 7 days per the module spec", () => {
    expect(RECENT_WINDOW_DAYS).toBe(7);
  });
});

describe("getDashboardStats", () => {
  const now = new Date("2026-04-17T12:00:00Z");
  const sevenDaysAgo = new Date("2026-04-10T12:00:00Z");

  it("returns all five metrics with the correct shape", async () => {
    const stub = makePrismaStub({
      totalDocuments: 42,
      recentUploads: 9,
      totalBuckets: 5,
      recentLinks: 3,
      activeUsers: 7,
    });
    const stats = await getDashboardStats(stub.client, now);
    const expected: DashboardStats = {
      totalDocuments: 42,
      totalBuckets: 5,
      recentUploads: 9,
      recentLinks: 3,
      activeUsers: 7,
    };
    expect(stats).toEqual(expected);
  });

  it("issues a total-documents count with isDeleted=false and no date filter", async () => {
    const stub = makePrismaStub({
      totalDocuments: 0,
      recentUploads: 0,
      totalBuckets: 0,
      recentLinks: 0,
      activeUsers: 0,
    });
    await getDashboardStats(stub.client, now);
    const totals = stub.calls.document.filter(
      (c) => !(c?.where as { uploadedAt?: unknown })?.uploadedAt,
    );
    expect(totals).toHaveLength(1);
    expect(totals[0]?.where).toEqual({ isDeleted: false });
  });

  it("issues a recent-uploads count with isDeleted=false AND uploadedAt>=now-7d", async () => {
    const stub = makePrismaStub({
      totalDocuments: 0,
      recentUploads: 0,
      totalBuckets: 0,
      recentLinks: 0,
      activeUsers: 0,
    });
    await getDashboardStats(stub.client, now);
    const recents = stub.calls.document.filter(
      (c) => (c?.where as { uploadedAt?: unknown })?.uploadedAt,
    );
    expect(recents).toHaveLength(1);
    const where = recents[0]?.where as {
      isDeleted: boolean;
      uploadedAt: { gte: Date };
    };
    expect(where.isDeleted).toBe(false);
    expect(where.uploadedAt.gte.toISOString()).toBe(
      sevenDaysAgo.toISOString(),
    );
  });

  it("filters total buckets by is_active=true", async () => {
    const stub = makePrismaStub({
      totalDocuments: 0,
      recentUploads: 0,
      totalBuckets: 0,
      recentLinks: 0,
      activeUsers: 0,
    });
    await getDashboardStats(stub.client, now);
    expect(stub.calls.bucket[0]?.where).toEqual({ isActive: true });
  });

  it("issues recent-links count with createdAt>=now-7d", async () => {
    const stub = makePrismaStub({
      totalDocuments: 0,
      recentUploads: 0,
      totalBuckets: 0,
      recentLinks: 0,
      activeUsers: 0,
    });
    await getDashboardStats(stub.client, now);
    const where = stub.calls.generatedLink[0]?.where as {
      createdAt: { gte: Date };
    };
    expect(where.createdAt.gte.toISOString()).toBe(sevenDaysAgo.toISOString());
  });

  it("active users filtered by status=active", async () => {
    const stub = makePrismaStub({
      totalDocuments: 0,
      recentUploads: 0,
      totalBuckets: 0,
      recentLinks: 0,
      activeUsers: 0,
    });
    await getDashboardStats(stub.client, now);
    expect(stub.calls.user[0]?.where).toEqual({ status: "active" });
  });

  it("issues exactly 5 count queries total (2 document + 1 bucket + 1 link + 1 user)", async () => {
    const stub = makePrismaStub({
      totalDocuments: 1,
      recentUploads: 1,
      totalBuckets: 1,
      recentLinks: 1,
      activeUsers: 1,
    });
    await getDashboardStats(stub.client, now);
    expect(stub.calls.document).toHaveLength(2);
    expect(stub.calls.bucket).toHaveLength(1);
    expect(stub.calls.generatedLink).toHaveLength(1);
    expect(stub.calls.user).toHaveLength(1);
  });
});
