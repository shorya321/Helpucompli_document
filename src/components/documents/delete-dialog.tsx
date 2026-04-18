"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";

interface DeleteDialogProps {
  readonly bucketId: string;
  readonly s3Key: string;
  readonly filename: string;
  readonly canHardDelete: boolean;
  readonly closeHref: string;
}

function safeHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return "/documents";
  return href;
}

export function DeleteDialog({
  bucketId,
  s3Key,
  filename,
  canHardDelete,
  closeHref,
}: DeleteDialogProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"soft" | "hard">("soft");
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const href = safeHref(closeHref);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body =
        mode === "hard"
          ? { mode, bucketId, s3Key, confirmName }
          : { mode, bucketId, s3Key };
      const res = await fetch("/api/s3/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      router.push(href);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const hardConfirmValid =
    mode !== "hard" || confirmName.trim().toLowerCase() === filename.toLowerCase();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-title"
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
          width: "min(30rem, 90vw)",
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
          <h2 id="delete-title" style={{ margin: 0, fontSize: "1.125rem" }}>
            Delete document
          </h2>
          <a
            href={href}
            style={{ fontSize: "0.75rem", color: BRAND.colors.blue }}
          >
            Close
          </a>
        </header>

        <p style={{ margin: 0, fontSize: "0.8125rem", color: "rgba(30,41,59,0.72)" }}>
          {filename}
        </p>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={{ fontSize: "0.75rem", fontWeight: 600 }}>Delete mode</legend>
          <label style={{ display: "block", marginTop: "0.25rem", fontSize: "0.875rem" }}>
            <input
              type="radio"
              name="mode"
              value="soft"
              checked={mode === "soft"}
              onChange={() => setMode("soft")}
            />{" "}
            Soft delete — hidden but recoverable via versioning
          </label>
          <label
            style={{
              display: "block",
              marginTop: "0.25rem",
              fontSize: "0.875rem",
              opacity: canHardDelete ? 1 : 0.5,
            }}
          >
            <input
              type="radio"
              name="mode"
              value="hard"
              disabled={!canHardDelete}
              checked={mode === "hard"}
              onChange={() => setMode("hard")}
            />{" "}
            Hard delete — permanent, all versions removed (superadmin)
          </label>
        </fieldset>

        {mode === "hard" ? (
          <>
            <div
              role="alert"
              style={{
                background: `${BRAND.colors.pink}14`,
                color: BRAND.colors.pink,
                padding: "0.5rem 0.75rem",
                borderRadius: "0.375rem",
                fontSize: "0.8125rem",
              }}
            >
              Hard delete is permanent and cannot be undone. All S3 versions will
              be purged.
            </div>
            <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
              Type the filename to confirm
              <input
                type="text"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                placeholder={filename}
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
          </>
        ) : null}

        {err ? (
          <p
            role="alert"
            style={{
              margin: 0,
              color: BRAND.colors.pink,
              fontSize: "0.8125rem",
            }}
          >
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
            disabled={busy || !hardConfirmValid}
            style={{
              background: mode === "hard" ? BRAND.colors.pink : BRAND.colors.blue,
              color: "#FFFFFF",
              border: "none",
              padding: "0.5rem 0.875rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              borderRadius: "0.375rem",
              cursor: busy || !hardConfirmValid ? "not-allowed" : "pointer",
              opacity: !hardConfirmValid ? 0.6 : 1,
            }}
          >
            {busy ? "…" : mode === "hard" ? "Delete permanently" : "Soft delete"}
          </button>
        </div>
      </form>
    </div>
  );
}
