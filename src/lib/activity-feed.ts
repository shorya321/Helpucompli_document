import { z } from "zod";
import type { AuditAction } from "@/types";

// Response-payload schema — enforced at the API boundary so a bug in
// another write path cannot inject oversized strings or unknown action
// codes into admin dashboards. Max lengths mirror Prisma column caps.
export const auditActionSchema = z.enum([
  "LOGIN",
  "LOGOUT",
  "BUCKET_CREATE",
  "BUCKET_DELETE",
  "DOCUMENT_UPLOAD",
  "DOCUMENT_DOWNLOAD",
  "DOCUMENT_SOFT_DELETE",
  "DOCUMENT_HARD_DELETE",
  "DOCUMENT_MOVE",
  "DOCUMENT_COPY",
  "POLICY_CREATE",
  "POLICY_UPDATE",
  "POLICY_DELETE",
  "LINK_GENERATE",
  "LINK_ACCESS",
  "LINK_DENIED",
  "LINK_REVOKE",
  "LINK_SHARE_INFO_VIEW",
  "LINK_OEMBED_FETCHED",
  "USER_INVITE",
  "USER_ROLE_CHANGE",
  "USER_DISABLE",
  "USER_ENABLE",
]);

export const activityEntrySchema = z.object({
  id: z.string().min(1).max(64),
  createdAt: z.date(),
  action: auditActionSchema,
  userName: z.string().max(256).nullable(),
  // Bumped 2026-04-22: real audit rows carry full S3 object keys as
  // targetId (AWS allows up to 1024 bytes), and bucket names + prefix
  // chains can exceed the prior 64-char targetType cap. The previous
  // tight limits caused the /api/dashboard/activity?cursor= path to
  // 500 on legitimate rows, breaking F4.6 Load more.
  targetType: z.string().max(256),
  targetId: z.string().max(1024),
});

export const activityFeedPayloadSchema = z.array(activityEntrySchema).max(200);

// Paged response — boundary-validated alongside the array form so the
// /api/dashboard/activity route can return either shape under the same
// ApiResponse<T> envelope without losing safety.
export const activityFeedPageSchema = z.object({
  entries: activityFeedPayloadSchema,
  nextCursor: z.string().min(1).max(64).nullable(),
});

export const ACTIVITY_FEED_LIMIT = 20 as const;
export const ACTIVITY_FEED_PAGE_LIMIT_MAX = 50 as const;
const ACTIVITY_FEED_MAX = 200;
const ACTIVITY_FEED_MIN = 1;

export interface ActivityEntry {
  readonly id: string;
  readonly createdAt: Date;
  readonly action: AuditAction;
  readonly userName: string | null;
  readonly targetType: string;
  readonly targetId: string;
}

export interface ActivityFeedPage {
  readonly entries: readonly ActivityEntry[];
  readonly nextCursor: string | null;
}

export interface ActivityFeedPrisma {
  readonly auditLog: {
    findMany: (args: {
      take: number;
      orderBy:
        | { createdAt: "desc" }
        | ReadonlyArray<{ createdAt?: "desc"; id?: "desc" }>;
      select: {
        id: true;
        createdAt: true;
        action: true;
        targetType: true;
        targetId: true;
        user: { select: { name: true } };
      };
      where?: Record<string, unknown>;
    }) => Promise<Array<Record<string, unknown>>>;
    findUnique?: (args: {
      where: { id: string };
      select: { createdAt: true };
    }) => Promise<{ createdAt: Date } | null>;
  };
}

export async function getRecentActivity(
  prisma: ActivityFeedPrisma,
  limit: number = ACTIVITY_FEED_LIMIT,
): Promise<readonly ActivityEntry[]> {
  const take = Math.max(
    ACTIVITY_FEED_MIN,
    Math.min(ACTIVITY_FEED_MAX, Math.floor(limit || ACTIVITY_FEED_MIN)),
  );

  const rows = await prisma.auditLog.findMany({
    take,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      action: true,
      targetType: true,
      targetId: true,
      user: { select: { name: true } },
    },
  });

  // HIPAA 164.312(e)(2)(ii) minimum-necessary: email is NOT fetched
  // here. Admins can resolve userId → email via /users when needed.
  return rows.map(toActivityEntry);
}

function toActivityEntry(row: Record<string, unknown>): ActivityEntry {
  const user = row.user as { name: string | null } | null;
  const name = user?.name ?? null;
  const userName = name && name.length > 0 ? name : null;
  return {
    id: row.id as string,
    createdAt: row.createdAt as Date,
    action: row.action as AuditAction,
    userName,
    targetType: row.targetType as string,
    targetId: row.targetId as string,
  };
}

// Cursor-based "Load more" pagination. Tie-stable on (createdAt, id):
// when two rows share createdAt, id (a sortable cuid/uuid in our schema)
// breaks the tie deterministically so the next page never duplicates or
// skips entries during steady-state writes. A missing cursor row yields
// an empty page + nextCursor=null — safer than throwing for a UI that
// might race a soft-delete.
export async function getRecentActivityPage(
  prisma: ActivityFeedPrisma,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<ActivityFeedPage> {
  const limit = clampLimit(
    opts.limit ?? ACTIVITY_FEED_LIMIT,
    1,
    ACTIVITY_FEED_PAGE_LIMIT_MAX,
  );
  const cursor = opts.cursor ?? null;

  let where: Record<string, unknown> | undefined;
  if (cursor) {
    if (!prisma.auditLog.findUnique) {
      // No findUnique on the stub — treat as no-cursor request rather
      // than crash. Production prisma always supplies findUnique.
      where = undefined;
    } else {
      const head = await prisma.auditLog.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });
      if (!head) {
        return { entries: [], nextCursor: null };
      }
      where = {
        OR: [
          { createdAt: { lt: head.createdAt } },
          { createdAt: head.createdAt, id: { lt: cursor } },
        ],
      };
    }
  }

  // Fetch limit+1 to detect whether another page exists without a
  // separate count query.
  const rows = await prisma.auditLog.findMany({
    take: limit + 1,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      createdAt: true,
      action: true,
      targetType: true,
      targetId: true,
      user: { select: { name: true } },
    },
    ...(where ? { where } : {}),
  });

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const entries = sliced.map(toActivityEntry);
  const last = entries[entries.length - 1];
  return {
    entries,
    nextCursor: hasMore && last ? last.id : null,
  };
}

function clampLimit(value: number, min: number, max: number): number {
  const n = Math.floor(Number(value) || min);
  return Math.max(min, Math.min(max, n));
}

// Structural witness for the caller — Prisma client or a stub. Method
// syntax on `findMany` gives us bivariant params so Prisma's generic
// <T extends AuditLogFindManyArgs> signature is still assignable while
// plain test stubs remain valid. If a future Prisma version drops
// auditLog.findMany, the call site fails to compile.
interface ActivityPrismaLike {
  readonly auditLog: { findMany(args?: unknown): Promise<unknown[]> };
}
export function asActivityPrisma(client: ActivityPrismaLike): ActivityFeedPrisma {
  return client as unknown as ActivityFeedPrisma;
}

export type BadgeTone = "info" | "success" | "warning" | "danger";

const TONE_MAP: Record<AuditAction, BadgeTone> = {
  LOGIN: "success",
  USER_ENABLE: "success",
  LOGOUT: "info",
  DOCUMENT_UPLOAD: "info",
  DOCUMENT_DOWNLOAD: "info",
  DOCUMENT_MOVE: "info",
  DOCUMENT_COPY: "info",
  BUCKET_CREATE: "info",
  POLICY_CREATE: "info",
  LINK_GENERATE: "info",
  LINK_ACCESS: "info",
  LINK_SHARE_INFO_VIEW: "info",
  LINK_OEMBED_FETCHED: "info",
  USER_INVITE: "info",
  DOCUMENT_SOFT_DELETE: "warning",
  POLICY_UPDATE: "warning",
  USER_ROLE_CHANGE: "warning",
  DOCUMENT_HARD_DELETE: "danger",
  BUCKET_DELETE: "danger",
  POLICY_DELETE: "danger",
  LINK_DENIED: "danger",
  LINK_REVOKE: "danger",
  USER_DISABLE: "danger",
};

export function actionBadgeTone(action: AuditAction): BadgeTone {
  // Fallback protects against a future AuditAction added to the enum
  // but not to TONE_MAP — returns `info` rather than crashing the feed
  // with an undefined badge color.
  return TONE_MAP[action] ?? "info";
}
