import { z } from "zod";
import { auditActionSchema } from "@/lib/activity-feed";
import type { AuditAction } from "@/types";

const LIMIT_MAX = 100;
const LIMIT_MIN = 1;
const LIMIT_DEFAULT = 50;

export const auditTargetTypeSchema = z.enum([
  "bucket",
  "document",
  "policy",
  "user",
  "link",
]);
export type AuditTargetType = z.infer<typeof auditTargetTypeSchema>;

export const auditQueryParamsSchema = z.object({
  userId: z.string().min(1).max(128).optional(),
  actions: z.array(auditActionSchema).max(21).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  targetType: auditTargetTypeSchema.optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().optional(),
});

export type AuditQueryFilters = z.infer<typeof auditQueryParamsSchema>;

export interface AuditQueryRow {
  readonly id: string;
  readonly createdAt: Date;
  readonly action: AuditAction;
  readonly targetType: string;
  readonly targetId: string;
  readonly ipAddress: string;
  readonly userId: string | null;
  readonly userName: string | null;
  readonly userEmail: string | null;
  // JSON blob written by logAudit() callers — surfaced to the audit UI
  // so reviewers can see action-specific context (e.g. allowPublicEmbed
  // on LINK_GENERATE, mode=folder_marker on DOCUMENT_UPLOAD-folder).
  readonly metadata: Record<string, unknown> | null;
}

export interface AuditQueryResult {
  readonly rows: readonly AuditQueryRow[];
  readonly nextCursor: string | null;
}

interface FindManyArgs {
  where?: Record<string, unknown>;
  orderBy?: ReadonlyArray<Record<string, "asc" | "desc">>;
  take?: number;
  cursor?: { id: string };
  skip?: number;
  select?: Record<string, unknown>;
}

export interface AuditQueryPrisma {
  readonly auditLog: {
    findMany: (args: FindManyArgs) => Promise<Array<Record<string, unknown>>>;
  };
}

function clampLimit(raw: number | undefined): number {
  const n = Math.floor(raw ?? LIMIT_DEFAULT);
  if (!Number.isFinite(n) || n < LIMIT_MIN) return LIMIT_MIN;
  if (n > LIMIT_MAX) return LIMIT_MAX;
  return n;
}

function buildWhere(f: AuditQueryFilters): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (f.userId) where.userId = f.userId;
  if (f.actions && f.actions.length > 0) where.action = { in: f.actions };
  if (f.targetType) where.targetType = f.targetType;
  if (f.dateFrom || f.dateTo) {
    const range: Record<string, Date> = {};
    if (f.dateFrom) range.gte = f.dateFrom;
    if (f.dateTo) range.lte = f.dateTo;
    where.createdAt = range;
  }
  return where;
}

export async function queryAuditLogs(
  prisma: AuditQueryPrisma,
  filters: AuditQueryFilters,
): Promise<AuditQueryResult> {
  const limit = clampLimit(filters.limit);
  const take = limit + 1;

  const args: FindManyArgs = {
    where: buildWhere(filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      createdAt: true,
      action: true,
      targetType: true,
      targetId: true,
      ipAddress: true,
      userId: true,
      metadata: true,
      user: { select: { id: true, name: true, email: true } },
    },
  };
  if (filters.cursor) {
    args.cursor = { id: filters.cursor };
    args.skip = 1;
  }

  const rawRows = await prisma.auditLog.findMany(args);

  const hasMore = rawRows.length > limit;
  const slice = hasMore ? rawRows.slice(0, limit) : rawRows;

  const rows: AuditQueryRow[] = slice.map((row) => {
    const user = row.user as
      | { id?: string; name?: string | null; email?: string | null }
      | null
      | undefined;
    const userName = user?.name && user.name.length > 0 ? user.name : null;
    const userEmail = user?.email && user.email.length > 0 ? user.email : null;
    const rawMeta = row.metadata as Record<string, unknown> | null | undefined;
    return {
      id: row.id as string,
      createdAt: row.createdAt as Date,
      action: row.action as AuditAction,
      targetType: row.targetType as string,
      targetId: row.targetId as string,
      ipAddress: row.ipAddress as string,
      userId: (row.userId as string | null) ?? user?.id ?? null,
      userName,
      userEmail,
      metadata: rawMeta ?? null,
    };
  });

  const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;

  return { rows, nextCursor };
}

interface AuditQueryPrismaLike {
  readonly auditLog: { findMany(args?: unknown): Promise<unknown[]> };
}
export function asAuditQueryPrisma(
  client: AuditQueryPrismaLike,
): AuditQueryPrisma {
  return client as unknown as AuditQueryPrisma;
}
