import type { PolicyInput, PolicyUpdate } from "@/lib/policy-schema";

export class PolicyNotFoundError extends Error {
  public readonly status = 404;
  constructor(id: string) {
    super(`Policy ${id} not found`);
    this.name = "PolicyNotFoundError";
  }
}

export interface PolicyRow {
  readonly id: string;
  readonly name: string;
  readonly targetType: string;
  readonly targetValue: string;
  readonly allowedDomains: readonly string[];
  readonly allowedIpRanges: readonly string[];
  readonly linkTtlSeconds: number;
  readonly maxDownloads: number | null;
  readonly requireAuth: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PolicyContext {
  readonly userId: string;
  readonly ipAddress: string;
  readonly userAgent: string;
}

interface PolicyTxClient {
  readonly accessPolicy: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findUnique(args: {
      where: { id: string };
    }): Promise<Record<string, unknown> | null>;
    update(args: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
    delete(args: { where: { id: string } }): Promise<Record<string, unknown>>;
  };
  readonly auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

export interface PolicyCrudPrisma extends PolicyTxClient {
  $transaction<T>(cb: (tx: PolicyTxClient) => Promise<T>): Promise<T>;
}

function rowToPolicy(row: Record<string, unknown>): PolicyRow {
  return {
    id: row.id as string,
    name: row.name as string,
    targetType: row.targetType as string,
    targetValue: row.targetValue as string,
    allowedDomains: (row.allowedDomains as string[]) ?? [],
    allowedIpRanges: (row.allowedIpRanges as string[]) ?? [],
    linkTtlSeconds: row.linkTtlSeconds as number,
    maxDownloads: (row.maxDownloads as number | null) ?? null,
    requireAuth: row.requireAuth as boolean,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

export async function createPolicy(
  prisma: PolicyCrudPrisma,
  input: PolicyInput,
  ctx: PolicyContext,
): Promise<PolicyRow> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.accessPolicy.create({
      data: {
        name: input.name,
        targetType: input.targetType,
        targetValue: input.targetValue,
        allowedDomains: input.allowedDomains,
        allowedIpRanges: input.allowedIpRanges,
        linkTtlSeconds: input.linkTtlSeconds,
        maxDownloads: input.maxDownloads,
        requireAuth: input.requireAuth,
        createdById: ctx.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: ctx.userId,
        action: "POLICY_CREATE",
        targetType: "policy",
        targetId: created.id as string,
        metadata: {
          name: input.name,
          targetType: input.targetType,
          targetValue: input.targetValue,
          requireAuth: input.requireAuth,
          linkTtlSeconds: input.linkTtlSeconds,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return rowToPolicy(created);
  });
}

export async function updatePolicy(
  prisma: PolicyCrudPrisma,
  id: string,
  patch: PolicyUpdate,
  ctx: PolicyContext,
): Promise<PolicyRow> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.accessPolicy.findUnique({ where: { id } });
    if (!existing) throw new PolicyNotFoundError(id);

    const updated = await tx.accessPolicy.update({
      where: { id },
      data: patch as Record<string, unknown>,
    });

    await tx.auditLog.create({
      data: {
        userId: ctx.userId,
        action: "POLICY_UPDATE",
        targetType: "policy",
        targetId: id,
        metadata: {
          changedKeys: Object.keys(patch),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return rowToPolicy(updated);
  });
}

export async function deletePolicy(
  prisma: PolicyCrudPrisma,
  id: string,
  ctx: PolicyContext,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.accessPolicy.findUnique({ where: { id } });
    if (!existing) throw new PolicyNotFoundError(id);

    await tx.accessPolicy.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        userId: ctx.userId,
        action: "POLICY_DELETE",
        targetType: "policy",
        targetId: id,
        metadata: {
          name: existing.name,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  });
}

export async function getPolicy(
  prisma: PolicyCrudPrisma,
  id: string,
): Promise<PolicyRow | null> {
  const row = await prisma.accessPolicy.findUnique({ where: { id } });
  return row ? rowToPolicy(row) : null;
}

interface PolicyCrudPrismaLike {
  readonly accessPolicy: {
    create(args?: unknown): Promise<unknown>;
    findUnique(args?: unknown): Promise<unknown>;
    update(args?: unknown): Promise<unknown>;
    delete(args?: unknown): Promise<unknown>;
  };
  readonly auditLog: { create(args?: unknown): Promise<unknown> };
  readonly $transaction: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
}
export function asPolicyCrudPrisma(
  client: PolicyCrudPrismaLike,
): PolicyCrudPrisma {
  return client as unknown as PolicyCrudPrisma;
}
