import type { NextConfig } from "next";

// Static security headers are applied here (every Next response, incl.
// static assets excluded from proxy.ts matcher). The dynamic,
// nonce-bearing Content-Security-Policy is set per-request in
// src/proxy.ts — do NOT duplicate CSP here or the static value would
// override the per-request nonce.
//
// Reference: next.config.ts `async headers()` applies to every response
// emitted by Next, including static files under /_next/static.
const nextConfig: NextConfig = {
  // Emit a self-contained production bundle (server.js + .next/standalone
  // + trimmed node_modules) so the Docker image copies only what it
  // needs to run. Required for the Coolify Dockerfile deploy path.
  // Docs: https://nextjs.org/docs/app/api-reference/next-config-js/output
  output: "standalone",
  async headers() {
    // Headers shared by every response (including the embeddable link
    // viewer). HSTS, XCTO, XSSP, Referrer-Policy do not affect framing
    // and must be applied globally.
    const commonHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-XSS-Protection", value: "1; mode=block" },
      // `no-referrer` drops the Origin leak on cross-origin
      // logout → Auth0 navigation (module 04 sec-review MED-3).
      { key: "Referrer-Policy", value: "no-referrer" },
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },
    ];
    return [
      {
        // Every path EXCEPT the shareable-link viewer and the bundled
        // PDF.js asset directory keeps the strict `X-Frame-Options:
        // DENY`. The viewer at /l/<token> emits its own policy-driven
        // CSP `frame-ancestors <allowedDomains>` so embed platforms
        // can iframe the document on admin-approved domains only.
        // Empty `allowedDomains` still falls back to `frame-ancestors
        // 'none'` inside the viewer. /pdfjs/* serves the static PDF.js
        // canvas viewer that the link viewer iframes for application/pdf
        // — it must be embeddable as a same-origin sub-resource of the
        // viewer page.
        source: "/((?!l/|pdfjs/).*)",
        headers: [
          ...commonHeaders,
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        // Link viewer: same common headers, no X-Frame-Options (CSP
        // frame-ancestors from the route handler is authoritative).
        source: "/l/:path*",
        headers: commonHeaders,
      },
      {
        // PDF.js viewer assets: same common headers, no X-Frame-Options
        // so the link viewer can iframe /pdfjs/viewer.html. Access is
        // gated upstream — the only sensitive byte source the viewer
        // can fetch is /l/<hash>/raw, which still runs full auth +
        // policy + audit + rate-limit via resolveAndAuthorizeLink.
        source: "/pdfjs/:path*",
        headers: commonHeaders,
      },
    ];
  },
};

export default nextConfig;
