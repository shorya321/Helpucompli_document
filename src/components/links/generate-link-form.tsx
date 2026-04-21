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
  const [embedCopied, setEmbedCopied] = useState(false);

  const embedCode = useMemo(() => {
    if (!result) return "";
    return `<iframe
  src="${result.shareableUrl}"
  width="100%"
  height="600"
  style="border:0"
  loading="lazy"
  referrerpolicy="no-referrer-when-downgrade"
  allow="fullscreen"
></iframe>`;
  }, [result]);

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
              onChange={(e) => setTtl(Number.parseInt(e.target.value, 10))}
              className={nativeSelectClass}
            >
              {TTL_PRESETS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
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
                Share this link — expires{" "}
                <span className="tabular-nums">
                  {formatDateTime(result.expiresAt)}
                </span>
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
