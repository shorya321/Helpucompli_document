import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { LINK_TOKEN_RE } from "@/lib/link-access";
import { computeLinkStatus } from "@/lib/link-list";
import { logAudit, asAuditPrisma } from "@/lib/audit";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Public oEmbed JSON endpoint (https://oembed.com/) advertised via
// `<link rel="alternate" type="application/json+oembed">` on the
// /l/<token> viewer head — but only when the link's `allowPublicEmbed`
// flag is set. Without the flag the discovery tag is not emitted AND
// this endpoint returns 404, so the existence of an unembeddable link
// is never leaked to anonymous callers.
//
// Why is this route public? Third-party platforms (WordPress oEmbed
// proxy, Iframely-backed Circle embeds, Notion, Confluence) call this
// from THEIR server, not the user's browser, so an Auth0 session would
// not be available. Every refusal returns the same 404 shape an
// unknown token would produce.
//
// HIPAA: an authenticated link with `requireAuth = true` returns 404
// even if `allowPublicEmbed` is set — the auth requirement always wins.
// File content itself is never returned by this endpoint; only metadata
// (title, dimensions) and the iframe HTML pointing back to the viewer.

// Every supported file type emits an iframe-bearing oEmbed response —
// `rich` for everything except `video/*` (which uses the `video` type
// so consumer platforms surface video-player UI). The iframe always
// points back at the /l/<token> viewer, which is the one place that
// holds a fresh presigned S3 URL and runs policy + audit on every
// load. We never return `photo` (would require raw image bytes URL,
// but our viewer returns HTML) or `link` (would render a card with no
// inline preview).
interface OembedIframeResponse {
  readonly version: "1.0";
  readonly type: "rich" | "video";
  readonly provider_name: string;
  readonly provider_url: string;
  readonly title: string;
  readonly html: string;
  readonly width: number;
  readonly height: number;
  readonly cache_age?: number;
  readonly thumbnail_url?: string;
}

type OembedResponse = OembedIframeResponse;

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const MIN_DIM = 200;
const MAX_DIM = 4096;

// 60s cache TTL on the response so a busy WordPress site does not hit
// us 100 times for the same URL. Per oEmbed spec recommendation.
const CACHE_AGE_SEC = 300;

const PROVIDER_NAME = "HelpUcompli Documents";

// Modest per-token quota — the endpoint is unauthenticated and read-
// only, but we still cap to blunt enumeration / DoS. Shared limiter
// prefix is intentionally distinct from /l/<token> so a hot embed does
// not steal the viewer's quota.
const limiter = createRateLimiter({
  max: 60,
  windowMs: 60_000,
  prefix: "@helpucompli/oembed",
});

function notFound(): NextResponse {
  // Same 404 body shape as an unknown token would produce. No JSON
  // payload differentiation between "doesn't exist" and "exists but
  // isn't embeddable" — see HIPAA comment in the file header.
  return NextResponse.json(
    { error: "Not Found" },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function badRequest(): NextResponse {
  return NextResponse.json(
    { error: "Bad Request" },
    {
      status: 400,
      headers: {
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function tooManyRequests(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "Too Many Requests" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Retry-After": String(retryAfterSec),
      },
    },
  );
}

function clampDim(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < MIN_DIM) return MIN_DIM;
  if (n > MAX_DIM) return MAX_DIM;
  return n;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function pickType(mime: string | null): "rich" | "video" {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("video/")) return "video";
  // Everything else — PDFs, HTML, text, images, audio, empty/unknown
  // MIMEs — uses `rich` with iframe HTML that loads /l/<token>. The
  // viewer picks the right inline element (<img>, <audio>, <iframe>,
  // …) on every load using a freshly presigned S3 URL. Returning
  // `photo` would require raw image bytes, which we cannot serve
  // from a path that runs policy + audit. Returning `link` would
  // strip the inline preview (consumer renders a plain card).
  return "rich";
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const targetUrl = url.searchParams.get("url");
  const formatParam = url.searchParams.get("format");

  if (!targetUrl) return badRequest();
  if (formatParam !== null && formatParam !== "json") {
    // Per oEmbed spec, providers MAY return 501 for non-JSON formats.
    // The spec is permissive; we keep the surface small.
    return NextResponse.json(
      { error: "Not Implemented" },
      {
        status: 501,
        headers: {
          "Cache-Control": "no-store, private",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  const cfg = getConfig();
  const appBase = cfg.APP_BASE_URL.replace(/\/+$/, "");

  // The url param MUST be one of our own /l/<token> URLs. Anything
  // else 400s — we do NOT proxy oEmbed for arbitrary external URLs.
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return badRequest();
  }
  const expectedOrigin = new URL(appBase).origin;
  if (parsed.origin !== expectedOrigin) return badRequest();
  const tokenMatch = /^\/l\/([A-Za-z0-9_-]{20,128})\/?$/.exec(parsed.pathname);
  if (!tokenMatch) return badRequest();
  const token = tokenMatch[1];
  if (!LINK_TOKEN_RE.test(token)) return badRequest();

  const quota = await limiter.limit(`oembed:${token}`);
  if (!quota.success) {
    const retrySec = Math.max(1, Math.ceil((quota.reset - Date.now()) / 1000));
    return tooManyRequests(retrySec);
  }

  const link = await prisma.generatedLink.findUnique({
    where: { presignedUrlHash: token },
    include: {
      document: {
        select: {
          id: true,
          filename: true,
          contentType: true,
          isDeleted: true,
        },
      },
      policy: {
        select: { requireAuth: true },
      },
    },
  });

  if (!link) return notFound();
  if (!link.document || link.document.isDeleted) return notFound();
  // `allowPublicEmbed` is the SOLE embed-enable signal. Without it,
  // /api/oembed returns 404 — same shape as an unknown token, so no
  // existence of the link is leaked. `policy.allowedDomains` does
  // NOT enable embedding on its own; per F9.3 / F8.7 it gates
  // direct link access strictly. When combined with
  // `allowPublicEmbed=true`, the viewer's CSP `frame-ancestors`
  // narrows the parent hosts to that list.
  if (link.allowPublicEmbed !== true) return notFound();

  const status = computeLinkStatus({
    isRevoked: link.isRevoked,
    expiresAt: link.expiresAt,
    downloadCount: link.downloadCount,
    maxDownloads: link.maxDownloads,
  });
  if (status !== "active") return notFound();

  // requireAuth on an attached policy MUST take precedence over the
  // public-embed flag. Anonymous third-party servers calling oEmbed
  // can never satisfy that check, so do not surface the document.
  if (link.policy?.requireAuth === true) return notFound();

  const width = clampDim(url.searchParams.get("maxwidth"), DEFAULT_WIDTH);
  const height = clampDim(url.searchParams.get("maxheight"), DEFAULT_HEIGHT);
  const title = link.document.filename;
  const titleAttr = escapeAttr(title);
  const titleText = escapeText(title);
  const viewerUrl = `${appBase}/l/${token}`;
  const viewerEsc = escapeAttr(viewerUrl);
  const oembedType = pickType(link.document.contentType);

  // Single iframe-emitting branch. `oembedType` is `"rich"` for every
  // MIME except `video/*`. Both render the same iframe markup; only
  // the oEmbed `type` field differs so consumer platforms can apply
  // any video-specific affordances (player controls, badges).
  const body: OembedResponse = {
    version: "1.0",
    type: oembedType,
    provider_name: PROVIDER_NAME,
    provider_url: appBase,
    title: titleText,
    html: `<iframe src="${viewerEsc}" width="${width}" height="${height}" frameborder="0" allowfullscreen title="${titleAttr}"></iframe>`,
    width,
    height,
    cache_age: CACHE_AGE_SEC,
  };

  // Audit on every successful resolution so admins can see which
  // platforms are calling oEmbed for this token. Best-effort — never
  // block the response on a failed write.
  try {
    await logAudit(asAuditPrisma(prisma), {
      userId: null,
      action: "LINK_OEMBED_FETCHED",
      targetType: "link",
      targetId: link.id,
      metadata: {
        documentId: link.documentId,
        format: "json",
        type: oembedType,
        userAgent: extractUserAgent(req),
        referer: req.headers.get("referer"),
      },
      ipAddress: extractIp(req),
      userAgent: extractUserAgent(req),
    });
  } catch {
    // Best-effort, intentional.
  }

  return NextResponse.json(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${CACHE_AGE_SEC}, s-maxage=${CACHE_AGE_SEC}`,
      "X-Content-Type-Options": "nosniff",
      // Do not advertise X-Frame-Options here — the response is JSON,
      // not framed content. Belt-and-suspenders against future code
      // that might add framing.
      "Referrer-Policy": "no-referrer",
    },
  });
}
