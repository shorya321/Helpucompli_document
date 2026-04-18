import type { ContextMenuItem } from "./context-menu";

// Pure helper — no React state, no hooks. Safe to call from server
// components. Kept in a separate file from context-menu.tsx because
// that file is marked 'use client' (hooks + onContextMenu handler) and
// Next.js forbids server components from importing exported functions
// from a 'use client' module (even when the function itself is pure).
export function buildDocumentMenu({
  bucketId,
  s3Key,
  canHardDelete,
  basePath = "/documents",
}: {
  readonly bucketId: string;
  readonly s3Key: string;
  readonly canHardDelete: boolean;
  readonly basePath?: string;
}): ReadonlyArray<ContextMenuItem> {
  const q = (op: string) =>
    `${basePath}?op=${op}&bucketId=${encodeURIComponent(bucketId)}&s3Key=${encodeURIComponent(s3Key)}`;
  return [
    { key: "preview", label: "View details", href: q("preview") },
    { key: "download", label: "Download", href: q("download") },
    { key: "move", label: "Move to…", href: q("move") },
    { key: "copy", label: "Copy to…", href: q("copy") },
    {
      key: "link",
      label: "Generate link",
      href: q("link"),
      disabled: true, // F9 wires the link engine
    },
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
