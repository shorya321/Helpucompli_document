"use client";

import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PolicyTargetType } from "@/types";

interface TargetPickerProps {
  readonly targetType: PolicyTargetType;
  readonly targetValue: string;
  readonly buckets: ReadonlyArray<{ id: string; name: string }>;
  // Optional document list for the "Single object" branch. When
  // provided, the picker renders a dropdown of {bucket} — {filename}
  // entries instead of a free-text S3 key input. Selecting a row sets
  // targetValue to that document's full s3Key (uuid prefix + sanitized
  // filename) so the user does not need to know the on-disk key shape.
  readonly documents?: ReadonlyArray<{
    id: string;
    filename: string;
    s3Key: string;
    bucketName: string;
  }>;
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
  documents,
  onChange,
  disabled,
}: TargetPickerProps) {
  // Derive every unique folder prefix from the document list so the
  // "Folder (prefix)" target offers a dropdown instead of free-text.
  // Generates all parent prefixes too (e.g. `a/b/c/file.png` →
  // `a/`, `a/b/`, `a/b/c/`) so the operator can target any level. Empty
  // folders (no files yet) are NOT included — that is the documented
  // tradeoff for using the existing documents list rather than running
  // a per-bucket S3 LIST on every form load.
  const folders = useMemo(() => {
    if (!documents) return [];
    const seen = new Map<string, { prefix: string; bucketName: string }>();
    for (const d of documents) {
      const segments = d.s3Key.split("/").filter((s) => s !== "");
      segments.pop(); // drop the filename leaf
      for (let i = 1; i <= segments.length; i += 1) {
        const prefix = segments.slice(0, i).join("/") + "/";
        const key = `${d.bucketName}::${prefix}`;
        if (!seen.has(key)) seen.set(key, { prefix, bucketName: d.bucketName });
      }
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.bucketName === b.bucketName
        ? a.prefix.localeCompare(b.prefix)
        : a.bucketName.localeCompare(b.bucketName),
    );
  }, [documents]);

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
      ) : targetType === "object" && documents && documents.length > 0 ? (
        <select
          aria-label="Document"
          value={targetValue}
          disabled={disabled}
          onChange={(e) =>
            onChange({ targetType, targetValue: e.target.value })
          }
          className={nativeSelectClass}
        >
          <option value="">Select document…</option>
          {documents.map((d) => (
            <option key={d.id} value={d.s3Key}>
              {d.bucketName} — {d.filename}
            </option>
          ))}
        </select>
      ) : targetType === "prefix" && folders.length > 0 ? (
        <select
          aria-label="Folder prefix"
          value={targetValue}
          disabled={disabled}
          onChange={(e) =>
            onChange({ targetType, targetValue: e.target.value })
          }
          className={nativeSelectClass}
        >
          <option value="">Select folder…</option>
          {folders.map((f) => (
            <option key={`${f.bucketName}::${f.prefix}`} value={f.prefix}>
              {f.bucketName} — {f.prefix}
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
