export interface LinkAnalytics {
  readonly total: number;
  readonly active: number;
  readonly expired: number;
  readonly revoked: number;
  readonly topDocuments: readonly TopDocument[];
}

export interface TopDocument {
  readonly documentId: string;
  readonly filename: string;
  readonly linkCount: number;
}

export interface LinkAnalyticsPrisma {
  readonly generatedLink: {
    count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
    groupBy: (args: Record<string, unknown>) => Promise<
      Array<Record<string, unknown>>
    >;
  };
  readonly document: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select?: Record<string, unknown>;
    }) => Promise<Array<{ id: string; filename: string }>>;
  };
}

const TOP_N = 5;

export async function getLinkAnalytics(
  prisma: LinkAnalyticsPrisma,
  now: Date = new Date(),
): Promise<LinkAnalytics> {
  const [total, active, revoked, topGroups] = await Promise.all([
    prisma.generatedLink.count(),
    prisma.generatedLink.count({
      where: { isRevoked: false, expiresAt: { gt: now } },
    }),
    prisma.generatedLink.count({ where: { isRevoked: true } }),
    prisma.generatedLink.groupBy({
      by: ["documentId"],
      _count: { _all: true },
      orderBy: { _count: { documentId: "desc" } },
      take: TOP_N,
    }),
  ]);

  // Clamp to zero in case of count race (active+revoked > total can
  // happen briefly during simultaneous revoke + create).
  const expired = Math.max(0, total - active - revoked);

  let topDocuments: TopDocument[] = [];
  if (topGroups.length > 0) {
    const ids = topGroups.map((g) => g.documentId as string);
    const docs = await prisma.document.findMany({
      where: { id: { in: ids } },
      select: { id: true, filename: true },
    });
    const byId = new Map(docs.map((d) => [d.id, d.filename]));
    topDocuments = topGroups.map((g) => {
      const documentId = g.documentId as string;
      const count = g._count as { _all?: number } | undefined;
      return {
        documentId,
        filename: byId.get(documentId) ?? "(deleted)",
        linkCount: count?._all ?? 0,
      };
    });
  }

  return { total, active, expired, revoked, topDocuments };
}

interface LinkAnalyticsPrismaLike {
  readonly generatedLink: {
    count(args?: unknown): Promise<number>;
    groupBy(args?: unknown): Promise<unknown[]>;
  };
  readonly document: {
    findMany(args?: unknown): Promise<unknown[]>;
  };
}
export function asLinkAnalyticsPrisma(
  client: LinkAnalyticsPrismaLike,
): LinkAnalyticsPrisma {
  return client as unknown as LinkAnalyticsPrisma;
}
