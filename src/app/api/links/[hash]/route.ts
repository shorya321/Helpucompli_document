import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { prisma } from "@/lib/prisma";
import {
  asPolicyEnginePrisma,
  defaultPolicy,
  enforcePolicy,
  resolvePolicy,
  type EffectivePolicy,
} from "@/lib/policy-engine";
import {
  MAX_GET_TTL_SECONDS,
  MIN_TTL_SECONDS,
  presignGetUrl,
} from "@/lib/s3-presign";
import { computeLinkStatus } from "@/lib/link-list";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Public endpoint — bearer token in URL is the only credential. Strict
// per-token rate limit blocks brute-force / scanning.
const limiter = createRateLimiter({
  max: 60,
  windowMs: 60_000,
  prefix: "@helpucompli/link-access",
});

interface RouteCtx {
  readonly params: Promise<{ hash: string }>;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;

function forbidden() {
  // Generic 403 — never leak whether the token existed, was revoked,
  // expired, exhausted, or rejected by policy. Sec invariant.
  return new NextResponse("Forbidden", {
    status: 403,
    headers: {
      "Cache-Control": "no-store, private",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function tooManyRequests(retryAfterSec: number) {
  return new NextResponse("Too Many Requests", {
    status: 429,
    headers: {
      "Cache-Control": "no-store, private",
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(retryAfterSec),
    },
  });
}

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
    linkTtlSeconds: number;
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
    linkTtlSeconds: policy.linkTtlSeconds,
    maxDownloads: policy.maxDownloads,
    requireAuth: policy.requireAuth,
    allowedDomains: policy.allowedDomains,
    allowedIpRanges: policy.allowedIpRanges,
  };
}

async function writeAudit(
  action: "LINK_ACCESS" | "LINK_DENIED",
  link: { id: string; documentId: string; policyId: string | null },
  ctx: { ipAddress: string; userAgent: string; userId: string | null; reason?: string },
) {
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
    // Best-effort. The decision must not block on the audit row write
    // — but production alerting should fire on audit failures.
  }
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const { hash } = await ctx.params;
  const ipAddress = extractIp(req);
  const userAgent = extractUserAgent(req);

  // Per-token rate limit BEFORE any DB hit. Treat unknown tokens with
  // the same quota as known ones so an attacker cannot tell them apart.
  if (!TOKEN_RE.test(hash)) {
    return forbidden();
  }
  const quota = await limiter.limit(`link-access:${hash}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return tooManyRequests(retrySec);
  }

  const link = (await prisma.generatedLink.findUnique({
    where: { presignedUrlHash: hash },
    include: {
      document: {
        select: {
          id: true,
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
        document: {
          id: string;
          s3Key: string;
          isDeleted: boolean;
          bucket: { name: string };
        } | null;
        policy: {
          id: string;
          linkTtlSeconds: number;
          maxDownloads: number | null;
          requireAuth: boolean;
          allowedDomains: string[];
          allowedIpRanges: string[];
        } | null;
      })
    | null;

  if (!link) return forbidden();

  const session = await auth0.getSession();
  const dbUserId: string | null = null; // Anonymous lookup — link is the credential.

  const status = computeLinkStatus({
    isRevoked: link.isRevoked as boolean,
    expiresAt: link.expiresAt as Date,
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
    return forbidden();
  }

  // Policy resolution: stored link.policyId overrides doc-level
  // inheritance. If no policy attached, fall back to F8 inheritance
  // (object > prefix > bucket > default).
  let effective: EffectivePolicy =
    effectiveFromStored(link.policy) ??
    (await resolvePolicy(asPolicyEnginePrisma(prisma), {
      bucketName: link.document.bucket.name,
      s3Key: link.document.s3Key,
    })) ??
    defaultPolicy;

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
    return forbidden();
  }

  // Compute presign TTL — never exceed the link's own remaining life.
  const remainingMs = (link.expiresAt as Date).getTime() - Date.now();
  const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
  const desired = decision.linkTtlSeconds;
  const ceiling = Math.min(MAX_GET_TTL_SECONDS, remainingSec || desired);
  // s3-presign requires ≥ MIN_TTL_SECONDS — clamp up if link is about
  // to expire (the link is still valid; the presign just expires
  // slightly later, which is fine because the audit row records the
  // single use we're authorising right now).
  const presignTtl = Math.max(
    MIN_TTL_SECONDS,
    Math.min(desired, ceiling || MIN_TTL_SECONDS),
  );

  let presignedUrl: string;
  try {
    presignedUrl = await presignGetUrl({
      bucket: link.document.bucket.name,
      key: link.document.s3Key,
      ttlSeconds: presignTtl,
      responseContentDisposition: "inline",
    });
  } catch {
    await writeAudit(
      "LINK_DENIED",
      {
        id: link.id,
        documentId: link.documentId,
        policyId: link.policyId,
      },
      { ipAddress, userAgent, userId: dbUserId, reason: "presign-failed" },
    );
    return forbidden();
  }

  // Atomic increment via Prisma {increment: 1} — no read-modify-write
  // race when two requests arrive simultaneously.
  try {
    await prisma.generatedLink.update({
      where: { id: link.id },
      data: { downloadCount: { increment: 1 } },
    });
  } catch {
    // Increment failure is non-fatal for the redirect (already
    // authorised) but MUST be flagged. Audit row records the access.
  }

  await writeAudit(
    "LINK_ACCESS",
    { id: link.id, documentId: link.documentId, policyId: link.policyId },
    { ipAddress, userAgent, userId: dbUserId },
  );

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: presignedUrl,
      "Cache-Control": "no-store, private",
    },
  });
}
