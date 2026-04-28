import { NextRequest, NextResponse } from "next/server";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole, resolveRole } from "@/lib/auth-guard";
import { getConfig } from "@/lib/config";
import { ensureUser } from "@/lib/ensure-user";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rate-limit";
import { buildEmbedCode } from "@/lib/link-embed";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Tighter than list (60/30s) — every call re-reveals a bearer token and
// writes a LINK_SHARE_INFO_VIEW audit row. 30/min per user blunts a
// compromised admin session from enumerating every token quickly.
const limiter = createRateLimiter({
  max: 30,
  windowMs: 60_000,
  prefix: "@helpucompli/links-share-info",
});

interface RouteCtx {
  readonly params: Promise<{ id: string }>;
}

interface ShareInfoResponse {
  readonly token: string;
  readonly shareableUrl: string;
  readonly embedCode: string;
  readonly expiresAt: string | null;
}

function json<T>(
  body: { data: T | null; error: string | null },
  status: number,
  extra?: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private", ...extra },
  });
}

// Sec-review: returns the raw bearer token for an existing link so an
// admin can re-copy the shareable URL / iframe snippet after leaving the
// generate-link result page. Guarded by:
//   1. role ≥ admin
//   2. per-user rate-limit (30/min)
//   3. link must be live (not revoked, not expired, not over download cap)
//   4. audit row LINK_SHARE_INFO_VIEW recorded per reveal
export async function GET(req: NextRequest, ctx: RouteCtx) {
  const session = await auth0.getSession();
  if (!session) return json<ShareInfoResponse>({ data: null, error: "Unauthorized" }, 401);
  if (!(await resolveHasRole(session, ["superadmin", "admin"]))) {
    return json<ShareInfoResponse>({ data: null, error: "Forbidden" }, 403);
  }

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return json<ShareInfoResponse>({ data: null, error: "Invalid id" }, 400);
  }

  const sub = (session.user as { sub?: string }).sub;
  if (!sub) return json<ShareInfoResponse>({ data: null, error: "Unauthorized" }, 401);
  const quota = await limiter.limit(`links-share-info:${sub}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return json<ShareInfoResponse>(
      { data: null, error: "Too Many Requests" },
      429,
      { "Retry-After": String(retrySec) },
    );
  }

  const role = await resolveRole(session);
  if (role !== "superadmin" && role !== "admin") {
    return json<ShareInfoResponse>({ data: null, error: "Forbidden" }, 403);
  }
  const dbUser = await ensureUser(prisma, { session, role });

  const link = await prisma.generatedLink.findUnique({
    where: { id },
    select: {
      id: true,
      documentId: true,
      policyId: true,
      presignedUrlHash: true,
      expiresAt: true,
      isRevoked: true,
      downloadCount: true,
      maxDownloads: true,
    },
  });
  if (!link) return json<ShareInfoResponse>({ data: null, error: "Not Found" }, 404);

  // Sec-review: defense-in-depth — do NOT reveal the token for inactive
  // links. An admin who wants to re-share must generate a fresh link.
  const now = new Date();
  const isExpired = link.expiresAt !== null && link.expiresAt <= now;
  const isCapReached =
    link.maxDownloads !== null && link.downloadCount >= link.maxDownloads;
  if (link.isRevoked || isExpired || isCapReached) {
    return json<ShareInfoResponse>({ data: null, error: "Gone" }, 410);
  }

  const origin = getConfig().APP_BASE_URL.replace(/\/+$/, "");
  // Canonical shareable URL points at the embeddable HTML viewer so
  // paste-to-embed flows (Notion / Confluence / WordPress / SharePoint
  // / generic iframes) work on admin-approved domains. Legacy
  // /api/links/<token> still serves a 302 for programmatic clients and
  // already-distributed links — kept unchanged for backward compat.
  const shareableUrl = `${origin}/l/${link.presignedUrlHash}`;
  const embedCode = buildEmbedCode(shareableUrl);

  try {
    await prisma.auditLog.create({
      data: {
        userId: dbUser.id,
        action: "LINK_SHARE_INFO_VIEW",
        targetType: "link",
        targetId: link.id,
        metadata: {
          documentId: link.documentId,
          policyId: link.policyId,
        },
        ipAddress: extractIp(req),
        userAgent: extractUserAgent(req),
      },
    });
  } catch {
    // Audit-write failure: return 500 rather than silently reveal a
    // token without a trail. HIPAA access logging is non-optional.
    return json<ShareInfoResponse>({ data: null, error: "Audit write failed" }, 500);
  }

  return json<ShareInfoResponse>(
    {
      data: {
        token: link.presignedUrlHash,
        shareableUrl,
        embedCode,
        expiresAt: link.expiresAt === null ? null : link.expiresAt.toISOString(),
      },
      error: null,
    },
    200,
  );
}
