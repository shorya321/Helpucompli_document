"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";

interface BucketOption {
  readonly id: string;
  readonly name: string;
}

interface MoveCopyDialogProps {
  readonly sourceBucketId: string;
  readonly sourceS3Key: string;
  readonly sourceFilename: string;
  readonly buckets: ReadonlyArray<BucketOption>;
  readonly closeHref: string;
}

// Restrict the closeHref prop so a caller-supplied value cannot redirect
// to an off-site URL when the dialog closes.
function safeHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return "/documents";
  return href;
}

export function MoveCopyDialog({
  sourceBucketId,
  sourceS3Key,
  sourceFilename,
  buckets,
  closeHref,
}: MoveCopyDialogProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"move" | "copy">("move");
  const [destBucketId, setDestBucketId] = useState<string>(
    buckets.find((b) => b.id !== sourceBucketId)?.id ?? sourceBucketId,
  );
  const [destFolderPrefix, setDestFolderPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const href = safeHref(closeHref);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/s3/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          sourceBucketId,
          sourceS3Key,
          destBucketId,
          destFolderPrefix,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Relocation failed (${res.status})`);
      }
      router.push(href);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Relocation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-copy-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(30,41,59,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 40,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          background: "#FFFFFF",
          borderRadius: "0.75rem",
          padding: "1.5rem",
          width: "min(32rem, 90vw)",
          display: "flex",
          flexDirection: "column",
          gap: "0.875rem",
          fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
          color: BRAND.colors.dark,
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <h2 id="move-copy-title" style={{ margin: 0, fontSize: "1.125rem" }}>
            Move or copy document
          </h2>
          <a
            href={href}
            style={{ fontSize: "0.75rem", color: BRAND.colors.blue }}
          >
            Close
          </a>
        </header>

        <p style={{ margin: 0, fontSize: "0.8125rem", color: "rgba(30,41,59,0.72)" }}>
          {sourceFilename}
        </p>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={{ fontSize: "0.75rem", fontWeight: 600 }}>Action</legend>
          <label style={{ marginRight: "1rem", fontSize: "0.875rem" }}>
            <input
              type="radio"
              name="mode"
              value="move"
              checked={mode === "move"}
              onChange={() => setMode("move")}
            />{" "}
            Move
          </label>
          <label style={{ fontSize: "0.875rem" }}>
            <input
              type="radio"
              name="mode"
              value="copy"
              checked={mode === "copy"}
              onChange={() => setMode("copy")}
            />{" "}
            Copy
          </label>
        </fieldset>

        <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
          Destination bucket
          <select
            value={destBucketId}
            onChange={(e) => setDestBucketId(e.target.value)}
            style={{
              display: "block",
              width: "100%",
              marginTop: "0.25rem",
              padding: "0.5rem",
              fontSize: "0.875rem",
              borderRadius: "0.375rem",
              border: `1px solid ${BRAND.colors.dark}26`,
              fontFamily: "inherit",
            }}
          >
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
          Destination folder prefix (optional)
          <input
            type="text"
            value={destFolderPrefix}
            onChange={(e) => setDestFolderPrefix(e.target.value)}
            placeholder="invoices/2026/"
            style={{
              display: "block",
              width: "100%",
              marginTop: "0.25rem",
              padding: "0.5rem",
              fontSize: "0.875rem",
              borderRadius: "0.375rem",
              border: `1px solid ${BRAND.colors.dark}26`,
              fontFamily: "inherit",
            }}
          />
        </label>

        {err ? (
          <p role="alert" style={{ margin: 0, color: BRAND.colors.pink, fontSize: "0.8125rem" }}>
            {err}
          </p>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <a
            href={href}
            style={{
              padding: "0.5rem 0.875rem",
              fontSize: "0.875rem",
              color: BRAND.colors.dark,
              textDecoration: "none",
              border: `1px solid ${BRAND.colors.dark}26`,
              borderRadius: "0.375rem",
            }}
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={busy}
            style={{
              background: BRAND.colors.blue,
              color: "#FFFFFF",
              border: "none",
              padding: "0.5rem 0.875rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              borderRadius: "0.375rem",
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "…" : mode === "move" ? "Move" : "Copy"}
          </button>
        </div>
      </form>
    </div>
  );
}
