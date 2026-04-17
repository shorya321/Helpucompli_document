import type { PrismaClient } from "@prisma/client";

export const RECENT_WINDOW_DAYS = 7 as const;
const DAY_MS = 86_400_000;

export interface DashboardStats {
  readonly totalDocuments: number;
  readonly totalBuckets: number;
  readonly recentUploads: number;
  readonly recentLinks: number;
  readonly activeUsers: number;
}

// Narrow surface of Prisma needed — lets tests inject plain stubs
// without reaching for @prisma/client's huge generated types.
export interface DashboardStatsPrisma {
  readonly document: {
    count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
  };
  readonly bucket: {
    count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
  };
  readonly generatedLink: {
    count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
  };
  readonly user: {
    count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
  };
}

export async function getDashboardStats(
  prisma: DashboardStatsPrisma,
  now: Date = new Date(),
): Promise<DashboardStats> {
  const windowStart = new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS);

  const [totalDocuments, totalBuckets, recentUploads, recentLinks, activeUsers] =
    await Promise.all([
      prisma.document.count({ where: { isDeleted: false } }),
      prisma.bucket.count({ where: { isActive: true } }),
      prisma.document.count({
        where: { isDeleted: false, uploadedAt: { gte: windowStart } },
      }),
      prisma.generatedLink.count({
        where: { createdAt: { gte: windowStart } },
      }),
      prisma.user.count({ where: { status: "active" } }),
    ]);

  return {
    totalDocuments,
    totalBuckets,
    recentUploads,
    recentLinks,
    activeUsers,
  };
}

// Convenience adapter for code paths that already hold the real client.
export async function getDashboardStatsFromClient(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<DashboardStats> {
  return getDashboardStats(
    prisma as unknown as DashboardStatsPrisma,
    now,
  );
}
