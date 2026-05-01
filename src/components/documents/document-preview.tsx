"use client";

import { useCallback, useEffect, useState } from "react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
// MIME smuggled past <iframe> / <img>. <video> and <audio> are safe
// to extend here: those elements only decode demuxable media
// containers and do not execute embedded scripts or sniff for HTML.
const INLINE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const INLINE_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
]);
const INLINE_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);
const INLINE_PDF_TYPE = "application/pdf";

function isInlineType(ct: string | null): boolean {
  if (!ct) return false;
  if (ct === INLINE_PDF_TYPE) return true;
  if (INLINE_IMAGE_TYPES.has(ct)) return true;
  if (INLINE_VIDEO_TYPES.has(ct)) return true;
  return INLINE_AUDIO_TYPES.has(ct);
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
  const isVideo = contentType ? INLINE_VIDEO_TYPES.has(contentType) : false;
  const isAudio = contentType ? INLINE_AUDIO_TYPES.has(contentType) : false;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 pb-3">
        <h2 className="text-foreground m-0 break-all text-base font-semibold">
          {filename}
        </h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {contentType ?? "unknown"} · {formatStorage(sizeBytes)}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {err ? (
          <p role="alert" className="text-destructive m-0 text-sm">
            {err}
          </p>
        ) : null}

        {isPdf && url ? (
          <iframe
            title={`Preview of ${filename}`}
            src={url}
            className="border-border h-[min(75vh,42rem)] w-full rounded-md border"
          />
        ) : null}

        {isImage && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={filename}
            className="border-border max-h-[min(75vh,42rem)] max-w-full rounded-md border object-contain"
          />
        ) : null}

        {isVideo && url ? (
          <video
            controls
            preload="metadata"
            src={url}
            className="border-border max-h-[min(75vh,42rem)] w-full rounded-md border bg-black"
          >
            <track kind="captions" />
          </video>
        ) : null}

        {isAudio && url ? (
          <audio controls preload="metadata" src={url} className="w-full" />
        ) : null}

        {!isInlineType(contentType) ? (
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground font-semibold">Type</dt>
            <dd className="text-foreground m-0 tabular-nums">
              {contentType ?? "unknown"}
            </dd>
            <dt className="text-muted-foreground font-semibold">Size</dt>
            <dd className="text-foreground m-0 tabular-nums">
              {formatStorage(sizeBytes)}
            </dd>
            <dt className="text-muted-foreground font-semibold">Uploaded</dt>
            <dd className="text-foreground m-0 tabular-nums">
              {uploadedAt.toISOString()}
            </dd>
            {uploadedByName ? (
              <>
                <dt className="text-muted-foreground font-semibold">By</dt>
                <dd className="text-foreground m-0">{uploadedByName}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground col-span-2 mt-1 text-xs italic">
              No inline preview available for this file type.
            </dt>
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}
