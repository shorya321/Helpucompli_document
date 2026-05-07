import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RestoreButton } from "@/components/documents/restore-button";
import { RestoreFolderButton } from "@/components/documents/restore-folder-button";

export interface TrashDocumentEntry {
  readonly kind: "document";
  readonly id: string;
  readonly bucketId: string;
  readonly bucketName: string;
  readonly s3Key: string;
  readonly filename: string;
  readonly contentType: string | null;
  readonly sizeBytes: bigint;
  readonly deletedAt: Date | null;
  readonly deletedByEmail: string | null;
}

export interface TrashFolderEntry {
  readonly kind: "folder";
  readonly id: string;
  readonly bucketId: string;
  readonly bucketName: string;
  readonly prefix: string;
  readonly deletedAt: Date | null;
}

export type TrashEntry = TrashDocumentEntry | TrashFolderEntry;

interface TrashViewProps {
  readonly entries: ReadonlyArray<TrashEntry>;
  readonly canHardDelete: boolean;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatStorage(bytes: bigint): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function entryTitle(entry: TrashEntry): string {
  return entry.kind === "folder" ? entry.prefix : entry.filename;
}

export function TrashView({ entries, canHardDelete }: TrashViewProps) {
  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <Link
            href="/documents"
            className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs no-underline transition-colors"
          >
            <ArrowLeft aria-hidden="true" className="size-3" />
            Back to documents
          </Link>
          <h1 className="text-foreground m-0 text-3xl font-semibold tracking-tight">
            Trash
          </h1>
          <p className="text-muted-foreground m-0 text-sm">
            Soft-deleted documents. Restoring removes the S3 delete-marker
            and returns the document to its original location.
          </p>
        </div>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {entries.length} {entries.length === 1 ? "item" : "items"}
        </span>
      </header>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground m-0 text-sm">
              Trash is empty.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <ul
            role="list"
            className="m-0 flex list-none flex-col divide-y divide-border/60 p-0"
          >
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-foreground truncate text-sm font-medium">
                    {entryTitle(e)}
                  </span>
                  <span className="text-muted-foreground font-mono text-xs tabular-nums">
                    {e.bucketName}
                    {e.kind === "document" ? ` · ${formatStorage(e.sizeBytes)}` : ""}
                    {e.deletedAt
                      ? ` · deleted ${DATE_FORMAT.format(e.deletedAt)}`
                      : ""}
                    {e.kind === "document" && e.deletedByEmail
                      ? ` by ${e.deletedByEmail}`
                      : ""}
                  </span>
                  <span className="text-muted-foreground font-mono text-[10px] truncate">
                    {e.kind === "folder" ? e.prefix : e.s3Key}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="whitespace-nowrap text-[10px] uppercase tracking-wide">
                    {e.kind === "folder" ? "Folder" : "Document"}
                  </Badge>
                  {e.kind === "folder" ? (
                    <RestoreFolderButton bucketId={e.bucketId} prefix={e.prefix} />
                  ) : (
                    <RestoreButton
                      bucketId={e.bucketId}
                      s3Key={e.s3Key}
                      filename={e.filename}
                    />
                  )}
                  {e.kind === "document" && canHardDelete ? (
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/documents?op=hard-delete&bucketId=${encodeURIComponent(
                          e.bucketId,
                        )}&s3Key=${encodeURIComponent(e.s3Key)}`}
                      >
                        <Trash2 aria-hidden="true" className="size-3.5" />
                        Purge
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}
