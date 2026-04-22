"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Upload } from "lucide-react";
import {
  MAX_FILE_SIZE_BYTES,
  MULTIPART_THRESHOLD_BYTES,
} from "@/lib/s3-multipart";

interface UploadZoneProps {
  readonly bucketId: string;
  readonly folderPrefix: string;
  readonly onComplete?: () => void;
}

type UploadStatus =
  | { readonly phase: "idle" }
  | { readonly phase: "uploading"; readonly filename: string; readonly pct: number }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "done"; readonly filename: string };

interface UploadUrlResponse {
  readonly data:
    | {
        readonly mode: "simple";
        readonly s3Key: string;
        readonly url: string;
        readonly receipt: string;
        readonly expiresIn: number;
      }
    | {
        readonly mode: "multipart";
        readonly s3Key: string;
        readonly uploadId: string;
        readonly parts: ReadonlyArray<{ readonly partNumber: number; readonly url: string }>;
        readonly receipt: string;
        readonly expiresIn: number;
      }
    | null;
  readonly error: string | null;
}

async function uploadWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<{ etag: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    if (contentType) xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress((ev.loaded / ev.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new Error(
            `S3 PUT failed (HTTP ${xhr.status}) — ${xhr.responseText.slice(0, 200)}`,
          ),
        );
        return;
      }
      const etag = xhr.getResponseHeader("ETag") ?? "";
      resolve({ etag });
    };
    xhr.onerror = () =>
      reject(
        new Error(
          `Upload blocked by browser (CORS or network). status=${xhr.status}. Check S3 bucket CORS, or browser devtools Network tab for the failed PUT request.`,
        ),
      );
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.send(blob);
  });
}

export function UploadZone({
  bucketId,
  folderPrefix,
  onComplete,
}: UploadZoneProps) {
  const router = useRouter();
  const [status, setStatus] = useState<UploadStatus>({ phase: "idle" });

  const uploadOne = useCallback(
    async (file: File) => {
      setStatus({ phase: "uploading", filename: file.name, pct: 0 });

      const urlRes = await fetch("/api/s3/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bucketId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          folderPrefix,
        }),
      });
      if (!urlRes.ok) {
        const body = (await urlRes.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Upload URL request failed (${urlRes.status})`);
      }
      const { data } = (await urlRes.json()) as UploadUrlResponse;
      if (!data) throw new Error("Upload URL response missing data");

      let completePayload: Record<string, unknown>;

      if (data.mode === "simple") {
        await uploadWithProgress(
          data.url,
          file,
          file.type || "application/octet-stream",
          (pct) => setStatus({ phase: "uploading", filename: file.name, pct }),
        );
        completePayload = {
          bucketId,
          s3Key: data.s3Key,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          receipt: data.receipt,
        };
      } else {
        const totalParts = data.parts.length;
        const partSize = Math.ceil(file.size / totalParts);
        const partResults: Array<{ partNumber: number; etag: string }> = [];
        try {
          for (const p of data.parts) {
            const start = (p.partNumber - 1) * partSize;
            const end = Math.min(start + partSize, file.size);
            const slice = file.slice(start, end);
            // Per-part Content-Type is not set — S3 requires no
            // content-type on UploadPart; only CreateMultipartUpload carries
            // it. Sending it here would cause a SignatureDoesNotMatch.
            const { etag } = await uploadWithProgress(
              p.url,
              slice,
              "",
              (partPct) => {
                const overall =
                  ((p.partNumber - 1 + partPct / 100) / totalParts) * 100;
                setStatus({
                  phase: "uploading",
                  filename: file.name,
                  pct: overall,
                });
              },
            );
            if (!etag) {
              throw new Error(
                "S3 did not return ETag (check bucket CORS ExposeHeaders includes 'ETag')",
              );
            }
            partResults.push({ partNumber: p.partNumber, etag });
          }
        } catch (partErr) {
          // Best-effort abort so orphaned parts don't accrue storage
          // until the 7-day lifecycle rule sweeps them.
          await fetch("/api/s3/upload-abort", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              bucketId,
              s3Key: data.s3Key,
              uploadId: data.uploadId,
              receipt: data.receipt,
            }),
          }).catch(() => {
            /* best-effort — lifecycle fallback */
          });
          throw partErr;
        }
        completePayload = {
          bucketId,
          s3Key: data.s3Key,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          receipt: data.receipt,
          multipart: {
            uploadId: data.uploadId,
            parts: partResults,
          },
        };
      }

      const completeRes = await fetch("/api/s3/upload-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(completePayload),
      });
      if (!completeRes.ok) {
        const body = (await completeRes.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error ?? `Upload finalise failed (${completeRes.status})`,
        );
      }
      setStatus({ phase: "done", filename: file.name });
    },
    [bucketId, folderPrefix],
  );

  const onDrop = useCallback(
    async (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) {
        setStatus({
          phase: "error",
          message:
            rejected[0]!.errors[0]?.message ??
            "File rejected by the uploader.",
        });
        return;
      }
      for (const file of accepted) {
        try {
          if (file.size > MAX_FILE_SIZE_BYTES) {
            throw new Error("File exceeds 5 GB limit");
          }
          await uploadOne(file);
        } catch (err) {
          setStatus({
            phase: "error",
            message: err instanceof Error ? err.message : "Upload failed",
          });
          return;
        }
      }
      // Refresh server component data so the new file appears in
      // FileList + FileTree without a manual browser reload.
      router.refresh();
      onComplete?.();
    },
    [uploadOne, onComplete, router],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize: MAX_FILE_SIZE_BYTES,
    multiple: true,
  });

  return (
    <div className="text-foreground flex flex-col gap-3">
      <div
        {...getRootProps()}
        role="button"
        tabIndex={0}
        className={
          isDragActive
            ? "border-ring bg-accent/40 text-foreground flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center text-sm transition-all duration-150 ease-out"
            : "border-border bg-card/50 text-foreground hover:border-ring/60 hover:bg-accent/30 flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center text-sm transition-all duration-150 ease-out"
        }
      >
        <input {...getInputProps()} />
        <div
          className={
            isDragActive
              ? "bg-foreground text-background flex size-11 items-center justify-center rounded-full transition-colors"
              : "bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-full transition-colors"
          }
        >
          <Upload aria-hidden="true" className="size-5" />
        </div>
        <span className="font-medium">
          {isDragActive
            ? "Drop files here to upload"
            : "Drag and drop files here, or click to select"}
        </span>
        <p className="text-muted-foreground m-0 text-xs">
          Max {Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024 * 1024))} GB per file.
          Files over{" "}
          {Math.floor(MULTIPART_THRESHOLD_BYTES / (1024 * 1024))} MB use
          multipart upload.
        </p>
        <p className="border-border bg-muted/50 text-muted-foreground m-0 mt-1 rounded-md border px-3 py-2 text-xs">
          Do not upload documents containing PHI without a signed BAA in place.
        </p>
      </div>

      {status.phase === "uploading" ? (
        <div role="status" aria-live="polite" className="flex flex-col gap-1">
          <p className="text-foreground m-0 text-sm tabular-nums">
            Uploading {status.filename}… {status.pct.toFixed(0)}%
          </p>
          <progress value={status.pct} max={100} className="w-full" />
        </div>
      ) : null}
      {status.phase === "done" ? (
        <p role="status" className="text-foreground m-0 text-sm">
          Uploaded {status.filename}.
        </p>
      ) : null}
      {status.phase === "error" ? (
        <p role="alert" className="text-destructive m-0 text-sm">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}
