"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

interface DownloadButtonProps {
  readonly bucketId: string;
  readonly s3Key: string;
  // When true, the component triggers the download exactly once on mount
  // (useEffect + ref guard) and replaces the URL with `closeHref` so a
  // reload does not re-fire. Used by the documents page to handle the
  // `?op=download` mount produced by the right-click context menu, which
  // emits a navigation link rather than a button. Defaults to false so
  // existing callers (e.g. document-search) keep their click-to-download
  // behaviour.
  readonly autoFire?: boolean;
  readonly closeHref?: string;
}

export function DownloadButton({
  bucketId,
  s3Key,
  autoFire,
  closeHref,
}: DownloadButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autoFired = useRef(false);

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

  useEffect(() => {
    if (!autoFire) return;
    if (autoFired.current) return;
    autoFired.current = true;
    // Clear ?op=download from the URL via client routing first so a
    // reload does not re-trigger. window.location.href inside onClick
    // then kicks off the S3 fetch; S3 returns Content-Disposition:
    // attachment so the browser stays on the current page while
    // downloading.
    if (closeHref) router.replace(closeHref);
    void onClick();
    // onClick is recreated each render but is a stable closure over the
    // current props; running it once on mount is the intent. eslint
    // disable line below documents the deliberate single-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFire, closeHref, router]);

  if (autoFire) {
    if (!err) return null;
    return (
      <div
        role="alert"
        className="border-destructive/40 bg-destructive/10 text-destructive fixed right-4 bottom-4 rounded-md border px-3 py-2 text-sm shadow-md"
      >
        {err}
      </div>
    );
  }

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
