"use client";

import { useEffect, useMemo, useState } from "react";
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
  readonly allowPublicEmbed: boolean;
}

interface EffectivePolicyPreview {
  readonly source: "object" | "prefix" | "bucket" | "default" | "none";
  readonly policyId: string | null;
  readonly linkTtlSeconds: number;
  readonly maxDownloads: number | null;
  readonly requireAuth: boolean;
  readonly allowedDomains: readonly string[];
  readonly allowedIpRanges: readonly string[];
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
  const [effectivePolicy, setEffectivePolicy] =
    useState<EffectivePolicyPreview | null>(null);
  const [effectiveLoading, setEffectiveLoading] = useState(false);
  // "never" sentinel = superadmin-only. Stored in the same state as the
  // finite presets so the TTL <select> is a single control, not a pair
  // of widgets. Submit converts "never" → { ttlSecondsOverride: null,
  // neverExpires: true }.
  const [ttl, setTtl] = useState<number | "never">(900);
  const [maxDownloads, setMaxDownloads] = useState("");
  // Per-link opt-in for cross-platform iframe embedding (WordPress
  // Embed/Custom-HTML block, Circle, Notion, Confluence). Default off
  // = HIPAA-safe; the URL still works for direct browser viewing but
  // any iframe parent gets `frame-ancestors 'none'`. When on, viewer
  // emits oEmbed discovery and CSP appends `https:`.
  const [allowPublicEmbed, setAllowPublicEmbed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);

  const embedCode = useMemo(
    () => (result ? buildEmbedCode(result.shareableUrl) : ""),
    [result],
  );

  // Fetch effective policy whenever the document changes. Aborts any
  // in-flight request so a fast dropdown change does not flash stale
  // banner content. Errors are swallowed — the preview is advisory and
  // must never block link creation. When no document is selected we
  // skip the fetch entirely; the document <select> onChange clears
  // `effectivePolicy` before the effect re-runs, so there is no stale
  // banner risk here.
  useEffect(() => {
    if (documentId === "") return;
    const ctl = new AbortController();
    let active = true;
    // Note: loading flag is set synchronously in the document <select>
    // onChange handler (not here) so this effect does not call setState
    // outside an async callback, matching the project's ESLint
    // `react-hooks/set-state-in-effect` guard.
    (async () => {
      try {
        const res = await fetch(
          `/api/policies/effective?documentId=${encodeURIComponent(documentId)}`,
          { signal: ctl.signal, cache: "no-store" },
        );
        if (!active) return;
        if (!res.ok) {
          setEffectivePolicy(null);
          return;
        }
        const body = (await res.json()) as ApiResponse<EffectivePolicyPreview>;
        if (!active) return;
        if (body.data) setEffectivePolicy(body.data);
        else setEffectivePolicy(null);
      } catch {
        if (active && !ctl.signal.aborted) setEffectivePolicy(null);
      } finally {
        if (active) setEffectiveLoading(false);
      }
    })();
    return () => {
      active = false;
      ctl.abort();
    };
  }, [documentId]);

  const selectedPolicyName = useMemo(() => {
    if (!effectivePolicy?.policyId) return null;
    return (
      policies.find((p) => p.id === effectivePolicy.policyId)?.name ?? null
    );
  }, [effectivePolicy, policies]);

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
          allowPublicEmbed,
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
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="gl-document"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Document
            </Label>
            <select
              id="gl-document"
              value={documentId}
              required
              onChange={(e) => {
                setDocumentId(e.target.value);
                // Clear stale banner before the effect re-fetches.
                // Skipping this would leak a previous doc's inherited
                // policy into the view for the newly-selected doc until
                // the fetch resolves.
                setEffectivePolicy(null);
                setEffectiveLoading(e.target.value !== "");
              }}
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
            <Label
              htmlFor="gl-policy"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Policy (optional)
            </Label>
            <select
              id="gl-policy"
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              disabled={submitting}
              className={nativeSelectClass}
            >
              <option value="">Use inherited policy</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground text-xs">
              Bucket and folder policies still apply when no override is
              selected.
            </span>
            {documentId !== "" && (
              <EffectivePolicyBanner
                effective={effectivePolicy}
                loading={effectiveLoading}
                override={
                  policyId === ""
                    ? null
                    : {
                        id: policyId,
                        name:
                          policies.find((p) => p.id === policyId)?.name ??
                          "Selected policy",
                      }
                }
                inheritedName={selectedPolicyName}
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="gl-ttl"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              TTL
            </Label>
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
            <Label
              htmlFor="gl-max"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Max downloads{" "}
              <span className="text-muted-foreground font-normal normal-case tracking-normal">
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

          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="gl-embed"
              className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider"
            >
              Embedding
            </Label>
            <label
              htmlFor="gl-embed"
              className="border-input bg-background flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <input
                id="gl-embed"
                type="checkbox"
                checked={allowPublicEmbed}
                disabled={submitting}
                onChange={(e) => {
                  if (e.target.checked) {
                    // HIPAA footgun guard: turning embedding on lets ANY
                    // HTTPS site iframe this link. Require explicit
                    // confirm; revert on cancel. Mirrors the "Never
                    // expires" pattern above.
                    const ok = window.confirm(
                      "Public embedding lets any HTTPS site iframe this link (WordPress, Circle, Notion). Do not enable for documents containing PHI. Continue?",
                    );
                    if (ok) setAllowPublicEmbed(true);
                    return;
                  }
                  setAllowPublicEmbed(false);
                }}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-1">
                <span className="text-foreground font-medium">
                  Allow embedding in iframes (WordPress, Notion, etc.)
                </span>
                <span className="text-muted-foreground text-xs">
                  Required to render this link inside another site.
                  Combined with a policy that has &quot;Allowed
                  Domains&quot;, the embed is restricted to those
                  hosts via CSP frame-ancestors. Leave OFF to keep
                  the link as a direct-access download — &quot;Allowed
                  Domains&quot; on the policy still gates direct
                  access strictly.
                </span>
                {allowPublicEmbed && (
                  <span
                    role="alert"
                    className="text-destructive text-xs font-medium"
                  >
                    ⚠ Non-PHI documents only. Every embed call is
                    audited.
                  </span>
                )}
              </span>
            </label>
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
              {result.allowPublicEmbed ? (
                <>
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
                    Paste the URL into a WordPress Embed block (auto-
                    preview via oEmbed) or paste the iframe snippet into
                    any Custom HTML / code block (WordPress, Circle,
                    Notion, Confluence). If a policy with Allowed
                    Domains is attached, browsers must still send a
                    matching Referer.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground mt-2 mb-0 text-xs">
                  This link is set to non-embeddable. It works for
                  direct browser viewing but third-party sites cannot
                  iframe it. Enable &quot;Allow public embedding&quot;
                  above before generating to get an embed snippet.
                </p>
              )}
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

interface EffectivePolicyBannerProps {
  readonly effective: EffectivePolicyPreview | null;
  readonly loading: boolean;
  readonly override: { readonly id: string; readonly name: string } | null;
  readonly inheritedName: string | null;
}

// Rendered under the policy select whenever a document is chosen.
// Shows: (a) the override the creator picked, if any; (b) the policy
// that would apply if they did not override, with the rule summary.
// If the creator picked "Use inherited policy" AND the inherited policy
// would deny anonymous recipients, we render an amber warning so they
// do not ship a link that 403s on open.
function EffectivePolicyBanner({
  effective,
  loading,
  override,
  inheritedName,
}: EffectivePolicyBannerProps) {
  if (loading && !effective) {
    return (
      <span
        role="status"
        aria-live="polite"
        className="border-border bg-muted text-muted-foreground rounded-md border px-3 py-2 text-xs"
      >
        Checking effective policy…
      </span>
    );
  }
  if (!effective) return null;

  if (override) {
    return (
      <span className="border-border bg-muted text-foreground rounded-md border px-3 py-2 text-xs">
        <span className="font-medium">Override:</span> {override.name} will
        replace the inherited rules for this link.
      </span>
    );
  }

  const displayName =
    inheritedName ??
    (effective.source === "none" || effective.source === "default"
      ? "Default (anonymous, no restrictions)"
      : `Policy ${effective.policyId?.slice(0, 8) ?? ""}`);

  const scope =
    effective.source === "object"
      ? "from this document"
      : effective.source === "prefix"
        ? "from a folder rule"
        : effective.source === "bucket"
          ? "from the bucket"
          : "no inherited policy found";

  const rules: string[] = [];
  rules.push(
    effective.requireAuth ? "login required" : "anonymous allowed",
  );
  rules.push(`TTL ${Math.round(effective.linkTtlSeconds / 60)}m`);
  if (effective.maxDownloads !== null) {
    rules.push(`max ${effective.maxDownloads} downloads`);
  }
  if (effective.allowedIpRanges.length > 0) {
    rules.push(`${effective.allowedIpRanges.length} IP range(s)`);
  }
  if (effective.allowedDomains.length > 0) {
    rules.push(`${effective.allowedDomains.length} referer domain(s)`);
  }

  // requireAuth with no override = recipient 403 on anonymous open.
  // Loud banner so the creator does not ship a broken link.
  if (effective.requireAuth) {
    return (
      <span
        role="alert"
        className="border-destructive/40 bg-destructive/10 text-foreground rounded-md border px-3 py-2 text-xs"
      >
        <span className="font-medium">Inherited: {displayName}</span>{" "}
        <span className="text-muted-foreground">({scope})</span>
        <br />
        <span className="font-medium">
          ⚠ Recipients must be logged in.
        </span>{" "}
        Anonymous opens will return 403. Pick a more permissive policy
        above if this link is for external users.
        <br />
        <span className="text-muted-foreground">Rules: {rules.join(" · ")}</span>
      </span>
    );
  }

  return (
    <span className="border-border bg-muted text-muted-foreground rounded-md border px-3 py-2 text-xs">
      <span className="text-foreground font-medium">
        Inherited: {displayName}
      </span>{" "}
      ({scope})
      <br />
      Rules: {rules.join(" · ")}
    </span>
  );
}
