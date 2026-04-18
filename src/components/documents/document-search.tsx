"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { BRAND } from "@/lib/brand";
import { formatStorage } from "@/components/buckets/bucket-card";
import { DownloadButton } from "@/components/documents/download-button";

interface UploaderSummary {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
}

interface DocumentRow {
  readonly id: string;
  readonly bucketId: string;
  readonly s3Key: string;
  readonly filename: string;
  readonly contentType: string | null;
  readonly sizeBytes: number | string | null;
  readonly uploadedAt: string;
  readonly uploadedBy: UploaderSummary;
}

interface SearchResponse {
  readonly data: {
    readonly documents: ReadonlyArray<DocumentRow>;
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
  } | null;
  readonly error: string | null;
}

interface DocumentSearchProps {
  readonly initialBucketId?: string;
}

const columnHelper = createColumnHelper<DocumentRow>();

function parseSize(v: DocumentRow["sizeBytes"]): bigint {
  if (v === null || v === undefined) return BigInt(0);
  if (typeof v === "number") return BigInt(v);
  // BigInt-as-string fallback (toJsonSafe emits string for large values).
  try {
    return BigInt(v);
  } catch {
    return BigInt(0);
  }
}

export function DocumentSearch({ initialBucketId }: DocumentSearchProps) {
  const [filters, setFilters] = useState({
    q: "",
    bucketId: initialBucketId ?? "",
    contentType: "",
    uploaderId: "",
    from: "",
    to: "",
    sort: "uploadedAt" as "filename" | "uploadedAt" | "sizeBytes",
    dir: "desc" as "asc" | "desc",
    page: 1,
  });
  const [rows, setRows] = useState<ReadonlyArray<DocumentRow>>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fetchResults = async () => {
      setErr(null);
      setBusy(true);
      try {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(filters)) {
          if (v === "" || v === undefined) continue;
          qs.set(k, String(v));
        }
        const res = await fetch(`/api/documents/search?${qs.toString()}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `Search failed (${res.status})`);
        }
        const body = (await res.json()) as SearchResponse;
        if (!body.data) throw new Error("empty response");
        setRows(body.data.documents);
        setTotal(body.data.total);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Search failed");
      } finally {
        setBusy(false);
      }
    };
    void fetchResults();
  }, [filters]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("filename", {
        header: "Filename",
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("contentType", {
        header: "Type",
        cell: (info) => info.getValue() ?? "unknown",
      }),
      columnHelper.accessor("sizeBytes", {
        header: "Size",
        cell: (info) => formatStorage(parseSize(info.getValue())),
      }),
      columnHelper.accessor("uploadedAt", {
        header: "Uploaded",
        cell: (info) => info.getValue().slice(0, 10),
      }),
      columnHelper.accessor((row) => row.uploadedBy.name ?? row.uploadedBy.email, {
        id: "uploader",
        header: "Uploader",
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => (
          <DownloadButton
            bucketId={info.row.original.bucketId}
            s3Key={info.row.original.s3Key}
          />
        ),
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: rows as DocumentRow[],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section
      style={{
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFilters((f) => ({ ...f, page: 1 }));
        }}
        style={{
          display: "grid",
          gap: "0.5rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
          padding: "1rem",
          background: "#FFFFFF",
          border: `1px solid ${BRAND.colors.dark}1A`,
          borderRadius: "0.75rem",
        }}
      >
        <input
          placeholder="Filename contains…"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value, page: 1 })}
          style={inputStyle}
          maxLength={128}
        />
        <input
          placeholder="Content type (e.g. application/pdf)"
          value={filters.contentType}
          onChange={(e) =>
            setFilters({ ...filters, contentType: e.target.value, page: 1 })
          }
          style={inputStyle}
          maxLength={255}
        />
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value, page: 1 })}
          style={inputStyle}
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value, page: 1 })}
          style={inputStyle}
        />
        <select
          value={filters.sort}
          onChange={(e) =>
            setFilters({
              ...filters,
              sort: e.target.value as typeof filters.sort,
              page: 1,
            })
          }
          style={inputStyle}
        >
          <option value="uploadedAt">Sort: Uploaded</option>
          <option value="filename">Sort: Filename</option>
          <option value="sizeBytes">Sort: Size</option>
        </select>
        <select
          value={filters.dir}
          onChange={(e) =>
            setFilters({
              ...filters,
              dir: e.target.value as typeof filters.dir,
              page: 1,
            })
          }
          style={inputStyle}
        >
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </select>
      </form>

      {err ? (
        <p role="alert" style={{ margin: 0, color: BRAND.colors.pink }}>
          {err}
        </p>
      ) : null}

      <div
        style={{
          background: "#FFFFFF",
          border: `1px solid ${BRAND.colors.dark}1A`,
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "0.875rem",
          }}
        >
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} style={{ background: `${BRAND.colors.blue}0D` }}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    style={{
                      padding: "0.625rem 0.875rem",
                      textAlign: "left",
                      fontWeight: 600,
                      color: BRAND.colors.blue,
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 && !busy ? (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    padding: "1.5rem",
                    textAlign: "center",
                    color: "rgba(30,41,59,0.6)",
                  }}
                >
                  No documents match the current filters.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  style={{ borderTop: `1px solid ${BRAND.colors.dark}0D` }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: "0.5rem 0.875rem",
                        verticalAlign: "top",
                        wordBreak: "break-word",
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "center",
          fontSize: "0.8125rem",
        }}
      >
        <button
          type="button"
          disabled={filters.page <= 1 || busy}
          onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
          style={btnStyle}
        >
          ← Prev
        </button>
        <span>
          Page {filters.page} of {totalPages} · {total} result{total === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          disabled={filters.page >= totalPages || busy}
          onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
          style={btnStyle}
        >
          Next →
        </button>
      </div>
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.5rem",
  fontSize: "0.875rem",
  borderRadius: "0.375rem",
  border: `1px solid ${BRAND.colors.dark}26`,
  fontFamily: "inherit",
};

const btnStyle: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: BRAND.colors.blue,
  background: `${BRAND.colors.blue}14`,
  border: "none",
  borderRadius: "0.375rem",
  cursor: "pointer",
  fontFamily: "inherit",
};
