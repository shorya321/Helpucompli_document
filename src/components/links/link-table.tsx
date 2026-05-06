"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Check, Code2, Image as ImageIcon, Link2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataPagination } from "@/components/ui/data-pagination";
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
  // null = never expires (superadmin-gated).
  expiresAt: string | null;
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
  { value: "downloadCount", label: "Hits" },
];

function StatusBadge({ status }: { readonly status: LinkStatus }) {
  if (status === "active") {
    return (
      <Badge
        variant="secondary"
        className="font-mono text-[10px] uppercase tracking-wide"
      >
        active
      </Badge>
    );
  }
  if (status === "revoked") {
    return (
      <Badge
        variant="destructive"
        className="font-mono text-[10px] uppercase tracking-wide"
      >
        revoked
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground font-mono text-[10px] uppercase tracking-wide"
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
  sp.set("limit", "10");
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
      expiresAt: r.expiresAt === null ? null : new Date(r.expiresAt),
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

interface ShareInfo {
  readonly token: string;
  readonly shareableUrl: string;
  readonly embedCode: string;
  readonly expiresAt: string | null;
  readonly embedImageUrl: string | null;
}

// Sec-review: token is fetched on-demand (click) and never cached past
// this tab's lifetime. Each call writes a LINK_SHARE_INFO_VIEW audit row
// server-side.
async function fetchShareInfo(id: string): Promise<ShareInfo> {
  const res = await fetch(
    `/api/links/admin/${encodeURIComponent(id)}/share-info`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as ApiResponse<ShareInfo>;
  if (!body.data) throw new Error("No data");
  return body.data;
}

type CopyKind = "url" | "embed" | "imageUrl";

export function LinkTable({ initial }: LinkTableProps) {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [copying, setCopying] = useState<{ id: string; kind: CopyKind } | null>(
    null,
  );
  const [copied, setCopied] = useState<{ id: string; kind: CopyKind } | null>(
    null,
  );
  // Replaces native window.confirm/alert with shadcn Dialog. confirm
  // = revoke prompt (destructive). alert = single-button error notice.
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [errorAlert, setErrorAlert] = useState<{
    title: string;
    description?: string;
  } | null>(null);

  const performRevoke = async (id: string) => {
    setRevoking(id);
    try {
      await revokeLink(id);
      await queryClient.invalidateQueries({ queryKey: ["links"] });
    } catch {
      setErrorAlert({
        title: "Revoke failed",
        description: "Failed to revoke. Try again.",
      });
    } finally {
      setRevoking(null);
    }
  };

  const onRevoke = (id: string) => {
    setConfirmRevoke(id);
  };

  // Re-reveal the bearer token via the audited share-info endpoint and
  // copy the requested artifact (URL or iframe) to the clipboard. Each
  // call is logged server-side — we never cache tokens in this client.
  const onCopy = async (id: string, kind: CopyKind) => {
    setCopying({ id, kind });
    try {
      const info = await fetchShareInfo(id);
      let payload: string;
      if (kind === "url") {
        payload = info.shareableUrl;
      } else if (kind === "embed") {
        payload = info.embedCode;
      } else {
        // imageUrl — only meaningful when the link is for an image
        // document with public-embed enabled. Server returns null
        // otherwise; surface a friendly error instead of pasting an
        // empty string.
        if (!info.embedImageUrl) {
          setErrorAlert({
            title: "Image URL not available",
            description:
              "This link's document is not an image OR public embedding is disabled. Generate a fresh link with the public-embed toggle enabled to use this option.",
          });
          return;
        }
        payload = info.embedImageUrl;
      }
      await navigator.clipboard.writeText(payload);
      setCopied({ id, kind });
      window.setTimeout(() => {
        setCopied((prev) =>
          prev && prev.id === id && prev.kind === kind ? null : prev,
        );
      }, 2000);
    } catch {
      setErrorAlert({
        title: "Copy failed",
        description:
          "Failed to copy. The link may be revoked, expired, or rate-limited.",
      });
    } finally {
      setCopying(null);
    }
  };
  const [status, setStatus] = useState<"all" | LinkStatus>("all");
  const [sort, setSort] = useState<
    "createdAt" | "expiresAt" | "downloadCount"
  >("createdAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [cursor, setCursor] = useState<string | null>(null);
  // Cursor history stack — each entry is the cursor used for the page
  // we came from. Push on Next, pop on Prev. Filter / sort changes reset.
  const [history, setHistory] = useState<ReadonlyArray<string | null>>([]);

  const resetPagination = () => {
    setCursor(null);
    setHistory([]);
  };

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
              resetPagination();
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
              resetPagination();
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
            resetPagination();
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
                <TableHead>Hits</TableHead>
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
                    title={
                      row.expiresAt === null
                        ? "never expires"
                        : row.expiresAt.toISOString()
                    }
                  >
                    {row.expiresAt === null ? (
                      <span className="text-muted-foreground italic">
                        Never expires
                      </span>
                    ) : (
                      formatDateTime(row.expiresAt)
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.status === "active" ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label="Copy shareable URL"
                          title="Copy URL — re-reveals the bearer token (audited)"
                          onClick={() => onCopy(row.id, "url")}
                          disabled={
                            copying?.id === row.id && copying.kind === "url"
                          }
                        >
                          {copied?.id === row.id && copied.kind === "url" ? (
                            <Check aria-hidden="true" className="size-4" />
                          ) : (
                            <Link2 aria-hidden="true" className="size-4" />
                          )}
                          <span className="ml-1.5">
                            {copied?.id === row.id && copied.kind === "url"
                              ? "Copied"
                              : copying?.id === row.id && copying.kind === "url"
                                ? "…"
                                : "URL"}
                          </span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label="Copy iframe embed code"
                          title="Copy embed HTML — re-reveals the bearer token (audited)"
                          onClick={() => onCopy(row.id, "embed")}
                          disabled={
                            copying?.id === row.id && copying.kind === "embed"
                          }
                        >
                          {copied?.id === row.id && copied.kind === "embed" ? (
                            <Check aria-hidden="true" className="size-4" />
                          ) : (
                            <Code2 aria-hidden="true" className="size-4" />
                          )}
                          <span className="ml-1.5">
                            {copied?.id === row.id && copied.kind === "embed"
                              ? "Copied"
                              : copying?.id === row.id &&
                                  copying.kind === "embed"
                                ? "…"
                                : "Embed"}
                          </span>
                        </Button>
                        {/* "Image URL" — direct image-bytes URL via /raw.
                            Only image documents with public-embed enabled
                            qualify; other rows omit the button entirely.
                            Some destinations (Circle.so image-embed slot,
                            Notion image embed) validate response Content-
                            Type=image/* and reject /l/<token> (text/html);
                            this URL serves image bytes directly so they
                            accept the paste. */}
                        {row.allowPublicEmbed &&
                        (row.contentType ?? "")
                          .toLowerCase()
                          .startsWith("image/") ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label="Copy direct image URL"
                            title="Copy direct image URL — for surfaces that need raw image bytes (Circle.so image embed, Notion image, etc.). Re-reveals the bearer token (audited)."
                            onClick={() => onCopy(row.id, "imageUrl")}
                            disabled={
                              copying?.id === row.id &&
                              copying.kind === "imageUrl"
                            }
                          >
                            {copied?.id === row.id &&
                            copied.kind === "imageUrl" ? (
                              <Check
                                aria-hidden="true"
                                className="size-4"
                              />
                            ) : (
                              <ImageIcon
                                aria-hidden="true"
                                className="size-4"
                              />
                            )}
                            <span className="ml-1.5">
                              {copied?.id === row.id &&
                              copied.kind === "imageUrl"
                                ? "Copied"
                                : copying?.id === row.id &&
                                    copying.kind === "imageUrl"
                                  ? "…"
                                  : "Image URL"}
                            </span>
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => onRevoke(row.id)}
                          disabled={revoking === row.id}
                        >
                          {revoking === row.id ? "Revoking…" : "Revoke"}
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <div className="flex flex-col items-center justify-between gap-3 py-3 sm:flex-row">
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
      <ConfirmDialog
        open={confirmRevoke !== null}
        title="Revoke this link?"
        description="Anyone holding the URL will get 403."
        destructive
        confirmLabel="Revoke"
        onConfirm={async () => {
          const id = confirmRevoke;
          if (id) await performRevoke(id);
        }}
        onClose={() => setConfirmRevoke(null)}
      />
      <ConfirmDialog
        open={errorAlert !== null}
        variant="alert"
        title={errorAlert?.title ?? ""}
        description={errorAlert?.description}
        onClose={() => setErrorAlert(null)}
      />
    </section>
  );
}
