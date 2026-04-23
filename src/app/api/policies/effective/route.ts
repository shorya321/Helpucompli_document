import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  asPolicyEnginePrisma,
  linkDefaultPolicy,
  resolvePolicyOrNull,
  type EffectivePolicy,
} from "@/lib/policy-engine";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ApiResponse } from "@/types";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({
  max: 60,
  windowMs: 30_000,
  prefix: "@helpucompli/policies-effective",
});

// Matches link access semantics: when no AccessPolicy row matches, the
// link would fall through to linkDefaultPolicy (anonymous, 15-min TTL).
// This preview endpoint mirrors that exact chain so the form shows what
// the recipient will actually experience.
export type EffectivePolicySource = EffectivePolicy["source"] | "none";

export interface EffectivePolicyPreview {
  readonly source: EffectivePolicySource;
  readonly policyId: string | null;
  readonly linkTtlSeconds: number;
  readonly maxDownloads: number | null;
  readonly requireAuth: boolean;
  readonly allowedDomains: readonly string[];
  readonly allowedIpRanges: readonly string[];
}

type Resp = ApiResponse<EffectivePolicyPreview>;

function json(body: Resp, status: number, extra?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<NextResponse<Resp>> {
  const session = await auth0.getSession();
  if (!session) return json({ data: null, error: "Unauthorized" }, 401);
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json({ data: null, error: "Forbidden" }, 403);
  }

  const sub = (session.user as { sub?: string }).sub;
  if (!sub) return json({ data: null, error: "Unauthorized" }, 401);
  const quota = await limiter.limit(`policies-effective:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json({ data: null, error: "Too Many Requests" }, 429, {
      "Retry-After": String(retrySec),
    });
  }

  const documentId = req.nextUrl.searchParams.get("documentId");
  if (!documentId || !UUID_RE.test(documentId)) {
    return json({ data: null, error: "Invalid documentId" }, 400);
  }

  try {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, isDeleted: false },
      select: {
        s3Key: true,
        bucket: { select: { name: true } },
      },
    });
    if (!doc) return json({ data: null, error: "Not Found" }, 404);

    const resolved = await resolvePolicyOrNull(asPolicyEnginePrisma(prisma), {
      bucketName: doc.bucket.name,
      s3Key: doc.s3Key,
    });

    // Preview semantics mirror src/app/api/links/[hash]/route.ts:241-247.
    // null → linkDefaultPolicy. Caller relies on this to render the
    // "anonymous allowed" state when no inherited policy exists.
    const preview: EffectivePolicyPreview = resolved
      ? {
          source: resolved.source,
          policyId: resolved.policyId,
          linkTtlSeconds: resolved.linkTtlSeconds,
          maxDownloads: resolved.maxDownloads,
          requireAuth: resolved.requireAuth,
          allowedDomains: resolved.allowedDomains,
          allowedIpRanges: resolved.allowedIpRanges,
        }
      : {
          source: "none",
          policyId: null,
          linkTtlSeconds: linkDefaultPolicy.linkTtlSeconds,
          maxDownloads: linkDefaultPolicy.maxDownloads,
          requireAuth: linkDefaultPolicy.requireAuth,
          allowedDomains: linkDefaultPolicy.allowedDomains,
          allowedIpRanges: linkDefaultPolicy.allowedIpRanges,
        };

    return json({ data: preview, error: null }, 200);
  } catch {
    return json({ data: null, error: "Failed to resolve policy" }, 500);
  }
}
