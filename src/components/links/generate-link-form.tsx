"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import {
  LINK_MIN_TTL_SECONDS,
  LINK_MAX_TTL_SECONDS,
} from "@/lib/link-create";
import type { ApiResponse } from "@/types";

const TTL_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 900, label: "15 minutes" },
  { value: 3_600, label: "1 hour" },
  { value: 86_400, label: "24 hours" },
  { value: 604_800, label: "7 days" },
];

interface DocumentOption {
  readonly id: string;
  readonly name: string;
  readonly bucketName: string;
}

interface PolicyOption {
  readonly id: string;
  readonly name: string;
  readonly linkTtlSeconds: number;
  readonly maxDownloads: number | null;
}

interface GenerateLinkFormProps {
  readonly documents: readonly DocumentOption[];
  readonly policies: readonly PolicyOption[];
}

interface CreateResp {
  readonly id: string;
  readonly token: string;
  readonly shareableUrl: string;
  readonly expiresAt: string;
  readonly ttlSeconds: number;
  readonly maxDownloads: number | null;
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "rgba(30,41,59,0.72)",
};

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  border: `1px solid ${BRAND.colors.dark}33`,
  borderRadius: "0.375rem",
  fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
  fontSize: "0.85rem",
  background: "#FFFFFF",
  color: BRAND.colors.dark,
};

export function GenerateLinkForm({
  documents,
  policies,
}: GenerateLinkFormProps) {
  const router = useRouter();
  const [documentId, setDocumentId] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [ttl, setTtl] = useState<number>(900);
  const [maxDownloads, setMaxDownloads] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isValid = documentId !== "";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          documentId,
          policyId: policyId === "" ? null : policyId,
          ttlSecondsOverride: ttl,
          maxDownloadsOverride:
            maxDownloads === "" ? null : Number.parseInt(maxDownloads, 10),
        }),
      });
      const body = (await res.json()) as ApiResponse<CreateResp>;
      if (!res.ok || !body.data) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(body.data);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const onCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.shareableUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard write failed. Copy the URL manually.");
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        padding: "1rem",
        background: "#FFFFFF",
        border: `1px solid ${BRAND.colors.dark}1A`,
        borderRadius: "0.5rem",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
      }}
    >
      <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: 0 }}>
        Generate share link
      </h2>

      <label style={labelStyle}>
        Document
        <select
          value={documentId}
          required
          onChange={(e) => setDocumentId(e.target.value)}
          disabled={submitting}
          style={inputStyle}
        >
          <option value="">Select document…</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.bucketName} — {d.name}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Policy (optional)
        <select
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
          disabled={submitting}
          style={inputStyle}
        >
          <option value="">No policy (default settings)</option>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        TTL
        <select
          value={ttl}
          disabled={submitting}
          onChange={(e) => setTtl(Number.parseInt(e.target.value, 10))}
          style={inputStyle}
        >
          {TTL_PRESETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Max downloads (optional, blank = unlimited within policy cap)
        <input
          type="number"
          min={1}
          max={99_999}
          value={maxDownloads}
          disabled={submitting}
          onChange={(e) => setMaxDownloads(e.target.value)}
          style={inputStyle}
        />
      </label>

      {error && (
        <p role="alert" style={{ color: BRAND.colors.pink, margin: 0 }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!isValid || submitting}
        style={{
          padding: "0.5rem 1rem",
          background: BRAND.colors.pink,
          color: "#FFFFFF",
          border: "none",
          borderRadius: "0.375rem",
          cursor: !isValid || submitting ? "not-allowed" : "pointer",
          opacity: !isValid || submitting ? 0.6 : 1,
          fontWeight: 600,
          fontSize: "0.85rem",
        }}
      >
        {submitting ? "Generating…" : "Generate link"}
      </button>

      {result && (
        <div
          style={{
            padding: "0.75rem",
            background: "rgba(37,99,235,0.08)",
            border: `1px solid ${BRAND.colors.blue}33`,
            borderRadius: "0.375rem",
          }}
        >
          <p
            style={{
              margin: "0 0 0.5rem",
              fontSize: "0.75rem",
              color: "rgba(30,41,59,0.72)",
            }}
          >
            Share this link — expires{" "}
            {new Date(result.expiresAt).toLocaleString()}
            {result.maxDownloads !== null
              ? ` · ${result.maxDownloads} downloads max`
              : " · unlimited downloads"}
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              readOnly
              value={result.shareableUrl}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Generated link URL"
              style={{
                ...inputStyle,
                flex: 1,
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
              }}
            />
            <button
              type="button"
              onClick={onCopy}
              style={{
                padding: "0.5rem 1rem",
                background: BRAND.colors.dark,
                color: "#FFFFFF",
                border: "none",
                borderRadius: "0.375rem",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85rem",
                whiteSpace: "nowrap",
              }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <p
        style={{
          margin: 0,
          fontSize: "0.7rem",
          color: "rgba(30,41,59,0.56)",
        }}
      >
        TTL must be {LINK_MIN_TTL_SECONDS}s–{LINK_MAX_TTL_SECONDS}s. Policy TTL
        caps the override.
      </p>
    </form>
  );
}
