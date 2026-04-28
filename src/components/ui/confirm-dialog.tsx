"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Replaces native window.confirm / window.alert with a shadcn Dialog so
// the chrome matches the rest of the app. Two modes:
//   variant="confirm" — Confirm + Cancel buttons (returns boolean via
//     onConfirm callback). Use as drop-in for window.confirm.
//   variant="alert" — single OK button. Use as drop-in for window.alert.
// `destructive` uses the destructive button color for the confirm CTA
// — set it for revoke/delete/PHI-risk actions.
export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly variant?: "confirm" | "alert";
  readonly destructive?: boolean;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly onConfirm?: () => void | Promise<void>;
  readonly onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  variant = "confirm",
  destructive = false,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  // Reset busy when the dialog closes so a re-open never starts disabled.
  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  const handleConfirm = async () => {
    if (!onConfirm) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  };

  const isAlert = variant === "alert";
  const finalConfirmLabel = confirmLabel ?? (isAlert ? "OK" : "Confirm");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription className="whitespace-pre-line">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          {isAlert ? null : (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              {cancelLabel}
            </Button>
          )}
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={handleConfirm}
          >
            {busy ? "…" : finalConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
