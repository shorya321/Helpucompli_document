"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";

interface CreateFolderDialogProps {
  readonly bucketId: string;
  readonly parentPrefix: string;
  readonly closeHref: string;
}

function safeHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return "/documents";
  return href;
}

export function CreateFolderDialog({
  bucketId,
  parentPrefix,
  closeHref,
}: CreateFolderDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const href = safeHref(closeHref);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/s3/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bucketId, parentPrefix, name: name.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Create folder failed (${res.status})`);
      }
      router.push(href);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Create folder failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-folder-title"
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
          width: "min(28rem, 90vw)",
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
          <h2 id="create-folder-title" style={{ margin: 0, fontSize: "1.125rem" }}>
            New folder
          </h2>
          <a
            href={href}
            style={{ fontSize: "0.75rem", color: BRAND.colors.blue }}
          >
            Close
          </a>
        </header>

        <p style={{ margin: 0, fontSize: "0.8125rem", color: "rgba(30,41,59,0.72)" }}>
          In:{" "}
          <code>{parentPrefix === "" ? "(bucket root)" : parentPrefix}</code>
        </p>

        <label style={{ fontSize: "0.75rem", fontWeight: 600 }}>
          Folder name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="invoices"
            maxLength={128}
            autoFocus
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

        <p style={{ margin: 0, fontSize: "0.75rem", color: "rgba(30,41,59,0.6)" }}>
          Letters, digits, <code>. _ -</code> only. No slashes.
        </p>

        {err ? (
          <p
            role="alert"
            style={{ margin: 0, color: BRAND.colors.pink, fontSize: "0.8125rem" }}
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
            disabled={busy || name.trim().length === 0}
            style={{
              background: BRAND.colors.blue,
              color: "#FFFFFF",
              border: "none",
              padding: "0.5rem 0.875rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              borderRadius: "0.375rem",
              cursor:
                busy || name.trim().length === 0 ? "not-allowed" : "pointer",
              opacity: name.trim().length === 0 ? 0.6 : 1,
            }}
          >
            {busy ? "…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
