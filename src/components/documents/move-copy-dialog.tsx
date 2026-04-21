"use client";

import { useState } from "react";
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

interface BucketOption {
  readonly id: string;
  readonly name: string;
}

interface MoveCopyDialogProps {
  readonly sourceBucketId: string;
  readonly sourceS3Key: string;
  readonly sourceFilename: string;
  readonly buckets: ReadonlyArray<BucketOption>;
  readonly closeHref: string;
  readonly initialMode?: "move" | "copy";
}

// Native <select> styled to match shadcn Input. The bucket picker must
// be a real <select> so value changes propagate cleanly in the controlled
// state without the Radix popover overhead.
const nativeSelectClass =
  "border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";

// Restrict the closeHref prop so a caller-supplied value cannot redirect
// to an off-site URL when the dialog closes.
function safeHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return "/documents";
  return href;
}

export function MoveCopyDialog({
  sourceBucketId,
  sourceS3Key,
  sourceFilename,
  buckets,
  closeHref,
  initialMode = "move",
}: MoveCopyDialogProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"move" | "copy">(initialMode);
  const [destBucketId, setDestBucketId] = useState<string>(
    buckets.find((b) => b.id !== sourceBucketId)?.id ?? sourceBucketId,
  );
  const [destFolderPrefix, setDestFolderPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const href = safeHref(closeHref);

  const onSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/s3/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          sourceBucketId,
          sourceS3Key,
          destBucketId,
          destFolderPrefix,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Relocation failed (${res.status})`);
      }
      router.push(href);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Relocation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) router.push(href);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Move or copy document</DialogTitle>
          </DialogHeader>

          <p className="text-muted-foreground m-0 break-all text-sm">
            {sourceFilename}
          </p>

          <fieldset className="m-0 flex flex-wrap gap-4 border-none p-0">
            <legend className="text-foreground text-xs font-semibold">
              Action
            </legend>
            <label className="text-foreground flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                value="move"
                checked={mode === "move"}
                onChange={() => setMode("move")}
              />
              Move
            </label>
            <label className="text-foreground flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                value="copy"
                checked={mode === "copy"}
                onChange={() => setMode("copy")}
              />
              Copy
            </label>
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor="dest-bucket">Destination bucket</Label>
            <select
              id="dest-bucket"
              value={destBucketId}
              onChange={(e) => setDestBucketId(e.target.value)}
              className={nativeSelectClass}
            >
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="dest-prefix">
              Destination folder prefix{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="dest-prefix"
              type="text"
              value={destFolderPrefix}
              onChange={(e) => setDestFolderPrefix(e.target.value)}
              placeholder="invoices/2026/"
            />
          </div>

          {err ? (
            <p role="alert" className="text-destructive text-sm">
              {err}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" asChild>
              <a href={href}>Cancel</a>
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "…" : mode === "move" ? "Move" : "Copy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
