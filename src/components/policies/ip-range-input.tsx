"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addCidr, removeAt } from "@/lib/policy-input-helpers";

interface IpRangeInputProps {
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly disabled?: boolean;
  readonly id?: string;
}

export function IpRangeInput({
  value,
  onChange,
  disabled,
  id,
}: IpRangeInputProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const result = addCidr(value, draft);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setDraft("");
    onChange(result.next);
  };

  const remove = (cidr: string) => {
    onChange(removeAt(value, cidr));
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        role="list"
        aria-label="Allowed IP ranges"
        className="flex min-h-6 flex-wrap gap-1.5"
      >
        {value.map((cidr) => (
          <span
            key={cidr}
            role="listitem"
            className="bg-secondary text-secondary-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs tabular-nums"
          >
            {cidr}
            <button
              type="button"
              onClick={() => remove(cidr)}
              disabled={disabled}
              aria-label={`Remove ${cidr}`}
              className="text-secondary-foreground/80 hover:text-secondary-foreground inline-flex h-4 w-4 items-center justify-center rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          type="text"
          value={draft}
          placeholder="10.0.0.0/8 or 1.2.3.4/32"
          maxLength={18}
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
          className={
            error
              ? "border-destructive focus-visible:ring-destructive flex-1 font-mono tabular-nums"
              : "flex-1 font-mono tabular-nums"
          }
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={add}
          disabled={disabled || draft.length === 0}
        >
          Add
        </Button>
      </div>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </div>
  );
}
