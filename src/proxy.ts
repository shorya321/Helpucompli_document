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

function applyStaticHeaders(headers: Headers): void {
  for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) {
    headers.set(k, v);
  }
}

export async function proxy(request: Request) {
  const cfg = getConfig();
  const nonce = generateNonce();
  const csp = buildCsp(nonce, {
    isDev: cfg.NODE_ENV !== "production",
    awsRegion: cfg.AWS_REGION,
    auth0Domain: cfg.AUTH0_DOMAIN,
  });

  const authRes = await auth0.middleware(request);

  const pathname = new URL(request.url).pathname;

  // /auth/* routes are fully owned by the Auth0 SDK — they do not render
  // downstream Next.js pages, so nonce injection is unnecessary. Still
  // attach CSP + static headers to the response.
  if (pathname.startsWith("/auth/")) {
    authRes.headers.set("Content-Security-Policy", csp);
    applyStaticHeaders(authRes.headers);
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

  response.headers.set("Content-Security-Policy", csp);
  applyStaticHeaders(response.headers);
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
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/health).*)",
  ],
};
