import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";

// Server-issued HMAC token that gates the same-origin streaming proxy
// at /l/[hash]/raw. The token carries an explicit `kind` claim that
// /raw uses to decide whether to bypass the publicEmbed Referer
// refinement gate in policy-engine.ts:
//
//   - "sub-fetch"      — minted by the outer /l/[hash] viewer page
//                        AFTER it passed the publicEmbed referer
//                        refinement check. Browser sub-resource fetches
//                        from the viewer carry it; /raw treats them as
//                        an already-authorized continuation of the
//                        outer page's request and skips the refinement
//                        branch. TTL is short (default 120 s) — enough
//                        for full PDF / video range streaming.
//
//   - "external-embed" — minted by surfaces that emit a long-lived
//                        externally-pasted image URL (og:image meta on
//                        /l/[hash], oEmbed `type:photo`, dashboard
//                        "Image URL" copy button). No prior browser
//                        referer was validated, so /raw MUST NOT skip
//                        refinement: browser fetches go through the
//                        normal F9.7 Sec-Fetch-Dest gate, while
//                        server-side oEmbed crawlers (no Sec-Fetch-*)
//                        keep bypassing per design.
//
// Both kinds are bound to the link hash and signed with an HMAC key
// derived from AUTH0_SECRET (already required to be ≥ 32 chars and
// rotated by the Auth0 admin) and scoped to this surface so a leaked
// token cannot be replayed against a different HMAC consumer.
//
// Token format: base64url(payloadJson) + "." + base64url(hmacSha256).

export class InvalidRawFetchTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid raw-fetch token: ${reason}`);
    this.name = "InvalidRawFetchTokenError";
  }
}

export type RawFetchTokenKind = "sub-fetch" | "external-embed";

interface SerializedClaims {
  readonly hash: string;
  readonly exp: number; // unix seconds
  readonly kind: RawFetchTokenKind;
}

export interface VerifiedRawFetchToken {
  readonly kind: RawFetchTokenKind;
}

function isRawFetchTokenKind(value: unknown): value is RawFetchTokenKind {
  return value === "sub-fetch" || value === "external-embed";
}

function b64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = 4 - (s.length % 4 || 4);
  const padded = s + "=".repeat(pad === 4 ? 0 : pad);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hmacKey(): Buffer {
  return createHmac("sha256", getConfig().AUTH0_SECRET)
    .update("helpucompli/raw-fetch/v1")
    .digest();
}

function sign(payloadJson: string): string {
  return b64url(createHmac("sha256", hmacKey()).update(payloadJson).digest());
}

export function issueRawFetchToken(
  hash: string,
  ttlSeconds: number,
  kind: RawFetchTokenKind,
): string {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new InvalidRawFetchTokenError("ttlSeconds must be positive");
  }
  if (typeof hash !== "string" || hash.length === 0) {
    throw new InvalidRawFetchTokenError("hash must be a non-empty string");
  }
  if (!isRawFetchTokenKind(kind)) {
    throw new InvalidRawFetchTokenError("kind must be sub-fetch or external-embed");
  }
  const serialized: SerializedClaims = {
    hash,
    exp: Math.floor(Date.now() / 1000) + Math.floor(ttlSeconds),
    kind,
  };
  const payloadJson = JSON.stringify(serialized);
  return `${b64url(payloadJson)}.${sign(payloadJson)}`;
}

export function verifyRawFetchToken(
  token: string,
  hash: string,
): VerifiedRawFetchToken {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new InvalidRawFetchTokenError("malformed token");
  }
  const [payloadB64, sigB64] = parts;
  const payloadJson = b64urlDecode(payloadB64!).toString("utf8");
  const expectedSig = sign(payloadJson);

  const given = b64urlDecode(sigB64!);
  const expectedBuf = b64urlDecode(expectedSig);
  if (given.length !== expectedBuf.length) {
    throw new InvalidRawFetchTokenError("signature mismatch");
  }
  if (!timingSafeEqual(given, expectedBuf)) {
    throw new InvalidRawFetchTokenError("signature mismatch");
  }

  let claims: SerializedClaims;
  try {
    claims = JSON.parse(payloadJson) as SerializedClaims;
  } catch {
    throw new InvalidRawFetchTokenError("malformed payload");
  }

  if (
    typeof claims.exp !== "number" ||
    claims.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new InvalidRawFetchTokenError("expired");
  }
  if (claims.hash !== hash) {
    throw new InvalidRawFetchTokenError("hash mismatch");
  }
  if (!isRawFetchTokenKind(claims.kind)) {
    // Pre-kind tokens never shipped to a surface that would now
    // refuse them — the new image flows landed in this same release.
    // Treating absent/unknown kind as invalid prevents a downgrade
    // attack where a forged-but-old payload would otherwise be
    // accepted as the safer "sub-fetch" by default.
    throw new InvalidRawFetchTokenError("unknown kind");
  }
  return { kind: claims.kind };
}
