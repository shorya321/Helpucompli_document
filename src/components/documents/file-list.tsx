import Link from "next/link";
import { Folder, FileText } from "lucide-react";
import { formatStorage } from "@/components/buckets/bucket-card";
import { buildBreadcrumb } from "@/lib/documents-browse";
import { DownloadButton } from "@/components/documents/download-button";
import { ContextMenu } from "@/components/documents/context-menu";
import { buildDocumentMenu } from "@/components/documents/context-menu-items";

export type FileListEntry =
  | {
      readonly kind: "folder";
      readonly name: string;
      readonly prefix: string; // full prefix including trailing slash
    }
  | {
      readonly kind: "file";
      readonly key: string;
      readonly size: bigint;
      readonly lastModified?: Date;
    };

interface FileListProps {
  readonly bucket: string;
  readonly bucketId?: string;
  readonly canHardDelete?: boolean;
  readonly canGenerateLink?: boolean;
  readonly prefix: string;
  readonly entries: ReadonlyArray<FileListEntry>;
  readonly view: "grid" | "list";
}

interface FileRowProps {
  readonly entry: Extract<FileListEntry, { kind: "file" }>;
  readonly view: "grid" | "list";
  readonly bucket: string;
  readonly bucketId?: string;
  readonly prefix: string;
  readonly canHardDelete: boolean;
  readonly canGenerateLink: boolean;
}

function rowClass(view: "grid" | "list"): string {
  const base =
    "flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors";
  return view === "grid"
    ? `${base} border-border bg-card rounded-lg border hover:border-ring/40 hover:shadow-sm`
    : `${base} border-border/50 border-b last:border-b-0 hover:bg-muted/40`;
}

function FileRow({
  entry,
  view,
  bucket,
  bucketId,
  prefix,
  canHardDelete,
  canGenerateLink,
}: FileRowProps) {
  const inner = (
    <>
      <span className="text-foreground inline-flex items-baseline gap-2 break-all font-medium">
        <FileText aria-hidden="true" className="text-muted-foreground h-4 w-4 shrink-0" />
        {filenameFromKey(entry.key)}
      </span>
      <span className="inline-flex items-baseline gap-3">
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {formatStorage(entry.size)}
        </span>
        {bucketId ? (
          <DownloadButton bucketId={bucketId} s3Key={entry.key} />
        ) : null}
      </span>
    </>
  );

  if (!bucketId) {
    return <li className={rowClass(view)}>{inner}</li>;
  }

  return (
    <li className={rowClass(view)}>
      <ContextMenu
        items={buildDocumentMenu({
          bucket,
          prefix,
          bucketId,
          s3Key: entry.key,
          canHardDelete,
          canGenerateLink,
        })}
      >
        <span className="flex w-full flex-wrap items-baseline justify-between gap-3">
          {inner}
        </span>
      </ContextMenu>
    </li>
  );
}

function hrefForFolder(bucket: string, prefix: string): string {
  const b = encodeURIComponent(bucket);
  const p = encodeURIComponent(prefix);
  return `/documents?bucket=${b}&prefix=${p}`;
}

function filenameFromKey(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] ?? key;
}

export function FileList({
  bucket,
  bucketId,
  canHardDelete = false,
  canGenerateLink = false,
  prefix,
  entries,
  view,
}: FileListProps) {
  const crumbs = buildBreadcrumb(bucket, prefix);

  return (
    <section className="text-foreground flex flex-col gap-4">
      <nav aria-label="Breadcrumb">
        <ol className="m-0 flex flex-wrap gap-1 p-0 text-sm">
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            const href = hrefForFolder(bucket, c.prefix);
            return (
              <li
                key={`${c.prefix}-${c.label}`}
                className="flex items-baseline gap-1"
              >
                {i > 0 ? (
                  <span aria-hidden="true" className="text-muted-foreground">
                    /
                  </span>
                ) : null}
                {isLast ? (
                  <span
                    aria-current="page"
                    className="text-foreground font-semibold"
                  >
                    {c.label}
                  </span>
                ) : (
                  <Link
                    href={href}
                    className="text-muted-foreground hover:text-foreground no-underline transition-colors"
                  >
                    {c.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {entries.length === 0 ? (
        <p
          className="border-border bg-card text-muted-foreground m-0 rounded-xl border border-dashed px-6 py-10 text-center text-sm"
          data-view={view}
        >
          This folder is empty.
        </p>
      ) : (
        <ul
          role="list"
          data-view={view}
          className={
            view === "grid"
              ? "m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3 p-0"
              : "border-border bg-card shadow-xs m-0 flex list-none flex-col overflow-hidden rounded-xl border p-0"
          }
        >
          {entries.map((e) =>
            e.kind === "folder" ? (
              <li
                key={`folder:${e.prefix}`}
                className={
                  view === "grid"
                    ? "border-border bg-card rounded-lg border px-4 py-2.5 transition-all hover:border-ring/40 hover:shadow-sm"
                    : "border-border/50 border-b px-4 py-2.5 last:border-b-0 transition-colors hover:bg-muted/40"
                }
              >
                <Link
                  href={hrefForFolder(bucket, e.prefix)}
                  className="text-foreground hover:text-foreground inline-flex items-center gap-2 break-all text-sm font-medium no-underline transition-colors"
                >
                  <Folder
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0"
                  />
                  {e.name}/
                </Link>
              </li>
            ) : (
              <FileRow
                key={`file:${e.key}`}
                entry={e}
                view={view}
                bucket={bucket}
                bucketId={bucketId}
                prefix={prefix}
                canHardDelete={canHardDelete}
                canGenerateLink={canGenerateLink}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}
