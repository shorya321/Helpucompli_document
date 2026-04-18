"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";

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
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: "0.5rem" }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        style={{
          background: busy ? "rgba(30,41,59,0.06)" : `${BRAND.colors.blue}14`,
          color: BRAND.colors.blue,
          border: "none",
          borderRadius: "0.375rem",
          padding: "0.25rem 0.625rem",
          fontSize: "0.75rem",
          fontWeight: 600,
          cursor: busy ? "wait" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {busy ? "…" : "Download"}
      </button>
      {err ? (
        <span role="alert" style={{ color: BRAND.colors.pink, fontSize: "0.75rem" }}>
          {err}
        </span>
      ) : null}
    </span>
  );
}
