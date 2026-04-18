import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const auth0Domain = process.env.AUTH0_DOMAIN?.trim();
const auth0Origin = auth0Domain ? `https://${auth0Domain}` : "";

// Build CSP once at config time. Script-src intentionally allows
// 'unsafe-inline' for Next.js App Router boot scripts (no nonce pipeline
// yet — carry-forward to F11 middleware). Dev additionally needs
// 'unsafe-eval' for hot reload. connect-src + form-action extend to the
// Auth0 tenant so Universal Login + /oauth/token calls succeed.
function buildCsp(): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": isProd
      ? ["'self'", "'unsafe-inline'"]
      : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(auth0Origin ? [auth0Origin] : [])],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", ...(auth0Origin ? [auth0Origin] : [])],
    "object-src": ["'none'"],
    "upgrade-insecure-requests": [],
  };
  return Object.entries(directives)
    .map(([name, values]) =>
      values.length > 0 ? `${name} ${values.join(" ")}` : name,
    )
    .join("; ");
}

const nextConfig: NextConfig = {
  // Security headers for HIPAA compliance
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            // `no-referrer` drops the Origin leak on cross-origin
            // logout → Auth0 navigation (module 04 sec-review MED-3).
            key: "Referrer-Policy",
            value: "no-referrer",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: buildCsp(),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
