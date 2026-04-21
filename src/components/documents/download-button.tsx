"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

interface DownloadButtonProps {
  readonly bucketId: string;
  readonly s3Key: string;
}

export function DownloadButton({ bucketId, s3Key }: DownloadButtonProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onClick = async () => {
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/s3/download-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bucketId, s3Key }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Download failed (${res.status})`);
      }
      const body = (await res.json()) as { data: { url: string } };
      // window.location navigation triggers the browser's native
      // download flow via S3's Content-Disposition header. We do NOT
      // embed the URL in an <a href> — avoids keeping a bearer token
      // in the DOM for the full link lifetime.
      window.location.href = body.data.url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-baseline gap-2">
      <Button
        type="button"
        onClick={onClick}
        disabled={busy}
        size="sm"
        variant="secondary"
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
        {busy ? "…" : "Download"}
      </Button>
      {err ? (
        <span role="alert" className="text-destructive text-xs">
          {err}
        </span>
      ) : null}
    </span>
  );
}
