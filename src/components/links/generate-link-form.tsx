"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  LINK_MIN_TTL_SECONDS,
  LINK_MAX_TTL_SECONDS,
} from "@/lib/link-create";
import { formatDateTime } from "@/lib/format-datetime";
import { buildEmbedCode } from "@/lib/link-embed";
import type { ApiResponse } from "@/types";
import { QrCode } from "@/components/links/qr-code";

// Native <select> styled to match shadcn Input. The policy/TTL/document
// pickers are driven by local state but stay on native DOM elements so
// the form behaves predictably for submit/disabled state without pulling
// in the Radix popover variant.
const nativeSelectClass =
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";

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
  // null = policy allows "never expires" — superadmin-gated on write.
  readonly linkTtlSeconds: number | null;
  readonly maxDownloads: number | null;
}

interface GenerateLinkFormProps {
  readonly documents: readonly DocumentOption[];
  readonly policies: readonly PolicyOption[];
  // Gates the "Never expires" checkbox. Server also enforces this — UI
  // hide is cosmetic; the POST /api/links handler 403s when a non-
  // superadmin sends neverExpires=true.
  readonly canNeverExpire?: boolean;
  // Preselect the document dropdown when the user arrives from the
  // doc browser right-click "Generate link" action. Must match one of
  // the `documents[].id` values — unmatched IDs are ignored and the
  // form opens with the placeholder.
  readonly initialDocumentId?: string;
}

interface CreateResp {
  readonly id: string;
  readonly token: string;
  readonly shareableUrl: string;
  readonly expiresAt: string | null;
  readonly ttlSeconds: number | null;
  readonly maxDownloads: number | null;
}

export function GenerateLinkForm({
  documents,
  policies,
  canNeverExpire = false,
  initialDocumentId,
}: GenerateLinkFormProps) {
  const router = useRouter();
  const [documentId, setDocumentId] = useState(
    initialDocumentId && documents.some((d) => d.id === initialDocumentId)
      ? initialDocumentId
      : "",
  );
  const [policyId, setPolicyId] = useState("");
  // "never" sentinel = superadmin-only. Stored in the same state as the
  // finite presets so the TTL <select> is a single control, not a pair
  // of widgets. Submit converts "never" → { ttlSecondsOverride: null,
  // neverExpires: true }.
  const [ttl, setTtl] = useState<number | "never">(900);
  const [maxDownloads, setMaxDownloads] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);

  const embedCode = useMemo(
    () => (result ? buildEmbedCode(result.shareableUrl) : ""),
    [result],
  );

  const isValid = documentId !== "";

  const onSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
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
          // "never" sentinel in the TTL select → nullable override +
          // neverExpires flag. Server still 403s for non-superadmin even
          // if the client somehow bypasses the hidden <option>.
          ttlSecondsOverride: ttl === "never" ? null : ttl,
          maxDownloadsOverride:
            maxDownloads === "" ? null : Number.parseInt(maxDownloads, 10),
          neverExpires: ttl === "never",
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

  const onCopyEmbed = async () => {
    if (!embedCode) return;
    try {
      await navigator.clipboard.writeText(embedCode);
      setEmbedCopied(true);
      window.setTimeout(() => setEmbedCopied(false), 2000);
    } catch {
      setError("Clipboard write failed. Copy the embed code manually.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate share link</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gl-document">Document</Label>
            <select
              id="gl-document"
              value={documentId}
              required
              onChange={(e) => setDocumentId(e.target.value)}
              disabled={submitting}
              className={nativeSelectClass}
            >
              <option value="">Select document…</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.bucketName} — {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gl-policy">Policy (optional)</Label>
            <select
              id="gl-policy"
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              disabled={submitting}
              className={nativeSelectClass}
            >
              <option value="">No policy (default settings)</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {policyId === "" && (
              <span className="border-border bg-muted text-muted-foreground rounded-md border px-3 py-2 text-xs">
                ⚠ Anonymous unrestricted share — anyone with the URL can
                download until expiry or revoke.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gl-ttl">TTL</Label>
            <select
              id="gl-ttl"
              value={ttl}
              disabled={submitting}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "never") {
                  // HIPAA footgun guard: picking "Never expires" produces
                  // a perpetual bearer token. Require explicit confirm;
                  // revert to prior preset on cancel.
                  const ok = window.confirm(
                    "A non-expiring share link remains valid until it is revoked or the download cap is hit. Are you sure?",
                  );
                  if (ok) setTtl("never");
                  return;
                }
                setTtl(Number.parseInt(raw, 10));
              }}
              className={nativeSelectClass}
            >
              {TTL_PRESETS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
              {canNeverExpire && (
                <option value="never">
                  Never expires (superadmin only — audited)
                </option>
              )}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gl-max">
              Max downloads{" "}
              <span className="text-muted-foreground font-normal">
                (optional, blank = unlimited within policy cap)
              </span>
            </Label>
            <Input
              id="gl-max"
              type="number"
              min={1}
              max={99_999}
              value={maxDownloads}
              disabled={submitting}
              onChange={(e) => setMaxDownloads(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-destructive m-0 text-sm">
              {error}
            </p>
          )}

          {/*
            Generate button stays solid (no disabled opacity) until
            the request is in flight. Validity is enforced inside
            onSubmit — if isValid is false we return early, matching
            the existing server-side guard.
          */}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Generating…" : "Generate link"}
          </Button>

          {result && (
            <div className="border-border bg-muted rounded-md border p-3">
              <p className="text-muted-foreground m-0 mb-2 text-xs">
                Share this link —{" "}
                {result.expiresAt === null ? (
                  <span className="text-foreground font-semibold">
                    never expires
                  </span>
                ) : (
                  <>
                    expires{" "}
                    <span className="tabular-nums">
                      {formatDateTime(result.expiresAt)}
                    </span>
                  </>
                )}
                {result.maxDownloads !== null
                  ? ` · ${result.maxDownloads} downloads max`
                  : " · unlimited downloads"}
              </p>
              <div className="flex gap-2">
                <Input
                  type="text"
                  readOnly
                  value={result.shareableUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Generated link URL"
                  className="flex-1 text-xs"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onCopy}
                  className="whitespace-nowrap"
                >
                  {copied ? "Copied!" : "Copy URL"}
                </Button>
              </div>
              <div className="mt-2 flex items-start gap-2">
                <Textarea
                  readOnly
                  value={embedCode}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Iframe embed code"
                  rows={6}
                  className="flex-1 whitespace-pre resize-y text-xs"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onCopyEmbed}
                  className="whitespace-nowrap"
                >
                  {embedCopied ? "Copied!" : "Copy embed"}
                </Button>
              </div>
              <p className="text-muted-foreground mt-1 mb-0 text-xs">
                Paste the embed snippet into any HTML page. If a policy
                with Allowed Domains is attached, the page must be hosted
                on one of those domains so the browser sends a matching
                Referer.
              </p>
              <div className="mt-3">
                <QrCode url={result.shareableUrl} />
              </div>
            </div>
          )}

          <p className="text-muted-foreground m-0 text-xs">
            TTL must be {LINK_MIN_TTL_SECONDS}s–{LINK_MAX_TTL_SECONDS}s.
            Policy TTL caps the override.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
