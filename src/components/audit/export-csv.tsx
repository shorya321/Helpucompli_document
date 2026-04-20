"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { rowsToCsv, csvFilename } from "@/lib/audit-csv";
import type { AuditQueryRow } from "@/lib/audit-query";
import type { ApiResponse } from "@/types";
import type { AuditFiltersValue } from "@/components/audit/audit-filters";

const PAGE_SIZE = 100;
const MAX_ROWS = 10_000;

type WireRow = Omit<AuditQueryRow, "createdAt"> & { createdAt: string };
type WirePayload = { rows: WireRow[]; nextCursor: string | null };

function buildQuery(filters: AuditFiltersValue, cursor: string | null): string {
  const sp = new URLSearchParams();
  if (filters.userId) sp.set("userId", filters.userId);
  if (filters.targetType) sp.set("targetType", filters.targetType);
  if (filters.dateFrom) sp.set("dateFrom", `${filters.dateFrom}T00:00:00Z`);
  if (filters.dateTo) sp.set("dateTo", `${filters.dateTo}T23:59:59Z`);
  for (const a of filters.actions) sp.append("actions", a);
  if (cursor) sp.set("cursor", cursor);
  sp.set("limit", String(PAGE_SIZE));
  return `?${sp.toString()}`;
}

async function fetchPage(
  filters: AuditFiltersValue,
  cursor: string | null,
): Promise<{ rows: AuditQueryRow[]; nextCursor: string | null }> {
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

function triggerDownload(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface ExportCsvProps {
  readonly filters: AuditFiltersValue;
}

export function ExportCsv({ filters }: ExportCsvProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const all: AuditQueryRow[] = [];
      let cursor: string | null = null;
      let truncated = false;
      do {
        const page = await fetchPage(filters, cursor);
        all.push(...page.rows);
        cursor = page.nextCursor;
        if (all.length >= MAX_ROWS) {
          all.length = MAX_ROWS;
          truncated = true;
          break;
        }
      } while (cursor);

      triggerDownload(rowsToCsv(all), csvFilename());
      if (truncated) {
        setError(`Export capped at ${MAX_ROWS} rows. Narrow filters for full export.`);
      }
    } catch {
      setError("Export failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: "0.25rem" }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          padding: "0.5rem 1rem",
          borderRadius: "0.375rem",
          border: "none",
          background: BRAND.colors.dark,
          color: "#FFFFFF",
          cursor: busy ? "wait" : "pointer",
          fontWeight: 600,
          fontSize: "0.85rem",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? "Exporting…" : "Export CSV"}
      </button>
      {error && (
        <span role="alert" style={{ color: BRAND.colors.pink, fontSize: "0.75rem" }}>
          {error}
        </span>
      )}
    </div>
  );
}
