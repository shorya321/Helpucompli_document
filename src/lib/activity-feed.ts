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
  targetType: z.string().max(64),
  targetId: z.string().max(128),
});

export const activityFeedPayloadSchema = z.array(activityEntrySchema).max(200);

export const ACTIVITY_FEED_LIMIT = 20 as const;
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

export interface ActivityFeedPrisma {
  readonly auditLog: {
    findMany: (args: {
      take: number;
      orderBy: { createdAt: "desc" };
      select: {
        id: true;
        createdAt: true;
        action: true;
        targetType: true;
        targetId: true;
        user: { select: { name: true } };
      };
    }) => Promise<Array<Record<string, unknown>>>;
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
  return rows.map((row) => {
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
  });
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
