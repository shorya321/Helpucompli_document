"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";

interface DeletePolicyButtonProps {
  readonly id: string;
  readonly name: string;
}

export function DeletePolicyButton({ id, name }: DeletePolicyButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    if (
      !window.confirm(
        `Delete policy "${name}"? Any links currently using it will fall back to the default policy.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/policies/${id}`, { method: "DELETE" });
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        router.refresh();
      } catch {
        setError("Network error");
      }
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      style={{
        background: "transparent",
        border: "none",
        color: BRAND.colors.pink,
        cursor: isPending ? "wait" : "pointer",
        fontWeight: 600,
        fontSize: "0.85rem",
        padding: 0,
      }}
      title={error ?? undefined}
    >
      {isPending ? "Deleting…" : "Delete"}
    </button>
  );
}
