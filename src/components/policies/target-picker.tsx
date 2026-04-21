"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

// Native <select> styled to match shadcn Input. Kept as a native control
// so the surrounding form semantics (disabled, keyboard submit) behave
// the same way they did before the shadcn migration.
const nativeSelectClass =
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";

export function TargetPicker({
  targetType,
  targetValue,
  buckets,
  onChange,
  disabled,
}: TargetPickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <fieldset className="m-0 flex flex-wrap gap-3 border-none p-0">
        <legend className="text-muted-foreground mb-1 text-xs font-semibold">
          Apply to
        </legend>
        {TYPES.map((t) => (
          <Label
            key={t.value}
            className={`inline-flex items-center gap-1.5 text-sm font-normal ${
              disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            }`}
          >
            <input
              type="radio"
              name="targetType"
              value={t.value}
              checked={targetType === t.value}
              disabled={disabled}
              onChange={() => onChange({ targetType: t.value, targetValue: "" })}
              className="accent-primary"
            />
            {t.label}
          </Label>
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
          className={nativeSelectClass}
        >
          <option value="">Select bucket…</option>
          {buckets.map((b) => (
            <option key={b.id} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      ) : (
        <Input
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
        />
      )}
    </div>
  );
}
