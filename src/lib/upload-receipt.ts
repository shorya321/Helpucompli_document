import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";

// Server-issued HMAC receipt that binds a presigned upload to the
// (sub, bucketId, s3Key, uploadId?) tuple. Prevents an authenticated
// caller from calling /api/s3/upload-complete with a forged s3Key or
// uploadId that was not issued by /api/s3/upload-url.
//
// Token format: base64url(payloadJson) + "." + base64url(hmacSha256).
// The payload carries the caller identity, bucket, key, optional
// multipart uploadId, and an absolute expiry timestamp (seconds since
// epoch). Verification is constant-time + covers the expiry check, so
// expired receipts cannot be replayed even with a valid signature.
//
// HMAC key is derived from AUTH0_SECRET (already required to be >= 32
// chars) — avoids introducing another secret while keeping the key
// scoped to a value already rotated by the Auth0 admin.

export class InvalidUploadReceiptError extends Error {
  constructor(reason: string) {
    super(`Invalid upload receipt: ${reason}`);
    this.name = "InvalidUploadReceiptError";
  }
}

export interface UploadReceiptClaims {
  readonly sub: string;
  readonly bucketId: string;
  readonly s3Key: string;
  readonly uploadId?: string;
}

interface SerializedClaims {
  readonly sub: string;
  readonly bucketId: string;
  readonly s3Key: string;
  readonly uploadId?: string;
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
  // Scope the key to this surface so a future leak of the receipt HMAC
  // value cannot be replayed against a different Auth0-derived token.
  return createHmac("sha256", getConfig().AUTH0_SECRET)
    .update("helpucompli/upload-receipt/v1")
    .digest();
}

function sign(payloadJson: string): string {
  return b64url(createHmac("sha256", hmacKey()).update(payloadJson).digest());
}

export function issueUploadReceipt(
  claims: UploadReceiptClaims,
  ttlSeconds: number,
): string {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new InvalidUploadReceiptError("ttlSeconds must be positive");
  }
  const serialized: SerializedClaims = {
    sub: claims.sub,
    bucketId: claims.bucketId,
    s3Key: claims.s3Key,
    ...(claims.uploadId !== undefined ? { uploadId: claims.uploadId } : {}),
    exp: Math.floor(Date.now() / 1000) + Math.floor(ttlSeconds),
  };
  const payloadJson = JSON.stringify(serialized);
  return `${b64url(payloadJson)}.${sign(payloadJson)}`;
}

export function verifyUploadReceipt(
  token: string,
  expected: UploadReceiptClaims,
): true {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new InvalidUploadReceiptError("malformed token");
  }
  const [payloadB64, sigB64] = parts;
  const payloadJson = b64urlDecode(payloadB64!).toString("utf8");
  const expectedSig = sign(payloadJson);

  const given = b64urlDecode(sigB64!);
  const expectedBuf = b64urlDecode(expectedSig);
  if (given.length !== expectedBuf.length) {
    throw new InvalidUploadReceiptError("signature mismatch");
  }
  if (!timingSafeEqual(given, expectedBuf)) {
    throw new InvalidUploadReceiptError("signature mismatch");
  }

  let claims: SerializedClaims;
  try {
    claims = JSON.parse(payloadJson) as SerializedClaims;
  } catch {
    throw new InvalidUploadReceiptError("malformed payload");
  }

  if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new InvalidUploadReceiptError("expired");
  }
  if (claims.sub !== expected.sub) {
    throw new InvalidUploadReceiptError("sub mismatch");
  }
  if (claims.bucketId !== expected.bucketId) {
    throw new InvalidUploadReceiptError("bucket mismatch");
  }
  if (claims.s3Key !== expected.s3Key) {
    throw new InvalidUploadReceiptError("key mismatch");
  }
  if ((claims.uploadId ?? undefined) !== (expected.uploadId ?? undefined)) {
    throw new InvalidUploadReceiptError("uploadId mismatch");
  }
  return true;
}
