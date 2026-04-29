export type LinkStatus = "active" | "expired" | "revoked";

export interface LinkStatusInput {
  readonly isRevoked: boolean;
  // null = never expires. Still bounded by maxDownloads + revoke.
  readonly expiresAt: Date | null;
  readonly downloadCount: number;
  readonly maxDownloads: number | null;
}

export function computeLinkStatus(
  input: LinkStatusInput,
  now: Date = new Date(),
): LinkStatus {
  if (input.isRevoked) return "revoked";
  if (
    input.expiresAt !== null &&
    input.expiresAt.getTime() <= now.getTime()
  ) {
    return "expired";
  }
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
  // Sec-review C1: bearer token (presignedUrlHash) is intentionally NOT
  // returned in the list response. Tokens are returned ONCE at create
  // time and never re-emitted. Admin actions (revoke) use `id`.
  readonly documentId: string;
  readonly documentName: string;
  readonly bucketName: string;
  readonly generatedByName: string | null;
  readonly generatedByEmail: string | null;
  readonly createdAt: Date;
  // null = never expires (superadmin-gated).
  readonly expiresAt: Date | null;
  readonly downloadCount: number;
  readonly maxDownloads: number | null;
  readonly status: LinkStatus;
  // Image-embed eligibility signals — image MIME + allowPublicEmbed
  // unlocks the "Copy image URL" action in the dashboard, which copies
  // a /raw URL serving image bytes (the only shape Circle.so's image-
  // embed slot accepts; /l/<token> returns text/html which it rejects).
  // Tokens are NOT included here — the URL is minted server-side at
  // share-info time so list responses stay token-free per sec-review C1.
  readonly contentType: string | null;
  readonly allowPublicEmbed: boolean;
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
      // Never-expires rows (expiresAt = NULL) count as active while not
      // revoked or past the download cap. Download-cap filter is not
      // expressible cleanly in a Prisma WHERE without a raw comparison
      // of two columns, so we leave that filter to computeLinkStatus in
      // the mapping step (rows past the cap will be included here but
      // flipped to "expired" after mapping).
      return {
        isRevoked: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      };
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
      // presignedUrlHash deliberately NOT selected (sec-review C1).
      expiresAt: true,
      createdAt: true,
      downloadCount: true,
      maxDownloads: true,
      isRevoked: true,
      allowPublicEmbed: true,
      document: {
        select: {
          filename: true,
          contentType: true,
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
      | {
          filename?: string;
          contentType?: string | null;
          bucket?: { name?: string };
        }
      | undefined;
    const gen = row.generatedBy as
      | { name?: string | null; email?: string | null }
      | null
      | undefined;

    return {
      id: row.id as string,
      documentId: row.documentId as string,
      documentName: doc?.filename ?? "(deleted)",
      bucketName: doc?.bucket?.name ?? "(unknown)",
      generatedByName:
        gen?.name && gen.name.length > 0 ? gen.name : null,
      generatedByEmail:
        gen?.email && gen.email.length > 0 ? gen.email : null,
      createdAt: row.createdAt as Date,
      expiresAt: (row.expiresAt as Date | null) ?? null,
      downloadCount: row.downloadCount as number,
      maxDownloads: (row.maxDownloads as number | null) ?? null,
      status: computeLinkStatus(
        {
          isRevoked: row.isRevoked as boolean,
          expiresAt: (row.expiresAt as Date | null) ?? null,
          downloadCount: row.downloadCount as number,
          maxDownloads: (row.maxDownloads as number | null) ?? null,
        },
        now,
      ),
      contentType: doc?.contentType ?? null,
      allowPublicEmbed: row.allowPublicEmbed === true,
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
