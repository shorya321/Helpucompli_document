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

interface DeleteFolderDialogProps {
  readonly bucketId: string;
  readonly folderPrefix: string; // ends with "/"
  readonly folderName: string; // last path segment, used for hard-delete confirm
  readonly canHardDelete: boolean;
  readonly closeHref: string;
  readonly initialMode?: "soft" | "hard";
}

function safeHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return "/documents";
  return href;
}

export function DeleteFolderDialog({
  bucketId,
  folderPrefix,
  folderName,
  canHardDelete,
  closeHref,
  initialMode,
}: DeleteFolderDialogProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"soft" | "hard">(
    initialMode === "hard" && canHardDelete ? "hard" : "soft",
  );
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const href = safeHref(closeHref);

  const onSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body =
        mode === "hard"
          ? { mode, bucketId, prefix: folderPrefix, confirmName }
          : { mode, bucketId, prefix: folderPrefix };
      const res = await fetch("/api/s3/folders/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `Delete failed (${res.status})`);
      }
      router.push(href);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const hardConfirmValid =
    mode !== "hard" ||
    confirmName.trim().toLowerCase() === folderName.toLowerCase();

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
            <DialogTitle>Delete folder</DialogTitle>
          </DialogHeader>

          <p className="text-muted-foreground m-0 break-all text-sm">
            {folderPrefix}
          </p>

          <fieldset className="m-0 flex flex-col gap-2 border-none p-0">
            <legend className="text-foreground text-xs font-semibold">
              Delete mode
            </legend>
            <label className="text-foreground flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="mode"
                value="soft"
                checked={mode === "soft"}
                onChange={() => setMode("soft")}
              />
              Soft delete — every file inside marked deleted, recoverable via versioning
            </label>
            <label
              className={
                canHardDelete
                  ? "text-foreground flex items-center gap-2 text-sm"
                  : "text-muted-foreground flex items-center gap-2 text-sm opacity-50"
              }
            >
              <input
                type="radio"
                name="mode"
                value="hard"
                disabled={!canHardDelete}
                checked={mode === "hard"}
                onChange={() => setMode("hard")}
              />
              Hard delete — permanent, all files + versions purged (superadmin)
            </label>
          </fieldset>

          {mode === "hard" ? (
            <>
              <div
                role="alert"
                className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
              >
                Hard delete is permanent. Every file inside this folder and
                every version of every file will be purged from S3 and the
                database. Cannot be undone.
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-folder-name">
                  Type <code>{folderName}</code> to confirm
                </Label>
                <Input
                  id="confirm-folder-name"
                  type="text"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={folderName}
                />
              </div>
            </>
          ) : null}

          {err ? (
            <p role="alert" className="text-destructive text-sm">
              {err}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" asChild>
              <a href={href}>Cancel</a>
            </Button>
            <Button
              type="submit"
              variant={mode === "hard" ? "destructive" : "default"}
              disabled={busy || !hardConfirmValid}
            >
              {busy ? "…" : mode === "hard" ? "Delete permanently" : "Soft delete"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
