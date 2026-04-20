// Centralized Content Security Policy + static security headers.
// Pairs with src/proxy.ts (per-request nonce injection) and
// next.config.ts (static headers via `async headers()`).
//
// HIPAA Technical Safeguard 164.312(e)(1) — Transmission Security.
// Reference: Next.js 16 CSP guide
// https://nextjs.org/docs/app/guides/content-security-policy

export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  // 2 years, preload-eligible. Required for HIPAA transmission security.
  "Strict-Transport-Security":
    "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  // Defense-in-depth with CSP frame-ancestors 'none'.
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  // `no-referrer` drops the Origin leak on cross-origin logout → Auth0
  // navigation (module 04 sec-review MED-3).
  "Referrer-Policy": "no-referrer",
};

export interface CspOptions {
  isDev: boolean;
  awsRegion?: string;
  auth0Domain?: string;
}

/**
 * Base64-encoded 128-bit random nonce. Unique per request —
 * never reused. Consumed by Next.js renderer via the request-side
 * Content-Security-Policy header (see proxy.ts).
 */
export function generateNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * Build a strict nonce-based CSP header value.
 *
 * Script-src uses `'strict-dynamic'` + nonce → third-party scripts that
 * the nonce'd bootstrap loads inherit trust transitively. This removes
 * the need for `'unsafe-inline'` in production.
 *
 * Dev adds `'unsafe-eval'` — React uses `eval` for enhanced error stacks
 * in development only. Production React does not.
 */
export function buildCsp(nonce: string, opts: CspOptions): string {
  const { isDev, awsRegion = "us-east-1", auth0Domain } = opts;
  const auth0Origin = auth0Domain ? `https://${auth0Domain}` : "";
  const s3UploadOrigin = `https://*.s3.${awsRegion}.amazonaws.com`;

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Style nonce + 'unsafe-inline': CSP3-compliant browsers honor the
    // nonce and ignore 'unsafe-inline'; CSP2 browsers fall back. Required
    // because Tailwind / shadcn inject inline <style> tags that cannot
    // always receive a nonce via the Next.js pipeline.
    "style-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'unsafe-inline'",
    ],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(auth0Origin ? [auth0Origin] : []),
      s3UploadOrigin,
    ],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'self'", s3UploadOrigin],
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
