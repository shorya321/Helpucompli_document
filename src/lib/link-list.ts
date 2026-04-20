export type LinkStatus = "active" | "expired" | "revoked";

export interface LinkStatusInput {
  readonly isRevoked: boolean;
  readonly expiresAt: Date;
  readonly downloadCount: number;
  readonly maxDownloads: number | null;
}

export function computeLinkStatus(
  input: LinkStatusInput,
  now: Date = new Date(),
): LinkStatus {
  if (input.isRevoked) return "revoked";
  if (input.expiresAt.getTime() <= now.getTime()) return "expired";
  if (
    input.maxDownloads !== null &&
    input.downloadCount >= input.maxDownloads
  ) {
    return "expired";
  }
  return "active";
}

export interface LinkListRow {
  readonly id: string;
  readonly token: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly bucketName: string;
  readonly generatedByName: string | null;
  readonly generatedByEmail: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly downloadCount: number;
  readonly maxDownloads: number | null;
  readonly status: LinkStatus;
}

export interface LinkListResult {
  readonly rows: readonly LinkListRow[];
  readonly nextCursor: string | null;
}

export interface LinkListQueryInput {
  readonly status: "all" | "active" | "expired" | "revoked";
  readonly sort: "createdAt" | "expiresAt" | "downloadCount";
  readonly dir: "asc" | "desc";
  readonly cursor?: string;
  readonly limit?: number;
}

interface FindManyArgs {
  where?: Record<string, unknown>;
  orderBy?: ReadonlyArray<Record<string, "asc" | "desc">>;
  take?: number;
  cursor?: { id: string };
  skip?: number;
  select?: Record<string, unknown>;
}

export interface LinkListPrisma {
  readonly generatedLink: {
    findMany: (args: FindManyArgs) => Promise<Array<Record<string, unknown>>>;
  };
}

const LIMIT_DEFAULT = 50;
const LIMIT_MAX = 100;
const LIMIT_MIN = 1;

function clampLimit(raw: number | undefined): number {
  const n = Math.floor(raw ?? LIMIT_DEFAULT);
  if (!Number.isFinite(n) || n < LIMIT_MIN) return LIMIT_MIN;
  if (n > LIMIT_MAX) return LIMIT_MAX;
  return n;
}

function buildWhere(
  status: LinkListQueryInput["status"],
  now: Date,
): Record<string, unknown> {
  switch (status) {
    case "active":
      return { isRevoked: false, expiresAt: { gt: now } };
    case "expired":
      return { isRevoked: false, expiresAt: { lte: now } };
    case "revoked":
      return { isRevoked: true };
    case "all":
    default:
      return {};
  }
}

export async function queryLinks(
  prisma: LinkListPrisma,
  input: LinkListQueryInput,
  now: Date = new Date(),
): Promise<LinkListResult> {
  const limit = clampLimit(input.limit);
  const take = limit + 1;

  const args: FindManyArgs = {
    where: buildWhere(input.status, now),
    orderBy: [{ [input.sort]: input.dir }, { id: input.dir }],
    take,
    select: {
      id: true,
      documentId: true,
      presignedUrlHash: true,
      expiresAt: true,
      createdAt: true,
      downloadCount: true,
      maxDownloads: true,
      isRevoked: true,
      document: {
        select: {
          filename: true,
          bucket: { select: { name: true } },
        },
      },
      generatedBy: { select: { name: true, email: true } },
    },
  };
  if (input.cursor) {
    args.cursor = { id: input.cursor };
    args.skip = 1;
  }

  const rawRows = await prisma.generatedLink.findMany(args);
  const hasMore = rawRows.length > limit;
  const slice = hasMore ? rawRows.slice(0, limit) : rawRows;

  const rows: LinkListRow[] = slice.map((row) => {
    const doc = row.document as
      | { filename?: string; bucket?: { name?: string } }
      | undefined;
    const gen = row.generatedBy as
      | { name?: string | null; email?: string | null }
      | null
      | undefined;

    return {
      id: row.id as string,
      token: row.presignedUrlHash as string,
      documentId: row.documentId as string,
      documentName: doc?.filename ?? "(deleted)",
      bucketName: doc?.bucket?.name ?? "(unknown)",
      generatedByName:
        gen?.name && gen.name.length > 0 ? gen.name : null,
      generatedByEmail:
        gen?.email && gen.email.length > 0 ? gen.email : null,
      createdAt: row.createdAt as Date,
      expiresAt: row.expiresAt as Date,
      downloadCount: row.downloadCount as number,
      maxDownloads: (row.maxDownloads as number | null) ?? null,
      status: computeLinkStatus(
        {
          isRevoked: row.isRevoked as boolean,
          expiresAt: row.expiresAt as Date,
          downloadCount: row.downloadCount as number,
          maxDownloads: (row.maxDownloads as number | null) ?? null,
        },
        now,
      ),
    };
  });

  const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;
  return { rows, nextCursor };
}

interface LinkListPrismaLike {
  readonly generatedLink: { findMany(args?: unknown): Promise<unknown[]> };
}
export function asLinkListPrisma(
  client: LinkListPrismaLike,
): LinkListPrisma {
  return client as unknown as LinkListPrisma;
}
