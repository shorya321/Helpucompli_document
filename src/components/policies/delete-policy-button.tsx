"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface DeletePolicyButtonProps {
  readonly id: string;
  readonly name: string;
}

export function DeletePolicyButton({ id, name }: DeletePolicyButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const performDelete = () => {
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
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={isPending}
        title={error ?? undefined}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        {isPending ? "Deleting…" : "Delete"}
      </Button>
      <ConfirmDialog
        open={open}
        title={`Delete policy "${name}"?`}
        description="Any links currently using it will fall back to the default policy."
        destructive
        confirmLabel="Delete"
        onConfirm={performDelete}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
