import { z } from "zod";
import type { Role } from "@/types";

export type DocumentSearchSortField = "filename" | "uploadedAt" | "sizeBytes";
export type DocumentSearchSortDir = "asc" | "desc";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Query schema used by both the API route and the page SSR path. Free
// text `q` is capped at 128 chars; bigger queries are client bugs, not
// legitimate searches, and this cap keeps the ILIKE scan bounded.
export const documentSearchQuerySchema = z.object({
  bucketId: z.string().uuid().optional(),
  q: z.string().max(128).optional(),
  contentType: z.string().max(255).optional(),
  uploaderId: z.string().uuid().optional(),
  from: z.string().regex(DATE_RE, "must be YYYY-MM-DD").optional(),
  to: z.string().regex(DATE_RE, "must be YYYY-MM-DD").optional(),
  sort: z.enum(["filename", "uploadedAt", "sizeBytes"]).default("uploadedAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(25),
});

export type DocumentSearchQuery = z.infer<typeof documentSearchQuerySchema>;

function firstValue(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}

// URL-derived query: values may be string | string[] | undefined. Returns
// null on invalid input so callers can 400 without a try/catch.
export function parseDocumentSearchQuery(
  params: Record<string, unknown>,
): DocumentSearchQuery | null {
  const raw = {
    bucketId: firstValue(params.bucketId),
    q: firstValue(params.q),
    contentType: firstValue(params.contentType),
    uploaderId: firstValue(params.uploaderId),
    from: firstValue(params.from),
    to: firstValue(params.to),
    sort: firstValue(params.sort) ?? "uploadedAt",
    dir: firstValue(params.dir) ?? "desc",
    page: params.page !== undefined ? Number(firstValue(params.page)) : 1,
    pageSize:
      params.pageSize !== undefined ? Number(firstValue(params.pageSize)) : 25,
  };
  const parsed = documentSearchQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type DocumentSearchScope =
  | { readonly role: Extract<Role, "superadmin" | "admin"> }
  | { readonly role: Extract<Role, "viewer">; readonly userId: string };

export interface DocumentSearchRow {
  readonly id: string;
  readonly bucketId: string;
  readonly s3Key: string;
  readonly filename: string;
  readonly contentType: string | null;
  readonly sizeBytes: bigint | null;
  readonly uploadedAt: Date;
  readonly uploadedBy: { readonly id: string; readonly name: string | null; readonly email: string };
  readonly isDeleted: boolean;
}

export interface DocumentSearchResult {
  readonly documents: ReadonlyArray<DocumentSearchRow>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface DocumentSearchPrisma {
  readonly document: {
    findMany(args: unknown): Promise<DocumentSearchRow[]>;
    count(args: unknown): Promise<number>;
  };
}

// Narrow cast helper — keeps test stubs minimal. Mirrors the
// asBucketListPrisma pattern used in F5.1.
export function asDocumentSearchPrisma(
  client: { readonly document: unknown },
): DocumentSearchPrisma {
  return client as unknown as DocumentSearchPrisma;
}

export async function searchDocuments(
  prisma: DocumentSearchPrisma,
  scope: DocumentSearchScope,
  input: Partial<DocumentSearchQuery>,
): Promise<DocumentSearchResult> {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const sort = input.sort ?? "uploadedAt";
  const dir = input.dir ?? "desc";

  // Viewer: Document is scoped via Bucket.userAccess relation. Admin +
  // superadmin see every bucket — F6.4/F6.5 routes still gate per-bucket
  // writes via UserBucketAccess at mutation time.
  const scopeWhere =
    scope.role === "viewer"
      ? { bucket: { userAccess: { some: { userId: scope.userId } } } }
      : {};

  const where: Record<string, unknown> = {
    ...scopeWhere,
    isDeleted: false,
    ...(input.bucketId ? { bucketId: input.bucketId } : {}),
    ...(input.contentType ? { contentType: input.contentType } : {}),
    ...(input.uploaderId ? { uploadedById: input.uploaderId } : {}),
    ...(input.q
      ? { filename: { contains: input.q, mode: "insensitive" } }
      : {}),
  };

  if (input.from || input.to) {
    const range: { gte?: Date; lte?: Date } = {};
    if (input.from) range.gte = new Date(`${input.from}T00:00:00.000Z`);
    if (input.to) range.lte = new Date(`${input.to}T23:59:59.999Z`);
    where.uploadedAt = range;
  }

  const orderBy: Record<string, string> = { [sort]: dir };

  const [documents, total] = await Promise.all([
    prisma.document.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        bucketId: true,
        s3Key: true,
        filename: true,
        contentType: true,
        sizeBytes: true,
        uploadedAt: true,
        isDeleted: true,
        uploadedBy: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.document.count({ where }),
  ]);

  return { documents, total, page, pageSize };
}
