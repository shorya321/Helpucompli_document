import { randomBytes } from "node:crypto";
import { MAX_GET_TTL_SECONDS } from "@/lib/s3-presign";

// Link tokens are independent of presign TTL — the access endpoint
// generates a fresh, short presigned URL on every redirect (Module 09
// F9.3). 60s lower bound supports burst/single-use shares; 7d upper
// bound mirrors SigV4 ceiling so we never accept a token longer than
// the longest renewable URL the engine could later sign.
export const LINK_MIN_TTL_SECONDS = 60;
export const LINK_MAX_TTL_SECONDS = MAX_GET_TTL_SECONDS;

export class DocumentNotFoundError extends Error {
  public readonly status = 404;
  constructor(id: string) {
    super(`Document ${id} not found`);
    this.name = "DocumentNotFoundError";
  }
}

export class PolicyMismatchError extends Error {
  public readonly status = 404;
  constructor(id: string) {
    super(`Policy ${id} not found`);
    this.name = "PolicyMismatchError";
  }
}

// 32 random bytes = 256 bits of entropy. base64url encodes to 43 chars
// (no padding) — URL-safe and meets RFC 4648 §5.
export function generateLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

interface PolicyInfo {
  readonly linkTtlSeconds: number;
  readonly maxDownloads: number | null;
}

export interface ResolveSettingsInput {
  readonly policy: PolicyInfo | null;
  readonly ttlOverride: number | null;
  readonly maxDownloadsOverride: number | null;
}

export interface ResolvedSettings {
  readonly ttlSeconds: number;
  readonly maxDownloads: number | null;
}

const DEFAULT_TTL = 900;

function clampToRange(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export function resolveEffectiveSettings(
  input: ResolveSettingsInput,
): ResolvedSettings {
  const policyTtl = input.policy?.linkTtlSeconds ?? DEFAULT_TTL;
  // Override may shorten the TTL (good for one-off shares) but never
  // extend beyond the policy's ceiling. Without a policy, allow up to
  // global MAX_GET_TTL.
  const ceilingTtl = input.policy ? policyTtl : LINK_MAX_TTL_SECONDS;
  const ttlSeconds =
    input.ttlOverride !== null
      ? clampToRange(input.ttlOverride, LINK_MIN_TTL_SECONDS, ceilingTtl)
      : policyTtl;

  const policyCap = input.policy?.maxDownloads ?? null;
  let maxDownloads: number | null;
  if (input.maxDownloadsOverride === null) {
    maxDownloads = policyCap;
  } else if (policyCap === null) {
    maxDownloads = Math.max(1, Math.floor(input.maxDownloadsOverride));
  } else {
    maxDownloads = Math.min(
      Math.max(1, Math.floor(input.maxDownloadsOverride)),
      policyCap,
    );
  }

  return { ttlSeconds, maxDownloads };
}

export interface LinkCreateInput {
  readonly documentId: string;
  readonly policyId: string | null;
  readonly ttlSecondsOverride: number | null;
  readonly maxDownloadsOverride: number | null;
}

export interface LinkCreateContext {
  readonly userId: string;
  readonly ipAddress: string;
  readonly userAgent: string;
}

export interface LinkCreateResult {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: Date;
  readonly ttlSeconds: number;
  readonly maxDownloads: number | null;
}

interface LinkTxClient {
  readonly document: {
    findUnique: (args: {
      where: { id: string };
      select: Record<string, unknown>;
    }) => Promise<Record<string, unknown> | null>;
  };
  readonly accessPolicy: {
    findUnique: (args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }) => Promise<Record<string, unknown> | null>;
  };
  readonly generatedLink: {
    create: (args: { data: Record<string, unknown> }) => Promise<
      Record<string, unknown>
    >;
  };
  readonly auditLog: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
}

export interface LinkCreatePrisma extends LinkTxClient {
  $transaction<T>(cb: (tx: LinkTxClient) => Promise<T>): Promise<T>;
}

export async function createLink(
  prisma: LinkCreatePrisma,
  input: LinkCreateInput,
  ctx: LinkCreateContext,
): Promise<LinkCreateResult> {
  return prisma.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({
      where: { id: input.documentId },
      select: { id: true, isDeleted: true },
    });
    if (!doc || doc.isDeleted === true) {
      throw new DocumentNotFoundError(input.documentId);
    }

    let policy: PolicyInfo | null = null;
    if (input.policyId) {
      const row = await tx.accessPolicy.findUnique({
        where: { id: input.policyId },
        select: { id: true, linkTtlSeconds: true, maxDownloads: true },
      });
      if (!row) throw new PolicyMismatchError(input.policyId);
      policy = {
        linkTtlSeconds: row.linkTtlSeconds as number,
        maxDownloads: (row.maxDownloads as number | null) ?? null,
      };
    }

    const { ttlSeconds, maxDownloads } = resolveEffectiveSettings({
      policy,
      ttlOverride: input.ttlSecondsOverride,
      maxDownloadsOverride: input.maxDownloadsOverride,
    });

    const token = generateLinkToken();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    const row = await tx.generatedLink.create({
      data: {
        documentId: input.documentId,
        policyId: input.policyId,
        generatedById: ctx.userId,
        presignedUrlHash: token,
        expiresAt,
        downloadCount: 0,
        maxDownloads,
        isRevoked: false,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: ctx.userId,
        action: "LINK_GENERATE",
        targetType: "link",
        targetId: row.id as string,
        metadata: {
          documentId: input.documentId,
          policyId: input.policyId,
          ttlSeconds,
          maxDownloads,
          expiresAt: expiresAt.toISOString(),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return {
      id: row.id as string,
      token,
      expiresAt,
      ttlSeconds,
      maxDownloads,
    };
  });
}

interface LinkCreatePrismaLike {
  readonly document: { findUnique(args?: unknown): Promise<unknown> };
  readonly accessPolicy: { findUnique(args?: unknown): Promise<unknown> };
  readonly generatedLink: { create(args?: unknown): Promise<unknown> };
  readonly auditLog: { create(args?: unknown): Promise<unknown> };
  readonly $transaction: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
}
export function asLinkCreatePrisma(
  client: LinkCreatePrismaLike,
): LinkCreatePrisma {
  return client as unknown as LinkCreatePrisma;
}
