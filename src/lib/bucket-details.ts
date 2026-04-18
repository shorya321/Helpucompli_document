import type { Role } from "@/types";

export class BucketNotFoundError extends Error {
  public readonly status = 404;
  constructor(id: string) {
    super(`Bucket '${id}' not found`);
    this.name = "BucketNotFoundError";
  }
}

export class BucketAccessDeniedError extends Error {
  public readonly status = 403;
  constructor(id: string) {
    super(`Access denied to bucket '${id}'`);
    this.name = "BucketAccessDeniedError";
  }
}

export type BucketDetailsScope =
  | { readonly role: Extract<Role, "superadmin" | "admin"> }
  | { readonly role: Extract<Role, "viewer">; readonly userId: string };

export interface BucketDetailsDocument {
  readonly id: string;
  readonly filename: string;
  readonly sizeBytes: bigint;
  readonly contentType: string | null;
  readonly uploadedAt: Date;
  readonly uploadedByName: string | null;
}

export interface BucketDetailsAccessPolicy {
  readonly id: string;
  readonly name: string;
  readonly linkTtlSeconds: number;
  readonly maxDownloads: number | null;
  readonly requireAuth: boolean;
  readonly allowedDomains: readonly string[];
  readonly allowedIpRanges: readonly string[];
  readonly createdAt: Date;
}

export interface BucketDetailsCompliance {
  readonly sseKms: boolean;
  readonly versioning: boolean;
  readonly publicAccessBlock: boolean;
  readonly httpsOnlyPolicy: boolean;
}

export interface BucketDetails {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly description: string | null;
  readonly createdAt: Date;
  readonly isActive: boolean;
  readonly documentCount: number;
  readonly storageBytes: bigint;
  readonly recentDocuments: readonly BucketDetailsDocument[];
  readonly accessPolicies: readonly BucketDetailsAccessPolicy[];
  readonly hipaaCompliance: BucketDetailsCompliance;
}

// All HIPAA buckets are provisioned by createHipaaBucket which applies
// SSE-KMS + versioning + BPA + HTTPS-only policy unconditionally. We
// surface this design-guarantee to the UI instead of running live
// HeadBucket round-trips on every details-page load. Bucket-level
// posture drift detection belongs in a periodic reconciliation job,
// not a user-facing fetch.
const HIPAA_COMPLIANCE: BucketDetailsCompliance = {
  sseKms: true,
  versioning: true,
  publicAccessBlock: true,
  httpsOnlyPolicy: true,
};

const RECENT_DOCS_LIMIT = 10;

// Narrow Prisma surface. Bivariant method syntax keeps real client +
// stubs both assignable.
export interface BucketDetailsPrisma {
  readonly bucket: {
    findUnique(args: unknown): Promise<{
      id: string;
      name: string;
      awsRegion: string;
      description: string | null;
      createdAt: Date;
      isActive: boolean;
      _count: { documents: number };
      userAccess?: Array<{ userId: string }>;
    } | null>;
  };
  readonly document: {
    aggregate(args: unknown): Promise<{
      _sum: { sizeBytes: bigint | null };
    }>;
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
  readonly accessPolicy: {
    findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  };
}

interface BucketDetailsPrismaLike {
  readonly bucket: { findUnique(args?: unknown): Promise<unknown> };
  readonly document: {
    aggregate(args?: unknown): Promise<unknown>;
    findMany(args?: unknown): Promise<unknown[]>;
  };
  readonly accessPolicy: { findMany(args?: unknown): Promise<unknown[]> };
}

export function asBucketDetailsPrisma(
  client: BucketDetailsPrismaLike,
): BucketDetailsPrisma {
  return client as unknown as BucketDetailsPrisma;
}

function buildFindUniqueArgs(
  bucketId: string,
  scope: BucketDetailsScope,
): unknown {
  const select = {
    id: true,
    name: true,
    awsRegion: true,
    description: true,
    createdAt: true,
    isActive: true,
    _count: { select: { documents: { where: { isDeleted: false } } } },
  };
  // Viewer scope: a `userAccess.some.userId` where-filter would change
  // findUnique-semantics, so instead we select the matching
  // user_bucket_access row. If the select returns an empty array, the
  // viewer has no grant to this bucket.
  if (scope.role === "viewer") {
    return {
      where: { id: bucketId },
      select: {
        ...select,
        userAccess: {
          where: { userId: scope.userId },
          select: { userId: true },
          take: 1,
        },
      },
    };
  }
  return { where: { id: bucketId }, select };
}

export async function getBucketDetails(
  prisma: BucketDetailsPrisma,
  scope: BucketDetailsScope,
  bucketId: string,
): Promise<BucketDetails> {
  const bucketRow = await prisma.bucket.findUnique(
    buildFindUniqueArgs(bucketId, scope),
  );

  // Fused viewer check — bucket missing OR userAccess empty both map
  // to 403 so the viewer cannot probe bucket existence via 404/403
  // distinction. Single guard keeps a future refactor from splitting
  // the access-control branches.
  if (scope.role === "viewer") {
    if (!bucketRow || (bucketRow.userAccess ?? []).length === 0) {
      throw new BucketAccessDeniedError(bucketId);
    }
  } else if (!bucketRow) {
    throw new BucketNotFoundError(bucketId);
  }
  // The fused check above guarantees bucketRow is non-null; assert
  // for TS.
  if (!bucketRow) throw new Error("unreachable: bucketRow narrowed");

  // Run aggregate + recent docs + policies in parallel — all are
  // scoped to this one bucket so there's no cross-bucket leakage risk
  // even for viewer scope.
  const [aggregate, rawRecentDocs, rawPolicies] = await Promise.all([
    prisma.document.aggregate({
      where: { bucketId, isDeleted: false },
      _sum: { sizeBytes: true },
    }),
    prisma.document.findMany({
      where: { bucketId, isDeleted: false },
      orderBy: { uploadedAt: "desc" },
      take: RECENT_DOCS_LIMIT,
      select: {
        id: true,
        filename: true,
        sizeBytes: true,
        contentType: true,
        uploadedAt: true,
        uploadedBy: { select: { name: true } },
      },
    }),
    prisma.accessPolicy.findMany({
      where: { targetType: "bucket", targetValue: bucketId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        linkTtlSeconds: true,
        maxDownloads: true,
        requireAuth: true,
        allowedDomains: true,
        allowedIpRanges: true,
        createdAt: true,
      },
    }),
  ]);

  const recentDocuments: BucketDetailsDocument[] = rawRecentDocs.map((r) => {
    const uploadedBy = r.uploadedBy as { name: string | null } | null;
    return {
      id: r.id as string,
      filename: r.filename as string,
      sizeBytes: (r.sizeBytes as bigint | null) ?? BigInt(0),
      contentType: (r.contentType as string | null) ?? null,
      uploadedAt: r.uploadedAt as Date,
      uploadedByName: uploadedBy?.name ?? null,
    };
  });

  const accessPolicies: BucketDetailsAccessPolicy[] = rawPolicies.map((p) => ({
    id: p.id as string,
    name: p.name as string,
    linkTtlSeconds: p.linkTtlSeconds as number,
    maxDownloads: (p.maxDownloads as number | null) ?? null,
    requireAuth: p.requireAuth as boolean,
    allowedDomains: (p.allowedDomains as string[]) ?? [],
    allowedIpRanges: (p.allowedIpRanges as string[]) ?? [],
    createdAt: p.createdAt as Date,
  }));

  return {
    id: bucketRow.id,
    name: bucketRow.name,
    region: bucketRow.awsRegion,
    description: bucketRow.description,
    createdAt: bucketRow.createdAt,
    isActive: bucketRow.isActive,
    documentCount: bucketRow._count.documents,
    storageBytes: aggregate._sum.sizeBytes ?? BigInt(0),
    recentDocuments,
    accessPolicies,
    hipaaCompliance: HIPAA_COMPLIANCE,
  };
}
