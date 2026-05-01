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
  // When true, omit the `frame-ancestors` directive from the emitted
  // CSP so a downstream response handler can set its own policy-driven
  // frame-ancestors value without collision. Used by the embeddable
  // link viewer (/l/<token>) — every other caller leaves this false so
  // the strict `'none'` default stands.
  omitFrameAncestors?: boolean;
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
  const { isDev, awsRegion = "us-east-1", auth0Domain, omitFrameAncestors } =
    opts;
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
    // Style-src intentionally uses 'unsafe-inline' without a nonce.
    // CSP3 browsers ignore 'unsafe-inline' when a nonce is present, so
    // mixing both would silently block every inline `style="…"` attribute
    // on <div>/<h1>/etc — React renders style props as attributes, and
    // Next.js's error page uses `dangerouslySetInnerHTML` <style> tags,
    // neither of which receive a nonce. Scripts stay strict (nonce +
    // strict-dynamic); stylesheet-level XSS has far narrower exploit
    // surface than inline script injection.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    // <video> / <audio> sources for inline document preview. S3 presigned
    // GETs come from the regional bucket origin; without an explicit
    // media-src, browsers fall back to default-src 'self' and silently
    // refuse to decode the stream.
    "media-src": ["'self'", "blob:", s3UploadOrigin],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...(auth0Origin ? [auth0Origin] : []),
      s3UploadOrigin,
    ],
    ...(omitFrameAncestors ? {} : { "frame-ancestors": ["'none'"] }),
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

// ---------------------------------------------------------------------------
// Dynamic frame-ancestors directive — built from an access policy's
// `allowedDomains`. Used exclusively by the shareable-link viewer at
// /l/<token> to permit iframe embedding on admin-declared domains.
//
// Contract:
//   - empty list  → "frame-ancestors 'none'" (HIPAA-safe default;
//                   pasting into an embed field still refuses).
//   - non-empty   → "frame-ancestors https://<d1> https://<d2> …"
//   - malformed entries (whitespace, scheme-like strings, empty) are
//     silently skipped. An all-malformed list falls back to 'none'.
//
// Hostnames must match the same loose check used by the policy-engine
// Referer check: bare host, lowercase, no path, no scheme. Wildcard
// labels ("*.example.com") are passed through — CSP3 Source Expressions
// accept them literally.
// ---------------------------------------------------------------------------

const HOSTNAME_RE = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const WILDCARD_HOST_RE = /^\*\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function buildFrameAncestorsDirective(
  allowedDomains: readonly string[],
): string {
  const sources: string[] = [];
  for (const raw of allowedDomains) {
    if (typeof raw !== "string") continue;
    const host = raw.trim().toLowerCase();
    if (host.length === 0) continue;
    if (host.includes("://") || host.includes("/") || host.includes(" ")) {
      continue;
    }
    if (HOSTNAME_RE.test(host) || WILDCARD_HOST_RE.test(host)) {
      sources.push(`https://${host}`);
    }
  }
  if (sources.length === 0) return "frame-ancestors 'none'";
  return `frame-ancestors ${sources.join(" ")}`;
}

// Per-link `allowPublicEmbed` opt-in. Sole authority on parent-host
// restriction when the toggle is on, because the policy-engine's
// Referer check is bypassed in this case (server-side oEmbed
// discovery has no Referer; relying on it would block WordPress /
// Circle / Notion crawlers).
//
//   - empty allowedDomains → `frame-ancestors https:` (any HTTPS
//     parent may iframe the link).
//   - non-empty            → exactly the listed hosts. We do NOT
//     append `https:`; the admin's narrowing intent must stay narrow.
//
// Replaces the earlier `mergePublicEmbedSource` helper, which
// always appended `https:` and silently widened admin-set domain
// allowlists. That behavior was wrong: a policy with
// `allowedDomains=["wpsite.com"]` was meant to RESTRICT embedding to
// wpsite.com, not permit any HTTPS parent.
export function buildPublicEmbedFrameAncestors(
  allowedDomains: readonly string[],
): string {
  const restricted = buildFrameAncestorsDirective(allowedDomains);
  if (restricted === "frame-ancestors 'none'") {
    return "frame-ancestors https:";
  }
  return restricted;
}
