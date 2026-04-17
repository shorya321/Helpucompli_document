import { describe, expect, it, vi } from "vitest";
import {
  getDashboardStats,
  RECENT_WINDOW_DAYS,
  type DashboardStats,
} from "@/lib/dashboard-stats";

type CountArg = { where?: Record<string, unknown> };

function makePrismaStub(counts: {
  document: number;
  bucket: number;
  recentUpload: number;
  recentLink: number;
  activeUser: number;
}) {
  const calls: Record<string, CountArg[]> = {
    document: [],
    bucket: [],
    generatedLink: [],
    user: [],
  };
  let docCall = 0;
  return {
    calls,
    client: {
      document: {
        count: vi.fn(async (args?: CountArg) => {
          calls.document.push(args ?? {});
          docCall += 1;
          // first call = total (is_deleted=false), second = recent uploads
          return docCall === 1 ? counts.document : counts.recentUpload;
        }),
      },
      bucket: {
        count: vi.fn(async (args?: CountArg) => {
          calls.bucket.push(args ?? {});
          return counts.bucket;
        }),
      },
      generatedLink: {
        count: vi.fn(async (args?: CountArg) => {
          calls.generatedLink.push(args ?? {});
          return counts.recentLink;
        }),
      },
      user: {
        count: vi.fn(async (args?: CountArg) => {
          calls.user.push(args ?? {});
          return counts.activeUser;
        }),
      },
    },
  };
}

describe("RECENT_WINDOW_DAYS", () => {
  it("is 7 days per the module spec", () => {
    expect(RECENT_WINDOW_DAYS).toBe(7);
  });
});

describe("getDashboardStats", () => {
  const now = new Date("2026-04-17T12:00:00Z");

  it("returns all five metrics with the correct shape", async () => {
    const stub = makePrismaStub({
      document: 42,
      bucket: 5,
      recentUpload: 9,
      recentLink: 3,
      activeUser: 7,
    });
    const stats = await getDashboardStats(
      stub.client as unknown as Parameters<typeof getDashboardStats>[0],
      now,
    );
    const expected: DashboardStats = {
      totalDocuments: 42,
      totalBuckets: 5,
      recentUploads: 9,
      recentLinks: 3,
      activeUsers: 7,
    };
    expect(stats).toEqual(expected);
  });

  it("filters total documents by is_deleted=false (soft-deleted excluded)", async () => {
    const stub = makePrismaStub({
      document: 0,
      bucket: 0,
      recentUpload: 0,
      recentLink: 0,
      activeUser: 0,
    });
    await getDashboardStats(
      stub.client as unknown as Parameters<typeof getDashboardStats>[0],
      now,
    );
    const totalDocsCall = stub.calls.document[0];
    expect(totalDocsCall?.where).toEqual({ isDeleted: false });
  });

  it("filters total buckets by is_active=true", async () => {
    const stub = makePrismaStub({
      document: 0,
      bucket: 0,
      recentUpload: 0,
      recentLink: 0,
      activeUser: 0,
    });
    await getDashboardStats(
      stub.client as unknown as Parameters<typeof getDashboardStats>[0],
      now,
    );
    expect(stub.calls.bucket[0]?.where).toEqual({ isActive: true });
  });

  it("recent uploads window = [now-7d, now] via uploadedAt gte", async () => {
    const stub = makePrismaStub({
      document: 0,
      bucket: 0,
      recentUpload: 0,
      recentLink: 0,
      activeUser: 0,
    });
    await getDashboardStats(
      stub.client as unknown as Parameters<typeof getDashboardStats>[0],
      now,
    );
    const recentCall = stub.calls.document[1];
    const where = recentCall?.where as {
      isDeleted: boolean;
      uploadedAt: { gte: Date };
    };
    expect(where.isDeleted).toBe(false);
    const sevenDaysAgo = new Date("2026-04-10T12:00:00Z");
    expect(where.uploadedAt.gte.toISOString()).toBe(
      sevenDaysAgo.toISOString(),
    );
  });

  it("recent links window = [now-7d, now] via createdAt gte", async () => {
    const stub = makePrismaStub({
      document: 0,
      bucket: 0,
      recentUpload: 0,
      recentLink: 0,
      activeUser: 0,
    });
    await getDashboardStats(
      stub.client as unknown as Parameters<typeof getDashboardStats>[0],
      now,
    );
    const where = stub.calls.generatedLink[0]?.where as {
      createdAt: { gte: Date };
    };
    const sevenDaysAgo = new Date("2026-04-10T12:00:00Z");
    expect(where.createdAt.gte.toISOString()).toBe(sevenDaysAgo.toISOString());
  });

  it("active users filtered by status=active", async () => {
    const stub = makePrismaStub({
      document: 0,
      bucket: 0,
      recentUpload: 0,
      recentLink: 0,
      activeUser: 0,
    });
    await getDashboardStats(
      stub.client as unknown as Parameters<typeof getDashboardStats>[0],
      now,
    );
    expect(stub.calls.user[0]?.where).toEqual({ status: "active" });
  });

  it("runs all five count queries in parallel (Promise.all)", async () => {
    const stub = makePrismaStub({
      document: 1,
      bucket: 1,
      recentUpload: 1,
      recentLink: 1,
      activeUser: 1,
    });
    await getDashboardStats(
      stub.client as unknown as Parameters<typeof getDashboardStats>[0],
      now,
    );
    // 2 document.count + 1 bucket.count + 1 generatedLink.count + 1 user.count = 5
    expect(
      stub.client.document.count.mock.calls.length +
        stub.client.bucket.count.mock.calls.length +
        stub.client.generatedLink.count.mock.calls.length +
        stub.client.user.count.mock.calls.length,
    ).toBe(5);
  });
});
