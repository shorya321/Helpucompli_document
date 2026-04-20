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
import { BRAND } from "@/lib/brand";
import { actionBadgeTone, type BadgeTone } from "@/lib/activity-feed";
import { AuditFilters, EMPTY_FILTERS, type AuditFiltersValue } from "@/components/audit/audit-filters";
import { ExportCsv } from "@/components/audit/export-csv";
import type { ApiResponse } from "@/types";
import type { AuditQueryResult, AuditQueryRow } from "@/lib/audit-query";

type WireRow = Omit<AuditQueryRow, "createdAt"> & { createdAt: string };
type WirePayload = { rows: WireRow[]; nextCursor: string | null };

const TONE_COLORS: Record<BadgeTone, { bg: string; fg: string }> = {
  info: { bg: BRAND.colors.blue, fg: "#FFFFFF" },
  success: { bg: "#16A34A", fg: "#FFFFFF" },
  warning: { bg: "#D97706", fg: "#FFFFFF" },
  danger: { bg: BRAND.colors.pink, fg: "#FFFFFF" },
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
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {d.toLocaleString()}
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
          const tone = TONE_COLORS[actionBadgeTone(action as Parameters<typeof actionBadgeTone>[0])];
          return (
            <span
              style={{
                background: tone.bg,
                color: tone.fg,
                padding: "0.125rem 0.5rem",
                borderRadius: "0.375rem",
                fontSize: "0.7rem",
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {action}
            </span>
          );
        },
      },
      {
        accessorFn: (r) => `${r.targetType}:${r.targetId}`,
        id: "target",
        header: "Target",
      },
      {
        accessorKey: "ipAddress",
        header: "IP address",
        cell: ({ getValue }) => (
          <span style={{ fontFamily: "ui-monospace, monospace" }}>
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
    <div>
      <AuditFilters
        value={filters}
        onChange={setFilters}
        onApply={apply}
        onReset={reset}
        disabled={isFetching}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: "0.5rem",
        }}
      >
        <ExportCsv filters={appliedFilters} />
      </div>
      {isError && (
        <p role="alert" style={{ color: BRAND.colors.pink }}>
          Failed to load audit log.
        </p>
      )}
      <div
        style={{
          background: "#FFFFFF",
          border: `1px solid ${BRAND.colors.dark}1A`,
          borderRadius: "0.5rem",
          overflowX: "auto",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
            fontSize: "0.85rem",
            color: BRAND.colors.dark,
          }}
        >
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    style={{
                      textAlign: "left",
                      padding: "0.75rem 1rem",
                      borderBottom: `1px solid ${BRAND.colors.dark}1A`,
                      cursor: h.column.getCanSort() ? "pointer" : "default",
                      userSelect: "none",
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "rgba(30,41,59,0.64)",
                    }}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getIsSorted() === "asc" ? " ▲" : ""}
                    {h.column.getIsSorted() === "desc" ? " ▼" : ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    style={{
                      padding: "0.625rem 1rem",
                      borderBottom: `1px solid ${BRAND.colors.dark}0F`,
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && !isFetching && (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    padding: "2rem",
                    textAlign: "center",
                    color: "rgba(30,41,59,0.56)",
                  }}
                >
                  No audit entries match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          padding: "0.75rem 0",
          alignItems: "center",
          fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
          fontSize: "0.85rem",
        }}
      >
        <button
          type="button"
          onClick={() => setCursor(null)}
          disabled={cursor === null || isFetching}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "0.375rem",
            border: `1px solid ${BRAND.colors.dark}33`,
            background: "transparent",
            cursor:
              cursor === null || isFetching ? "not-allowed" : "pointer",
            color: BRAND.colors.dark,
          }}
        >
          ⟲ First page
        </button>
        <button
          type="button"
          onClick={() => nextCursor && setCursor(nextCursor)}
          disabled={!nextCursor || isFetching}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: "0.375rem",
            border: "none",
            background: nextCursor ? BRAND.colors.blue : "rgba(30,41,59,0.24)",
            color: "#FFFFFF",
            cursor: !nextCursor || isFetching ? "not-allowed" : "pointer",
          }}
        >
          Next page →
        </button>
        <span style={{ color: "rgba(30,41,59,0.56)" }}>
          {isFetching ? "Loading…" : `${rows.length} rows`}
        </span>
      </div>
    </div>
  );
}
