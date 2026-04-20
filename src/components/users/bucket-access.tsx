"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BRAND } from "@/lib/brand";

interface BucketOption {
  readonly id: string;
  readonly name: string;
}

interface BucketAccessProps {
  readonly userId: string;
  readonly allBuckets: ReadonlyArray<BucketOption>;
  readonly initialAssignedIds: ReadonlyArray<string>;
}

export function BucketAccess({
  userId,
  allBuckets,
  initialAssignedIds,
}: BucketAccessProps) {
  const [assigned, setAssigned] = useState<Set<string>>(
    () => new Set(initialAssignedIds),
  );
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "ok"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const router = useRouter();

  const dirty = useMemo(() => {
    const initial = new Set(initialAssignedIds);
    if (initial.size !== assigned.size) return true;
    for (const id of assigned) if (!initial.has(id)) return true;
    return false;
  }, [assigned, initialAssignedIds]);

  useEffect(() => {
    setAssigned(new Set(initialAssignedIds));
  }, [initialAssignedIds]);

  function toggle(id: string) {
    setAssigned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setStatus({ kind: "idle" });
  }

  async function save() {
    setPending(true);
    setStatus({ kind: "idle" });
    try {
      const res = await fetch(`/api/users/${userId}/buckets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucketIds: Array.from(assigned) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setStatus({
          kind: "error",
          message: body.error ?? "Failed to update bucket access",
        });
        return;
      }
      setStatus({ kind: "ok", message: "Bucket access updated." });
      router.refresh();
    } catch {
      setStatus({ kind: "error", message: "Network error" });
    } finally {
      setPending(false);
    }
  }

  if (allBuckets.length === 0) {
    return (
      <p style={{ color: "rgba(30,41,59,0.64)", fontSize: "0.85rem" }}>
        No buckets configured yet.
      </p>
    );
  }

  return (
    <div>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(16rem, 1fr))",
          gap: "0.4rem",
        }}
      >
        {allBuckets.map((b) => {
          const checked = assigned.has(b.id);
          return (
            <li key={b.id}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.45rem 0.6rem",
                  border: `1px solid ${BRAND.colors.dark}1F`,
                  borderRadius: "0.375rem",
                  fontSize: "0.85rem",
                  background: checked ? "#EFF6FF" : "#FFFFFF",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={pending}
                  onChange={() => toggle(b.id)}
                />
                <span style={{ fontFamily: "ui-monospace, monospace" }}>
                  {b.name}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginTop: "0.75rem",
        }}
      >
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          style={{
            padding: "0.45rem 1rem",
            background: BRAND.colors.blue,
            color: "#FFFFFF",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: !dirty || pending ? "not-allowed" : "pointer",
            opacity: !dirty || pending ? 0.6 : 1,
          }}
        >
          {pending ? "Saving…" : "Save bucket access"}
        </button>
        {status.kind === "ok" && (
          <span style={{ color: "#16A34A", fontSize: "0.8rem" }}>
            {status.message}
          </span>
        )}
        {status.kind === "error" && (
          <span
            role="alert"
            style={{ color: BRAND.colors.pink, fontSize: "0.8rem" }}
          >
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}
