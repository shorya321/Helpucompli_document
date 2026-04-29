import { NextRequest, NextResponse } from "next/server";
import { extractIp, extractUserAgent } from "@/lib/request-headers";
import { getConfig } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { LINK_TOKEN_RE } from "@/lib/link-access";
import { computeLinkStatus } from "@/lib/link-list";
import { logAudit, asAuditPrisma } from "@/lib/audit";
import { createRateLimiter } from "@/lib/rate-limit";
import { issueRawFetchToken } from "@/lib/raw-fetch-token";

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

// Two response shapes:
//
// 1. Iframe-bearing (`rich` / `video`) — the iframe points back at the
//    /l/<token> viewer, which holds a fresh presigned S3 URL and runs
//    policy + audit on every load. Used for PDF / HTML / TXT / audio /
//    unknown MIME (`rich`) and `video/*` (`video`).
//
// 2. Photo (`photo`) — `image/*` only. The oEmbed spec mandates that
//    `url` resolve to **raw image bytes** (image/png, image/jpeg, …),
//    NOT to text/html. We point `url` at the same-origin streaming
//    proxy at /l/<hash>/raw which DOES serve image bytes with the
//    correct Content-Type and runs the same auth + policy + audit as
//    the viewer. A long-lived HMAC raw-fetch token rides on the URL
//    so the proxy treats the request as an already-authorized
//    sub-fetch (matching the bypass the viewer page already uses for
//    its own <img>/<video>/<audio> sub-resource loads).
//
// Why `photo` matters: Iframely-backed embed surfaces (Circle.so,
// Notion's "image" embed slot, etc.) reject `rich`-typed images with
// "embed a different image"-class errors because they expect either a
// direct image MIME on the URL OR oEmbed `type: photo`. WordPress
// already accepts both via Open Graph fallback, so the rich → photo
// switch is forward-compatible there.
//
// We never return `link` (would render a card with no inline preview).
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

interface OembedPhotoResponse {
  readonly version: "1.0";
  readonly type: "photo";
  readonly provider_name: string;
  readonly provider_url: string;
  readonly title: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly cache_age?: number;
}

type OembedResponse = OembedIframeResponse | OembedPhotoResponse;

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const MIN_DIM = 200;
const MAX_DIM = 4096;

// 60s cache TTL on the response so a busy WordPress site does not hit
// us 100 times for the same URL. Per oEmbed spec recommendation.
const CACHE_AGE_SEC = 300;

// TTL for the HMAC raw-fetch token embedded in `photo.url`. Iframely +
// WordPress media caches retain image URLs well beyond `cache_age`, so
// the token must outlive the consumer-side cache. We clamp to the
// link's remaining lifetime when set; perpetual links use the SigV4 7d
// ceiling. The /raw route still revalidates auth + policy + revoke +
// expiry on every fetch — the token only bypasses the publicEmbed
// referer-refinement gate, identical to the viewer's existing 120 s
// sub-fetch token. So a leaked token cannot outlive the link itself.
const PHOTO_TOKEN_DEFAULT_TTL_SEC = 7 * 24 * 60 * 60; // 7 days
const PHOTO_TOKEN_FLOOR_TTL_SEC = 60; // align with raw-fetch-token min sanity

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

function pickType(mime: string | null): "rich" | "video" | "photo" {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("video/")) return "video";
  // `image/*` → `photo`. The `url` field MUST resolve to raw image
  // bytes (oEmbed spec) — we point it at /l/<hash>/raw which streams
  // bytes with the correct Content-Type. Without this branch,
  // Iframely-backed embed surfaces (Circle.so, Notion image-embed
  // slot) reject the URL with "embed a different image" because
  // their consumer rejects `type: rich` + iframe HTML for an image
  // slot.
  if (m.startsWith("image/")) return "photo";
  // Everything else — PDFs, HTML, text, audio, empty/unknown MIMEs —
  // uses `rich` with iframe HTML that loads /l/<token>. The viewer
  // picks the right inline element (<audio>, <iframe>, …) on every
  // load using a freshly presigned S3 URL. Returning `link` would
  // strip the inline preview (consumer renders a plain card).
  return "rich";
}

// Choose the raw-fetch token TTL bundled into `photo.url`. Clamps to
// the link's remaining lifetime so a token cannot survive past link
// expiry. Perpetual links (`expiresAt === null`) use the configured
// default (7d). Floor enforces the underlying issuer's positive-ttl
// invariant for edge cases (already-near-expiry links).
function choosePhotoTokenTtlSec(expiresAt: Date | null): number {
  if (expiresAt === null) return PHOTO_TOKEN_DEFAULT_TTL_SEC;
  const remainingSec = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (remainingSec <= 0) return PHOTO_TOKEN_FLOOR_TTL_SEC;
  return Math.min(PHOTO_TOKEN_DEFAULT_TTL_SEC, remainingSec);
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

  // Two branches:
  //   - `photo`: image MIME — `url` MUST resolve to raw image bytes.
  //     We point at /l/<hash>/raw with a long-lived HMAC raw-fetch
  //     token bundled. /raw runs the same auth + policy + audit as
  //     the viewer and serves bytes with the correct image/* MIME.
  //   - `rich`/`video`: iframe back at the viewer. Unchanged shape.
  let body: OembedResponse;
  if (oembedType === "photo") {
    const tokenTtl = choosePhotoTokenTtlSec(
      (link.expiresAt as Date | null) ?? null,
    );
    const rawFetchToken = issueRawFetchToken(token, tokenTtl, "external-embed");
    const photoUrl = `${appBase}/l/${token}/raw?t=${encodeURIComponent(rawFetchToken)}`;
    body = {
      version: "1.0",
      type: "photo",
      provider_name: PROVIDER_NAME,
      provider_url: appBase,
      title: titleText,
      url: photoUrl,
      width,
      height,
      cache_age: CACHE_AGE_SEC,
    };
  } else {
    body = {
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
  }

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
