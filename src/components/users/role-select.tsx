"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/types";

interface RoleSelectProps {
  readonly userId: string;
  readonly currentRole: Role;
  readonly actorRole: Role;
  readonly isSelf: boolean;
}

function allowedRolesFor(actorRole: Role, targetCurrent: Role): Role[] {
  if (actorRole === "superadmin") return ["superadmin", "admin", "viewer"];
  if (actorRole === "admin" && targetCurrent !== "superadmin") return ["viewer"];
  return [];
}

export function RoleSelect({
  userId,
  currentRole,
  actorRole,
  isSelf,
}: RoleSelectProps) {
  const router = useRouter();
  const [value, setValue] = useState<Role>(currentRole);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const options = allowedRolesFor(actorRole, currentRole);

  // Read-only states: self-demotion block + no permitted change at all.
  if (isSelf || options.length === 0 || options.length === 1 && options[0] === currentRole) {
    return (
      <span
        style={{
          fontSize: "0.7rem",
          fontWeight: 600,
          textTransform: "uppercase",
          color: "rgba(30,41,59,0.72)",
        }}
      >
        {currentRole}
      </span>
    );
  }

  // Make sure currentRole is in options for the select to preselect.
  const displayOptions = options.includes(currentRole)
    ? options
    : [currentRole, ...options];

  async function apply(next: Role) {
    setError(null);
    setValue(next);
    if (next === currentRole) return;
    start(() => {
      void (async () => {
        const res = await fetch(`/api/users/${userId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: next }),
        });
        if (!res.ok) {
          setValue(currentRole);
          const body = (await res.json().catch(() => ({
            error: "Failed",
          }))) as { error?: string };
          setError(body.error ?? "Failed to change role");
          return;
        }
        router.refresh();
      })();
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <select
        aria-label="Change role"
        value={value}
        disabled={pending}
        onChange={(e) => apply(e.target.value as Role)}
        style={{
          padding: "0.2rem 0.4rem",
          fontSize: "0.75rem",
          border: "1px solid rgba(30,41,59,0.25)",
          borderRadius: "0.25rem",
        }}
      >
        {displayOptions.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {error && (
        <span
          role="alert"
          style={{ fontSize: "0.7rem", color: "#DC2626" }}
        >
          {error}
        </span>
      )}
    </span>
  );
}
