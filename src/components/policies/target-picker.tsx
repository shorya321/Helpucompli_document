"use client";

import { BRAND } from "@/lib/brand";
import type { PolicyTargetType } from "@/types";

interface TargetPickerProps {
  readonly targetType: PolicyTargetType;
  readonly targetValue: string;
  readonly buckets: ReadonlyArray<{ id: string; name: string }>;
  readonly onChange: (next: {
    targetType: PolicyTargetType;
    targetValue: string;
  }) => void;
  readonly disabled?: boolean;
}

const TYPES: ReadonlyArray<{ value: PolicyTargetType; label: string }> = [
  { value: "bucket", label: "Whole bucket" },
  { value: "prefix", label: "Folder (prefix)" },
  { value: "object", label: "Single object" },
];

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  border: `1px solid ${BRAND.colors.dark}33`,
  borderRadius: "0.375rem",
  fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
  fontSize: "0.85rem",
  background: "#FFFFFF",
  color: BRAND.colors.dark,
  width: "100%",
};

export function TargetPicker({
  targetType,
  targetValue,
  buckets,
  onChange,
  disabled,
}: TargetPickerProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <fieldset
        style={{
          display: "flex",
          gap: "0.5rem",
          border: "none",
          padding: 0,
          margin: 0,
        }}
      >
        <legend
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "rgba(30,41,59,0.72)",
            marginBottom: "0.25rem",
          }}
        >
          Apply to
        </legend>
        {TYPES.map((t) => (
          <label
            key={t.value}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.85rem",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <input
              type="radio"
              name="targetType"
              value={t.value}
              checked={targetType === t.value}
              disabled={disabled}
              onChange={() => onChange({ targetType: t.value, targetValue: "" })}
            />
            {t.label}
          </label>
        ))}
      </fieldset>

      {targetType === "bucket" ? (
        <select
          aria-label="Bucket"
          value={targetValue}
          disabled={disabled}
          onChange={(e) =>
            onChange({ targetType, targetValue: e.target.value })
          }
          style={inputStyle}
        >
          <option value="">Select bucket…</option>
          {buckets.map((b) => (
            <option key={b.id} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          aria-label={
            targetType === "prefix" ? "Folder prefix" : "Object key"
          }
          placeholder={
            targetType === "prefix"
              ? "shared/contracts/"
              : "shared/contracts/agreement.pdf"
          }
          value={targetValue}
          disabled={disabled}
          maxLength={1024}
          onChange={(e) =>
            onChange({ targetType, targetValue: e.target.value })
          }
          style={{
            ...inputStyle,
            fontFamily: "ui-monospace, monospace",
          }}
        />
      )}
    </div>
  );
}
