import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client, withSseKms } from "./s3";

// Presigned URLs are bearer tokens — anyone holding the URL within the TTL
// can execute the signed request. HIPAA §164.312 minimum-necessary + auto-
// logoff argues for short TTLs, especially on WRITE URLs. We split the cap
// by verb:
//   PUT (write): [15 min, 1 hour] — a stolen upload URL can overwrite an
//     object for at most 1 hour; keeps blast radius tight.
//   GET (read):  [15 min, 7 days] — 7-day reads gated by F9 link engine
//     (policy enforcement + revocation + download-count cap).
// SigV4 itself caps at 7 days, matching the GET ceiling.
export const MIN_TTL_SECONDS = 900; // 15 minutes
export const MAX_PUT_TTL_SECONDS = 3_600; // 1 hour — HIPAA write-bearer cap
export const MAX_GET_TTL_SECONDS = 604_800; // 7 days — SigV4 protocol cap
export const DEFAULT_TTL_SECONDS = 900;

// Kept for backward compatibility with F9 wiring that imports the
// unverbed name.
export const MAX_TTL_SECONDS = MAX_GET_TTL_SECONDS;

export class InvalidPresignTtlError extends Error {
  constructor(ttl: number, max: number) {
    super(
      `Invalid TTL ${ttl}s. Must be within [${MIN_TTL_SECONDS}, ${max}] seconds.`,
    );
    this.name = "InvalidPresignTtlError";
  }
}

export class InvalidPresignTargetError extends Error {
  constructor(target: "bucket" | "key", reason?: string) {
    super(
      `Presigned URL ${target} is invalid${reason ? `: ${reason}` : ""}`,
    );
    this.name = "InvalidPresignTargetError";
  }
}

export class InvalidResponseOverrideError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid ${field}: ${reason}`);
    this.name = "InvalidResponseOverrideError";
  }
}

function assertTargets(bucket: string, key: string): void {
  if (!bucket) throw new InvalidPresignTargetError("bucket");
  if (!key) throw new InvalidPresignTargetError("key");
  // Block keys that a downstream consumer could mishandle when joining
  // with a filesystem path or stripping S3 URL components. S3 accepts
  // these literally but they have no legitimate use here.
  if (key.startsWith("/")) {
    throw new InvalidPresignTargetError("key", "must not start with '/'");
  }
  if (key.split("/").includes("..")) {
    throw new InvalidPresignTargetError("key", "must not contain '..'");
  }
}

function assertTtl(ttl: number, max: number): void {
  if (!Number.isFinite(ttl) || ttl < MIN_TTL_SECONDS || ttl > max) {
    throw new InvalidPresignTtlError(ttl, max);
  }
}

// RFC 6838 media-type grammar subset — token "/" token with common suffix
// and parameter chars. Rejects anything exotic so a caller cannot flip
// MIME sniffing by supplying "text/html" against a PDF object.
const SAFE_CONTENT_TYPE_RE = /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]{0,127}\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]{0,127}$/;

// filename="..." value characters. Allows unicode word chars, common
// punctuation, brackets, parens. Rejects quotes, backslashes, CR/LF.
const SAFE_FILENAME_RE = /^[\p{L}\p{N} ._\-()[\]]+$/u;

// Exported so s3-multipart reuses the same RFC 6838 subset and error
// class (keeps contentType validation semantics identical across the
// upload surface).
export function assertContentType(value: string, fieldName: string): void {
  if (!SAFE_CONTENT_TYPE_RE.test(value)) {
    throw new InvalidResponseOverrideError(
      fieldName,
      "must be a valid RFC 6838 media type",
    );
  }
}

function assertContentDisposition(value: string): void {
  const m = value.match(
    /^(attachment|inline)(?:;\s*filename="([^"]+)")?$/,
  );
  if (!m) {
    throw new InvalidResponseOverrideError(
      "responseContentDisposition",
      "must be 'attachment' or 'inline' with optional quoted filename",
    );
  }
  const filename = m[2];
  if (filename !== undefined && !SAFE_FILENAME_RE.test(filename)) {
    throw new InvalidResponseOverrideError(
      "responseContentDisposition",
      "filename contains unsafe characters",
    );
  }
}

export interface PresignPutInput {
  bucket: string;
  key: string;
  contentType?: string;
  ttlSeconds?: number;
}

// PutObject presigned URLs are write bearer tokens. A stolen URL lets the
// holder overwrite the target object until TTL expires (S3 has no native
// one-time-use semantics). Mitigations:
//   - never log the URL; return it once to the authenticated caller
//   - keep ttlSeconds as short as the upload UX tolerates
//   - SSE-KMS headers are signed in so unencrypted bytes are rejected 403
//   - ContentType (when supplied) is hoisted into the signed URL so the
//     uploader cannot swap it post-signature
export async function presignPutUrl(input: PresignPutInput): Promise<string> {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  assertTargets(input.bucket, input.key);
  assertTtl(ttl, MAX_PUT_TTL_SECONDS);
  if (input.contentType) assertContentType(input.contentType, "contentType");

  const cmd = new PutObjectCommand(
    withSseKms({
      Bucket: input.bucket,
      Key: input.key,
      ...(input.contentType ? { ContentType: input.contentType } : {}),
    }),
  );

  // Pin SSE-KMS headers to SignedHeaders (never moved to query string)
  // so the uploader MUST resend them verbatim. A stolen presigned URL
  // cannot drop these headers and land unencrypted bytes — S3 would
  // reject the request with SignatureDoesNotMatch.
  // Ref: https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html
  const unhoistableHeaders = new Set([
    "x-amz-server-side-encryption",
    "x-amz-server-side-encryption-aws-kms-key-id",
    "x-amz-server-side-encryption-bucket-key-enabled",
  ]);

  return getSignedUrl(getS3Client(), cmd, {
    expiresIn: ttl,
    unhoistableHeaders,
    ...(input.contentType ? { signableHeaders: new Set(["content-type"]) } : {}),
  });
}

export interface PresignGetInput {
  bucket: string;
  key: string;
  ttlSeconds?: number;
  responseContentDisposition?: string;
  responseContentType?: string;
}

export async function presignGetUrl(input: PresignGetInput): Promise<string> {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  assertTargets(input.bucket, input.key);
  assertTtl(ttl, MAX_GET_TTL_SECONDS);
  if (input.responseContentType) {
    assertContentType(input.responseContentType, "responseContentType");
  }
  if (input.responseContentDisposition) {
    assertContentDisposition(input.responseContentDisposition);
  }

  const cmd = new GetObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    ...(input.responseContentDisposition
      ? { ResponseContentDisposition: input.responseContentDisposition }
      : {}),
    ...(input.responseContentType
      ? { ResponseContentType: input.responseContentType }
      : {}),
  });

  return getSignedUrl(getS3Client(), cmd, { expiresIn: ttl });
}
