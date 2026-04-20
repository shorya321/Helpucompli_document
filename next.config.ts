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
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          // `no-referrer` drops the Origin leak on cross-origin
          // logout → Auth0 navigation (module 04 sec-review MED-3).
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
