import { randomBytes } from "node:crypto";
import { MAX_GET_TTL_SECONDS } from "@/lib/s3-presign";
import {
  asPolicyEnginePrisma,
  resolvePolicyOrNull,
} from "@/lib/policy-engine";

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

// Raised when the resolved link ends up perpetual (ttlSeconds=null) but
// the caller isn't superadmin. Closes the hole where a null-TTL policy
// would let a regular admin inherit a perpetual link without setting the
// explicit neverExpires=true flag that step 5 already gates.
export class PerpetualLinkForbiddenError extends Error {
  public readonly status = 403;
  constructor() {
    super("Perpetual link requires superadmin");
    this.name = "PerpetualLinkForbiddenError";
  }
}

// 32 random bytes = 256 bits of entropy. base64url encodes to 43 chars
// (no padding) — URL-safe and meets RFC 4648 §5.
export function generateLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

interface PolicyInfo {
  // null = policy permits "never expires" links (superadmin-gated).
  readonly linkTtlSeconds: number | null;
  readonly maxDownloads: number | null;
}

export interface ResolveSettingsInput {
  readonly policy: PolicyInfo | null;
  readonly ttlOverride: number | null;
  readonly maxDownloadsOverride: number | null;
}

export interface ResolvedSettings {
  // null = perpetual link (inherited from a policy with null TTL and no
  // finite override).
  readonly ttlSeconds: number | null;
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
  // Null policy TTL = "no ceiling" on the policy side. Without an
  // override this produces a perpetual link; with one, the override is
  // clamped against the SigV4 ceiling only.
  const policyTtl = input.policy?.linkTtlSeconds ?? null;
  const ceilingTtl =
    input.policy === null
      ? LINK_MAX_TTL_SECONDS
      : (policyTtl ?? LINK_MAX_TTL_SECONDS);
  let ttlSeconds: number | null;
  if (input.ttlOverride !== null) {
    ttlSeconds = clampToRange(
      input.ttlOverride,
      LINK_MIN_TTL_SECONDS,
      ceilingTtl,
    );
  } else if (policyTtl !== null) {
    ttlSeconds = policyTtl;
  } else if (input.policy === null) {
    // No policy + no override → server default TTL (pre-existing behavior).
    ttlSeconds = DEFAULT_TTL;
  } else {
    // Policy present but perpetual + no override → inherit perpetual.
    ttlSeconds = null;
  }

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
  // Superadmin-gated on the API route. When true, link.expiresAt is
  // stored as null and TTL-related inputs are ignored. Link remains
  // bounded by maxDownloads + isRevoked.
  readonly neverExpires?: boolean;
  // Per-link opt-in for iframe embedding on third-party sites. See
  // schema.prisma `allow_public_embed` for the persisted shape and
  // src/app/l/[hash]/route.ts + src/app/api/oembed/route.ts for the
  // two consumers gated on this flag.
  readonly allowPublicEmbed?: boolean;
}

export interface LinkCreateContext {
  readonly userId: string;
  readonly ipAddress: string;
  readonly userAgent: string;
  // Caller's role. Defaults to undefined for backwards-compat with
  // existing tests — when undefined the perpetual-link check is
  // skipped. Production callers MUST pass it so the superadmin gate
  // is enforced end-to-end.
  readonly callerRole?: "superadmin" | "admin" | "viewer";
}

export interface LinkCreateResult {
  readonly id: string;
  readonly token: string;
  // null = never expires (superadmin-gated). Still bounded by
  // maxDownloads + revoke.
  readonly expiresAt: Date | null;
  readonly ttlSeconds: number | null;
  readonly maxDownloads: number | null;
  readonly allowPublicEmbed: boolean;
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
    findMany: (args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }) => Promise<Array<Record<string, unknown>>>;
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
      select: {
        id: true,
        isDeleted: true,
        s3Key: true,
        bucket: { select: { name: true } },
      },
    });
    if (!doc || doc.isDeleted === true) {
      throw new DocumentNotFoundError(input.documentId);
    }

    let policy: PolicyInfo | null = null;
    let resolvedPolicyId: string | null = input.policyId;
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
    } else {
      // Inheritance fallback. Mirrors /api/policies/effective so the
      // generate-link banner preview and the persisted snapshot agree.
      // Without this, a bucket/prefix policy with maxDownloads set never
      // reaches the link row when the form is submitted with the default
      // "Use inherited policy" option (policyId=null).
      const bucketName = (doc.bucket as { name: string } | undefined)?.name;
      const s3Key = doc.s3Key as string | undefined;
      if (bucketName && typeof s3Key === "string") {
        const resolved = await resolvePolicyOrNull(asPolicyEnginePrisma(tx), {
          bucketName,
          s3Key,
        });
        if (resolved) {
          policy = {
            linkTtlSeconds: resolved.linkTtlSeconds,
            maxDownloads: resolved.maxDownloads,
          };
          resolvedPolicyId = resolved.policyId;
        }
      }
    }

    // neverExpires short-circuits TTL resolution entirely — policy TTL
    // and per-request override are both ignored. maxDownloads precedence
    // still applies so compliance can cap downloads on a perpetual link.
    const neverExpires = input.neverExpires === true;
    let ttlSeconds: number | null;
    let maxDownloads: number | null;
    if (neverExpires) {
      ttlSeconds = null;
      const resolvedForCap = resolveEffectiveSettings({
        policy,
        ttlOverride: null,
        maxDownloadsOverride: input.maxDownloadsOverride,
      });
      maxDownloads = resolvedForCap.maxDownloads;
    } else {
      const resolved = resolveEffectiveSettings({
        policy,
        ttlOverride: input.ttlSecondsOverride,
        maxDownloadsOverride: input.maxDownloadsOverride,
      });
      ttlSeconds = resolved.ttlSeconds;
      maxDownloads = resolved.maxDownloads;
    }

    // Closes the null-TTL-policy hole: if the caller is not superadmin
    // and the resolved TTL is perpetual, reject. Must run AFTER resolve
    // (policy inheritance can make a finite-override intent resolve
    // perpetual).
    if (
      ttlSeconds === null &&
      ctx.callerRole !== undefined &&
      ctx.callerRole !== "superadmin"
    ) {
      throw new PerpetualLinkForbiddenError();
    }

    const token = generateLinkToken();
    const expiresAt: Date | null =
      ttlSeconds === null ? null : new Date(Date.now() + ttlSeconds * 1000);
    const allowPublicEmbed = input.allowPublicEmbed === true;

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
        allowPublicEmbed,
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
          // Resolved id includes the inherited bucket/prefix/object
          // policy applied when policyId was not explicit. Equals
          // policyId for explicit selection. null only when no policy
          // matched at all (default policy).
          resolvedPolicyId,
          ttlSeconds,
          maxDownloads,
          expiresAt: expiresAt === null ? null : expiresAt.toISOString(),
          neverExpires,
          allowPublicEmbed,
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
      allowPublicEmbed,
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
