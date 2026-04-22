"use client";

import { useCallback, useMemo, useState } from "react";
import { FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatStorage } from "@/components/buckets/bucket-card";
import { formatRelative } from "@/lib/format-time";
import type {
  BucketDetailsDocument,
  BucketDocumentsPage,
} from "@/lib/bucket-details";
import type { ApiResponse } from "@/types";

// Wire-format type — server JSON-serialises Date → string and BigInt →
// string (via toJsonSafe in the route handler), so we coerce on receive.
interface WireDocument {
  readonly id: string;
  readonly filename: string;
  readonly sizeBytes: string | number;
  readonly contentType: string | null;
  readonly uploadedAt: string;
  readonly uploadedByName: string | null;
}

interface WirePage {
  readonly entries: readonly WireDocument[];
  readonly nextCursor: string | null;
}

interface RecentDocsListProps {
  readonly bucketId: string;
  readonly initial: readonly BucketDetailsDocument[];
  readonly initialNextCursor: string | null;
}

const LOAD_MORE_LIMIT = 10;
const MAX_DISPLAYED = 100;

class DocsFetchError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "DocsFetchError";
  }
}

async function fetchNextDocsPage(
  bucketId: string,
  cursor: string,
  limit: number,
): Promise<BucketDocumentsPage> {
  const res = await fetch(
    `/api/s3/buckets/${encodeURIComponent(bucketId)}/documents?cursor=${encodeURIComponent(cursor)}&limit=${limit}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    let serverErr: string | undefined;
    try {
      const body = (await res.json()) as ApiResponse<unknown>;
      serverErr = body.error ?? undefined;
    } catch {
      // body wasn't JSON
    }
    throw new DocsFetchError(
      res.status,
      `HTTP ${res.status}${serverErr ? `: ${serverErr}` : ""}`,
    );
  }
  const body = (await res.json()) as ApiResponse<WirePage>;
  if (!body.data) {
    throw new DocsFetchError(500, body.error ?? "Empty payload");
  }
  return {
    entries: body.data.entries.map(coerceWire),
    nextCursor: body.data.nextCursor,
  };
}

function coerceWire(w: WireDocument): BucketDetailsDocument {
  return {
    id: w.id,
    filename: w.filename,
    sizeBytes: BigInt(typeof w.sizeBytes === "string" ? w.sizeBytes : Math.floor(w.sizeBytes)),
    contentType: w.contentType,
    uploadedAt: new Date(w.uploadedAt),
    uploadedByName: w.uploadedByName,
  };
}

export function RecentDocsList({
  bucketId,
  initial,
  initialNextCursor,
}: RecentDocsListProps) {
  const [appended, setAppended] = useState<readonly BucketDetailsDocument[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialNextCursor,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const allDocs = useMemo(() => {
    const seen = new Set<string>();
    const merged: BucketDetailsDocument[] = [];
    for (const d of [...initial, ...appended]) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      merged.push(d);
    }
    return merged;
  }, [initial, appended]);

  const canLoadMore =
    nextCursor !== null && allDocs.length < MAX_DISPLAYED && !loadingMore;

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    setExhausted(false);
    try {
      const page = await fetchNextDocsPage(
        bucketId,
        nextCursor,
        LOAD_MORE_LIMIT,
      );
      setAppended((prev) => [...prev, ...page.entries]);
      setNextCursor(page.nextCursor);
      if (page.entries.length === 0 || page.nextCursor === null) {
        setExhausted(true);
      }
    } catch (e) {
      let suffix = "";
      if (e instanceof DocsFetchError) {
        suffix = ` (HTTP ${e.status})`;
        if (process.env.NODE_ENV !== "production") {
          console.error("[recent-docs] load-more failed:", e.message);
        }
      } else if (e instanceof Error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[recent-docs] load-more failed:", e);
        }
      }
      setLoadMoreError(`Unable to load more documents.${suffix}`);
    } finally {
      setLoadingMore(false);
    }
  }, [bucketId, nextCursor, loadingMore]);

  if (allDocs.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <p className="text-muted-foreground m-0 text-sm">
            No documents uploaded yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="overflow-hidden py-0">
        <ul
          role="list"
          className="m-0 flex list-none flex-col divide-y divide-border/60 p-0"
        >
          {allDocs.map((d) => (
            <li
              key={d.id}
              className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/40"
            >
              <span className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
                <FileText aria-hidden="true" className="size-4" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span
                  className="text-foreground truncate text-sm font-medium"
                  title={d.filename}
                >
                  {d.filename}
                </span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {d.contentType ?? "unknown"} · {formatStorage(d.sizeBytes)}
                </span>
              </div>
              <div className="ml-auto flex shrink-0 flex-col items-end gap-0.5">
                <time
                  className="text-muted-foreground font-mono text-xs tabular-nums"
                  dateTime={d.uploadedAt.toISOString()}
                  title={d.uploadedAt.toISOString()}
                >
                  {formatRelative(d.uploadedAt)}
                </time>
                <span className="text-muted-foreground truncate text-xs">
                  {d.uploadedByName ?? "unknown"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {loadMoreError ? (
        <p role="alert" className="text-destructive text-center text-sm">
          {loadMoreError}
        </p>
      ) : null}
      {canLoadMore ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            data-testid="bucket-docs-load-more"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
      {exhausted && !loadingMore && !loadMoreError ? (
        <p className="text-muted-foreground text-center text-xs">
          No more documents to load.
        </p>
      ) : null}
    </div>
  );
}
