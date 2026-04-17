import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client, sseKmsParams } from "./s3";
import {
  assertContentType,
  DEFAULT_TTL_SECONDS,
  InvalidPresignTargetError,
  InvalidPresignTtlError,
  MAX_PUT_TTL_SECONDS,
  MIN_TTL_SECONDS,
} from "./s3-presign";

// HIPAA doc spec: multipart for files > 100 MB, cap at 5 GB per object.
// S3's own multipart lower bound is 5 MB per part (except the last),
// upper bound is 10 000 parts. With our 5 GB ceiling and 10 MB target
// part size we produce at most 512 parts — well under the cap.
export const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024; // S3 hard minimum
export const MAX_PART_NUMBER = 10_000; // S3 hard maximum
export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const TARGET_PART_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Standard + composite S3 ETag formats: 32 hex + optional "-<N>" suffix
// for multipart composite ETags, wrapped in quotes (S3 always returns
// quoted ETags). Rejects obvious client-fabricated values before we
// spend a round-trip on CompleteMultipartUpload.
const ETAG_RE = /^"[0-9a-fA-F]{32}(?:-\d+)?"$/;

export class InvalidMultipartInputError extends Error {
  constructor(field: string, reason: string) {
    super(`Invalid ${field}: ${reason}`);
    this.name = "InvalidMultipartInputError";
  }
}

function assertBucket(bucket: string): void {
  if (!bucket) throw new InvalidPresignTargetError("bucket");
}

// Same rules as s3-presign / s3-objects: reject empty, leading '/',
// '..' segments, empty path segments. Kept in lockstep with sibling
// modules — divergence across these validators is itself a security
// risk because an API route could branch on module choice to smuggle
// a bad key past one validator.
function assertKey(key: string): void {
  if (!key) throw new InvalidPresignTargetError("key");
  if (key.startsWith("/")) {
    throw new InvalidPresignTargetError("key", "must not start with '/'");
  }
  if (key.split("/").includes("..")) {
    throw new InvalidPresignTargetError("key", "must not contain '..'");
  }
  if (key.split("/").some((seg) => seg === "")) {
    throw new InvalidPresignTargetError(
      "key",
      "must not contain empty path segments",
    );
  }
}

function assertUploadId(uploadId: string): void {
  if (!uploadId) {
    throw new InvalidMultipartInputError("uploadId", "must be non-empty");
  }
}

function assertPartNumber(n: number): void {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_PART_NUMBER) {
    throw new InvalidMultipartInputError(
      "partNumber",
      `must be an integer in [1, ${MAX_PART_NUMBER}]`,
    );
  }
}

function assertTtl(ttl: number): void {
  if (!Number.isFinite(ttl) || ttl < MIN_TTL_SECONDS || ttl > MAX_PUT_TTL_SECONDS) {
    throw new InvalidPresignTtlError(ttl, MAX_PUT_TTL_SECONDS);
  }
}

function assertEtag(etag: string, partNumber: number): void {
  if (!ETAG_RE.test(etag)) {
    throw new InvalidMultipartInputError(
      "parts",
      `part ${partNumber} ETag is not an S3 ETag (expected quoted 32-hex or composite)`,
    );
  }
}

/** Returns true only if sizeBytes STRICTLY exceeds the 100 MB threshold. */
export function shouldUseMultipart(sizeBytes: number): boolean {
  return sizeBytes > MULTIPART_THRESHOLD_BYTES;
}

export function assertFileSize(sizeBytes: number): void {
  if (
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > MAX_FILE_SIZE_BYTES
  ) {
    throw new InvalidMultipartInputError(
      "size",
      `must be in (0, ${MAX_FILE_SIZE_BYTES}] bytes`,
    );
  }
}

export interface MultipartPlan {
  partCount: number;
  parts: Array<{ partNumber: number; size: number }>;
}

// Target ~10 MB parts. If sizeBytes is large enough that 10 MB parts
// would exceed MAX_PART_NUMBER, scale the part size up (ceil division)
// then clamp to the 5 MB S3 minimum. With our 5 GB cap this never
// actually triggers the clamp — 5 GB / 10000 = ~524 KB which is below
// 5 MB, but the minSize wrapper guards future cap increases without
// producing sub-5 MB parts.
export function planMultipartParts(sizeBytes: number): MultipartPlan {
  assertFileSize(sizeBytes);
  const dynamicMin = Math.ceil(sizeBytes / MAX_PART_NUMBER);
  const partSize = Math.max(TARGET_PART_SIZE_BYTES, dynamicMin, MIN_PART_SIZE_BYTES);
  const fullParts = Math.floor(sizeBytes / partSize);
  const remainder = sizeBytes - fullParts * partSize;
  const parts: MultipartPlan["parts"] = [];
  for (let i = 0; i < fullParts; i++) {
    parts.push({ partNumber: i + 1, size: partSize });
  }
  if (remainder > 0) {
    parts.push({ partNumber: fullParts + 1, size: remainder });
  }
  return { partCount: parts.length, parts };
}

export interface InitiateMultipartInput {
  bucket: string;
  key: string;
  contentType?: string;
  // Server-side file-size gate. When provided, enforces the 5 GB HIPAA
  // cap before the UploadId is ever issued (closes the window where an
  // API route might forget to call assertFileSize separately).
  declaredSizeBytes?: number;
}

export interface InitiateMultipartResult {
  uploadId: string;
}

export async function initiateMultipartUpload(
  input: InitiateMultipartInput,
): Promise<InitiateMultipartResult> {
  assertBucket(input.bucket);
  assertKey(input.key);
  if (input.contentType) assertContentType(input.contentType, "contentType");
  if (input.declaredSizeBytes !== undefined) {
    assertFileSize(input.declaredSizeBytes);
  }

  const res = await getS3Client().send(
    new CreateMultipartUploadCommand({
      Bucket: input.bucket,
      Key: input.key,
      ...(input.contentType ? { ContentType: input.contentType } : {}),
      // SSE-KMS on the multipart init — every uploaded part inherits
      // this encryption context; UploadPart requests do NOT re-send it.
      // A stolen part presigned URL therefore cannot write unencrypted.
      ...sseKmsParams(),
    }),
  );

  if (!res.UploadId) {
    throw new InvalidMultipartInputError(
      "uploadId",
      "CreateMultipartUpload did not return an UploadId",
    );
  }
  return { uploadId: res.UploadId };
}

export interface PresignUploadPartInput {
  bucket: string;
  key: string;
  uploadId: string;
  partNumber: number;
  ttlSeconds?: number;
}

export async function presignUploadPart(
  input: PresignUploadPartInput,
): Promise<string> {
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  assertBucket(input.bucket);
  assertKey(input.key);
  assertUploadId(input.uploadId);
  assertPartNumber(input.partNumber);
  assertTtl(ttl);

  const cmd = new UploadPartCommand({
    Bucket: input.bucket,
    Key: input.key,
    UploadId: input.uploadId,
    PartNumber: input.partNumber,
  });

  return getSignedUrl(getS3Client(), cmd, { expiresIn: ttl });
}

export interface CompleteMultipartInput {
  bucket: string;
  key: string;
  uploadId: string;
  parts: Array<{ PartNumber: number; ETag: string }>;
}

export interface CompleteMultipartResult {
  location?: string;
  etag: string;
  versionId?: string;
}

export async function completeMultipartUpload(
  input: CompleteMultipartInput,
): Promise<CompleteMultipartResult> {
  assertBucket(input.bucket);
  assertKey(input.key);
  assertUploadId(input.uploadId);
  if (input.parts.length === 0) {
    throw new InvalidMultipartInputError(
      "parts",
      "must contain at least one part",
    );
  }
  const seen = new Set<number>();
  for (const p of input.parts) {
    assertPartNumber(p.PartNumber);
    assertEtag(p.ETag, p.PartNumber);
    if (seen.has(p.PartNumber)) {
      throw new InvalidMultipartInputError(
        "parts",
        `duplicate PartNumber ${p.PartNumber}`,
      );
    }
    seen.add(p.PartNumber);
  }

  // Require contiguous 1..N sequence: missing parts cause S3 to return
  // InvalidPartOrder, but it is cheaper to reject client-side.
  const sorted = [...input.parts].sort((a, b) => a.PartNumber - b.PartNumber);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].PartNumber !== i + 1) {
      throw new InvalidMultipartInputError(
        "parts",
        `non-contiguous PartNumber sequence (expected ${i + 1}, got ${sorted[i].PartNumber})`,
      );
    }
  }

  const res = await getS3Client().send(
    new CompleteMultipartUploadCommand({
      Bucket: input.bucket,
      Key: input.key,
      UploadId: input.uploadId,
      MultipartUpload: { Parts: sorted },
    }),
  );
  if (!res.ETag) {
    throw new InvalidMultipartInputError(
      "parts",
      "CompleteMultipartUpload did not return an ETag",
    );
  }
  return {
    location: res.Location,
    etag: res.ETag,
    versionId: res.VersionId,
  };
}

export interface AbortMultipartInput {
  bucket: string;
  key: string;
  uploadId: string;
}

// Abort releases all uploaded parts' storage. MUST be called on any
// upload-session failure (client abandons, server error, policy change)
// or AWS charges accrue for the parts until a bucket lifecycle rule
// sweeps them. Deploy runbook carry-forward: every document bucket
// must carry an AbortIncompleteMultipartUpload lifecycle rule as the
// safety net for this function never being reached.
export async function abortMultipartUpload(
  input: AbortMultipartInput,
): Promise<void> {
  assertBucket(input.bucket);
  assertKey(input.key);
  assertUploadId(input.uploadId);
  await getS3Client().send(
    new AbortMultipartUploadCommand({
      Bucket: input.bucket,
      Key: input.key,
      UploadId: input.uploadId,
    }),
  );
}
