"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";
import type { PolicyTargetType } from "@/types";
import type { PolicyInput } from "@/lib/policy-schema";
import { policyInputSchema } from "@/lib/policy-schema";
import { DomainInput } from "@/components/policies/domain-input";
import { IpRangeInput } from "@/components/policies/ip-range-input";
import { TargetPicker } from "@/components/policies/target-picker";
import { PolicyPreview } from "@/components/policies/policy-preview";

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

export function PolicyForm({ initial, buckets, mode }: PolicyFormProps) {
  const router = useRouter();
  const [policy, setPolicy] = useState<PolicyInput>({
    ...DEFAULT_VALUES,
    ...initial,
    allowedDomains: initial?.allowedDomains ?? [],
    allowedIpRanges: initial?.allowedIpRanges ?? [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const validation = useMemo(
    () => policyInputSchema.safeParse(policy),
    [policy],
  );
  const isValid = validation.success;

  const onSubmit = async (e: React.FormEvent) => {
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
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
        gap: "1.5rem",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <label style={labelStyle}>
          Policy name
          <input
            type="text"
            value={policy.name}
            onChange={(e) =>
              setPolicy({ ...policy, name: e.target.value })
            }
            required
            maxLength={128}
            disabled={submitting}
            style={inputStyle}
          />
        </label>

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

        <label style={labelStyle}>
          Allowed domains (optional, referrer)
          <DomainInput
            value={policy.allowedDomains}
            onChange={(allowedDomains) =>
              setPolicy({ ...policy, allowedDomains: [...allowedDomains] })
            }
            disabled={submitting}
          />
        </label>

        <label style={labelStyle}>
          Allowed IP ranges (optional, CIDR)
          <IpRangeInput
            value={policy.allowedIpRanges}
            onChange={(allowedIpRanges) =>
              setPolicy({ ...policy, allowedIpRanges: [...allowedIpRanges] })
            }
            disabled={submitting}
          />
        </label>

        <label style={labelStyle}>
          Link expiration
          <select
            value={policy.linkTtlSeconds}
            disabled={submitting}
            onChange={(e) =>
              setPolicy({
                ...policy,
                linkTtlSeconds: Number.parseInt(e.target.value, 10),
              })
            }
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
          Max downloads (blank = unlimited)
          <input
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
            style={inputStyle}
          />
        </label>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.85rem",
          }}
        >
          <input
            type="checkbox"
            checked={policy.requireAuth}
            disabled={submitting}
            onChange={(e) =>
              setPolicy({ ...policy, requireAuth: e.target.checked })
            }
          />
          Require Auth0 session to access generated link
        </label>

        {serverError && (
          <p role="alert" style={{ color: BRAND.colors.pink, margin: 0 }}>
            Save failed: {serverError}
          </p>
        )}

        <div style={{ display: "flex", gap: "0.5rem" }}>
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
            {submitting
              ? "Saving…"
              : mode === "edit"
                ? "Save changes"
                : "Create policy"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/policies")}
            disabled={submitting}
            style={{
              padding: "0.5rem 1rem",
              background: "transparent",
              border: `1px solid ${BRAND.colors.dark}33`,
              borderRadius: "0.375rem",
              cursor: submitting ? "not-allowed" : "pointer",
              fontSize: "0.85rem",
            }}
          >
            Cancel
          </button>
        </div>
      </div>

      <PolicyPreview policy={policy} />
    </form>
  );
}
