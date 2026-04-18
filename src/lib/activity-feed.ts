import type { AuditAction } from "@/types";

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
        user: { select: { name: true; email: true } };
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
      user: { select: { name: true, email: true } },
    },
  });

  return rows.map((row) => {
    const user = row.user as
      | { name: string | null; email: string | null }
      | null;
    const name = user?.name ?? null;
    const email = user?.email ?? null;
    const userName =
      name && name.length > 0
        ? name
        : email && email.length > 0
          ? email
          : null;
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

export function asActivityPrisma(client: unknown): ActivityFeedPrisma {
  return client as ActivityFeedPrisma;
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
  return TONE_MAP[action];
}
