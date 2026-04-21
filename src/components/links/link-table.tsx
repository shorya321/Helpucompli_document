"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format-datetime";
import type { ApiResponse } from "@/types";
import type { LinkListResult, LinkListRow, LinkStatus } from "@/lib/link-list";

// Native <select> styled to match shadcn Input. Filter controls submit
// client-side state, but we stay on the native DOM element to keep the
// Radix popover out of the table header row.
const nativeSelectClass =
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";

type WireRow = Omit<LinkListRow, "createdAt" | "expiresAt"> & {
  createdAt: string;
  expiresAt: string;
};
type WirePayload = { rows: WireRow[]; nextCursor: string | null };

const STATUS_OPTIONS: ReadonlyArray<{
  value: "all" | LinkStatus;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
];

const SORT_OPTIONS: ReadonlyArray<{
  value: "createdAt" | "expiresAt" | "downloadCount";
  label: string;
}> = [
  { value: "createdAt", label: "Created" },
  { value: "expiresAt", label: "Expires" },
  { value: "downloadCount", label: "Downloads" },
];

function StatusBadge({ status }: { readonly status: LinkStatus }) {
  if (status === "active") {
    return (
      <Badge
        variant="secondary"
        className="text-[0.65rem] uppercase tracking-wide"
      >
        active
      </Badge>
    );
  }
  if (status === "revoked") {
    return (
      <Badge
        variant="destructive"
        className="text-[0.65rem] uppercase tracking-wide"
      >
        revoked
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground text-[0.65rem] uppercase tracking-wide"
    >
      expired
    </Badge>
  );
}

function buildQuery(
  status: "all" | LinkStatus,
  sort: "createdAt" | "expiresAt" | "downloadCount",
  dir: "asc" | "desc",
  cursor: string | null,
): string {
  const sp = new URLSearchParams();
  sp.set("status", status);
  sp.set("sort", sort);
  sp.set("dir", dir);
  if (cursor) sp.set("cursor", cursor);
  sp.set("limit", "50");
  return `?${sp.toString()}`;
}

async function fetchLinks(qs: string): Promise<LinkListResult> {
  const res = await fetch(`/api/links${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as ApiResponse<WirePayload>;
  const data = body.data ?? { rows: [], nextCursor: null };
  return {
    rows: data.rows.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt),
      expiresAt: new Date(r.expiresAt),
    })),
    nextCursor: data.nextCursor,
  };
}

interface LinkTableProps {
  readonly initial: LinkListResult;
}

async function revokeLink(id: string): Promise<void> {
  // Sec-review C1: revoke is keyed on link.id (UUID) not the bearer
  // token, so the admin browser never receives valid tokens.
  const res = await fetch(`/api/links/admin/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`HTTP ${res.status}`);
  }
}

export function LinkTable({ initial }: LinkTableProps) {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<string | null>(null);
  const onRevoke = async (id: string) => {
    if (!window.confirm("Revoke this link? Anyone holding the URL will get 403.")) {
      return;
    }
    setRevoking(id);
    try {
      await revokeLink(id);
      await queryClient.invalidateQueries({ queryKey: ["links"] });
    } catch {
      window.alert("Failed to revoke. Try again.");
    } finally {
      setRevoking(null);
    }
  };
  const [status, setStatus] = useState<"all" | LinkStatus>("all");
  const [sort, setSort] = useState<
    "createdAt" | "expiresAt" | "downloadCount"
  >("createdAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [cursor, setCursor] = useState<string | null>(null);

  const qs = buildQuery(status, sort, dir, cursor);
  const isInitialQuery =
    cursor === null && status === "all" && sort === "createdAt" && dir === "desc";

  const { data, isFetching, isError } = useQuery({
    queryKey: ["links", qs],
    queryFn: () => fetchLinks(qs),
    initialData: isInitialQuery ? initial : undefined,
    staleTime: 0,
  });

  const rows = data?.rows ?? [];
  const nextCursor = data?.nextCursor ?? null;

  return (
    <section className="mt-8 flex flex-col gap-3">
      <header className="flex flex-wrap items-end gap-3">
        <h2 className="text-foreground m-0 flex-1 text-base font-bold">
          Generated links
        </h2>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="links-status" className="sr-only">
            Filter status
          </Label>
          <select
            id="links-status"
            aria-label="Filter status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as "all" | LinkStatus);
              setCursor(null);
            }}
            className={nativeSelectClass}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="links-sort" className="sr-only">
            Sort field
          </Label>
          <select
            id="links-sort"
            aria-label="Sort field"
            value={sort}
            onChange={(e) => {
              setSort(
                e.target.value as "createdAt" | "expiresAt" | "downloadCount",
              );
              setCursor(null);
            }}
            className={nativeSelectClass}
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={dir === "desc" ? "Descending" : "Ascending"}
          onClick={() => {
            setDir(dir === "asc" ? "desc" : "asc");
            setCursor(null);
          }}
        >
          {dir === "desc" ? (
            <ArrowDown aria-hidden="true" />
          ) : (
            <ArrowUp aria-hidden="true" />
          )}
        </Button>
      </header>

      {isError && (
        <p role="alert" className="text-destructive text-sm">
          Failed to load links.
        </p>
      )}

      {rows.length === 0 && !isFetching ? (
        <div className="border-border bg-card text-muted-foreground rounded-lg border border-dashed p-6 text-center">
          No links match the current filter.
        </div>
      ) : (
        <Card className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead>Downloads</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="text-foreground font-semibold">
                      {row.documentName}
                    </span>
                    <br />
                    <span className="text-muted-foreground text-xs">
                      {row.bucketName}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.generatedByName ?? row.generatedByEmail ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.downloadCount}
                    {row.maxDownloads !== null
                      ? ` / ${row.maxDownloads}`
                      : ""}
                  </TableCell>
                  <TableCell
                    className="tabular-nums"
                    title={row.expiresAt.toISOString()}
                  >
                    {formatDateTime(row.expiresAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.status === "active" ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => onRevoke(row.id)}
                        disabled={revoking === row.id}
                      >
                        {revoking === row.id ? "Revoking…" : "Revoke"}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="text-muted-foreground flex items-center gap-2 py-3 text-sm">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCursor(null)}
          disabled={cursor === null || isFetching}
        >
          ⟲ First page
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => nextCursor && setCursor(nextCursor)}
          disabled={!nextCursor || isFetching}
        >
          Next page →
        </Button>
        <span className="tabular-nums">
          {isFetching ? "Loading…" : `${rows.length} rows`}
        </span>
      </div>
    </section>
  );
}
