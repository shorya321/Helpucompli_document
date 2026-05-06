"use client";

import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataPagination } from "@/components/ui/data-pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { actionBadgeTone, type BadgeTone } from "@/lib/activity-feed";
import { formatDateTime } from "@/lib/format-datetime";
import { AuditFilters, EMPTY_FILTERS, type AuditFiltersValue } from "@/components/audit/audit-filters";
import { ExportCsv } from "@/components/audit/export-csv";
import type { ApiResponse } from "@/types";
import type { AuditQueryResult, AuditQueryRow } from "@/lib/audit-query";

type WireRow = Omit<AuditQueryRow, "createdAt"> & { createdAt: string };
type WirePayload = { rows: WireRow[]; nextCursor: string | null };

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

// Mirrors the TONE_VARIANT mapping in components/dashboard/activity-feed.tsx
// so the audit table and the dashboard activity feed render the same
// action with the same Badge variant.
const TONE_VARIANT: Record<BadgeTone, BadgeVariant> = {
  info: "secondary",
  success: "default",
  warning: "outline",
  danger: "destructive",
};

function buildQuery(filters: AuditFiltersValue, cursor: string | null): string {
  const sp = new URLSearchParams();
  if (filters.userId) sp.set("userId", filters.userId);
  if (filters.targetType) sp.set("targetType", filters.targetType);
  if (filters.dateFrom) sp.set("dateFrom", `${filters.dateFrom}T00:00:00Z`);
  if (filters.dateTo) sp.set("dateTo", `${filters.dateTo}T23:59:59Z`);
  for (const a of filters.actions) sp.append("actions", a);
  if (cursor) sp.set("cursor", cursor);
  sp.set("limit", "10");
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

async function fetchAudit(
  filters: AuditFiltersValue,
  cursor: string | null,
): Promise<AuditQueryResult> {
  const res = await fetch(`/api/audit${buildQuery(filters, cursor)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as ApiResponse<WirePayload>;
  const data = body.data ?? { rows: [], nextCursor: null };
  return {
    rows: data.rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })),
    nextCursor: data.nextCursor,
  };
}

interface AuditTableProps {
  readonly initial: AuditQueryResult;
}

export function AuditTable({ initial }: AuditTableProps) {
  const [filters, setFilters] = useState<AuditFiltersValue>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<AuditFiltersValue>(EMPTY_FILTERS);
  const [cursor, setCursor] = useState<string | null>(null);
  // Cursor history stack — pushed on Next so Prev can pop back. Reset on
  // filter apply / reset. Page index = history.length + 1.
  const [history, setHistory] = useState<ReadonlyArray<string | null>>([]);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["audit", appliedFilters, cursor],
    queryFn: () => fetchAudit(appliedFilters, cursor),
    initialData:
      cursor === null && appliedFilters === EMPTY_FILTERS ? initial : undefined,
    staleTime: 0,
  });

  const rows = data?.rows ?? [];
  const nextCursor = data?.nextCursor ?? null;

  const columns = useMemo<ColumnDef<AuditQueryRow>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "Timestamp",
        cell: ({ getValue }) => {
          const d = getValue<Date>();
          return (
            <span
              title={d.toISOString()}
              className="font-mono text-xs tabular-nums"
            >
              {formatDateTime(d)}
            </span>
          );
        },
      },
      {
        accessorFn: (r) => r.userName ?? r.userEmail ?? r.userId ?? "System",
        id: "user",
        header: "User",
      },
      {
        id: "action",
        header: "Action",
        cell: ({ row }) => {
          const r = row.original;
          // Folder creation is logged as DOCUMENT_UPLOAD with
          // targetType=folder + metadata.mode=folder_marker (no
          // dedicated enum value — see src/app/api/s3/folders/route.ts).
          // Display synthetic "FOLDER_CREATE" so reviewers can tell
          // folders apart from real document uploads at a glance. The
          // colour tone still derives from the underlying action so
          // grouping behaviour is unchanged.
          const display =
            r.action === "DOCUMENT_UPLOAD" && r.targetType === "folder"
              ? "FOLDER_CREATE"
              : r.action;
          const variant =
            TONE_VARIANT[
              actionBadgeTone(
                r.action as Parameters<typeof actionBadgeTone>[0],
              )
            ];
          // Surface allowPublicEmbed (per-link iframe opt-in) inline so
          // reviewers can spot embed-enabled links without expanding
          // metadata. The bit is recorded by link-create at audit time
          // (`metadata.allowPublicEmbed`) but is not in any DB column
          // on the audit row itself — it lives in the JSON blob.
          const showEmbed =
            r.action === "LINK_GENERATE" &&
            r.metadata !== null &&
            (r.metadata as { allowPublicEmbed?: boolean })
              .allowPublicEmbed === true;
          return (
            <span className="inline-flex items-center gap-1">
              <Badge
                variant={variant}
                className="font-mono text-[10px] uppercase tracking-wide"
              >
                {display}
              </Badge>
              {showEmbed ? (
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] uppercase tracking-wide"
                >
                  EMBED
                </Badge>
              ) : null}
            </span>
          );
        },
      },
      {
        accessorFn: (r) => `${r.targetType}:${r.targetId}`,
        id: "target",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs tabular-nums">
            {getValue<string>()}
          </span>
        ),
        header: "Target",
      },
      {
        accessorKey: "ipAddress",
        header: "IP address",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs tabular-nums">
            {getValue<string>()}
          </span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows as AuditQueryRow[],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
  });

  const apply = () => {
    setCursor(null);
    setHistory([]);
    setAppliedFilters(filters);
  };
  const reset = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setCursor(null);
    setHistory([]);
  };

  return (
    <div className="flex flex-col gap-2">
      <AuditFilters
        value={filters}
        onChange={setFilters}
        onApply={apply}
        onReset={reset}
        disabled={isFetching}
      />
      <div className="flex justify-end">
        <ExportCsv filters={appliedFilters} />
      </div>
      {isError && (
        <p role="alert" className="text-destructive text-sm">
          Failed to load audit log.
        </p>
      )}
      <Card className="p-0">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => {
                  const canSort = h.column.getCanSort();
                  const sorted = h.column.getIsSorted();
                  const ariaSort =
                    sorted === "asc"
                      ? "ascending"
                      : sorted === "desc"
                        ? "descending"
                        : canSort
                          ? "none"
                          : undefined;
                  return (
                    <TableHead
                      key={h.id}
                      aria-sort={ariaSort}
                      onClick={h.column.getToggleSortingHandler()}
                      className={`text-muted-foreground text-xs uppercase tracking-wide select-none ${
                        canSort ? "cursor-pointer" : ""
                      }`}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {sorted === "asc" ? " ▲" : ""}
                      {sorted === "desc" ? " ▼" : ""}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {rows.length === 0 && !isFetching && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground p-6 text-center"
                >
                  No audit entries match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <div
        className="flex flex-col items-center justify-between gap-3 py-3 sm:flex-row"
        aria-live="polite"
      >
        <span className="text-muted-foreground text-xs tabular-nums">
          {isFetching ? "Loading…" : `${rows.length} row${rows.length === 1 ? "" : "s"}`}
        </span>
        <DataPagination
          mode="cursor"
          page={history.length + 1}
          hasPrev={history.length > 0 && !isFetching}
          hasNext={!!nextCursor && !isFetching}
          onPrev={() => {
            setHistory((h) => {
              const prev = h.length > 0 ? h[h.length - 1] : null;
              setCursor(prev);
              return h.slice(0, -1);
            });
          }}
          onNext={() => {
            if (!nextCursor) return;
            setHistory((h) => [...h, cursor]);
            setCursor(nextCursor);
          }}
        />
      </div>
    </div>
  );
}
