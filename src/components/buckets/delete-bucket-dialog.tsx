"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";

interface DeleteBucketDialogProps {
  readonly bucketId: string;
  readonly bucketName: string;
  readonly closeHref: string;
  readonly onSuccessHref: string;
}

function safeHref(href: string, fallback: string): string {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return fallback;
}

export function DeleteBucketDialog({
  bucketId,
  bucketName,
  closeHref,
  onSuccessHref,
}: DeleteBucketDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmInput, setConfirmInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const safeClose = safeHref(closeHref, "/buckets");
  const safeSuccess = safeHref(onSuccessHref, "/buckets");
  const matches = confirmInput === bucketName;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) {
      setError("Bucket name does not match.");
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/s3/buckets/${bucketId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: bucketName }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      startTransition(() => {
        router.push(safeSuccess);
        router.refresh();
      });
    } catch {
      setError("Network error. Try again.");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-bucket-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(30,41,59,0.48)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        zIndex: 50,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          background: "#FFFFFF",
          borderRadius: "0.75rem",
          padding: "1.5rem",
          maxWidth: "32rem",
          width: "100%",
          color: BRAND.colors.dark,
          fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <h2
          id="delete-bucket-title"
          style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}
        >
          Delete bucket
        </h2>

        <p
          style={{
            margin: 0,
            padding: "0.75rem 1rem",
            background: `${BRAND.colors.pink}12`,
            color: BRAND.colors.pink,
            borderRadius: "0.5rem",
            fontSize: "0.8125rem",
          }}
        >
          This deactivates the PostgreSQL row and deletes the S3 bucket. It
          cannot be undone. The bucket must already be empty (no active
          documents). A BUCKET_DELETE audit entry is recorded.
        </p>

        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.375rem",
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: BRAND.colors.blue,
            fontWeight: 600,
          }}
        >
          Type <code>{bucketName}</code> to confirm
          <input
            required
            name="confirmName"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={bucketName}
            style={{
              padding: "0.5rem 0.625rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              color: BRAND.colors.dark,
              background: "#FFFFFF",
              border: `1px solid ${BRAND.colors.dark}33`,
              borderRadius: "0.375rem",
              fontFamily: "inherit",
            }}
          />
        </label>

        {error ? (
          <p
            role="alert"
            style={{
              margin: 0,
              color: BRAND.colors.pink,
              fontSize: "0.875rem",
            }}
          >
            {error}
          </p>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
          }}
        >
          <a
            href={safeClose}
            style={{
              padding: "0.5rem 0.875rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: BRAND.colors.dark,
              textDecoration: "none",
              borderRadius: "0.5rem",
              border: `1px solid ${BRAND.colors.dark}33`,
            }}
          >
            Cancel
          </a>
          <button
            type="submit"
            disabled={pending || !matches}
            style={{
              background:
                pending || !matches
                  ? `${BRAND.colors.pink}80`
                  : BRAND.colors.pink,
              color: "#FFFFFF",
              padding: "0.5rem 0.875rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              borderRadius: "0.5rem",
              border: "none",
              cursor: pending || !matches ? "not-allowed" : "pointer",
            }}
          >
            {pending ? "Deleting…" : "Delete bucket"}
          </button>
        </div>
      </form>
    </div>
  );
}
