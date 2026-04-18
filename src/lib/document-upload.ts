import { z } from "zod";
import {
  MAX_FILE_SIZE_BYTES,
  MULTIPART_THRESHOLD_BYTES,
} from "./s3-multipart";

// Upload orchestration layer. Pure functions + schemas only — this
// module is shared by the upload-url API route, the upload-complete API
// route, and the upload-zone client component. Keeping the filename/key
// rules in one place prevents drift between the three surfaces.

export const MAX_FILENAME_LENGTH = 255;

// RFC 6838 media-type subset. Matches s3-presign SAFE_CONTENT_TYPE_RE.
const SAFE_CONTENT_TYPE_RE =
  /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]{0,127}\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]{0,127}$/;

// Folder prefix grammar: non-empty lowercase alnum + hyphen segments
// separated by '/', always terminated by '/'. Empty string = bucket root.
// Rejects traversal segments (..), leading slash, empty segments.
const FOLDER_PREFIX_RE = /^(?:[a-zA-Z0-9][a-zA-Z0-9._-]*\/)+$/;

export function assertFolderPrefix(prefix: string): void {
  if (prefix === "") return;
  if (!FOLDER_PREFIX_RE.test(prefix)) {
    throw new Error(`Invalid folderPrefix: ${JSON.stringify(prefix)}`);
  }
  if (prefix.split("/").includes("..")) {
    throw new Error("folderPrefix must not contain '..'");
  }
}

// Sanitize user-supplied filename into a safe object-key suffix. Strips
// any path component (so "../../etc/passwd" → "passwd"), collapses
// filesystem separators + control characters to "_", and caps length.
export function sanitizeFilename(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const stripControl = raw.replace(/[\u0000-\u001f\u007f]/g, "_");
  const segments = stripControl.split(/[\\/]/).filter((s) => s !== "");
  const last = segments.length ? segments[segments.length - 1]! : "";
  // Replace any residual filesystem separators that survived (defense
  // against odd encodings) plus quote/backtick which would break
  // Content-Disposition filename="..." roundtripping.
  const replaced = last.replace(/[\\/"`]/g, "_");
  if (!replaced) return "file";
  return replaced.slice(0, MAX_FILENAME_LENGTH);
}

export interface BuildUploadKeyInput {
  readonly folderPrefix: string;
  readonly filename: string;
  readonly uuid: string;
}

// Deterministic key shape: `${folderPrefix}${uuid}-${safeFilename}`.
// The UUID makes S3 ETag collisions safe (two uploads of the same bytes
// under the same logical name get distinct keys) and prevents
// overwriting a prior object by re-uploading the same filename.
export function buildUploadKey(input: BuildUploadKeyInput): string {
  assertFolderPrefix(input.folderPrefix);
  const safe = sanitizeFilename(input.filename);
  return `${input.folderPrefix}${input.uuid}-${safe}`;
}

export type UploadMode = "simple" | "multipart";

export function chooseUploadMode(sizeBytes: number): UploadMode {
  if (
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > MAX_FILE_SIZE_BYTES
  ) {
    throw new Error(
      `Invalid sizeBytes ${sizeBytes}: must be in (0, ${MAX_FILE_SIZE_BYTES}]`,
    );
  }
  return sizeBytes > MULTIPART_THRESHOLD_BYTES ? "multipart" : "simple";
}

// Zod schemas — used by both API routes for input validation.
const folderPrefixSchema = z
  .string()
  .max(512)
  .refine((v) => {
    try {
      assertFolderPrefix(v);
      return true;
    } catch {
      return false;
    }
  }, "invalid folderPrefix");

export const uploadUrlRequestSchema = z.object({
  bucketId: z.string().uuid(),
  filename: z.string().min(1).max(MAX_FILENAME_LENGTH),
  contentType: z.string().regex(SAFE_CONTENT_TYPE_RE, "invalid contentType"),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_FILE_SIZE_BYTES),
  folderPrefix: folderPrefixSchema.default(""),
});

export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>;

// Accept the same S3 ETag grammar as s3-multipart (quoted 32-hex with
// optional "-<N>" suffix). A client-fabricated ETag cannot get past S3
// anyway, but we reject at the API boundary for a better error surface.
const etagSchema = z.string().regex(/^"[0-9a-fA-F]{32}(?:-\d+)?"$/);

const s3KeySchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((k) => !k.startsWith("/"), "must not start with '/'")
  .refine(
    (k) => !k.split("/").includes(".."),
    "must not contain '..'",
  );

export const uploadCompleteRequestSchema = z.object({
  bucketId: z.string().uuid(),
  s3Key: s3KeySchema,
  filename: z.string().min(1).max(MAX_FILENAME_LENGTH),
  contentType: z.string().regex(SAFE_CONTENT_TYPE_RE, "invalid contentType"),
  sizeBytes: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
  multipart: z
    .object({
      uploadId: z.string().min(1).max(1024),
      parts: z
        .array(
          z.object({
            partNumber: z.number().int().positive().max(10_000),
            etag: etagSchema,
          }),
        )
        .min(1),
    })
    .optional(),
});

export type UploadCompleteRequest = z.infer<typeof uploadCompleteRequestSchema>;
