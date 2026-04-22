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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  sp.set("limit", "50");
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
        accessorKey: "action",
        header: "Action",
        cell: ({ getValue }) => {
          const action = getValue<string>();
          const variant =
            TONE_VARIANT[actionBadgeTone(action as Parameters<typeof actionBadgeTone>[0])];
          return (
            <Badge
              variant={variant}
              className="font-mono text-[10px] uppercase tracking-wide"
            >
              {action}
            </Badge>
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
    setAppliedFilters(filters);
  };
  const reset = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setCursor(null);
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
        className="text-muted-foreground flex items-center gap-2 py-3 text-sm"
        aria-live="polite"
      >
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
          variant="default"
          size="sm"
          onClick={() => nextCursor && setCursor(nextCursor)}
          disabled={!nextCursor || isFetching}
        >
          Next page →
        </Button>
        <span>{isFetching ? "Loading…" : `${rows.length} rows`}</span>
      </div>
    </div>
  );
}
