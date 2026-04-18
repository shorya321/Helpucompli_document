import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "./s3";
import { assertFolderPrefix } from "./document-upload";

// Folder-name grammar: Unicode letters + digits, plus `.`, `-`, `_`.
// Rejects slashes, backslashes, whitespace, control chars. Unicode
// letters are intentionally permitted — tenants with non-ASCII labels
// (e.g. French, Japanese) must be able to organise their buckets.
const FOLDER_NAME_RE = /^[\p{L}\p{N}._-]+$/u;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
export const MAX_FOLDER_NAME_LENGTH = 128;

export class InvalidFolderNameError extends Error {
  constructor(reason: string) {
    super(`Invalid folder name: ${reason}`);
    this.name = "InvalidFolderNameError";
  }
}

export function assertFolderName(name: string): void {
  if (!name) throw new InvalidFolderNameError("must not be empty");
  if (name.length > MAX_FOLDER_NAME_LENGTH) {
    throw new InvalidFolderNameError(
      `must be ≤ ${MAX_FOLDER_NAME_LENGTH} characters`,
    );
  }
  if (CONTROL_CHAR_RE.test(name)) {
    throw new InvalidFolderNameError("must not contain control characters");
  }
  if (name === "." || name === ".." || name.startsWith(".")) {
    throw new InvalidFolderNameError(
      "must not be '.' / '..' or start with a dot",
    );
  }
  if (!FOLDER_NAME_RE.test(name)) {
    throw new InvalidFolderNameError(
      "only letters, digits, '.', '-', '_' allowed",
    );
  }
}

// Pure — throws on invalid parentPrefix or name. No I/O.
export function buildFolderKey(parentPrefix: string, name: string): string {
  assertFolderPrefix(parentPrefix);
  assertFolderName(name);
  return `${parentPrefix}${name}/`;
}

export interface CreateFolderInput {
  readonly bucket: string; // S3 bucket NAME (not DB id)
  readonly parentPrefix: string; // "" or "a/b/"
  readonly name: string;
}

export interface CreateFolderResult {
  readonly key: string;
}

// Creates a zero-byte "folder marker" object at `<parentPrefix><name>/`.
// S3 has no real folders — this marker is what makes the folder appear
// in `ListObjectsV2(delimiter='/')` via CommonPrefixes. SSE-KMS is
// applied by bucket default encryption (F3.2) — we intentionally do
// NOT set SSE-KMS headers here: the F6.2 upload flow had to drop them
// for the same reason (signature / header mismatch concerns) and the
// bucket-level default is the single source of truth for encryption.
export async function createFolderMarker(
  input: CreateFolderInput,
): Promise<CreateFolderResult> {
  if (!input.bucket) {
    throw new InvalidFolderNameError("bucket name is required");
  }
  const key = buildFolderKey(input.parentPrefix, input.name);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: key,
      // Zero-byte body; explicitly empty string so the SDK sets
      // Content-Length: 0 and does not buffer.
      Body: "",
    }),
  );
  return { key };
}
