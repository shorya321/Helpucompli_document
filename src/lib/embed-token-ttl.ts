// Single source of truth for the HMAC raw-fetch token TTL bundled
// into externally-pasted media URLs (`/l/<hash>/raw?t=<token>`):
//
//   - share-info "Image URL" copy button (admin dashboard)
//   - viewer route og:image / og:video / twitter:player:stream meta tags
//   - oEmbed photo.url
//
// The token wraps an S3 presigned URL that `/raw` re-mints on every
// request. Therefore the wrapper token's lifetime is INDEPENDENT of
// the SigV4 7-day ceiling — `MAX_GET_TTL_SECONDS` only constrains the
// presigned URL inside the proxy, never the browser-visible token.
//
// Behavior:
//   - Finite link (link.expiresAt is a Date): TTL = min(7d, remaining).
//     Floor at 60s for almost-expired links so issueRawFetchToken's
//     positive-ttl invariant holds.
//   - Perpetual link (link.expiresAt === null): TTL = 10y. This makes
//     "Never expires" links survive past the previous 7-day cap on
//     third-party embeds (Circle.so / Compass / Notion etc.) where the
//     consumer caches the URL itself.
//
// Revocation remains the only kill switch: `/raw` checks
// `link.isRevoked` on every request, so a leaked perpetual token can
// be killed instantly via the existing per-link revoke flag.

export const EMBED_TOKEN_FINITE_DEFAULT_TTL_SEC = 7 * 24 * 60 * 60;
export const EMBED_TOKEN_PERPETUAL_TTL_SEC = 10 * 365 * 24 * 60 * 60;
export const EMBED_TOKEN_FLOOR_TTL_SEC = 60;

export function chooseEmbedTokenTtlSec(
  expiresAt: Date | null | undefined,
): number {
  if (expiresAt === null || expiresAt === undefined) {
    return EMBED_TOKEN_PERPETUAL_TTL_SEC;
  }
  const remainingSec = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (remainingSec <= 0) return EMBED_TOKEN_FLOOR_TTL_SEC;
  return Math.min(EMBED_TOKEN_FINITE_DEFAULT_TTL_SEC, remainingSec);
}
