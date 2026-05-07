"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface RestoreFolderButtonProps {
  readonly bucketId: string;
  readonly prefix: string;
}

export function RestoreFolderButton({ bucketId, prefix }: RestoreFolderButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/s3/folders/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bucketId, prefix }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onClick}
        disabled={pending}
        aria-label={`Restore ${prefix}`}
      >
        <RotateCcw aria-hidden="true" className="size-3.5" />
        {pending ? "Restoring..." : "Restore"}
      </Button>
      {error ? (
        <p role="alert" className="text-destructive m-0 text-[10px]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
