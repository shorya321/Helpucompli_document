"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DeleteBucketDialogProps {
  readonly bucketId: string;
  readonly bucketName: string;
  readonly closeHref: string;
  readonly onSuccessHref: string;
}

function safeHref(href: string, fallback: string): string {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return fallback;
}

export function DeleteBucketDialog({
  bucketId,
  bucketName,
  closeHref,
  onSuccessHref,
}: DeleteBucketDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmInput, setConfirmInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const safeClose = safeHref(closeHref, "/buckets");
  const safeSuccess = safeHref(onSuccessHref, "/buckets");
  const matches = confirmInput === bucketName;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) {
      setError("Bucket name does not match.");
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/s3/buckets/${bucketId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName: bucketName }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? `Request failed (${res.status})`);
        return;
      }
      startTransition(() => {
        router.push(safeSuccess);
        router.refresh();
      });
    } catch {
      setError("Network error. Try again.");
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.push(safeClose);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Delete bucket</DialogTitle>
          </DialogHeader>

          <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
            This deactivates the PostgreSQL row and deletes the S3 bucket. It
            cannot be undone. The bucket must already be empty (no active
            documents). A BUCKET_DELETE audit entry is recorded.
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-name">
              Type <code>{bucketName}</code> to confirm
            </Label>
            <Input
              id="confirm-name"
              required
              name="confirmName"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={bucketName}
            />
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" asChild>
              <a href={safeClose}>Cancel</a>
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || !matches}
            >
              {pending ? "Deleting…" : "Delete bucket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
