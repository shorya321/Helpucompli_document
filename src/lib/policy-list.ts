import type { PolicyTargetType } from "@/types";

export interface PolicyListRow {
  readonly id: string;
  readonly name: string;
  readonly targetType: PolicyTargetType;
  readonly targetValue: string;
  readonly allowedDomains: readonly string[];
  readonly allowedIpRanges: readonly string[];
  readonly linkTtlSeconds: number;
  readonly maxDownloads: number | null;
  readonly requireAuth: boolean;
  readonly updatedAt: Date;
  readonly createdByName: string | null;
}

export interface PolicyListPrisma {
  readonly accessPolicy: {
    findMany: (args: Record<string, unknown>) => Promise<
      Array<Record<string, unknown>>
    >;
  };
}

const SELECT = {
  id: true,
  name: true,
  targetType: true,
  targetValue: true,
  allowedDomains: true,
  allowedIpRanges: true,
  linkTtlSeconds: true,
  maxDownloads: true,
  requireAuth: true,
  updatedAt: true,
  createdBy: { select: { name: true, email: true } },
} as const;

export async function getPolicyList(
  prisma: PolicyListPrisma,
): Promise<readonly PolicyListRow[]> {
  const rows = await prisma.accessPolicy.findMany({
    orderBy: { updatedAt: "desc" },
    select: SELECT,
  });

  return rows.map((row) => {
    const createdBy = row.createdBy as
      | { name?: string | null }
      | null
      | undefined;
    const name = createdBy?.name && createdBy.name.length > 0 ? createdBy.name : null;
    return {
      id: row.id as string,
      name: row.name as string,
      targetType: row.targetType as PolicyTargetType,
      targetValue: row.targetValue as string,
      allowedDomains: (row.allowedDomains as string[]) ?? [],
      allowedIpRanges: (row.allowedIpRanges as string[]) ?? [],
      linkTtlSeconds: row.linkTtlSeconds as number,
      maxDownloads: (row.maxDownloads as number | null) ?? null,
      requireAuth: row.requireAuth as boolean,
      updatedAt: row.updatedAt as Date,
      createdByName: name,
    };
  });
}

interface PolicyListPrismaLike {
  readonly accessPolicy: { findMany(args?: unknown): Promise<unknown[]> };
}
export function asPolicyListPrisma(
  client: PolicyListPrismaLike,
): PolicyListPrisma {
  return client as unknown as PolicyListPrisma;
}

const TTL_NAMES: ReadonlyMap<number, string> = new Map([
  [900, "15 minutes"],
  [3600, "1 hour"],
  [86_400, "24 hours"],
  [604_800, "7 days"],
]);

function ttlLabel(seconds: number): string {
  const named = TTL_NAMES.get(seconds);
  if (named) return named;
  if (seconds % 86_400 === 0) return `${seconds / 86_400} days`;
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

export interface RestrictionInput {
  readonly allowedDomains: readonly string[];
  readonly allowedIpRanges: readonly string[];
  readonly linkTtlSeconds: number;
  readonly maxDownloads: number | null;
  readonly requireAuth: boolean;
}

export function summarizeRestrictions(p: RestrictionInput): string {
  const parts: string[] = [];
  parts.push(`TTL ${ttlLabel(p.linkTtlSeconds)}`);
  if (p.maxDownloads === null || p.maxDownloads === undefined) {
    parts.push("unlimited downloads");
  } else {
    parts.push(`${p.maxDownloads} downloads`);
  }
  if (p.allowedDomains.length > 0) {
    parts.push(
      `${p.allowedDomains.length} domain${p.allowedDomains.length === 1 ? "" : "s"}`,
    );
  }
  if (p.allowedIpRanges.length > 0) {
    parts.push(
      `${p.allowedIpRanges.length} IP range${p.allowedIpRanges.length === 1 ? "" : "s"}`,
    );
  }
  if (p.requireAuth) parts.push("auth required");
  return parts.join(" · ");
}
