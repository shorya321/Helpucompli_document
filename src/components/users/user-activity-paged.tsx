"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format-datetime";
import type { AuditQueryResult, AuditQueryRow } from "@/lib/audit-query";
import type { ApiResponse } from "@/types";

const PAGE_SIZE = 10;

interface WireRow extends Omit<AuditQueryRow, "createdAt"> {
  readonly createdAt: string;
}

interface WireResult {
  readonly rows: readonly WireRow[];
  readonly nextCursor: string | null;
}

interface UserActivityPagedProps {
  readonly userId: string;
  readonly initialRows: readonly AuditQueryRow[];
  readonly initialNextCursor: string | null;
}

class AuditFetchError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AuditFetchError";
  }
}

async function fetchPage(
  userId: string,
  cursor: string | null,
): Promise<AuditQueryResult> {
  const params = new URLSearchParams({
    userId,
    limit: String(PAGE_SIZE),
  });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/audit?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    let serverErr: string | undefined;
    try {
      const body = (await res.json()) as ApiResponse<unknown>;
      serverErr = body.error ?? undefined;
    } catch {
      // body wasn't JSON
    }
    throw new AuditFetchError(
      res.status,
      `HTTP ${res.status}${serverErr ? `: ${serverErr}` : ""}`,
    );
  }
  const body = (await res.json()) as ApiResponse<WireResult>;
  if (!body.data) {
    throw new AuditFetchError(500, body.error ?? "Empty payload");
  }
  return {
    rows: body.data.rows.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt),
    })),
    nextCursor: body.data.nextCursor,
  };
}

export function UserActivityPaged({
  userId,
  initialRows,
  initialNextCursor,
}: UserActivityPagedProps) {
  const [rows, setRows] = useState<readonly AuditQueryRow[]>(initialRows);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialNextCursor,
  );
  // Stack of cursors used to reach previous pages. Index = page number - 1.
  // Page 1 → []. Page 2 → [cursorAfterPage1]. Page 3 → [c1, c2].
  const [cursorStack, setCursorStack] = useState<ReadonlyArray<string | null>>([
    null,
  ]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goNext = useCallback(async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPage(userId, nextCursor);
      setCursorStack((prev) => [...prev, nextCursor]);
      setRows(result.rows);
      setNextCursor(result.nextCursor);
      setPage((p) => p + 1);
    } catch (e) {
      let suffix = "";
      if (e instanceof AuditFetchError) suffix = ` (HTTP ${e.status})`;
      setError(`Unable to load activity.${suffix}`);
    } finally {
      setLoading(false);
    }
  }, [userId, nextCursor, loading]);

  const goPrev = useCallback(async () => {
    if (page <= 1 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const targetCursor = cursorStack[page - 2] ?? null;
      const result = await fetchPage(userId, targetCursor);
      setCursorStack((prev) => prev.slice(0, prev.length - 1));
      setRows(result.rows);
      setNextCursor(result.nextCursor);
      setPage((p) => p - 1);
    } catch (e) {
      let suffix = "";
      if (e instanceof AuditFetchError) suffix = ` (HTTP ${e.status})`;
      setError(`Unable to load activity.${suffix}`);
    } finally {
      setLoading(false);
    }
  }, [userId, page, cursorStack, loading]);

  if (rows.length === 0 && page === 1) {
    return (
      <p className="text-muted-foreground text-sm">
        No audited activity for this user yet.
      </p>
    );
  }

  const canPrev = page > 1 && !loading;
  const canNext = nextCursor !== null && !loading;

  return (
    <div className="flex flex-col gap-3">
      <ul role="list" className="m-0 list-none p-0">
        {rows.map((row) => (
          <ActivityItem key={row.id} row={row} />
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs tabular-nums">
          Page {page}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={goPrev}
            disabled={!canPrev}
            data-testid="user-activity-prev"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={goNext}
            disabled={!canNext}
            data-testid="user-activity-next"
          >
            {loading ? "Loading…" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ActivityItem({ row }: { readonly row: AuditQueryRow }) {
  return (
    <li className="border-border grid grid-cols-[9rem_1fr_auto] gap-3 border-b py-2 text-xs last:border-b-0">
      <span className="text-muted-foreground tabular-nums">
        {formatDateTime(row.createdAt)}
      </span>
      <span className="text-foreground font-semibold">{row.action}</span>
      <span className="text-muted-foreground text-xs">
        {row.targetType}:{row.targetId}
      </span>
    </li>
  );
}
