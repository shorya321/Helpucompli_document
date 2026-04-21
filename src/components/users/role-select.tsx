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

// Native <select> styled to match shadcn Input for a compact inline cell.
const nativeSelectClass =
  "border-input bg-background text-foreground focus-visible:ring-ring h-7 rounded-md border px-2 text-xs shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50";

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
  if (isSelf || options.length === 0 || (options.length === 1 && options[0] === currentRole)) {
    return (
      <span className="text-muted-foreground text-xs font-semibold uppercase">
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
    <span className="inline-flex items-center gap-1.5">
      <select
        aria-label="Change role"
        value={value}
        disabled={pending}
        onChange={(e) => apply(e.target.value as Role)}
        className={nativeSelectClass}
      >
        {displayOptions.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
