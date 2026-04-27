import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import { getConfig } from "@/lib/config";
import {
  STATIC_SECURITY_HEADERS,
  buildCsp,
  generateNonce,
} from "@/lib/security-headers";

// Next.js 16 `src/proxy.ts` contract (and Auth0 v4 README) require the
// standard web `Request` type, NOT `NextRequest`.
// Ref: https://github.com/auth0/nextjs-auth0/blob/main/README.md#on-next-js-16

// The embeddable link viewer at /l/<token> owns its own frame-ancestors
// CSP (derived from the policy's allowedDomains at request time). The
// same-origin asset proxy at /l/<token>/raw must also be embeddable —
// the viewer's inner <img>/<video>/<audio>/<iframe> all load from it,
// and an iframe-loaded PDF response with `X-Frame-Options: DENY` or
// `frame-ancestors 'none'` is blocked by the browser even when same-
// origin. For both paths we skip the static `X-Frame-Options: DENY`
// and omit the middleware CSP's `frame-ancestors 'none'` so the
// viewer's response headers (and the proxy's same-origin delivery)
// aren't double-blocked. Every other path keeps the strict default.
// `<img>` / `<video>` / `<audio>` ignore X-Frame-Options and
// frame-ancestors regardless, so this change has no effect on the
// image / video / audio embed flows.
// Token shape must match LINK_TOKEN_RE in src/lib/link-access.ts.
const LINK_VIEWER_PATH_RE =
  /^\/l\/[A-Za-z0-9_-]{20,128}(?:\/raw)?\/?$/;

function isLinkViewerPath(pathname: string): boolean {
  return LINK_VIEWER_PATH_RE.test(pathname);
}

function applyStaticHeaders(
  headers: Headers,
  opts?: { skipFrameOptions?: boolean },
): void {
  for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) {
    if (opts?.skipFrameOptions && k.toLowerCase() === "x-frame-options") {
      continue;
    }
    headers.set(k, v);
  }
}

export async function proxy(request: Request) {
  const cfg = getConfig();
  const nonce = generateNonce();
  const pathname = new URL(request.url).pathname;
  const isLinkViewer = isLinkViewerPath(pathname);
  const csp = buildCsp(nonce, {
    isDev: cfg.NODE_ENV !== "production",
    awsRegion: cfg.AWS_REGION,
    auth0Domain: cfg.AUTH0_DOMAIN,
    // Viewer response sets its own frame-ancestors (policy-driven) —
    // omit here to avoid emitting two conflicting directives.
    omitFrameAncestors: isLinkViewer,
  });

  const authRes = await auth0.middleware(request);

  // /auth/* routes are fully owned by the Auth0 SDK — they do not render
  // downstream Next.js pages, so nonce injection is unnecessary. Still
  // attach CSP + static headers to the response.
  if (pathname.startsWith("/auth/")) {
    if (!isLinkViewer) {
      authRes.headers.set("Content-Security-Policy", csp);
    }
    applyStaticHeaders(authRes.headers, { skipFrameOptions: isLinkViewer });
    return authRes;
  }

  // App + API routes: rebuild the response so the downstream Next.js
  // renderer sees the nonce in the request headers. Next parses the
  // request CSP header and auto-applies the nonce to framework scripts.
  // Ref: https://nextjs.org/docs/app/guides/content-security-policy#how-nonces-work-in-next-js
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Propagate Auth0 response headers (set-cookie, session writes) onto
  // our CSP-enhanced response. Skip middleware-directive headers that
  // NextResponse.next already controls.
  //
  // Per Auth0 v4 docs on combining middleware — copying x-middleware-next
  // from authRes could force Next to forward a request we intended to
  // block, so always skip it.
  for (const [key, value] of authRes.headers) {
    const lower = key.toLowerCase();
    if (lower === "x-middleware-next") continue;
    if (lower === "x-middleware-override-headers") continue;
    response.headers.set(key, value);
  }

  // Link viewer owns its own CSP (policy-driven frame-ancestors). Letting
  // the middleware set a second CSP header would either override the
  // viewer's directive (`.set` semantics on a shared Headers object) or
  // force an intersection that never permits framing. Either way the
  // embed breaks. Skip here and let the /l/<token> handler be sole CSP
  // author for its responses.
  if (!isLinkViewer) {
    response.headers.set("Content-Security-Policy", csp);
  }
  applyStaticHeaders(response.headers, { skipFrameOptions: isLinkViewer });
  return response;
}

// Auth0 proxy matcher. Every request except the listed exclusions is
// funnelled through Auth0 middleware (session check + /auth/* route
// handling) and the CSP nonce injector.
//
// Exclusions:
//   - _next/static, _next/image — build output and optimized images
//   - favicon.ico — browser chrome
//   - robots.txt, sitemap.xml — SEO assets (public by design)
//   - api/health — liveness probe (must be reachable pre-auth for k8s/LB)
//
// SECURITY: adding a new route to this exclusion list removes it from
// auth AND from CSP enforcement. Every addition MUST be reviewed for
// HIPAA exposure (no PHI, no session data, no mutations). Prefer a
// dedicated public route under /api/public/* with its own threat model
// over broadening this regex.
export const config = {
  matcher: [
    // `pdfjs` is excluded so the static PDF.js viewer.html and runtime
    // .mjs files at /pdfjs/* serve without the strict app CSP. The
    // viewer is loaded by the embeddable link viewer at /l/<token> and
    // is itself static — auth on the rendered PDF runs at /l/<token>/raw,
    // which the viewer fetches and which DOES go through this middleware.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/health|pdfjs).*)",
  ],
};
