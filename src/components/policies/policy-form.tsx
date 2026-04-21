"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DomainInput } from "@/components/policies/domain-input";
import { IpRangeInput } from "@/components/policies/ip-range-input";
import { PolicyPreview } from "@/components/policies/policy-preview";
import { TargetPicker } from "@/components/policies/target-picker";
import type { PolicyInput } from "@/lib/policy-schema";
import { policyInputSchema } from "@/lib/policy-schema";
import type { PolicyTargetType } from "@/types";

const TTL_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 900, label: "15 minutes" },
  { value: 3600, label: "1 hour" },
  { value: 86_400, label: "24 hours" },
  { value: 604_800, label: "7 days" },
];

interface PolicyFormProps {
  readonly initial?: Partial<PolicyInput> & { id?: string };
  readonly buckets: ReadonlyArray<{ id: string; name: string }>;
  readonly mode: "create" | "edit";
  // Gates the "Never expires" TTL option. Server also 403s if a non-
  // superadmin sends linkTtlSeconds=null.
  readonly canNeverExpire?: boolean;
}

const DEFAULT_VALUES: PolicyInput = {
  name: "",
  targetType: "bucket",
  targetValue: "",
  allowedDomains: [],
  allowedIpRanges: [],
  linkTtlSeconds: 900,
  maxDownloads: null,
  requireAuth: false,
};

// Native <select> styled to match shadcn Input. Used for the TTL preset
// where the GET-form / Radix popover tradeoffs favor the native control.
const nativeSelectClass =
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";

export function PolicyForm({
  initial,
  buckets,
  mode,
  canNeverExpire = false,
}: PolicyFormProps) {
  const router = useRouter();
  const [policy, setPolicy] = useState<PolicyInput>(() => {
    // Build the PolicyInput WITHOUT spreading `initial` blindly — the
    // edit page passes `{ id, ...fields }` and `policyInputSchema` is
    // .strict(), so any stray key (including `id`) would fail
    // validation and permanently disable the Save button.
    const src = initial ?? {};
    return {
      name: src.name ?? DEFAULT_VALUES.name,
      targetType: src.targetType ?? DEFAULT_VALUES.targetType,
      targetValue: src.targetValue ?? DEFAULT_VALUES.targetValue,
      allowedDomains: src.allowedDomains ?? [],
      allowedIpRanges: src.allowedIpRanges ?? [],
      linkTtlSeconds: src.linkTtlSeconds ?? DEFAULT_VALUES.linkTtlSeconds,
      maxDownloads:
        src.maxDownloads === undefined
          ? DEFAULT_VALUES.maxDownloads
          : src.maxDownloads,
      requireAuth: src.requireAuth ?? DEFAULT_VALUES.requireAuth,
    };
  });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const validation = useMemo(
    () => policyInputSchema.safeParse(policy),
    [policy],
  );
  const isValid = validation.success;

  const onSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const url =
        mode === "edit" && initial?.id
          ? `/api/policies/${initial.id}`
          : "/api/policies";
      const method = mode === "edit" ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(policy),
      });
      if (!res.ok) {
        setServerError(`HTTP ${res.status}`);
        return;
      }
      router.push("/policies");
      router.refresh();
    } catch {
      setServerError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="text-foreground grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-name">Policy name</Label>
          <Input
            id="policy-name"
            type="text"
            value={policy.name}
            onChange={(e) => setPolicy({ ...policy, name: e.target.value })}
            required
            maxLength={128}
            disabled={submitting}
          />
        </div>

        <TargetPicker
          targetType={policy.targetType}
          targetValue={policy.targetValue}
          buckets={buckets}
          disabled={submitting}
          onChange={({ targetType, targetValue }) =>
            setPolicy({
              ...policy,
              targetType: targetType as PolicyTargetType,
              targetValue,
            })
          }
        />

        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-domains">
            Allowed domains{" "}
            <span className="text-muted-foreground font-normal">
              (optional, referrer)
            </span>
          </Label>
          <DomainInput
            id="policy-domains"
            value={policy.allowedDomains}
            onChange={(allowedDomains) =>
              setPolicy({ ...policy, allowedDomains: [...allowedDomains] })
            }
            disabled={submitting}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-ips">
            Allowed IP ranges{" "}
            <span className="text-muted-foreground font-normal">
              (optional, CIDR)
            </span>
          </Label>
          <IpRangeInput
            id="policy-ips"
            value={policy.allowedIpRanges}
            onChange={(allowedIpRanges) =>
              setPolicy({ ...policy, allowedIpRanges: [...allowedIpRanges] })
            }
            disabled={submitting}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-ttl">Link expiration</Label>
          <select
            id="policy-ttl"
            value={policy.linkTtlSeconds === null ? "never" : policy.linkTtlSeconds}
            disabled={submitting}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "never") {
                // HIPAA footgun guard: a policy with linkTtlSeconds=null
                // issues perpetual bearer tokens for every link it
                // governs. Explicit confirm required; cancel reverts.
                const ok = window.confirm(
                  "Links governed by this policy will not expire unless revoked or the download cap is hit. Are you sure?",
                );
                if (ok) setPolicy({ ...policy, linkTtlSeconds: null });
                return;
              }
              setPolicy({
                ...policy,
                linkTtlSeconds: Number.parseInt(raw, 10),
              });
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

        <div className="flex flex-col gap-2">
          <Label htmlFor="policy-max-downloads">
            Max downloads{" "}
            <span className="text-muted-foreground font-normal">
              (blank = unlimited)
            </span>
          </Label>
          <Input
            id="policy-max-downloads"
            type="number"
            min={1}
            max={99_999}
            value={policy.maxDownloads ?? ""}
            disabled={submitting}
            onChange={(e) => {
              const raw = e.target.value;
              setPolicy({
                ...policy,
                maxDownloads: raw === "" ? null : Number.parseInt(raw, 10),
              });
            }}
            className="tabular-nums"
          />
        </div>

        <Label className="inline-flex cursor-pointer items-center gap-2 text-sm font-normal">
          <input
            type="checkbox"
            checked={policy.requireAuth}
            disabled={submitting}
            onChange={(e) =>
              setPolicy({ ...policy, requireAuth: e.target.checked })
            }
            className="accent-primary"
          />
          Require Auth0 session to access generated link
        </Label>

        {serverError && (
          <p role="alert" className="text-destructive m-0 text-sm">
            Save failed: {serverError}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={!isValid || submitting}>
            {submitting
              ? "Saving…"
              : mode === "edit"
                ? "Save changes"
                : "Create policy"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/policies")}
            disabled={submitting}
          >
            Cancel
          </Button>
        </div>
      </div>

      <PolicyPreview policy={policy} />
    </form>
  );
}
