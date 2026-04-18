// Query-string layer for the document browser. Pure functions only —
// no I/O, no Prisma, no AWS SDK. Designed to be imported from both the
// Next.js server page and any shared render utility.
//
// Canonical URL shape:
//   /documents
//   /documents?bucket=<name>
//   /documents?bucket=<name>&prefix=<safe-prefix>
//   /documents?bucket=<name>&prefix=<safe-prefix>&view=grid|list

export type ViewMode = "grid" | "list";

export interface BrowseQuery {
  readonly bucket?: string;
  readonly prefix: string;
  readonly view: ViewMode;
}

// Match the S3 bucket-name validator already enforced at
// createBucket time: lowercase alnum + hyphen, 3–63 chars. Anything
// else in the URL is ignored (defensive — upstream route already
// rejects, but a URL-only state can drift).
const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function firstValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

// Normalise a URL-supplied prefix. Returns "" for any unsafe input so
// the browser cannot be tricked into issuing an S3 list against a
// traversal-style key path.
function sanitizePrefix(raw: string | undefined): string {
  if (!raw) return "";
  if (raw.startsWith("/")) return "";
  const segments = raw.split("/");
  if (segments.some((s) => s === "..")) return "";
  // Collapse consecutive slashes — "a//b/" → invalid.
  if (segments.some((s, i) => s === "" && i !== segments.length - 1)) return "";
  // Always end in "/" for folder-style listing via S3 delimiter="/".
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function sanitizeBucket(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!BUCKET_NAME_RE.test(raw)) return undefined;
  return raw;
}

function sanitizeView(raw: string | undefined): ViewMode {
  return raw === "grid" ? "grid" : "list";
}

export function parseBrowseQuery(
  params: Record<string, string | string[] | undefined>,
): BrowseQuery {
  return {
    bucket: sanitizeBucket(firstValue(params.bucket)),
    prefix: sanitizePrefix(firstValue(params.prefix)),
    view: sanitizeView(firstValue(params.view)),
  };
}

export interface Breadcrumb {
  readonly label: string;
  readonly prefix: string;
}

// Build crumb list for "bucket > folder > subfolder". Root crumb is the
// bucket itself at prefix "".
export function buildBreadcrumb(
  bucket: string,
  prefix: string,
): ReadonlyArray<Breadcrumb> {
  const crumbs: Breadcrumb[] = [{ label: bucket, prefix: "" }];
  if (!prefix) return crumbs;
  const parts = prefix.split("/").filter((s) => s !== "");
  let acc = "";
  for (const p of parts) {
    acc = `${acc}${p}/`;
    crumbs.push({ label: p, prefix: acc });
  }
  return crumbs;
}

// Extracts the last non-empty segment of a prefix (folder name UI).
export function folderNameFromPrefix(prefix: string): string {
  const parts = prefix.split("/").filter((s) => s !== "");
  return parts.length ? parts[parts.length - 1]! : "";
}

// Returns the parent prefix for an "Up one folder" link.
export function parentPrefix(prefix: string): string {
  const parts = prefix.split("/").filter((s) => s !== "");
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/") + "/";
}
