import { auth0 } from "@/lib/auth0";

// Next.js 16 `src/proxy.ts` contract (and Auth0 v4 README) require the
// standard web `Request` type, NOT `NextRequest`. Using `NextRequest`
// here relies on internal Next 15 behaviour and is stricter than the
// Edge runtime will enforce under Next 16.
// Ref: https://github.com/auth0/nextjs-auth0/blob/main/README.md#on-next-js-16
export async function proxy(request: Request) {
  return auth0.middleware(request);
}

// Auth0 proxy matcher. Every request except the listed exclusions is
// funnelled through Auth0 middleware (session check + /auth/* route
// handling). Auth routes like /auth/login, /auth/callback, /auth/logout
// are inside the matched set by design — the SDK owns them.
//
// Exclusions:
//   - _next/static, _next/image — build output and optimized images
//   - favicon.ico — browser chrome
//   - robots.txt, sitemap.xml — SEO assets (public by design)
//   - api/health — liveness probe (must be reachable pre-auth for k8s/LB)
//
// SECURITY: adding a new route to this exclusion list removes it from
// auth. Every addition MUST be reviewed for HIPAA exposure (no PHI,
// no session data, no mutations). Prefer a dedicated public route under
// /api/public/* with its own threat model over broadening this regex.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|api/health).*)",
  ],
};
