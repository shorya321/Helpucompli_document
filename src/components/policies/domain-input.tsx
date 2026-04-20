"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { addDomain, removeAt } from "@/lib/policy-input-helpers";

interface DomainInputProps {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly disabled?: boolean;
  readonly id?: string;
}

export function DomainInput({
  value,
  onChange,
  disabled,
  id,
}: DomainInputProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const result = addDomain(value, draft);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setDraft("");
    onChange(result.next);
  };

  const remove = (domain: string) => {
    onChange(removeAt(value, domain));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <div
        role="list"
        aria-label="Allowed domains"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.375rem",
          minHeight: "1.5rem",
        }}
      >
        {value.map((domain) => (
          <span
            key={domain}
            role="listitem"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              background: BRAND.colors.blue,
              color: "#FFFFFF",
              padding: "0.25rem 0.5rem",
              borderRadius: "0.375rem",
              fontSize: "0.75rem",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {domain}
            <button
              type="button"
              onClick={() => remove(domain)}
              disabled={disabled}
              aria-label={`Remove ${domain}`}
              style={{
                background: "transparent",
                border: "none",
                color: "#FFFFFF",
                cursor: disabled ? "not-allowed" : "pointer",
                padding: 0,
                fontSize: "0.85rem",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          id={id}
          type="text"
          value={draft}
          placeholder="example.com or *.example.com"
          maxLength={253}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          disabled={disabled}
          aria-invalid={error !== null}
          style={{
            flex: 1,
            padding: "0.5rem 0.75rem",
            border: `1px solid ${
              error ? BRAND.colors.pink : BRAND.colors.dark + "33"
            }`,
            borderRadius: "0.375rem",
            fontFamily: `'${BRAND.font.family}', system-ui, sans-serif`,
            fontSize: "0.85rem",
          }}
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || draft.length === 0}
          style={{
            padding: "0.5rem 1rem",
            background: BRAND.colors.dark,
            color: "#FFFFFF",
            border: "none",
            borderRadius: "0.375rem",
            cursor:
              disabled || draft.length === 0 ? "not-allowed" : "pointer",
            opacity: disabled || draft.length === 0 ? 0.5 : 1,
            fontWeight: 600,
            fontSize: "0.85rem",
          }}
        >
          Add
        </button>
      </div>
      {error && (
        <span
          role="alert"
          style={{ color: BRAND.colors.pink, fontSize: "0.75rem" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
