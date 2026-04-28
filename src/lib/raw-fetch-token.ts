import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";

// Server-issued HMAC token that lets the same-origin streaming proxy
// at /l/[hash]/raw skip the publicEmbedBypass referer refinement gate
// in policy-engine.ts when the request is a browser sub-resource fetch
// from an already-authorized /l/[hash] viewer page.
//
// The outer /l/[hash] page mints this token only AFTER
// resolveAndAuthorizeLink + enforcePolicy succeed (which on the
// allowedDomains path means the parent embed referer matched). The
// token is short-lived (default 120s — enough for full PDF/video range
// streaming) and bound to the link hash, so it cannot be replayed
// against a different document.
//
// Token format: base64url(payloadJson) + "." + base64url(hmacSha256).
//
// HMAC key is derived from AUTH0_SECRET (already required to be >= 32
// chars and rotated by the Auth0 admin) and scoped to this surface so
// a leaked raw-fetch token cannot be replayed against a different
// HMAC consumer (e.g. upload-receipt.ts).

export class InvalidRawFetchTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid raw-fetch token: ${reason}`);
    this.name = "InvalidRawFetchTokenError";
  }
}

interface SerializedClaims {
  readonly hash: string;
  readonly exp: number; // unix seconds
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
): string {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new InvalidRawFetchTokenError("ttlSeconds must be positive");
  }
  if (typeof hash !== "string" || hash.length === 0) {
    throw new InvalidRawFetchTokenError("hash must be a non-empty string");
  }
  const serialized: SerializedClaims = {
    hash,
    exp: Math.floor(Date.now() / 1000) + Math.floor(ttlSeconds),
  };
  const payloadJson = JSON.stringify(serialized);
  return `${b64url(payloadJson)}.${sign(payloadJson)}`;
}

export function verifyRawFetchToken(token: string, hash: string): true {
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
  return true;
}
