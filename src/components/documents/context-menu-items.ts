import type { ContextMenuItem } from "./context-menu";

// Pure helper — no React state, no hooks. Safe to call from server
// components. Kept in a separate file from context-menu.tsx because
// that file is marked 'use client' (hooks + onContextMenu handler) and
// Next.js forbids server components from importing exported functions
// from a 'use client' module (even when the function itself is pure).
export function buildDocumentMenu({
  bucket,
  prefix = "",
  bucketId,
  s3Key,
  canHardDelete,
  canGenerateLink,
  basePath = "/documents",
}: {
  readonly bucket: string;
  readonly prefix?: string;
  readonly bucketId: string;
  readonly s3Key: string;
  readonly canHardDelete: boolean;
  readonly canGenerateLink: boolean;
  readonly basePath?: string;
}): ReadonlyArray<ContextMenuItem> {
  // Preserve current browse state (bucket + prefix) in every action href
  // so the page render stays in-scope when an action param (op=*) is
  // parsed. Without these, `parseBrowseQuery` returns `bucket: undefined`
  // and the dialog conditional in page.tsx never renders.
  const browse =
    `bucket=${encodeURIComponent(bucket)}` +
    (prefix ? `&prefix=${encodeURIComponent(prefix)}` : "");
  const q = (op: string) =>
    `${basePath}?${browse}&op=${op}` +
    `&bucketId=${encodeURIComponent(bucketId)}` +
    `&s3Key=${encodeURIComponent(s3Key)}`;
  // "Generate link" jumps to the /links page with the source document
  // preselected. Only admin+superadmin see the item — the /links page
  // renders an empty state for viewers, so hiding the entry here keeps
  // the menu honest instead of offering a dead click.
  const linkHref =
    `/links?fromBucketId=${encodeURIComponent(bucketId)}` +
    `&fromS3Key=${encodeURIComponent(s3Key)}`;
  return [
    { key: "preview", label: "View details", href: q("preview") },
    { key: "download", label: "Download", href: q("download") },
    { key: "move", label: "Move to…", href: q("move") },
    { key: "copy", label: "Copy to…", href: q("copy") },
    ...(!canGenerateLink
      ? []
      : [
          {
            key: "link",
            label: "Generate link",
            href: linkHref,
          } as ContextMenuItem,
        ]),
    { key: "delete", label: "Delete", href: q("delete"), danger: true },
    ...(!canHardDelete
      ? []
      : [
          {
            key: "hard-delete",
            label: "Delete permanently",
            href: q("hard-delete"),
            danger: true,
          } as ContextMenuItem,
        ]),
  ];
}

// Folder context menu — Delete (admin+) and Delete permanently
// (superadmin). Same href shape as buildDocumentMenu so the dialog
// mount in page.tsx parses both via shared `op` + `prefix` params.
// `canDelete` mirrors role gating: admins see Delete, viewers see
// nothing (caller short-circuits before invoking this builder).
export function buildFolderMenu({
  bucket,
  parentPrefix = "",
  bucketId,
  folderPrefix,
  canHardDelete,
  basePath = "/documents",
}: {
  readonly bucket: string;
  // Parent of the folder being acted on — preserves browse state so the
  // dialog mounts in the same view the user is in.
  readonly parentPrefix?: string;
  readonly bucketId: string;
  readonly folderPrefix: string; // ends with "/"
  readonly canHardDelete: boolean;
  readonly basePath?: string;
}): ReadonlyArray<ContextMenuItem> {
  const browse =
    `bucket=${encodeURIComponent(bucket)}` +
    (parentPrefix ? `&prefix=${encodeURIComponent(parentPrefix)}` : "");
  const q = (op: string) =>
    `${basePath}?${browse}&op=${op}` +
    `&bucketId=${encodeURIComponent(bucketId)}` +
    `&folderPrefix=${encodeURIComponent(folderPrefix)}`;
  return [
    {
      key: "delete-folder",
      label: "Delete",
      href: q("delete-folder"),
      danger: true,
    },
    ...(!canHardDelete
      ? []
      : [
          {
            key: "hard-delete-folder",
            label: "Delete permanently",
            href: q("hard-delete-folder"),
            danger: true,
          } as ContextMenuItem,
        ]),
  ];
}
