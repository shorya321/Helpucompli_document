"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/types";
import { BRAND } from "@/lib/brand";

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

  const allowed =
    !isSelf &&
    (actorRole === "superadmin" ||
      (actorRole === "admin" && targetRole !== "superadmin"));

  if (!allowed) return null;

  const nextStatus = currentStatus === "active" ? "disabled" : "active";
  const label = nextStatus === "disabled" ? "Disable" : "Enable";
  const bg = nextStatus === "disabled" ? "#DC2626" : "#16A34A";

  function onClick() {
    setError(null);
    if (
      nextStatus === "disabled" &&
      !confirm("Disable this user? They will be signed out of Auth0.")
    ) {
      return;
    }
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
          // Local DB + audit succeeded; Auth0 user was already gone. Alert
          // operator so they can clean up the orphan row or accept drift.
          alert(
            "Status updated locally, but the Auth0 user was not found (likely deleted from the Auth0 dashboard). The local DB is now out of sync.",
          );
        }
        router.refresh();
      })();
    });
  }

  return (
    <span style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        style={{
          padding: "0.2rem 0.55rem",
          background: bg,
          color: "#FFFFFF",
          border: "none",
          borderRadius: "0.25rem",
          fontSize: "0.7rem",
          fontWeight: 600,
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "…" : label}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: "0.7rem", color: BRAND.colors.pink }}>
          {error}
        </span>
      )}
    </span>
  );
}
