import type { NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";
import { ensureUser } from "@/lib/ensure-user";
import { resolveRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asPolicyEnginePrisma,
  enforcePolicy,
  linkDefaultPolicy,
  resolvePolicyOrNull,
  type EffectivePolicy,
} from "@/lib/policy-engine";
import {
  MAX_GET_TTL_SECONDS,
  MIN_TTL_SECONDS,
  presignGetUrl,
} from "@/lib/s3-presign";
import { computeLinkStatus } from "@/lib/link-list";
import { createRateLimiter } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// Shared link access helper. Both the legacy 302 redirect route
// (/api/links/<token>) and the new embeddable HTML viewer
// (/l/<token>) call this. Lifting the logic keeps authorization, audit,
// rate-limit, and counter semantics byte-identical across both paths.
// Never in-line this into a route — one source of truth prevents drift.
// ---------------------------------------------------------------------------

export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;
export const LINK_ABORT_FLOOR_SEC = 30;

// Shared per-token quota. Both routes use the same Redis prefix so an
// attacker cannot get double the quota by alternating paths.
const limiter = createRateLimiter({
  max: 60,
  windowMs: 60_000,
  prefix: "@helpucompli/link-access",
});

export interface LinkAccessDoc {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string | null;
  readonly bucketName: string;
  readonly s3Key: string;
}

export interface LinkAccessOk {
  readonly kind: "ok";
  readonly link: {
    readonly id: string;
    readonly documentId: string;
    readonly policyId: string | null;
    readonly allowPublicEmbed: boolean;
  };
  readonly document: LinkAccessDoc;
  readonly effective: EffectivePolicy;
  readonly presignedUrl: string;
}

export type LinkAccessResult =
  | { readonly kind: "forbidden" }
  | { readonly kind: "rateLimited"; readonly retryAfterSec: number }
  | LinkAccessOk;

function extractIp(req: NextRequest): string {
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

function extractUserAgent(req: NextRequest): string {
  const ua = req.headers.get("user-agent");
  return ua && ua.length > 0 ? ua : "unknown";
}

function effectiveFromStored(
  policy: {
    id?: string;
    linkTtlSeconds: number | null;
    maxDownloads: number | null;
    requireAuth: boolean;
    allowedDomains: string[];
    allowedIpRanges: string[];
  } | null,
): EffectivePolicy | null {
  if (!policy) return null;
  return {
    source: "object",
    policyId: policy.id ?? null,
    linkTtlSeconds: policy.linkTtlSeconds ?? MAX_GET_TTL_SECONDS,
    maxDownloads: policy.maxDownloads,
    requireAuth: policy.requireAuth,
    allowedDomains: policy.allowedDomains,
    allowedIpRanges: policy.allowedIpRanges,
  };
}

async function writeAudit(
  action: "LINK_ACCESS" | "LINK_DENIED",
  link: { id: string; documentId: string; policyId: string | null },
  ctx: {
    ipAddress: string;
    userAgent: string;
    userId: string | null;
    reason?: string;
  },
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        action,
        targetType: "link",
        targetId: link.id,
        metadata: {
          documentId: link.documentId,
          policyId: link.policyId,
          ...(ctx.reason ? { reason: ctx.reason } : {}),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  } catch {
    // Best-effort. Access decision must not block on the audit row.
  }
}

export async function resolveAndAuthorizeLink(
  req: NextRequest,
  hash: string,
): Promise<LinkAccessResult> {
  const ipAddress = extractIp(req);
  const userAgent = extractUserAgent(req);

  if (!LINK_TOKEN_RE.test(hash)) {
    return { kind: "forbidden" };
  }
  const quota = await limiter.limit(`link-access:${hash}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return { kind: "rateLimited", retryAfterSec: retrySec };
  }

  const link = (await prisma.generatedLink.findUnique({
    where: { presignedUrlHash: hash },
    include: {
      document: {
        select: {
          id: true,
          filename: true,
          contentType: true,
          s3Key: true,
          isDeleted: true,
          bucket: { select: { name: true } },
        },
      },
      policy: {
        select: {
          id: true,
          linkTtlSeconds: true,
          maxDownloads: true,
          requireAuth: true,
          allowedDomains: true,
          allowedIpRanges: true,
        },
      },
    },
  })) as
    | (Record<string, unknown> & {
        id: string;
        documentId: string;
        policyId: string | null;
        allowPublicEmbed: boolean;
        document: {
          id: string;
          filename: string;
          contentType: string | null;
          s3Key: string;
          isDeleted: boolean;
          bucket: { name: string };
        } | null;
        policy: {
          id: string;
          linkTtlSeconds: number | null;
          maxDownloads: number | null;
          requireAuth: boolean;
          allowedDomains: string[];
          allowedIpRanges: string[];
        } | null;
      })
    | null;

  if (!link) return { kind: "forbidden" };

  const session = await auth0.getSession();
  let dbUserId: string | null = null;
  if (session) {
    try {
      const role = (await resolveRole(session)) ?? "viewer";
      const dbu = await ensureUser(prisma, { session, role });
      dbUserId = dbu.id;
    } catch {
      dbUserId = null;
    }
  }

  const status = computeLinkStatus({
    isRevoked: link.isRevoked as boolean,
    expiresAt: (link.expiresAt as Date | null) ?? null,
    downloadCount: link.downloadCount as number,
    maxDownloads: (link.maxDownloads as number | null) ?? null,
  });
  if (status !== "active" || !link.document || link.document.isDeleted) {
    await writeAudit(
      "LINK_DENIED",
      {
        id: link.id,
        documentId: link.documentId,
        policyId: link.policyId,
      },
      {
        ipAddress,
        userAgent,
        userId: dbUserId,
        reason: !link.document
          ? "document-missing"
          : link.document.isDeleted
            ? "document-deleted"
            : status,
      },
    );
    return { kind: "forbidden" };
  }

  const effective: EffectivePolicy =
    effectiveFromStored(link.policy) ??
    (await resolvePolicyOrNull(asPolicyEnginePrisma(prisma), {
      bucketName: link.document.bucket.name,
      s3Key: link.document.s3Key,
    })) ??
    linkDefaultPolicy;

  const referer = req.headers.get("referer");
  const decision = enforcePolicy(effective, {
    ipAddress,
    referer,
    isAuthenticated: !!session,
  });

  if (!decision.allow) {
    await writeAudit(
      "LINK_DENIED",
      {
        id: link.id,
        documentId: link.documentId,
        policyId: link.policyId,
      },
      { ipAddress, userAgent, userId: dbUserId, reason: "policy-deny" },
    );
    return { kind: "forbidden" };
  }

  const linkExpiresAt = link.expiresAt as Date | null;
  let remainingSecForClamp: number;
  if (linkExpiresAt === null) {
    remainingSecForClamp = MAX_GET_TTL_SECONDS;
  } else {
    const remainingMs = linkExpiresAt.getTime() - Date.now();
    const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
    if (remainingSec < LINK_ABORT_FLOOR_SEC) {
      await writeAudit(
        "LINK_DENIED",
        { id: link.id, documentId: link.documentId, policyId: link.policyId },
        {
          ipAddress,
          userAgent,
          userId: dbUserId,
          reason: "remaining-ttl-too-low",
        },
      );
      return { kind: "forbidden" };
    }
    remainingSecForClamp = remainingSec;
  }
  const desired = decision.linkTtlSeconds;
  const presignTtl = Math.max(
    MIN_TTL_SECONDS,
    Math.min(desired, remainingSecForClamp, MAX_GET_TTL_SECONDS),
  );

  const cap = link.maxDownloads as number | null;
  const now = new Date();
  const where: Record<string, unknown> = {
    id: link.id,
    isRevoked: false,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
  if (cap !== null) where.downloadCount = { lt: cap };
  const updated = await prisma.generatedLink.updateMany({
    where: where as Parameters<
      typeof prisma.generatedLink.updateMany
    >[0]["where"],
    data: { downloadCount: { increment: 1 } },
  });
  if (updated.count === 0) {
    await writeAudit(
      "LINK_DENIED",
      { id: link.id, documentId: link.documentId, policyId: link.policyId },
      {
        ipAddress,
        userAgent,
        userId: dbUserId,
        reason: "race-lost-or-just-exhausted",
      },
    );
    return { kind: "forbidden" };
  }

  let presignedUrl: string;
  try {
    presignedUrl = await presignGetUrl({
      bucket: link.document.bucket.name,
      key: link.document.s3Key,
      ttlSeconds: presignTtl,
      responseContentDisposition: "inline",
    });
  } catch {
    await prisma.generatedLink
      .update({
        where: { id: link.id },
        data: { downloadCount: { decrement: 1 } },
      })
      .catch(() => {});
    await writeAudit(
      "LINK_DENIED",
      {
        id: link.id,
        documentId: link.documentId,
        policyId: link.policyId,
      },
      { ipAddress, userAgent, userId: dbUserId, reason: "presign-failed" },
    );
    return { kind: "forbidden" };
  }

  await writeAudit(
    "LINK_ACCESS",
    { id: link.id, documentId: link.documentId, policyId: link.policyId },
    { ipAddress, userAgent, userId: dbUserId },
  );

  return {
    kind: "ok",
    link: {
      id: link.id,
      documentId: link.documentId,
      policyId: link.policyId,
      allowPublicEmbed: link.allowPublicEmbed === true,
    },
    document: {
      id: link.document.id,
      filename: link.document.filename,
      contentType: link.document.contentType,
      bucketName: link.document.bucket.name,
      s3Key: link.document.s3Key,
    },
    effective,
    presignedUrl,
  };
}
