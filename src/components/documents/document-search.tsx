"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

// Native <select> styled to match shadcn Input. Used for GET-like
// filter controls and client-state selects where the Radix popover
// would hamper keyboard-driven submit flows.
const nativeSelectClass =
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";

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
    <section className="text-foreground flex flex-col gap-4">
      <Card className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilters((f) => ({ ...f, page: 1 }));
          }}
          className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2"
        >
          <Input
            placeholder="Filename contains…"
            value={filters.q}
            onChange={(e) =>
              setFilters({ ...filters, q: e.target.value, page: 1 })
            }
            maxLength={128}
          />
          <Input
            placeholder="Content type (e.g. application/pdf)"
            value={filters.contentType}
            onChange={(e) =>
              setFilters({ ...filters, contentType: e.target.value, page: 1 })
            }
            maxLength={255}
          />
          <Input
            type="date"
            value={filters.from}
            onChange={(e) =>
              setFilters({ ...filters, from: e.target.value, page: 1 })
            }
          />
          <Input
            type="date"
            value={filters.to}
            onChange={(e) =>
              setFilters({ ...filters, to: e.target.value, page: 1 })
            }
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
            className={nativeSelectClass}
            aria-label="Sort by"
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
            className={nativeSelectClass}
            aria-label="Sort direction"
          >
            <option value="desc">Desc</option>
            <option value="asc">Asc</option>
          </select>
        </form>
      </Card>

      {err ? (
        <p role="alert" className="text-destructive m-0 text-sm">
          {err}
        </p>
      ) : null}

      <Card className="overflow-hidden p-0">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-muted/50">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="text-muted-foreground px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider"
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
                  className="text-muted-foreground p-6 text-center"
                >
                  No documents match the current filters.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-border/50 border-t">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="text-foreground break-words px-3.5 py-2 align-top"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={filters.page <= 1 || busy}
          onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
        >
          ← Prev
        </Button>
        <span className="tabular-nums">
          Page {filters.page} of {totalPages} · {total} result
          {total === 1 ? "" : "s"}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={filters.page >= totalPages || busy}
          onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
        >
          Next →
        </Button>
      </div>
    </section>
  );
}
