"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={isPending}
      title={error ?? undefined}
      className="text-destructive hover:text-destructive hover:bg-destructive/10"
    >
      {isPending ? "Deleting…" : "Delete"}
    </Button>
  );
}
