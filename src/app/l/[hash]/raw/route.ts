import { NextRequest, NextResponse } from "next/server";
import { resolveAndAuthorizeLink } from "@/lib/link-access";
import {
  InvalidRawFetchTokenError,
  verifyRawFetchToken,
} from "@/lib/raw-fetch-token";

export const dynamic = "force-dynamic";

// Same-origin streaming proxy for the embeddable viewer at /l/[hash].
// The viewer's <img> / <video> / <audio> / <iframe> all point here so
// every file type loads from the app origin (no S3 host in the DOM).
//
// Why a proxy:
//   1. Chrome's built-in PDF viewer refuses to render PDFs delivered
//      from a cross-origin URL inside an iframe ("This page has been
//      blocked by Chrome"). Same-origin delivery sidesteps that.
//   2. The presigned S3 URL never reaches the browser, so it can't be
//      copied out of the DOM and replayed until TTL expires.
//   3. Uniform Content-Type / Content-Disposition / Range handling
//      across every file type, regardless of how the object was
//      uploaded to S3.
//
// What is unchanged:
//   - resolveAndAuthorizeLink runs the same auth, audit, rate-limit,
//     policy-engine, public-embed bypass, and Sec-Fetch-Dest
//     discriminator that /l/[hash] already runs. No new policy
//     surface is introduced here.

interface RouteCtx {
  readonly params: Promise<{ hash: string }>;
}

// `etag` and `last-modified` deliberately NOT forwarded. With them
// present, well-behaved intermediaries (Iframely / Circle / WP unfurl
// CDNs) may issue conditional GETs and serve stale 304s past link
// expiry — surfacing as "expired link still works on embed". Stripping
// the validators leaves `Cache-Control: no-store, no-cache,
// must-revalidate` (set below) as the sole caching directive, which
// conformant proxies treat as terminal. Range seeking is unaffected
// (Content-Range stays in passthrough).
const PASSTHROUGH_HEADERS = [
  "content-length",
  "accept-ranges",
  "content-range",
] as const;

// Build an RFC 5987 / RFC 6266 `Content-Disposition: inline` header.
// `filename=` carries an ASCII-only fallback for legacy clients.
// `filename*=UTF-8''…` carries the unicode-correct value for modern
// clients. Quote characters and backslashes are stripped from the
// fallback because they are unsafe inside a quoted-string token.
function buildContentDisposition(filename: string): string {
  // Strip anything outside printable ASCII for the legacy fallback.
  // eslint-disable-next-line no-control-regex
  const NON_PRINTABLE_ASCII = /[^\x20-\x7E]/g;
  const ascii = filename.replace(NON_PRINTABLE_ASCII, "_").replace(/["\\]/g, "_");
  // RFC 5987 attr-char: encodeURIComponent leaves `'`, `(`, `)`, `*`
  // alone, but those are not in attr-char and must be percent-encoded.
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// `Access-Control-Allow-Origin: *` lets the bundled PDF.js viewer fetch
// the PDF stream when it runs inside a third-party `<iframe sandbox>`
// (WordPress / Notion / Confluence). Sandboxed iframes have
// `Origin: null`, so even a same-host fetch is treated as cross-origin
// by the browser and requires an ACAO header. Wildcard is safe here:
// `resolveAndAuthorizeLink` runs full auth + policy + publicEmbedBypass
// + Sec-Fetch-Dest + audit + rate-limit before any bytes stream, and
// the unguessable hash in the URL is the bearer token. We must NOT
// emit `Access-Control-Allow-Credentials: true` (incompatible with `*`),
// and the viewer is updated to fetch without `withCredentials`.
function forbidden(): NextResponse {
  return new NextResponse(null, {
    status: 403,
    headers: {
      "Cache-Control":
        "private, no-store, no-cache, max-age=0, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function tooManyRequests(retryAfterSec: number): NextResponse {
  return new NextResponse(null, {
    status: 429,
    headers: {
      "Cache-Control":
        "private, no-store, no-cache, max-age=0, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "Retry-After": String(retryAfterSec),
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function GET(
  req: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  const { hash } = await ctx.params;

  // Optional raw-fetch token. Two kinds:
  //
  //   - "sub-fetch" — minted by the outer /l/[hash] viewer page AFTER
  //     it passed the publicEmbed referer-refinement check. Browser
  //     sub-resource fetches from the viewer ride this; we treat them
  //     as already-authorized and skip ONLY the refinement gate
  //     (`requireAuth`, `allowedIpRanges`, audit, rate-limit
  //     unaffected).
  //
  //   - "external-embed" — minted by surfaces that emit a long-lived
  //     externally-pasted media URL (og:image, og:video, oEmbed
  //     `type:photo`, dashboard "Image URL" copy). No prior browser
  //     referer was validated.
  //
  //     Sec-Fetch-Dest carve-out: cross-platform embed proxies
  //     (Iframely, Embedly, Compass video player) inline a bare
  //     <video> / <audio> element pointing at our og:video / og:audio
  //     URL. The browser fetches /raw with `Sec-Fetch-Dest=video|audio`,
  //     but the immediate Referer is the proxy host (cdn.iframe.ly),
  //     not the user-facing parent admins listed in
  //     `policy.allowedDomains` — refinement therefore denies even
  //     legitimate plays. The HMAC raw-fetch token is hash-bound,
  //     7-day TTL, and revocable via link revoke + expiresAt; combined
  //     with audit it is the authoritative gate for these media sub-
  //     resources. So when the token is `external-embed` AND
  //     `Sec-Fetch-Dest` is `video` or `audio`, we skip the refinement
  //     gate just like a `sub-fetch` token would. `Sec-Fetch-Dest=image`
  //     still hits strict refinement (F9.10 / 7e84fb7 invariant) — bare
  //     <img> embeds preserve Referer end-to-end so the F9.10 strict
  //     check is reliable; image-only widening is unnecessary and would
  //     reduce defense in depth.
  //
  // Missing or invalid token: fall through to normal policy
  // enforcement unchanged. See raw-fetch-token.ts.
  const rawFetchToken = req.nextUrl.searchParams.get("t");
  let bypassRefererRefinement = false;
  let tokenKind: "sub-fetch" | "external-embed" | null = null;
  if (rawFetchToken !== null) {
    try {
      const verified = verifyRawFetchToken(rawFetchToken, hash);
      tokenKind = verified.kind;
      if (verified.kind === "sub-fetch") {
        bypassRefererRefinement = true;
      } else if (verified.kind === "external-embed") {
        const dest = req.headers.get("sec-fetch-dest");
        if (dest === "video" || dest === "audio") {
          bypassRefererRefinement = true;
        }
      }
    } catch (err) {
      if (!(err instanceof InvalidRawFetchTokenError)) {
        throw err;
      }
      // Tampered / expired / wrong-hash / unknown-kind tokens are
      // silently ignored — the request still goes through normal
      // policy enforcement.
    }
  }
  const result = await resolveAndAuthorizeLink(req, hash, {
    bypassRefererRefinement,
    tokenKind,
    // /raw serves bytes for an already-rendered parent (inline
    // viewer image, Iframely media sub-resource, og:image fetch).
    // Suppress counter increment here; the parent /l/<hash> hit is
    // the canonical "view" event for the dashboard.
    isSubResource: true,
  });

  if (result.kind === "forbidden") return forbidden();
  if (result.kind === "rateLimited") {
    return tooManyRequests(result.retryAfterSec);
  }

  const { document, presignedUrl } = result;

  // Forward Range so Chrome's PDF viewer and HTML5 <video> seek work
  // on large objects. S3 supports Range natively; we proxy whatever
  // status it returns (200 or 206).
  const range = req.headers.get("range");
  const upstreamHeaders: Record<string, string> = {};
  if (range) upstreamHeaders["Range"] = range;

  let upstream: Response;
  try {
    upstream = await fetch(presignedUrl, { headers: upstreamHeaders });
  } catch {
    return new NextResponse(null, {
      status: 502,
      headers: { "Cache-Control": "no-store, private" },
    });
  }

  if (!upstream.ok && upstream.status !== 206) {
    // S3 hands back 403 (presign expired/mismatched) or 404 (object
    // gone). Translate into our forbidden response so the viewer
    // surfaces a uniform error.
    return forbidden();
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    document.contentType ?? "application/octet-stream",
  );
  headers.set("Content-Disposition", buildContentDisposition(document.filename));
  // Belt-and-suspenders against external CDN caches (Iframely, Circle,
  // WP unfurl) that previously kept serving bytes after link expiry.
  // `no-store` forbids storage; `no-cache` forces revalidation;
  // `must-revalidate` blocks stale-on-error fallback. Pragma + Expires
  // cover HTTP/1.0 / legacy proxies. With etag/last-modified stripped
  // above, there is no validator to revalidate against — every fetch
  // re-hits this route and re-runs `resolveAndAuthorizeLink`.
  headers.set(
    "Cache-Control",
    "private, no-store, no-cache, max-age=0, must-revalidate",
  );
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Access-Control-Allow-Origin", "*");

  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
