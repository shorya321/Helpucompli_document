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
