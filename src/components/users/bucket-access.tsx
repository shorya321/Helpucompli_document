"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

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
      <p className="text-muted-foreground text-sm">
        No buckets configured yet.
      </p>
    );
  }

  return (
    <div>
      <ul
        role="list"
        className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2 p-0"
      >
        {allBuckets.map((b) => {
          const checked = assigned.has(b.id);
          return (
            <li key={b.id}>
              <label
                className={
                  checked
                    ? "border-border bg-accent text-accent-foreground flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm"
                    : "border-border bg-background text-foreground hover:bg-accent/30 flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors"
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={pending}
                  onChange={() => toggle(b.id)}
                  className="accent-primary"
                />
                <span>{b.name}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center gap-3">
        <Button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          size="sm"
        >
          {pending ? "Saving…" : "Save bucket access"}
        </Button>
        {status.kind === "ok" && (
          <span className="text-muted-foreground text-xs">{status.message}</span>
        )}
        {status.kind === "error" && (
          <span role="alert" className="text-destructive text-xs">
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}
