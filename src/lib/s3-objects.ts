import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  type _Object,
} from "@aws-sdk/client-s3";
import { getS3Client, sseKmsParams } from "./s3";

// S3 DeleteObjects single-request cap.
const DELETE_BATCH_MAX = 1000;
const LIST_MAX_KEYS_CAP = 1000;

// Allowlist for user metadata surfaced by headObject. Any key the upload
// path sets outside this list is dropped — defense-in-depth against PHI
// accidentally landing in x-amz-meta-* despite the boundary validator.
const ALLOWED_USER_METADATA_KEYS = new Set([
  "uploader",
  "filename",
  "tenant-id",
  "content-type",
]);

export class InvalidObjectTargetError extends Error {
  constructor(target: "bucket" | "key" | "prefix" | "keys", reason?: string) {
    super(`Invalid ${target}${reason ? `: ${reason}` : ""}`);
    this.name = "InvalidObjectTargetError";
  }
}

function assertBucket(bucket: string): void {
  if (!bucket) throw new InvalidObjectTargetError("bucket");
}

function assertKey(key: string): void {
  if (!key) throw new InvalidObjectTargetError("key");
  if (key.split("/").includes("..")) {
    throw new InvalidObjectTargetError("key", "must not contain '..'");
  }
  // Empty path segment (leading slash, trailing slash, or consecutive
  // slashes) — rejected so encodeCopySource never produces ambiguous
  // destinations and so folder-marker keys cannot sneak into
  // copy/delete/move paths.
  if (key.split("/").some((seg) => seg === "")) {
    throw new InvalidObjectTargetError(
      "key",
      "must not contain empty path segments (no leading/trailing/consecutive slashes)",
    );
  }
}

function assertPrefix(prefix: string): void {
  if (prefix.startsWith("/") || prefix.split("/").includes("..")) {
    throw new InvalidObjectTargetError(
      "prefix",
      "must not start with '/' or contain '..'",
    );
  }
}

function clampMaxKeys(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  if (v > LIST_MAX_KEYS_CAP) return LIST_MAX_KEYS_CAP;
  return Math.floor(v);
}

export interface ListObjectsInput {
  bucket: string;
  prefix?: string;
  continuationToken?: string;
  maxKeys?: number;
  // Default "/" produces folder-view listings (CommonPrefixes populated).
  // Pass "" to get a flat recursive listing (all nested keys in Contents).
  delimiter?: string;
}

export interface ListObjectsResult {
  contents: Array<Pick<_Object, "Key" | "Size" | "LastModified" | "ETag">>;
  commonPrefixes: string[];
  nextContinuationToken?: string;
  isTruncated: boolean;
}

export async function listObjects(input: ListObjectsInput): Promise<ListObjectsResult> {
  assertBucket(input.bucket);
  if (input.prefix !== undefined) assertPrefix(input.prefix);

  const res = await getS3Client().send(
    new ListObjectsV2Command({
      Bucket: input.bucket,
      ...(input.prefix !== undefined ? { Prefix: input.prefix } : {}),
      ...(input.continuationToken
        ? { ContinuationToken: input.continuationToken }
        : {}),
      MaxKeys: clampMaxKeys(input.maxKeys ?? LIST_MAX_KEYS_CAP),
      Delimiter: input.delimiter ?? "/",
    }),
  );

  return {
    contents: (res.Contents ?? []).map((c) => ({
      Key: c.Key,
      Size: c.Size,
      LastModified: c.LastModified,
      ETag: c.ETag,
    })),
    commonPrefixes: (res.CommonPrefixes ?? [])
      .map((p) => p.Prefix)
      .filter((p): p is string => typeof p === "string"),
    nextContinuationToken: res.NextContinuationToken,
    isTruncated: Boolean(res.IsTruncated),
  };
}

export interface ListObjectVersionsInput {
  bucket: string;
  prefix?: string;
  keyMarker?: string;
  versionIdMarker?: string;
  maxKeys?: number;
}

export interface ObjectVersionSummary {
  key: string;
  versionId?: string;
  isLatest: boolean;
  isDeleteMarker: boolean;
  size?: number;
  lastModified?: Date;
}

export interface ListObjectVersionsResult {
  versions: ObjectVersionSummary[];
  nextKeyMarker?: string;
  nextVersionIdMarker?: string;
  isTruncated: boolean;
}

// Expose versioning enumeration for the F6.5 superadmin hard-delete UX:
// operator sees every version (including delete markers) and can target
// a specific VersionId for permanent removal.
export async function listObjectVersions(
  input: ListObjectVersionsInput,
): Promise<ListObjectVersionsResult> {
  assertBucket(input.bucket);
  if (input.prefix !== undefined) assertPrefix(input.prefix);

  const res = await getS3Client().send(
    new ListObjectVersionsCommand({
      Bucket: input.bucket,
      ...(input.prefix !== undefined ? { Prefix: input.prefix } : {}),
      ...(input.keyMarker ? { KeyMarker: input.keyMarker } : {}),
      ...(input.versionIdMarker
        ? { VersionIdMarker: input.versionIdMarker }
        : {}),
      MaxKeys: clampMaxKeys(input.maxKeys ?? LIST_MAX_KEYS_CAP),
    }),
  );

  const versions: ObjectVersionSummary[] = [
    ...(res.Versions ?? []).map((v) => ({
      key: v.Key ?? "",
      versionId: v.VersionId,
      isLatest: Boolean(v.IsLatest),
      isDeleteMarker: false,
      size: v.Size,
      lastModified: v.LastModified,
    })),
    ...(res.DeleteMarkers ?? []).map((d) => ({
      key: d.Key ?? "",
      versionId: d.VersionId,
      isLatest: Boolean(d.IsLatest),
      isDeleteMarker: true,
      lastModified: d.LastModified,
    })),
  ];

  return {
    versions,
    nextKeyMarker: res.NextKeyMarker,
    nextVersionIdMarker: res.NextVersionIdMarker,
    isTruncated: Boolean(res.IsTruncated),
  };
}

export interface HeadObjectInput {
  bucket: string;
  key: string;
  versionId?: string;
}

export interface ObjectMetadata {
  contentLength?: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
  versionId?: string;
  sseAlgorithm?: string;
  sseKmsKeyId?: string;
  userMetadata?: Record<string, string>;
}

export async function headObject(input: HeadObjectInput): Promise<ObjectMetadata> {
  assertBucket(input.bucket);
  assertKey(input.key);
  const res = await getS3Client().send(
    new HeadObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ...(input.versionId ? { VersionId: input.versionId } : {}),
    }),
  );

  // Filter user metadata to the allowlist so a key accidentally set on
  // upload cannot leak through this read path. The upload route should
  // already enforce the same list — this is defense-in-depth.
  const userMetadata = res.Metadata
    ? Object.fromEntries(
        Object.entries(res.Metadata).filter(([k]) =>
          ALLOWED_USER_METADATA_KEYS.has(k),
        ),
      )
    : undefined;

  return {
    contentLength: res.ContentLength,
    contentType: res.ContentType,
    etag: res.ETag,
    lastModified: res.LastModified,
    versionId: res.VersionId,
    sseAlgorithm: res.ServerSideEncryption,
    sseKmsKeyId: res.SSEKMSKeyId,
    userMetadata,
  };
}

export interface CopyObjectInput {
  srcBucket: string;
  srcKey: string;
  destBucket: string;
  destKey: string;
}

// URL-encode each key path segment (spaces, non-ASCII) but preserve `/`
// separators — the S3 CopySource header requires this form or the copy
// rejects with AccessDenied / malformed URI.
function encodeCopySource(bucket: string, key: string): string {
  const encoded = key.split("/").map((seg) => encodeURIComponent(seg)).join("/");
  return `${bucket}/${encoded}`;
}

export async function copyObject(input: CopyObjectInput): Promise<void> {
  assertBucket(input.srcBucket);
  assertBucket(input.destBucket);
  assertKey(input.srcKey);
  assertKey(input.destKey);

  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: input.destBucket,
      Key: input.destKey,
      CopySource: encodeCopySource(input.srcBucket, input.srcKey),
      // MetadataDirective controls user/system metadata only — does NOT
      // interact with SSE-KMS headers below (confirmed by AWS docs). So
      // COPY preserves x-amz-meta-* while sseKmsParams() forces re-encrypt
      // with OUR CMK regardless of source-side encryption.
      MetadataDirective: "COPY",
      ...sseKmsParams(),
    }),
  );
}

// move = copy then delete source. If copy fails, source is untouched.
// If the process crashes AFTER copy succeeds but BEFORE delete is sent,
// both source and destination exist — accepted degraded state for HIPAA
// (no data loss; ops reconciles via versioning history).
export async function moveObject(input: CopyObjectInput): Promise<void> {
  await copyObject(input);
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: input.srcBucket, Key: input.srcKey }),
  );
}

export interface SoftDeleteInput {
  bucket: string;
  key: string;
}

export interface HardDeleteInput {
  bucket: string;
  key: string;
  versionId: string;
}

export interface DeleteObjectResult {
  deleteMarker: boolean;
  versionId?: string;
}

// Soft delete: versioning is Enabled on every bucket (F3.2) so omitting
// VersionId places a delete marker. Object remains recoverable.
export async function softDeleteObject(
  input: SoftDeleteInput,
): Promise<DeleteObjectResult> {
  assertBucket(input.bucket);
  assertKey(input.key);
  const res = await getS3Client().send(
    new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }),
  );
  return {
    deleteMarker: Boolean(res.DeleteMarker),
    versionId: res.VersionId,
  };
}

// Hard delete: permanently removes a specific version (including delete
// markers). MUST be guarded by superadmin role check at the API route
// (F6.5). Named distinctly to make accidental hard-delete from a
// lower-privilege route impossible without a deliberate import.
export async function hardDeleteObjectVersion(
  input: HardDeleteInput,
): Promise<DeleteObjectResult> {
  assertBucket(input.bucket);
  assertKey(input.key);
  if (!input.versionId) {
    throw new InvalidObjectTargetError(
      "key",
      "hardDeleteObjectVersion requires a non-empty versionId",
    );
  }
  const res = await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      VersionId: input.versionId,
    }),
  );
  return {
    deleteMarker: Boolean(res.DeleteMarker),
    versionId: res.VersionId,
  };
}

export interface DeleteObjectsInput {
  bucket: string;
  keys: string[];
}

export interface DeleteObjectsResult {
  deleted: Array<{ key: string; versionId?: string }>;
  errors: Array<{ key: string; code: string; message: string }>;
}

export async function deleteObjects(
  input: DeleteObjectsInput,
): Promise<DeleteObjectsResult> {
  assertBucket(input.bucket);
  if (input.keys.length === 0) {
    throw new InvalidObjectTargetError("keys", "must contain at least one key");
  }
  for (const k of input.keys) assertKey(k);

  // Batches are independent — no ordering requirement between them —
  // so fire them in parallel. AWS SDK client handles connection pooling
  // + request coalescing.
  const s3 = getS3Client();
  const batches: string[][] = [];
  for (let i = 0; i < input.keys.length; i += DELETE_BATCH_MAX) {
    batches.push(input.keys.slice(i, i + DELETE_BATCH_MAX));
  }

  const responses = await Promise.all(
    batches.map((batch) =>
      s3.send(
        new DeleteObjectsCommand({
          Bucket: input.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: false },
        }),
      ),
    ),
  );

  const deleted: DeleteObjectsResult["deleted"] = [];
  const errors: DeleteObjectsResult["errors"] = [];
  for (const res of responses) {
    for (const d of res.Deleted ?? []) {
      if (d.Key !== undefined) {
        deleted.push({ key: d.Key, versionId: d.DeleteMarkerVersionId });
      }
    }
    for (const e of res.Errors ?? []) {
      if (e.Key !== undefined) {
        errors.push({
          key: e.Key,
          code: e.Code ?? "Unknown",
          message: e.Message ?? "",
        });
      }
    }
  }
  return { deleted, errors };
}
