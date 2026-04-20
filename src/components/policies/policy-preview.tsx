"use client";

import { BRAND } from "@/lib/brand";
import {
  describePolicy,
  type PolicyPreviewInput,
} from "@/lib/policy-preview";

interface PolicyPreviewProps {
  readonly policy: PolicyPreviewInput;
}

const ROWS: ReadonlyArray<{
  readonly label: string;
  readonly key: keyof ReturnType<typeof describePolicy>;
}> = [
  { label: "Applies to", key: "target" },
  { label: "Links expire after", key: "ttl" },
  { label: "Max downloads", key: "maxDownloads" },
  { label: "IP restriction", key: "ipRestriction" },
  { label: "Domain restriction", key: "domainRestriction" },
  { label: "Auth required", key: "requireAuth" },
];

export function PolicyPreview({ policy }: PolicyPreviewProps) {
  const desc = describePolicy(policy);
  return (
    <aside
      aria-label="Policy preview"
      style={{
        padding: "1rem",
        background: "#FFFFFF",
        border: `1px solid ${BRAND.colors.dark}1A`,
        borderRadius: "0.5rem",
        fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
        color: BRAND.colors.dark,
        fontSize: "0.85rem",
      }}
    >
      <h3
        style={{
          fontSize: "0.75rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "rgba(30,41,59,0.64)",
          margin: "0 0 0.75rem",
        }}
      >
        Policy preview
      </h3>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "0.5rem 1rem",
          margin: 0,
        }}
      >
        {ROWS.map((row) => (
          <div
            key={row.key}
            style={{ display: "contents" }}
          >
            <dt style={{ color: "rgba(30,41,59,0.64)", fontWeight: 600 }}>
              {row.label}
            </dt>
            <dd
              style={{
                margin: 0,
                fontFamily:
                  row.key === "target" ? "ui-monospace, monospace" : undefined,
              }}
            >
              {desc[row.key]}
            </dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
