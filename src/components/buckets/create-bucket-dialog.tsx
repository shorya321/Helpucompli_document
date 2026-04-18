"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import {
  AWS_REGIONS,
  HIPAA_BUCKET_NAME_PREFIX,
} from "@/lib/bucket-constants";

interface CreateBucketDialogProps {
  readonly closeHref: string;
}

// Guard against open-redirect if `closeHref` is ever wired to a
// user-supplied search param. Only same-origin relative paths allowed.
function safeHref(href: string): string {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return "/buckets";
}

export function CreateBucketDialog({
  closeHref: rawCloseHref,
}: CreateBucketDialogProps) {
  const closeHref = safeHref(rawCloseHref);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(HIPAA_BUCKET_NAME_PREFIX);
  const [awsRegion, setAwsRegion] = useState<string>(AWS_REGIONS[0]);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch("/api/s3/buckets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          awsRegion,
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      // Close + refresh the bucket list so the new row shows up.
      startTransition(() => {
        router.push(closeHref);
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
      aria-labelledby="create-bucket-title"
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
          id="create-bucket-title"
          style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}
        >
          Create bucket
        </h2>
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "rgba(30,41,59,0.72)" }}>
          HIPAA settings (SSE-KMS, versioning, public-access block, HTTPS
          policy, CloudTrail data events) are applied automatically.
        </p>
        <p
          style={{
            margin: 0,
            padding: "0.625rem 0.75rem",
            background: `${BRAND.colors.pink}12`,
            color: BRAND.colors.pink,
            borderRadius: "0.5rem",
            fontSize: "0.75rem",
            fontWeight: 500,
          }}
        >
          Do not enter patient names, MRNs, birthdates, or any PHI in the
          bucket name or description. Both fields are stored in cleartext
          and surfaced in audit logs.
        </p>

        <label style={fieldLabel}>
          Bucket name
          <input
            required
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            pattern="^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$"
            minLength={3}
            maxLength={63}
            style={fieldInput}
            placeholder={`${HIPAA_BUCKET_NAME_PREFIX}tenant-name`}
          />
          <span style={fieldHelp}>
            Must start with <code>{HIPAA_BUCKET_NAME_PREFIX}</code>. Lowercase,
            digits, hyphens only. 3–63 chars.
          </span>
        </label>

        <label style={fieldLabel}>
          AWS region
          <select
            name="awsRegion"
            value={awsRegion}
            onChange={(e) => setAwsRegion(e.target.value)}
            style={fieldInput}
          >
            {AWS_REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label style={fieldLabel}>
          Description <span style={{ opacity: 0.6 }}>(optional)</span>
          <textarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2048}
            rows={3}
            style={{ ...fieldInput, fontFamily: "inherit" }}
          />
        </label>

        {error ? (
          <p
            role="alert"
            style={{ margin: 0, color: BRAND.colors.pink, fontSize: "0.875rem" }}
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
            href={closeHref}
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
            disabled={pending}
            style={{
              background: pending
                ? `${BRAND.colors.pink}80`
                : BRAND.colors.pink,
              color: "#FFFFFF",
              padding: "0.5rem 0.875rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              borderRadius: "0.5rem",
              border: "none",
              cursor: pending ? "wait" : "pointer",
            }}
          >
            {pending ? "Creating…" : "Create bucket"}
          </button>
        </div>
      </form>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: BRAND.colors.blue,
  fontWeight: 600,
};

const fieldInput: React.CSSProperties = {
  padding: "0.5rem 0.625rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  color: BRAND.colors.dark,
  background: "#FFFFFF",
  border: `1px solid ${BRAND.colors.dark}33`,
  borderRadius: "0.375rem",
  fontFamily: "inherit",
};

const fieldHelp: React.CSSProperties = {
  fontSize: "0.6875rem",
  textTransform: "none",
  letterSpacing: 0,
  color: "rgba(30,41,59,0.64)",
  fontWeight: 400,
};
