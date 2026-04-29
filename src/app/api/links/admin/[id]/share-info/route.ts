import { NextRequest, NextResponse } from "next/server";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
import { auth0 } from "@/lib/auth0";
import { resolveHasRole, resolveRole } from "@/lib/auth-guard";
import { getConfig } from "@/lib/config";
import { ensureUser } from "@/lib/ensure-user";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rate-limit";
import { buildEmbedCode } from "@/lib/link-embed";
import { logAudit, asAuditPrisma } from "@/lib/audit";
import { issueRawFetchToken } from "@/lib/raw-fetch-token";

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
  // Direct image URL for embedding into surfaces that validate
  // Content-Type=image/* on the URL response (Circle.so image-embed
  // slot, Notion image embeds, etc.). Populated only when:
  //   - document MIME starts with `image/`
  //   - link.allowPublicEmbed === true
  // null otherwise. The URL points at /l/<hash>/raw with a longer-
  // lived HMAC raw-fetch token bundled (clamped to link expiry,
  // 7d ceiling for perpetual links). /raw still revalidates auth +
  // policy + revoke + expiry on every fetch, so the longer token is
  // harmless. Sec-review C1: token is minted on-demand (audited),
  // never returned in list responses.
  readonly embedImageUrl: string | null;
}

// TTL ceiling for the raw-fetch token bundled in `embedImageUrl`.
// Matches the og:image token TTL on /l/<hash> so a single embed
// resource has consistent lifetime across the meta-tag and the
// dashboard-copy paths.
const EMBED_IMAGE_TOKEN_DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;
const EMBED_IMAGE_TOKEN_FLOOR_TTL_SEC = 60;

function chooseEmbedImageTokenTtlSec(expiresAt: Date | null): number {
  if (expiresAt === null) return EMBED_IMAGE_TOKEN_DEFAULT_TTL_SEC;
  const remainingSec = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (remainingSec <= 0) return EMBED_IMAGE_TOKEN_FLOOR_TTL_SEC;
  return Math.min(EMBED_IMAGE_TOKEN_DEFAULT_TTL_SEC, remainingSec);
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
      allowPublicEmbed: true,
      document: {
        select: {
          contentType: true,
        },
      },
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

  // embedImageUrl: optional secondary URL that resolves DIRECTLY to
  // image bytes via /raw. Some surfaces (Circle.so image-embed slot)
  // validate URL response Content-Type=image/* and reject the canonical
  // /l/<token> page (text/html). Minted only when the document is an
  // image AND the admin has opted into public embedding — same gate
  // as the og:image meta tag on /l/<token>. /raw still runs full auth
  // + policy + audit on every fetch, so the longer-lived token (clamped
  // to link expiry) cannot outlive the link itself.
  const docContentType =
    (link as { document?: { contentType?: string | null } | null })
      .document?.contentType ?? null;
  const isImage = (docContentType ?? "").toLowerCase().startsWith("image/");
  const embedImageUrl =
    isImage && link.allowPublicEmbed === true
      ? `${origin}/l/${link.presignedUrlHash}/raw?t=${encodeURIComponent(
          issueRawFetchToken(
            link.presignedUrlHash,
            chooseEmbedImageTokenTtlSec(link.expiresAt ?? null),
          ),
        )}`
      : null;

  try {
    await logAudit(asAuditPrisma(prisma), {
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
        embedImageUrl,
      },
      error: null,
    },
    200,
  );
}
