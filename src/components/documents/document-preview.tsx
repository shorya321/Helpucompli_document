"use client";

import { useCallback, useEffect, useState } from "react";
import { BRAND } from "@/lib/brand";
import { formatStorage } from "@/components/buckets/bucket-card";

interface DocumentPreviewProps {
  readonly bucketId: string;
  readonly s3Key: string;
  readonly filename: string;
  readonly contentType: string | null;
  readonly sizeBytes: bigint;
  readonly uploadedAt: Date;
  readonly uploadedByName: string | null;
}

// Allowlist. Outside this set we render metadata only — no browser
// attempt to interpret the bytes, no stored-XSS via an SVG or HTML
// MIME.
const INLINE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const INLINE_PDF_TYPE = "application/pdf";

function isInlineType(ct: string | null): boolean {
  if (!ct) return false;
  if (ct === INLINE_PDF_TYPE) return true;
  return INLINE_IMAGE_TYPES.has(ct);
}

export function DocumentPreview({
  bucketId,
  s3Key,
  filename,
  contentType,
  sizeBytes,
  uploadedAt,
  uploadedByName,
}: DocumentPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fetchPreview = useCallback(async () => {
    if (!isInlineType(contentType)) return;
    try {
      const res = await fetch("/api/s3/download-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bucketId,
          s3Key,
          disposition: "inline",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Preview failed (${res.status})`);
      }
      const body = (await res.json()) as { data: { url: string } };
      setUrl(body.data.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Preview failed");
    }
  }, [bucketId, s3Key, contentType]);

  useEffect(() => {
    void fetchPreview();
  }, [fetchPreview]);

  const isPdf = contentType === INLINE_PDF_TYPE;
  const isImage = contentType ? INLINE_IMAGE_TYPES.has(contentType) : false;

  return (
    <section
      style={{
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
        background: "#FFFFFF",
        border: `1px solid ${BRAND.colors.dark}1A`,
        borderRadius: "0.75rem",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1rem", wordBreak: "break-all" }}>
          {filename}
        </h2>
        <span style={{ fontSize: "0.75rem", color: "rgba(30,41,59,0.6)" }}>
          {contentType ?? "unknown"} · {formatStorage(sizeBytes)}
        </span>
      </header>

      {err ? (
        <p role="alert" style={{ margin: 0, color: BRAND.colors.pink, fontSize: "0.8125rem" }}>
          {err}
        </p>
      ) : null}

      {isPdf && url ? (
        <iframe
          title={`Preview of ${filename}`}
          src={url}
          style={{
            width: "100%",
            height: "min(75vh, 42rem)",
            border: "none",
            borderRadius: "0.375rem",
          }}
        />
      ) : null}

      {isImage && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={filename}
          style={{
            maxWidth: "100%",
            maxHeight: "min(75vh, 42rem)",
            objectFit: "contain",
            borderRadius: "0.375rem",
          }}
        />
      ) : null}

      {!isInlineType(contentType) ? (
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            gap: "0.375rem 1rem",
            margin: 0,
            fontSize: "0.8125rem",
          }}
        >
          <dt style={{ color: BRAND.colors.blue, fontWeight: 600 }}>Type</dt>
          <dd style={{ margin: 0 }}>{contentType ?? "unknown"}</dd>
          <dt style={{ color: BRAND.colors.blue, fontWeight: 600 }}>Size</dt>
          <dd style={{ margin: 0 }}>{formatStorage(sizeBytes)}</dd>
          <dt style={{ color: BRAND.colors.blue, fontWeight: 600 }}>Uploaded</dt>
          <dd style={{ margin: 0 }}>{uploadedAt.toISOString()}</dd>
          {uploadedByName ? (
            <>
              <dt style={{ color: BRAND.colors.blue, fontWeight: 600 }}>By</dt>
              <dd style={{ margin: 0 }}>{uploadedByName}</dd>
            </>
          ) : null}
          <dt
            style={{
              color: "rgba(30,41,59,0.6)",
              fontStyle: "italic",
              gridColumn: "1 / -1",
              marginTop: "0.25rem",
              fontWeight: 500,
            }}
          >
            No inline preview available for this file type.
          </dt>
        </dl>
      ) : null}
    </section>
  );
}
