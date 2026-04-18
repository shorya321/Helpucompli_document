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

// Adapter: the full PrismaClient has wider overloads than
// DashboardStatsPrisma requires (where-clauses are Prisma.*CountArgs,
// not Record<string, unknown>). Rather than widen the narrow test-
// friendly interface, narrow the client here once. This is the single
// cast point — every consumer calls getDashboardStats with the narrow
// shape.
export function asStatsPrisma(client: unknown): DashboardStatsPrisma {
  return client as DashboardStatsPrisma;
}
