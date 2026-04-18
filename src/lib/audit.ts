import type { AuditAction } from "@/types";

// Narrow Prisma surface — tests inject plain stubs; production passes
// the real prisma client. Bivariant method syntax keeps both
// assignable (same pattern as dashboard-stats / activity-feed).
export interface AuditPrisma {
  readonly auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

export interface AuditEntry {
  readonly userId: string | null;
  readonly action: AuditAction;
  readonly targetType: string;
  readonly targetId: string;
  readonly metadata?: Record<string, unknown>;
  readonly ipAddress: string;
  readonly userAgent: string;
}

// Upper bound on User-Agent — the DB column is TEXT but we do not want
// a request able to pad every audit row to megabytes. 512 is well
// above the longest real-world browser UA (~300).
const USER_AGENT_MAX = 512;
const TARGET_ID_MAX = 256;

export async function logAudit(
  prisma: AuditPrisma,
  entry: AuditEntry,
): Promise<{ id: string }> {
  if (!entry.ipAddress)
    throw new Error("logAudit: ipAddress must be a non-empty string");
  if (!entry.userAgent)
    throw new Error("logAudit: userAgent must be a non-empty string");

  const userAgent =
    entry.userAgent.length > USER_AGENT_MAX
      ? entry.userAgent.slice(0, USER_AGENT_MAX)
      : entry.userAgent;

  const targetId =
    entry.targetId.length > TARGET_ID_MAX
      ? entry.targetId.slice(0, TARGET_ID_MAX)
      : entry.targetId;

  return prisma.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      targetType: entry.targetType,
      targetId,
      metadata: entry.metadata ?? {},
      ipAddress: entry.ipAddress,
      userAgent,
    },
  });
}

interface AuditPrismaLike {
  readonly auditLog: { create(args: unknown): Promise<unknown> };
}

export function asAuditPrisma(client: AuditPrismaLike): AuditPrisma {
  return client as unknown as AuditPrisma;
}
