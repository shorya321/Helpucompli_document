"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/types";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface StatusToggleProps {
  readonly userId: string;
  readonly currentStatus: "active" | "disabled";
  readonly targetRole: Role;
  readonly actorRole: Role;
  readonly isSelf: boolean;
}

export function StatusToggle({
  userId,
  currentStatus,
  targetRole,
  actorRole,
  isSelf,
}: StatusToggleProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [driftAlert, setDriftAlert] = useState(false);

  const allowed =
    !isSelf &&
    (actorRole === "superadmin" ||
      (actorRole === "admin" && targetRole !== "superadmin"));

  if (!allowed) return null;

  const nextStatus = currentStatus === "active" ? "disabled" : "active";
  const label = nextStatus === "disabled" ? "Disable" : "Enable";
  const variant = nextStatus === "disabled" ? "destructive" : "secondary";

  function performToggle() {
    setError(null);
    start(() => {
      void (async () => {
        const res = await fetch(`/api/users/${userId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          const msg = body.error ?? "Failed";
          console.error(
            `[status-toggle] PATCH /api/users/${userId}/status ${res.status}: ${msg}`,
          );
          setError(msg);
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          data?: { auth0Synced?: boolean };
        };
        if (body.data?.auth0Synced === false) {
          // Local DB + audit succeeded; Auth0 user was already gone.
          // Show dialog so operator can clean up the orphan row or
          // accept drift.
          setDriftAlert(true);
        }
        router.refresh();
      })();
    });
  }

  function onClick() {
    if (nextStatus === "disabled") {
      setConfirmDisable(true);
      return;
    }
    performToggle();
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        type="button"
        onClick={onClick}
        disabled={pending}
        variant={variant}
        size="sm"
        className="h-7 px-2.5 text-xs"
      >
        {pending ? "…" : label}
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
      <ConfirmDialog
        open={confirmDisable}
        title="Disable this user?"
        description="They will be signed out of Auth0."
        destructive
        confirmLabel="Disable"
        onConfirm={performToggle}
        onClose={() => setConfirmDisable(false)}
      />
      <ConfirmDialog
        open={driftAlert}
        variant="alert"
        title="Auth0 drift detected"
        description="Status updated locally, but the Auth0 user was not found (likely deleted from the Auth0 dashboard). The local DB is now out of sync."
        onClose={() => setDriftAlert(false)}
      />
    </span>
  );
}
