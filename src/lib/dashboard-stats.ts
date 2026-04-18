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

// Structural witness that the caller actually looks like a Prisma
// client (or a hand-rolled test stub). Each model surface we touch MUST
// expose a `count` method returning Promise<number>. If a future Prisma
// bump drops one of these models, or renames `count`, the assignment
// at call sites fails to compile — catching drift that an unchecked
// `client as DashboardStatsPrisma` would silently allow.
// Method syntax (not arrow) makes the `args` parameter bivariant, which
// is what we need to accept both Prisma's generic <T extends DocumentCountArgs>
// signature AND the simpler stub shapes used in tests.
interface CountCapable {
  count(args?: unknown): Promise<number>;
}
interface StatsPrismaLike {
  readonly document: CountCapable;
  readonly bucket: CountCapable;
  readonly generatedLink: CountCapable;
  readonly user: CountCapable;
}

// Adapter: the full PrismaClient has wider overloads than
// DashboardStatsPrisma requires (where-clauses are Prisma.*CountArgs,
// not Record<string, unknown>), so a direct assignment is still
// contravariantly incompatible. The `as unknown as` is unavoidable,
// but input is now structurally checked — see StatsPrismaLike.
export function asStatsPrisma(client: StatsPrismaLike): DashboardStatsPrisma {
  return client as unknown as DashboardStatsPrisma;
}
