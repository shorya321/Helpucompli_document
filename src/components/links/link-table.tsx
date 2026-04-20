"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BRAND } from "@/lib/brand";
import type { ApiResponse } from "@/types";
import type { LinkListResult, LinkListRow, LinkStatus } from "@/lib/link-list";

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

const STATUS_COLORS: Record<LinkStatus, { bg: string; fg: string }> = {
  active: { bg: "#16A34A", fg: "#FFFFFF" },
  expired: { bg: "#D97706", fg: "#FFFFFF" },
  revoked: { bg: BRAND.colors.pink, fg: "#FFFFFF" },
};

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
    <section
      style={{
        marginTop: "2rem",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
      }}
    >
      <header
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "flex-end",
          marginBottom: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0, flex: 1 }}>
          Generated links
        </h2>
        <select
          aria-label="Filter status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as "all" | LinkStatus);
            setCursor(null);
          }}
          style={inputStyle}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort field"
          value={sort}
          onChange={(e) => {
            setSort(
              e.target.value as "createdAt" | "expiresAt" | "downloadCount",
            );
            setCursor(null);
          }}
          style={inputStyle}
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              Sort: {s.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setDir(dir === "asc" ? "desc" : "asc");
            setCursor(null);
          }}
          style={{
            ...inputStyle,
            cursor: "pointer",
            background: BRAND.colors.dark,
            color: "#FFFFFF",
            border: "none",
          }}
        >
          {dir === "desc" ? "▼" : "▲"}
        </button>
      </header>

      {isError && (
        <p role="alert" style={{ color: BRAND.colors.pink }}>
          Failed to load links.
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
            fontSize: "0.85rem",
          }}
        >
          <thead>
            <tr>
              {["Document", "Status", "Created by", "Downloads", "Expires", ""].map(
                (h) => (
                  <th
                    key={h || "actions"}
                    style={{
                      textAlign: "left",
                      padding: "0.75rem 1rem",
                      borderBottom: `1px solid ${BRAND.colors.dark}1A`,
                      fontSize: "0.75rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "rgba(30,41,59,0.64)",
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = STATUS_COLORS[row.status];
              return (
                <tr key={row.id}>
                  <td style={cellStyle}>
                    <span style={{ fontWeight: 600 }}>{row.documentName}</span>
                    <br />
                    <span
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontSize: "0.7rem",
                        color: "rgba(30,41,59,0.56)",
                      }}
                    >
                      {row.bucketName}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <span
                      style={{
                        background: tone.bg,
                        color: tone.fg,
                        padding: "0.125rem 0.5rem",
                        borderRadius: "0.375rem",
                        fontSize: "0.7rem",
                        fontWeight: 700,
                      }}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    {row.generatedByName ?? row.generatedByEmail ?? "—"}
                  </td>
                  <td
                    style={{
                      ...cellStyle,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {row.downloadCount}
                    {row.maxDownloads !== null
                      ? ` / ${row.maxDownloads}`
                      : ""}
                  </td>
                  <td
                    style={{
                      ...cellStyle,
                      fontVariantNumeric: "tabular-nums",
                    }}
                    title={row.expiresAt.toISOString()}
                  >
                    {row.expiresAt.toLocaleString()}
                  </td>
                  <td style={{ ...cellStyle, textAlign: "right" }}>
                    {row.status === "active" ? (
                      <button
                        type="button"
                        onClick={() => onRevoke(row.id)}
                        disabled={revoking === row.id}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: BRAND.colors.pink,
                          cursor:
                            revoking === row.id ? "wait" : "pointer",
                          fontWeight: 600,
                          fontSize: "0.85rem",
                        }}
                      >
                        {revoking === row.id ? "Revoking…" : "Revoke"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !isFetching && (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: "2rem",
                    textAlign: "center",
                    color: "rgba(30,41,59,0.56)",
                  }}
                >
                  No links match the current filter.
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
          fontSize: "0.85rem",
        }}
      >
        <button
          type="button"
          onClick={() => setCursor(null)}
          disabled={cursor === null || isFetching}
          style={navBtnStyle(cursor === null || isFetching, false)}
        >
          ⟲ First page
        </button>
        <button
          type="button"
          onClick={() => nextCursor && setCursor(nextCursor)}
          disabled={!nextCursor || isFetching}
          style={navBtnStyle(!nextCursor || isFetching, true)}
        >
          Next page →
        </button>
        <span style={{ color: "rgba(30,41,59,0.56)" }}>
          {isFetching ? "Loading…" : `${rows.length} rows`}
        </span>
      </div>
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  border: `1px solid ${BRAND.colors.dark}33`,
  borderRadius: "0.375rem",
  fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
  fontSize: "0.8rem",
  background: "#FFFFFF",
  color: BRAND.colors.dark,
};

const cellStyle: React.CSSProperties = {
  padding: "0.625rem 1rem",
  borderBottom: `1px solid ${BRAND.colors.dark}0F`,
  verticalAlign: "top",
};

function navBtnStyle(disabled: boolean, primary: boolean): React.CSSProperties {
  return {
    padding: "0.5rem 1rem",
    borderRadius: "0.375rem",
    border: primary ? "none" : `1px solid ${BRAND.colors.dark}33`,
    background: primary
      ? disabled
        ? "rgba(30,41,59,0.24)"
        : BRAND.colors.blue
      : "transparent",
    color: primary ? "#FFFFFF" : BRAND.colors.dark,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
